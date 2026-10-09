// HR Payroll, step 7b: Earnings & Deductions (owner, 2026-10-09;
// docs/modules/HR_PAYROLL.md, step 7, point 4 and decision 57).
//   - The payroll inputs (overtime, bonus, commission, one-off additions and
//     deductions) have their own module, PAYROLLED: an entry per employee,
//     month and variable element, with hours (overtime by the hour) or an
//     amount, a note and supporting documents (the shared attachments).
//   - Entered before the month's run exists, and changed until the run
//     leaves Draft: the run is the lock (decision 57: no approval of their
//     own; the run's approval covers them). No GL from the entries: the run
//     posts them, as it did its inputs.
//   - An earning can instead be paid by Interim Payroll (point 5): the entry
//     says so (PayBy "Interim"), the run leaves it out, and an interim batch
//     pays it (Dr the element's account / Cr the bank or cash).
//   Stored in Firestore payrollInputs.
'use strict';
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const setup = require('./payrollSetup');
const P = require('./payrollProvisions');
const calc = require('./payrollCalc');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'PAYROLLED';
const ENTRIES = () => firestore.collection('payrollInputs');
const EMPLOYEES = () => firestore.collection('employees');
const RUNS = () => firestore.collection('payrollRuns');

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const round2 = n => Math.round(n * 100) / 100;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const docs = snap => snap.docs.map(d => Object.assign({ EntryID: d.id }, d.data()));

const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Earnings & Deductions.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', 'You do not have permission to enter earnings and deductions.');
}
async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}

// ---------- the elements an entry goes against (as the run's inputs) ----------

// The variable elements in use, not the system ones; and the accruals paid
// with the salary (step 5a, decision 33), paid from their provision.
async function inputElements() {
  const els = (await setup.payrollElements()).filter(e => e.Nature === 'Variable' && e.Active !== false && !e.System);
  return els.concat((await P.accrualTypes()).filter(t => t.Active !== false).map(t => ({ ElementID: 'acc-' + t.AccrualTypeID, Code: t.Code,
    Name: t.Name + ' (from the provision)', Kind: 'Earning', Nature: 'Variable', Active: true, Category: 'AccrualPayout', AccrualTypeID: t.AccrualTypeID })));
}
const byHours = e => e.Category === 'Overtime' && e.Overtime && e.Overtime.Mode === 'Hours';
// Paid by Interim Payroll: an earning by amount (not overtime by the hour,
// not an accrual paid from its provision).
const interimPayable = e => e.Kind === 'Earning' && !byHours(e) && e.Category !== 'AccrualPayout';

// The employees on payroll in a month.
async function employeesIn(co, month) {
  const start = month + '-01', end = calc.monthEnd(month);
  return (await EMPLOYEES().where('CompanyID', '==', co).get()).docs.map(d => Object.assign({ EmployeeID: d.id }, d.data()))
    .filter(e => e.JoinDate && e.JoinDate <= end && !(e.LeavingDate && e.LeavingDate < start))
    .sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
}
async function runOf(co, month) {
  const snap = await RUNS().doc(co + '_' + month).get();
  return snap.exists ? Object.assign({ RunID: snap.id }, snap.data()) : null;
}
// Changed only while the month's run is a draft (or not made yet).
const runOpen = run => !run || run.Status === 'Draft';

// One row typed or pasted: employee (id or no.), element (id or code), hours
// or amount, note, paid by (Run / Interim). Returns the entry's fields.
function checkRow(r, i, emps, els, all) {
  const setupElementName = key => { const e = (all || []).find(x => x.ElementID === key || x.Code === key); return e ? e.Name : ''; };
  const empKey = text(r.EmployeeID, 80) || text(r.EmployeeNo, 40), elKey = text(r.ElementID, 80) || text(r.Code, 20).toUpperCase();
  const e = emps.find(x => x.EmployeeID === empKey || (x.EmployeeNo && x.EmployeeNo === empKey));
  if (!e) bad(i + 'employee "' + empKey + '" is not on payroll in the month.');
  const el = els.find(x => x.ElementID === elKey || x.Code === elKey);
  if (!el) {
    const known = text(r.Code, 20) ? setupElementName(elKey) : '';
    bad(i + (known ? known + ' is not entered per run' : 'pay element "' + elKey + '" is not entered per run') + ' (only variable elements are: overtime, bonus, commission, one-offs).');
  }
  const num = v => Number(String(v == null ? '' : v).replace(/,/g, ''));
  const payBy = r.PayBy === 'Interim' ? 'Interim' : 'Run';
  if (payBy === 'Interim' && !interimPayable(el)) bad(i + el.Name + ' is paid with the salary: only an earning by amount (a bonus, a commission...) can be paid by Interim Payroll.');
  const out = { EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo || '', EmployeeName: e.FullName || '', ElementID: el.ElementID, Code: el.Code, ElementName: el.Name, Kind: el.Kind,
    Hours: null, Amount: null, Note: text(r.Note, 150), PayBy: payBy };
  if (byHours(el)) {
    out.Hours = num(r.Hours);
    if (!(out.Hours > 0 && out.Hours <= 744)) bad(i + el.Name + ' is paid by the hour: enter the hours (more than 0).');
  } else {
    out.Amount = round2(num(r.Amount));
    if (!(out.Amount > 0)) bad(i + 'enter the ' + el.Name + ' amount (more than 0).');
  }
  return out;
}

// ---------- shared with the run (payrollRun.js) and Interim Payroll ----------

// The month's entries the run pays (not those paid by Interim Payroll), by
// employee, as the run's inputs; and a key of them, so a run knows when they
// changed since it was worked out.
async function runInputs(co, month) {
  const list = docs(await ENTRIES().where('CompanyID', '==', co).get()).filter(x => x.Month === month && x.PayBy !== 'Interim')
    .sort((a, b) => a.EntryID.localeCompare(b.EntryID));
  const byEmp = {};
  list.forEach(x => (byEmp[x.EmployeeID] = byEmp[x.EmployeeID] || []).push(Object.assign({ ElementID: x.ElementID, Note: x.Note || '', EntryID: x.EntryID },
    x.Hours != null ? { Hours: x.Hours } : { Amount: x.Amount })));
  const key = crypto.createHash('sha1').update(list.map(x => x.EntryID + ':' + (x.UpdatedAt || x.CreatedAt || '')).join('|')).digest('hex');
  return { byEmp, key, count: list.length };
}
// A run's inputs from before this step (kept on its slips) become entries,
// once: the first time the run is worked out with none for its month.
async function adoptRunInputs(run, slips, user) {
  const has = (await ENTRIES().where('CompanyID', '==', run.CompanyID).get()).docs.some(d => d.data().Month === run.Month);
  if (has) return 0;
  const els = Object.fromEntries((await inputElements()).map(e => [e.ElementID, e]));
  const now = new Date().toISOString();
  const rows = [];
  slips.forEach(s => (s.Inputs || []).forEach(x => {
    const el = els[x.ElementID] || {};
    rows.push({ CompanyID: run.CompanyID, Month: run.Month, EmployeeID: s.EmployeeID, EmployeeNo: s.EmployeeNo || '', EmployeeName: s.EmployeeName || '',
      ElementID: x.ElementID, Code: el.Code || '', ElementName: el.Name || x.ElementID, Kind: el.Kind || 'Earning',
      Hours: x.Hours != null ? x.Hours : null, Amount: x.Hours != null ? null : x.Amount, Note: x.Note || '', PayBy: 'Run',
      CreatedAt: now, CreatedBy: user.uid, CreatedByName: 'Moved from the run', UpdatedAt: now });
  }));
  for (let i = 0; i < rows.length; i += 400) { const b = firestore.batch(); rows.slice(i, i + 400).forEach(r => b.set(ENTRIES().doc(), r)); await b.commit(); }
  return rows.length;
}
// Replaces the month's run entries with rows (the run's own "inputs" call,
// kept for its callers; the screen enters them in Earnings & Deductions).
async function replaceRunInputs(run, rows, user) {
  const [emps, els, all] = await Promise.all([employeesIn(run.CompanyID, run.Month), inputElements(), setup.payrollElements()]);
  const out = [];
  rows.forEach((r, n) => {
    const hasValue = [r.Hours, r.Amount].some(v => v !== '' && v != null);
    if (!text(r.EmployeeID) && !text(r.EmployeeNo) && !text(r.ElementID) && !text(r.Code) && !hasValue && !text(r.Note)) return;
    out.push(checkRow(Object.assign({}, r, { PayBy: 'Run' }), 'Row ' + (n + 1) + ': ', emps, els, all));
  });
  const old = (await ENTRIES().where('CompanyID', '==', run.CompanyID).get()).docs.filter(d => d.data().Month === run.Month && d.data().PayBy !== 'Interim');
  const now = new Date().toISOString();
  const writes = old.map(d => b => b.delete(d.ref)).concat(out.map(x => b => b.set(ENTRIES().doc(), Object.assign(x, { CompanyID: run.CompanyID, Month: run.Month,
    CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user), UpdatedAt: now }))));
  for (let i = 0; i < writes.length; i += 400) { const b = firestore.batch(); writes.slice(i, i + 400).forEach(w => w(b)); await b.commit(); }
}

// ---------- callables ----------

// A company's month: its entries (with where each stands), the employees
// and elements to enter them against, and whether they can change.
exports.getEarningsDeductions = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  const companies = Object.entries((await rtdb.ref('companies').get()).val() || {}).filter(([id, c]) => c.Status === 'Active' && userCanAccessCompany(user.profile, id))
    .map(([id, c]) => ({ CompanyID: id, Name: c.LegalName || id }));
  if (!d.companyId) return { companies, canDraft: await can(user, 'draft') };
  const co = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) bad('Choose the month.');
  const [emps, els, run, entries] = await Promise.all([employeesIn(co, month), inputElements(), runOf(co, month),
    ENTRIES().where('CompanyID', '==', co).get().then(s => docs(s).filter(x => x.Month === month))]);
  const open = runOpen(run);
  const state = x => (x.PayBy === 'Interim'
    ? (x.InterimPaid ? 'Paid by ' + x.InterimNumber : x.InterimID ? 'In interim payroll ' + x.InterimNumber : 'For interim payroll')
    : run ? (run.Status === 'Posted' ? 'Posted with the run' : run.Status === 'Draft' ? 'In the draft run' : 'In the run (' + (run.Status === 'PendingApproval' ? 'pending approval' : 'approved') + ')') : 'For the run');
  const editable = x => (x.PayBy === 'Interim' ? !x.InterimID : open);
  return {
    companies, companyId: co, month,
    run: run ? { RunID: run.RunID, Status: run.Status } : null,
    canDraft: await can(user, 'draft'), runOpen: open,
    employees: emps.map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo || '', Name: e.FullName || '' })),
    elements: els.map(e => ({ ElementID: e.ElementID, Code: e.Code, Name: e.Name, Kind: e.Kind, Hours: byHours(e), Interim: interimPayable(e) })),
    entries: entries.sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)) || String(a.Code).localeCompare(String(b.Code)))
      .map(x => Object.assign(x, { State: state(x), Editable: editable(x) }))
  };
});

// Adds or changes one entry, or adds rows pasted from Excel (rows).
exports.saveEarningsDeductions = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) bad('Choose the month.');
  const rows = Array.isArray(d.rows) ? d.rows : d.entry ? [d.entry] : [];
  if (!rows.length) bad('Enter at least one row.');
  if (rows.length > 5000) bad('At most 5,000 rows at a time.');
  const [emps, els, run, all] = await Promise.all([employeesIn(co, month), inputElements(), runOf(co, month), setup.payrollElements()]);
  const now = new Date().toISOString();
  const writes = [];
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    const label = rows.length > 1 ? 'Row ' + (n + 1) + ': ' : '';
    const x = checkRow(r, label, emps, els, all);
    if (x.PayBy === 'Run' && !runOpen(run)) throw failed(label + 'the ' + month + ' run is ' + (run.Status === 'Posted' ? 'posted' : 'past its draft') + ': its earnings and deductions can no longer change' + (run.Status === 'Posted' ? '.' : ' (reject or reverse it first).'));
    const id = text(r.EntryID, 80);
    if (id) {
      const cur = (await ENTRIES().doc(id).get()).data();
      if (!cur || cur.CompanyID !== co || cur.Month !== month) throw new HttpsError('not-found', label + 'entry not found.');
      if (cur.InterimID) throw failed(label + 'it is in interim payroll ' + cur.InterimNumber + ': it can no longer change.');
      if (cur.PayBy !== 'Interim' && !runOpen(run)) throw failed(label + 'the ' + month + ' run is past its draft: the entry can no longer change.');
      writes.push(b => b.update(ENTRIES().doc(id), Object.assign(x, { UpdatedAt: now, UpdatedBy: user.uid, UpdatedByName: actorName(user) })));
    } else {
      writes.push(b => b.set(ENTRIES().doc(), Object.assign(x, { CompanyID: co, Month: month, CreatedAt: now, CreatedBy: user.uid, CreatedByName: actorName(user), UpdatedAt: now })));
    }
  }
  for (let i = 0; i < writes.length; i += 400) { const b = firestore.batch(); writes.slice(i, i + 400).forEach(w => w(b)); await b.commit(); }
  return { success: true, saved: writes.length };
});

exports.deleteEarningsDeduction = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const id = text((request.data || {}).entryId, 80);
  const cur = id && (await ENTRIES().doc(id).get()).data();
  if (!cur) throw new HttpsError('not-found', 'Entry not found.');
  if (!userCanAccessCompany(user.profile, cur.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (cur.InterimID) throw failed('It is in interim payroll ' + cur.InterimNumber + ': take it out of the batch first.');
  if (cur.PayBy !== 'Interim' && !runOpen(await runOf(cur.CompanyID, cur.Month))) throw failed('The ' + cur.Month + ' run is past its draft: the entry can no longer change.');
  await ENTRIES().doc(id).delete();
  return { success: true };
});

// ---------- paid by Interim Payroll (point 5) ----------

// An entry waiting for Interim Payroll: not paid, in no other batch.
const interimDue = (x, batchId) => x.PayBy === 'Interim' && !x.InterimPaid && (!x.InterimID || x.InterimID === batchId);
// Paid: Dr the element's account (the company's, at the employee's cost
// center) / Cr the cash or bank account; the batch number as the reference.
async function payEntry(user, x, payDate, accountId, batch) {
  if (!interimDue(x, batch.InterimID)) throw failed(x.EmployeeName + ' ' + x.ElementName + ' is already paid.');
  const [coa, els, emp] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), setup.payrollElements(), EMPLOYEES().doc(x.EmployeeID).get().then(s => s.data() || {})]);
  const el = els.find(e => e.ElementID === x.ElementID);
  const exp = el && coa[calc.accountFor(el, x.CompanyID)];
  if (!exp) throw failed('Set ' + x.ElementName + '\'s GL account in Payroll Setup → Payroll Accounting.');
  const bank = coa[accountId];
  if (!bank) throw failed('Choose the cash or bank account it is paid from.');
  const label = x.ElementName + ' paid — ' + (x.EmployeeNo ? x.EmployeeNo + ' ' : '') + x.EmployeeName + ' (' + batch.Number + ')';
  return withGlobalLock(user.uid, async () => {
    const fresh = (await ENTRIES().doc(x.EntryID).get()).data();
    if (!fresh || !interimDue(fresh, batch.InterimID)) throw failed('The entry changed: open the batch again.');
    let gl;
    try {
      gl = await writeStockGlEntry(user, 'PayrollPayment', payDate, label, batch.Number,
        [{ AccountCode: exp.AccountCode, Debit: x.Amount, Credit: 0, Description: label, CostCenterID: emp.CostCenterID || '' },
          { AccountCode: bank.AccountCode, Debit: 0, Credit: x.Amount, Description: label }],
        { CompanyID: x.CompanyID }, { PayrollInterimID: batch.InterimID, SourceTransactionID: x.EntryID, ReversalOfJV: '' });
    } catch (e) { throw failed(e.message); }
    await ENTRIES().doc(x.EntryID).update({ InterimPaid: true, PaymentDate: payDate, PaymentJVID: gl.jvId, PaymentJVNumber: gl.jvNumber, UpdatedAt: new Date().toISOString() });
    return gl;
  });
}
// The payment reversed: a mirror journal; the entry waits to be paid again.
async function unpayEntry(user, x, reason) {
  if (!x.InterimPaid || !x.PaymentJVID) throw failed('The entry is not paid.');
  const ref = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(x.PaymentJVID);
  const e = (await ref.get()).data();
  const gl = await writeStockGlEntry(user, 'PayrollPayment', e.JVDate, 'Reversal of ' + e.JVNumber + ' — ' + reason, e.JVNumber,
    e.Lines.map(l => ({ AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: l.Description, CostCenterID: l.CostCenterID || '' })),
    { CompanyID: x.CompanyID }, { PayrollInterimID: e.PayrollInterimID || '', SourceTransactionID: x.EntryID, ReversalOfJV: x.PaymentJVID });
  await ref.update({ ReversedByJV: gl.jvId, UpdatedAt: new Date().toISOString() });
  await ENTRIES().doc(x.EntryID).update({ InterimPaid: false, PaymentDate: '', PaymentJVID: '', PaymentJVNumber: '', UpdatedAt: new Date().toISOString() });
  return gl;
}

Object.assign(module.exports, { ENTRIES, runInputs, adoptRunInputs, replaceRunInputs, inputElements, interimPayable, byHours, interimDue, payEntry, unpayEntry });
