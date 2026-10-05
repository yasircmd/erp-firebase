// HR Payroll, step 5b: the final settlement (owner, 2026-10-05;
// docs/modules/HR_PAYROLL.md, "Step 5b design", decisions 29, 34, 36-39).
//   - Its own document (module PAYROLLFS, "Final Settlements"): one per
//     employee who is on notice or has left, drafted once a leaving date is
//     set, submitted once the leaving month's run is posted (that run pays
//     the last days and brings the provisions to the leaving date).
//   - Worked out on the leaving date: gratuity (Payroll Setup's rule, never
//     reduced for the reason, decision 29), the annual leave balance (paid,
//     or a negative balance deducted, decision 37), the accruals paid at
//     leaving, notice pay (days × the gross daily rate, paid or deducted,
//     decision 36), other additions and deductions, every running loan
//     (decision 38). Gratuity, leave salary and accruals can be changed by
//     hand with a reason (e.g. 0 for dismissal).
//   - Approval (Approval Configuration → "Final settlement"); the final
//     approval posts it (voucher FinalSettlement, FS, dated the leaving
//     date): each provision used (the difference to its expense), lapsed
//     accruals taken back, the loans' receivables, the net to Salaries
//     Payable (or, owed by the employee, to Recoverable from employees).
//   - Paid as a run is (decision 39): the bank file, or a cash or bank
//     account; Mark paid; reverse the payment.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { leaveTypes } = require('./hrLeaveSetup');
const lv = require('./hrLeave');
const setup = require('./payrollSetup');
const calc = require('./payrollCalc');
const files = require('./payrollFiles');
const loans = require('./payrollLoans');
const P = require('./payrollProvisions');
const R = require('./payrollRun');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'PAYROLLFS';
const VOUCHER_TYPE = 'FinalSettlement';
const PAYMENT_TYPE = 'PayrollPayment';
const SETTLEMENTS = () => firestore.collection('payrollSettlements');
const EMPLOYEES = () => firestore.collection('employees');
const FORMATS = () => firestore.collection('payrollPaymentFormats');
const CC_TYPES = ['Expense', 'Revenue', 'COGS'];
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const num = v => (v === '' || v == null ? NaN : Number(String(v).replace(/,/g, '')));
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const isCashOrBank = a => a && a.AccountType === 'Asset' && ['10', '11'].includes(String(a.AccountCode).slice(0, 2));
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const actorOf = user => user.profile.username || user.uid; // as My Drafts matches
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const docs = (snap, key) => snap.docs.map(d => Object.assign({ [key]: d.id }, d.data()));
const history = (s, event, user, extra) => (s.History || []).concat([Object.assign({ Event: event, By: actorName(user), At: new Date().toISOString() }, extra || {})]);
const LEAVING = ['On notice', 'Left'];
const companyNow = () => new Date(Date.now() + 4 * 3600000); // Asia/Dubai, for the bank file

// ---------- rights ----------

const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Final Settlements.');
  if (cap && !(await can(user, cap))) {
    throw new HttpsError('permission-denied', cap === 'pay' ? 'You do not have permission to pay final settlements.'
      : cap === 'post' ? 'You do not have permission to reverse final settlements.' : 'You do not have permission to prepare final settlements.');
  }
}
async function loadSettlement(user, id) {
  const snap = await SETTLEMENTS().doc(text(id, 120) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Final settlement not found.');
  const s = Object.assign({ SettlementID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, s.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return s;
}
// One settlement per employee: its id is the employee's.
const idOf = empId => 'fs_' + empId;
// A settlement that is past its draft holds the employee's provisions and
// loans: claims, repayments and payouts wait for it (payrollProvisions,
// payrollLoans).
async function activeFor(employeeId) {
  const snap = await SETTLEMENTS().doc(idOf(employeeId)).get();
  const s = snap.exists ? snap.data() : null;
  return s && s.Status !== 'Draft' ? Object.assign({ SettlementID: snap.id }, s) : null;
}

// ---------- the calculation (on the leaving date) ----------

// The compensation in force on the date: its basic and gross (as the run's).
function payOn(versions, date, elements) {
  const ref = calc.versionOn(versions, date);
  if (!ref) return { basic: 0, gross: 0 };
  const el = l => elements[l.ElementID] || l;
  return { basic: (ref.Lines.find(l => el(l).IsBasic) || { Amount: 0 }).Amount,
    gross: round2(ref.Lines.filter(l => el(l).Kind === 'Earning' && el(l).InGross).reduce((t, l) => t + l.Amount, 0)) };
}

// The settlement's lines. d: { Notice: { Days, Mode, ElementID },
// Overrides: { key: { Amount, Reason } }, Others: [{ ElementID, Amount, Note }] }.
async function compute(emp, d) {
  const co = emp.CompanyID, date = emp.LeavingDate, month = date.slice(0, 7);
  const [settings, els, prov, types, versionsSnap, provided, leaves, grade, lvTypes, loanSnap] = await Promise.all([
    setup.companySettings(co), setup.payrollElements(), P.provisionSettings(co), P.accrualTypes(),
    firestore.collection('employeeCompensation').where('EmployeeID', '==', emp.EmployeeID).get(), P.providedBefore(co, '9999-12'),
    lv.leavesOf(emp.EmployeeID), lv.gradeLevel(emp), leaveTypes(), firestore.collection('payrollLoans').where('EmployeeID', '==', emp.EmployeeID).get()]);
  const elements = Object.fromEntries(els.map(e => [e.ElementID, e]));
  const method = settings.DailyRateMethod;
  const { basic, gross } = payOn(docs(versionsSnap, '_id'), date, elements);
  const mine = provided[emp.EmployeeID] || {};
  const over = d.Overrides || {};
  const lines = [], warnings = [];
  // A provision's line: worked out, or HR's own amount with a reason.
  const provisionLine = (key, name, worked, workedText, extra) => {
    const o = over[key];
    const amount = o ? round2(num(o.Amount)) : worked;
    const kind = amount < 0 ? 'Deduction' : 'Earning';
    lines.push(Object.assign({ Key: key, Kind: kind, Name: name, Amount: round2(Math.abs(amount)), Signed: amount, Worked: worked, Text: workedText,
      Provided: round2(mine[key] || 0), Reason: o ? text(o.Reason, 300) : '' }, extra || {}));
  };
  // Gratuity: the rule on the leaving date; service less the unpaid days.
  const unpaid = leaves.filter(l => l.Status === 'Approved' || l.Status === 'Cancelled')
    .reduce((t, l) => t + (l.Lines || []).filter(x => x.Pay === 'Unpaid' && x.Date <= date).reduce((a, x) => a + x.Fraction, 0), 0);
  const g = calc.gratuityFor(prov.Gratuity, { base: prov.Gratuity.Base === 'Gross' ? gross : basic, joinDate: emp.JoinDate, asOf: date, unpaidDays: unpaid, method, month, provision: false });
  provisionLine('Gratuity', 'Gratuity', g.amount, g.text + (unpaid ? ' (' + round2(unpaid) + ' unpaid days left out)' : ''));
  // Leave: the annual leave balance on the leaving date, paid, or deducted if negative.
  const cache = { leaves, grade };
  let days = 0;
  for (const t of lvTypes.filter(x => x.Kind === 'Leave' && x.UsesBalance && x.Active !== false)) { const b = await lv.balanceOf(emp, t, date, null, cache); days += b.Available + b.Booked; }
  const ls = calc.leaveSalaryFor({ days: round2(days), base: prov.LeaveSalary.Base === 'Gross' ? gross : basic, method, month });
  provisionLine('LeaveSalary', days < 0 ? 'Leave taken in advance' : 'Leave salary (unused leave)', ls.amount, ls.text);
  // Accruals: paid at leaving, or lapsed (the provision taken back).
  types.forEach(t => {
    const key = P.keyOf('Accrual', t.AccrualTypeID), balance = round2(mine[key] || 0);
    if (t.PaidAtLeaving && balance > 0) provisionLine(key, t.Name, balance, 'the balance provided', { AccrualTypeID: t.AccrualTypeID });
    else if (balance) lines.push({ Key: key, Kind: 'Lapse', Name: t.Name + ' (lapses)', Amount: 0, Signed: 0, Worked: 0, Text: money(balance) + ' provided is taken back', Provided: balance, AccrualTypeID: t.AccrualTypeID });
  });
  // Notice pay: days × the gross daily rate, paid or deducted.
  const n = d.Notice || {};
  const nDays = round2(num(n.Days) || 0);
  if (nDays) {
    const daily = calc.dailyRate(gross, method, month);
    const el = elements[n.ElementID];
    if (!el || el.System || el.Active === false) bad('Choose the pay element notice pay posts to.');
    const want = n.Mode === 'Deduct' ? 'Deduction' : 'Earning';
    if (el.Kind !== want) bad('Notice ' + (want === 'Earning' ? 'paid' : 'deducted') + ' goes on ' + (want === 'Earning' ? 'an earning' : 'a deduction') + ' element.');
    lines.push({ Key: 'Notice', Kind: want, Name: 'Notice pay' + (want === 'Deduction' ? ' (short notice)' : ' (in lieu)'), Amount: round2(nDays * daily), ElementID: el.ElementID,
      Text: nDays + ' days × ' + calc.dailyText(gross, method, month) + ' (gross)' });
  }
  // Other additions and deductions.
  (d.Others || []).forEach((o, i) => {
    const el = elements[o.ElementID];
    if (!el || el.System || el.Active === false) bad('Line ' + (i + 1) + ': choose a pay element.');
    const amount = round2(num(o.Amount));
    if (!(amount > 0)) bad('Line ' + (i + 1) + ': enter an amount more than 0.');
    lines.push({ Key: 'Other' + (i + 1), Kind: el.Kind, Name: el.Name, Amount: amount, ElementID: el.ElementID, Text: text(o.Note, 200) });
  });
  // Every running loan's balance (decision 38).
  const running = docs(loanSnap, 'LoanID').filter(l => l.Status === 'Active' && l.PayoutJVID && l.CompanyID === co);
  if (running.length) {
    const recs = await loans.recoveriesOf(co);
    running.sort((a, b) => String(a.LoanNumber).localeCompare(String(b.LoanNumber))).forEach(l => {
      const balance = loans.balanceOf(l, recs[l.LoanID]);
      if (balance > 0) lines.push({ Key: 'Loan:' + l.LoanID, Kind: 'Deduction', Name: 'Loan recovery: ' + l.TypeName + ' ' + l.LoanNumber, Amount: balance, LoanID: l.LoanID, Text: 'the balance owed' });
    });
  }
  const earnings = round2(lines.filter(l => l.Kind === 'Earning').reduce((t, l) => t + l.Amount, 0));
  const deductions = round2(lines.filter(l => l.Kind === 'Deduction').reduce((t, l) => t + l.Amount, 0));
  const net = round2(earnings - deductions);
  if (net < 0) warnings.push('The employee owes ' + money(-net) + ': it stays on Recoverable from employees.');
  if (!basic) warnings.push('No pay in force on the leaving date.');
  return { Lines: lines, Earnings: earnings, Deductions: deductions, Net: net, Basic: basic, Gross: gross, Method: method, LeaveDays: round2(days), UnpaidDays: round2(unpaid), Warnings: warnings };
}

// The journal's lines (posting, and the accounts checked at submit).
async function glLinesFor(s) {
  const co = s.CompanyID, label = ' — final settlement ' + (s.Number || '') + ' ' + s.EmployeeName;
  const [coaSnap, settings, els, prov, types, loanTypes] = await Promise.all([rtdb.ref('coa').get(), setup.companySettings(co), setup.payrollElements(), P.provisionSettings(co), P.accrualTypes(), loans.loanTypes()]);
  const coa = coaSnap.val() || {};
  const elements = Object.fromEntries(els.map(e => [e.ElementID, e]));
  const byType = Object.fromEntries(types.map(t => [t.AccrualTypeID, t]));
  const loanType = Object.fromEntries(loanTypes.map(t => [t.LoanTypeID, t]));
  const provAccount = (key, side) => key === 'Gratuity' ? prov.Gratuity[side + 'AccountID'] : key === 'LeaveSalary' ? prov.LeaveSalary[side + 'AccountID']
    : byType[key.slice(8)] ? P.accrualAccount(byType[key.slice(8)], side, co) : '';
  const missing = new Set(), out = [];
  let noCc = false;
  // signed: more than 0 a debit, less a credit.
  const add = (accountId, what, signed) => {
    const amount = round2(signed);
    if (!amount) return;
    const a = coa[accountId];
    if (!accountId || !a) { missing.add(what); return; }
    const cc = CC_TYPES.includes(a.AccountType);
    if (cc && !s.CostCenterID) noCc = true;
    out.push({ AccountCode: a.AccountCode, Debit: amount > 0 ? amount : 0, Credit: amount < 0 ? -amount : 0, Description: what + label, CostCenterID: cc ? s.CostCenterID : '' });
  };
  const loanAcc = {};
  for (const l of s.Lines.filter(x => x.LoanID)) {
    const ln = (await firestore.collection('payrollLoans').doc(l.LoanID).get()).data();
    loanAcc[l.LoanID] = ln && loanType[ln.LoanTypeID] ? loans.accountFor(loanType[ln.LoanTypeID], co) : '';
  }
  s.Lines.forEach(l => {
    if (l.Key === 'Gratuity' || l.Key === 'LeaveSalary' || l.Key.startsWith('Accrual:')) {
      // The provision used, and the difference to (or back from) its expense.
      const name = l.Key === 'Gratuity' ? 'Gratuity' : l.Key === 'LeaveSalary' ? 'Leave salary' : l.Name.replace(/ \(lapses\)$/, '');
      add(provAccount(l.Key, 'Provision'), name + ' provision', l.Provided);
      add(provAccount(l.Key, 'Expense'), name + ' expense', l.Signed - l.Provided);
    } else if (l.LoanID) add(loanAcc[l.LoanID], l.Name.replace(/ LN-\d+$/, ''), -l.Amount);
    else { const el = elements[l.ElementID]; add(el ? calc.accountFor(el, co) : '', l.Name, l.Kind === 'Earning' ? l.Amount : -l.Amount); }
  });
  if (s.Net > 0) add(settings.PayableAccountID, 'Salaries Payable', -s.Net);
  if (s.Net < 0) add(settings.ReceivableAccountID, 'Recoverable from employees', -s.Net);
  if (missing.size) throw failed('Set the GL accounts in Payroll Setup first: ' + [...missing].join(', ') + '.');
  if (noCc) throw failed(s.EmployeeName + ' has no cost center for the expense.');
  return out;
}

// ---------- the list and a settlement ----------

exports.getSettlements = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const [snap, empSnap] = await Promise.all([SETTLEMENTS().get(), EMPLOYEES().get()]);
  const settlements = docs(snap, 'SettlementID').filter(s => userCanAccessCompany(user.profile, s.CompanyID))
    .map(s => ({ SettlementID: s.SettlementID, Number: s.Number || '', EmployeeID: s.EmployeeID, EmployeeNo: s.EmployeeNo, EmployeeName: s.EmployeeName, CompanyID: s.CompanyID,
      LeavingDate: s.LeavingDate, Net: s.Net, Status: s.Status, PaidAt: s.PaidAt || '' }))
    .sort((a, b) => String(b.LeavingDate).localeCompare(String(a.LeavingDate)));
  const have = new Set(settlements.map(s => s.EmployeeID));
  // Those who can have one: on notice or left, with a leaving date, none yet.
  const leavers = docs(empSnap, 'EmployeeID').filter(e => LEAVING.includes(e.Status) && e.LeavingDate && !have.has(e.EmployeeID) && userCanAccessCompany(user.profile, e.CompanyID))
    .map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID, LeavingDate: e.LeavingDate, Status: e.Status }))
    .sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  return { settlements, leavers, canDraft: await can(user, 'draft') };
});

async function employeeFor(user, id) {
  const snap = await EMPLOYEES().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Employee not found.');
  const e = Object.assign({ EmployeeID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return e;
}
// The leaving month's run, posted? (submit waits for it)
async function leavingRun(co, date) {
  const runs = R.docs(await R.RUNS().where('CompanyID', '==', co).get()).filter(r => r.Month === date.slice(0, 7));
  return runs[0] || null;
}
// A draft's fields from the employee and the calculation.
async function draftFields(emp, d) {
  if (!LEAVING.includes(emp.Status) || !emp.LeavingDate) throw failed(emp.FullName + ' has no leaving date: set it (On notice or Left) on the employee record first.');
  const c = await compute(emp, d);
  return Object.assign({ EmployeeID: emp.EmployeeID, EmployeeNo: emp.EmployeeNo || '', EmployeeName: emp.FullName || '', CompanyID: emp.CompanyID, CostCenterID: emp.CostCenterID || '',
    JoinDate: emp.JoinDate, LeavingDate: emp.LeavingDate, LeavingReason: emp.LeavingReason || '', Notice: d.Notice || {}, Overrides: d.Overrides || {}, Others: d.Others || [], Note: text(d.Note, 500),
    CalculatedAt: new Date().toISOString() }, c);
}
function cleanInput(d) {
  const n = d.notice || {};
  const overrides = {};
  Object.entries(d.overrides || {}).forEach(([k, o]) => {
    if (!o || o.Amount === '' || o.Amount == null) return;
    const amount = num(o.Amount);
    if (!(amount >= 0)) bad('An amount of your own is 0 or more.');
    if (!text(o.Reason, 300)) bad('Give the reason for changing an amount.');
    overrides[text(k, 120)] = { Amount: round2(amount), Reason: text(o.Reason, 300) };
  });
  const days = num(n.Days);
  if (n.Days !== '' && n.Days != null && !(days >= 0)) bad('Notice days are 0 or more.');
  return { Notice: { Days: days > 0 ? round2(days) : 0, Mode: n.Mode === 'Deduct' ? 'Deduct' : 'Pay', ElementID: text(n.ElementID, 80) },
    Overrides: overrides, Others: (d.others || []).filter(o => o && (o.ElementID || o.Amount)).map(o => ({ ElementID: text(o.ElementID, 80), Amount: o.Amount, Note: text(o.Note, 200) })), Note: d.note };
}

// A leaver's settlement: the saved one, else worked out afresh to start one.
exports.getSettlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  let s;
  if (d.settlementId) {
    s = await loadSettlement(user, d.settlementId);
    if (s.Status === 'Draft') {
      // A draft follows the employee record and the balances until it's submitted.
      const emp = await employeeFor(user, s.EmployeeID);
      try { s = Object.assign({}, s, await draftFields(emp, s)); } catch (e) { s = Object.assign({}, s, { Warnings: (s.Warnings || []).concat([e.message]) }); }
    }
  } else {
    const emp = await employeeFor(user, d.employeeId);
    const existing = await SETTLEMENTS().doc(idOf(emp.EmployeeID)).get();
    if (existing.exists) throw new HttpsError('already-exists', emp.FullName + ' already has a final settlement.');
    s = Object.assign({ SettlementID: '', Status: 'New' }, await draftFields(emp, {}));
  }
  const run = s.LeavingDate ? await leavingRun(s.CompanyID, s.LeavingDate) : null;
  const els = (await setup.payrollElements()).filter(e => !e.System && e.Active !== false).map(e => ({ ElementID: e.ElementID, Code: e.Code, Name: e.Name, Kind: e.Kind }));
  return { settlement: s, elements: els, leavingRun: run ? { RunID: run._id, Month: run.Month, Status: run.Status } : null, approval: await R.approvalOf(s, user),
    canDraft: await can(user, 'draft'), canPost: await can(user, 'post'), canPay: await can(user, 'pay') };
});

exports.saveSettlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const emp = await employeeFor(user, d.employeeId);
  const ref = SETTLEMENTS().doc(idOf(emp.EmployeeID));
  const snap = await ref.get();
  if (snap.exists && snap.data().Status !== 'Draft') throw failed('Only a draft is changed.');
  const fields = await draftFields(emp, cleanInput(d));
  const now = new Date().toISOString();
  const cur = snap.exists ? snap.data() : { History: [] };
  await ref.set(Object.assign({}, cur, fields, { Status: 'Draft', UpdatedAt: now, UpdatedBy: actorOf(user), CreatedAt: cur.CreatedAt || now, CreatedBy: cur.CreatedBy || actorOf(user),
    Description: 'Final settlement — ' + emp.FullName, History: snap.exists ? cur.History : history({}, 'Drafted', user) }));
  return { success: true, settlementId: ref.id, net: fields.Net };
});

exports.deleteSettlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const s = await loadSettlement(user, (request.data || {}).settlementId);
  if (s.Status !== 'Draft') throw failed('Only a draft is deleted.');
  await SETTLEMENTS().doc(s.SettlementID).delete();
  return { success: true };
});

// ---------- submit, approval, posting ----------

async function nextNumber() {
  const res = await rtdb.ref('hrCounters/FS').transaction(cur => (Number(cur) || 0) + 1);
  return 'FS-' + String(res.snapshot.val()).padStart(4, '0');
}
async function posterFor(user, s) {
  if (userCanAccessCompany(user.profile, s.CompanyID)) return user;
  const profile = (await rtdb.ref('users/' + s.SubmittedBy).get()).val();
  if (!profile) throw failed('The user who submitted the settlement no longer exists.');
  return { uid: s.SubmittedBy, profile };
}
async function postSettlement(id, user) {
  return withGlobalLock(user.uid, async () => {
    const snap = await SETTLEMENTS().doc(id).get();
    const s = Object.assign({ SettlementID: snap.id }, snap.data());
    if (s.Status !== 'Approved') throw failed('Only an approved settlement is posted.');
    const lines = await glLinesFor(s);
    const gl = await writeStockGlEntry(await posterFor(user, s), VOUCHER_TYPE, s.LeavingDate, 'Final settlement ' + s.Number + ' — ' + s.EmployeeName, s.Number, lines,
      { CompanyID: s.CompanyID }, { PayrollSettlementID: s.SettlementID, SourceTransactionID: s.SettlementID, ReversalOfJV: '' });
    // Each loan is recovered by the settlement (a repayment it reverses with it).
    for (const l of s.Lines.filter(x => x.LoanID)) {
      const ref = firestore.collection('payrollLoans').doc(l.LoanID);
      const ln = (await ref.get()).data();
      await ref.update({ Repayments: (ln.Repayments || []).concat([{ Date: s.LeavingDate, Amount: l.Amount, JVID: gl.jvId, JVNumber: gl.jvNumber, SettlementID: s.SettlementID,
        Note: 'Final settlement ' + s.Number, By: actorName(user) }]), UpdatedAt: new Date().toISOString() });
    }
    await SETTLEMENTS().doc(id).update({ Status: 'Posted', JVID: gl.jvId, JVNumber: gl.jvNumber, PostedAt: new Date().toISOString(), PostedByName: actorName(user), PostError: '',
      History: history(s, 'Posted', user, { JVNumber: gl.jvNumber }) });
    return gl;
  });
}
async function postAndReport(id, user) {
  try {
    const gl = await postSettlement(id, user);
    return { success: true, status: 'Posted', jvNumber: gl.jvNumber };
  } catch (e) {
    await SETTLEMENTS().doc(id).update({ PostError: e.message });
    return { success: true, status: 'Approved', postError: e.message };
  }
}

exports.submitSettlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const s0 = await loadSettlement(user, (request.data || {}).settlementId);
  if (s0.Status !== 'Draft') throw failed('Only a draft is submitted.');
  const emp = await employeeFor(user, s0.EmployeeID);
  const run = await leavingRun(emp.CompanyID, emp.LeavingDate || '');
  if (!run || run.Status !== 'Posted') throw failed('Post the payroll run for ' + (emp.LeavingDate || '').slice(0, 7) + ' first: it pays the last days and brings the provisions to the leaving date.');
  // Worked out again and frozen from here.
  const s = Object.assign({}, s0, await draftFields(emp, s0));
  s.Number = s0.Number || await nextNumber();
  await glLinesFor(s); // the accounts are checked before approval starts
  const scope = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: s.CompanyID });
  const inst = await beginApprovalInstance(MODULE_ID, s.SettlementID, s.Number, scope, Math.max(0, s.Net), user.uid);
  const now = new Date().toISOString();
  const status = inst.required ? 'PendingApproval' : 'Approved';
  const { SettlementID, ...fields } = s;
  await SETTLEMENTS().doc(SettlementID).set(Object.assign(fields, { Status: status, ApprovalInstanceID: inst.required ? inst.instanceId : '', SubmittedAt: now, SubmittedBy: user.uid,
    SubmittedByName: actorName(user), RejectedReason: '', PostError: '', UpdatedAt: now, UpdatedBy: actorOf(user),
    History: history(s0, 'Submitted', user).concat(inst.required ? [] : [{ Event: 'Approved (no approval set up)', By: actorName(user), At: now }]) }));
  if (inst.required) return { success: true, status, number: s.Number };
  return Object.assign(await postAndReport(SettlementID, user), { number: s.Number });
});

exports.decideSettlementApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const snap = await SETTLEMENTS().doc(text(d.settlementId, 120) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Final settlement not found.');
  const s = Object.assign({ SettlementID: snap.id }, snap.data());
  if (s.Status !== 'PendingApproval' || !s.ApprovalInstanceID) throw failed('The settlement is not waiting for approval.');
  let r;
  try { r = await recordApprovalDecision(user, s.ApprovalInstanceID, Number(d.levelNumber), text(d.decision, 20), text(d.reason, 500)); } catch (e) { throw failed(e.message); }
  if (r.status === 'Rejected') {
    await snap.ref.update({ Status: 'Draft', RejectedReason: text(d.reason, 500), History: history(s, 'Rejected', user, { Note: text(d.reason, 500) }) });
    return { success: true, status: 'Draft' };
  }
  if (r.status !== 'Approved') {
    await snap.ref.update({ History: history(s, text(d.decision, 20) + ' (level ' + Number(d.levelNumber) + ')', user) });
    return { success: true, status: 'PendingApproval' };
  }
  await snap.ref.update({ Status: 'Approved', History: history(s, 'Approved', user) });
  return postAndReport(s.SettlementID, user);
});

// Posting again after a failure at approval (the accounts fixed meanwhile).
exports.postSettlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const s = await loadSettlement(user, (request.data || {}).settlementId);
  if (s.Status !== 'Approved') throw failed('Only an approved settlement waiting to post can be posted.');
  try { const gl = await postSettlement(s.SettlementID, user); return { success: true, status: 'Posted', jvNumber: gl.jvNumber }; } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw failed(e.message);
  }
});

async function reverseEntry(user, jvId, voucherType, reason, co, extra) {
  const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(jvId);
  const entry = (await glRef.get()).data();
  if (!entry) throw failed('The GL entry was not found.');
  if (entry.ReversedByJV) throw failed('That GL entry has already been reversed.');
  const description = 'Reversal of ' + entry.JVNumber + ' — ' + reason;
  const lines = (entry.Lines || []).map(l => ({ AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: l.Description || description, CostCenterID: l.CostCenterID || '' }));
  let gl;
  try { gl = await writeStockGlEntry(user, voucherType, entry.JVDate, description, entry.JVNumber, lines, { CompanyID: co }, Object.assign({ ReversalOfJV: jvId }, extra)); } catch (e) { throw failed(e.message); }
  await glRef.update({ ReversedByJV: gl.jvId, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) });
  return { entry, gl };
}

// Back to a draft: the journal mirrored, the loans' recoveries undone.
exports.reverseSettlement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'post');
  const d = request.data || {};
  const reason = text(d.reason, 500);
  if (!reason) bad('Give the reason for reversing the settlement.');
  const s = await loadSettlement(user, d.settlementId);
  if (s.Status !== 'Posted' || !s.JVID) throw failed('Only a posted settlement can be reversed.');
  if (s.PaidAt) throw failed('The settlement is paid: reverse the payment first.');
  return withGlobalLock(user.uid, async () => {
    const { entry, gl } = await reverseEntry(user, s.JVID, VOUCHER_TYPE, reason, s.CompanyID, { PayrollSettlementID: s.SettlementID, SourceTransactionID: s.SettlementID });
    const now = new Date().toISOString();
    for (const l of s.Lines.filter(x => x.LoanID)) {
      const ref = firestore.collection('payrollLoans').doc(l.LoanID);
      const ln = (await ref.get()).data();
      await ref.update({ Repayments: (ln.Repayments || []).map(x => (x.SettlementID === s.SettlementID && !x.ReversedAt ? Object.assign({}, x, { ReversedAt: now, ReversalJVNumber: gl.jvNumber }) : x)), UpdatedAt: now });
    }
    await SETTLEMENTS().doc(s.SettlementID).update({ Status: 'Draft', JVID: '', JVNumber: '', PostedAt: '', ApprovalInstanceID: '',
      History: history(s, 'Reversed', user, { JVNumber: entry.JVNumber, ReversalJVNumber: gl.jvNumber, Note: reason }) });
    return { success: true, reversalNumber: gl.jvNumber };
  });
});

// ---------- payment (decision 39, as a run's) ----------

async function payee(s) {
  const e = (await EMPLOYEES().doc(s.EmployeeID).get()).data() || {};
  const slip = { EmployeeNo: s.EmployeeNo, EmployeeName: s.EmployeeName, Net: s.Net, UnpaidDays: 0, Lines: [{ Kind: 'Earning', Source: 'Input', Amount: Math.max(0, s.Net) }] };
  return Object.assign(files.employeeValues(slip, e, calc.daysInMonth(s.LeavingDate.slice(0, 7))), { ByBank: Boolean(e.IBAN),
    Missing: [e.IBAN ? '' : 'IBAN', e.WpsPersonID ? '' : 'WPS person ID', e.BankRoutingCode ? '' : 'bank routing code'].filter(Boolean) });
}
const requirePayable = s => {
  if (s.Status !== 'Posted') throw failed('Only a posted settlement is paid.');
  if (!(s.Net > 0)) throw failed('There is nothing to pay: the employee owes the company.');
};

exports.getSettlementPayment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const s = await loadSettlement(user, (request.data || {}).settlementId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const accounts = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && isCashOrBank(a) && (!a.CompanyID || a.CompanyID === s.CompanyID))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName, Bank: String(a.AccountCode).startsWith('11') }))
    .sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  const formats = docs(await FORMATS().where('CompanyID', '==', s.CompanyID).get(), 'FormatID').filter(f => f.Active !== false).map(f => ({ FormatID: f.FormatID, Name: f.Name, Bank: f.Bank }));
  const p = s.Status === 'Posted' && s.Net > 0 ? await payee(s) : null;
  return { payee: p && { BankName: p.BANK, IBAN: p.IBAN, Net: p.NET, ByBank: p.ByBank, Missing: p.Missing }, accounts, formats, canPay: await can(user, 'pay') };
});

exports.downloadSettlementFile = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const s = await loadSettlement(user, d.settlementId);
  requirePayable(s);
  const snap = await FORMATS().doc(text(d.formatId, 80) || '-').get();
  if (!snap.exists || snap.data().CompanyID !== s.CompanyID) throw new HttpsError('not-found', 'Choose one of the company\'s payment file formats.');
  const payDate = text(d.paymentDate, 10);
  if (!isDate(payDate)) bad('Enter the payment date.');
  const p = await payee(s);
  if (!p.ByBank) throw failed(s.EmployeeName + ' has no bank account (IBAN): pay by cash or cheque.');
  const f = files.buildFile({ format: snap.data(), month: s.LeavingDate.slice(0, 7), payDate, created: companyNow(), rows: [p] });
  await SETTLEMENTS().doc(s.SettlementID).update({ History: history(s, 'Payment file', user, { Note: f.fileName + ', ' + f.total.toFixed(2) }) });
  return { fileName: f.fileName, content: f.content, count: f.count, total: f.total };
});

exports.markSettlementPaid = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const s = await loadSettlement(user, d.settlementId);
  requirePayable(s);
  if (s.PaidAt) throw failed('The settlement is already paid.');
  const payDate = text(d.paymentDate, 10);
  if (!isDate(payDate)) bad('Enter the payment date.');
  if (payDate < s.LeavingDate) bad('The payment date is before the leaving date.');
  const [coa, settings] = await Promise.all([rtdb.ref('coa').get().then(x => x.val() || {}), setup.companySettings(s.CompanyID)]);
  const a = coa[text(d.accountId, 80)];
  if (!isCashOrBank(a) || a.Status !== 'Active' || !a.IsPostable || (a.CompanyID && a.CompanyID !== s.CompanyID)) bad('Choose the cash or bank account (of the company) it is paid from.');
  const payable = coa[settings.PayableAccountID];
  if (!payable) throw failed('Set the company\'s Salaries Payable in Payroll Setup → Payroll.');
  const label = 'Final settlement paid — ' + s.Number + ' ' + s.EmployeeName;
  return withGlobalLock(user.uid, async () => {
    const fresh = (await SETTLEMENTS().doc(s.SettlementID).get()).data();
    if (fresh.PaidAt || fresh.Status !== 'Posted') throw failed('The settlement changed: open it again.');
    let gl;
    try {
      gl = await writeStockGlEntry(user, PAYMENT_TYPE, payDate, label, s.Number, [{ AccountCode: payable.AccountCode, Debit: s.Net, Credit: 0, Description: label },
        { AccountCode: a.AccountCode, Debit: 0, Credit: s.Net, Description: label }], { CompanyID: s.CompanyID }, { PayrollSettlementID: s.SettlementID, SourceTransactionID: s.SettlementID, ReversalOfJV: '' });
    } catch (e) { throw failed(e.message); }
    await SETTLEMENTS().doc(s.SettlementID).update({ PaidAt: new Date().toISOString(), PaidByName: actorName(user), PaymentDate: payDate, PaymentJVID: gl.jvId, PaymentJVNumber: gl.jvNumber,
      PaymentReference: text(d.reference, 100), PaymentAccountID: text(d.accountId, 80), History: history(Object.assign({}, s, { History: fresh.History }), 'Paid', user, { JVNumber: gl.jvNumber }) });
    return { success: true, jvNumber: gl.jvNumber };
  });
});

exports.reverseSettlementPayment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const reason = text(d.reason, 500);
  if (!reason) bad('Give the reason for reversing the payment.');
  const s = await loadSettlement(user, d.settlementId);
  if (!s.PaidAt || !s.PaymentJVID) throw failed('The settlement is not paid.');
  return withGlobalLock(user.uid, async () => {
    const { entry, gl } = await reverseEntry(user, s.PaymentJVID, PAYMENT_TYPE, reason, s.CompanyID, { PayrollSettlementID: s.SettlementID, SourceTransactionID: s.SettlementID });
    await SETTLEMENTS().doc(s.SettlementID).update({ PaidAt: '', PaymentDate: '', PaymentJVID: '', PaymentJVNumber: '',
      History: history(s, 'Payment reversed', user, { JVNumber: entry.JVNumber, ReversalJVNumber: gl.jvNumber, Note: reason }) });
    return { success: true, reversalNumber: gl.jvNumber };
  });
});

Object.assign(module.exports, { compute, glLinesFor, activeFor, SETTLEMENTS });
