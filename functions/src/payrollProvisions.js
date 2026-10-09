// HR Payroll, step 5a: provisions (owner, 2026-10-05; docs/modules/HR_PAYROLL.md,
// "Step 5 design", the owner's points 1-3 and decisions 28-33).
//   - Payroll Setup → Provisions: each company's gratuity (slabs, base, a
//     day's rule, cap, when it starts, accounts) and leave salary (base,
//     accounts); the accrual types (flight, education, ...: fixed a year or
//     a % of the basic or gross, by grade level, with employee exceptions;
//     paid at leaving or lapsing; accounts).
//   - Opening provisions at go-live (Master Data Import), already in the GL.
//   - Each employee's provision balances, and claims against an accrual
//     (Dr the provision / Cr bank or cash, decision 33).
// The monthly provision itself is worked out with the run (payrollRun.js)
// and posted with its journal (payrollPost.js).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const calc = require('./payrollCalc');

const onCallOptions = { region: 'us-central1' };
const SETTINGS = () => firestore.collection('payrollSettings');
const TYPES = () => firestore.collection('payrollAccrualTypes');
const OPENINGS = () => firestore.collection('payrollProvisionOpenings');
const CLAIMS = () => firestore.collection('payrollAccrualClaims');
const RUNS = () => firestore.collection('payrollRuns');
const SETTLEMENTS = () => firestore.collection('payrollSettlements');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const num = v => (v === '' || v == null ? null : Number(String(v).replace(/,/g, '')));
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const docs = (snap, key) => snap.docs.map(d => Object.assign({ [key]: d.id }, d.data()));
const isCashOrBank = a => a && a.AccountType === 'Asset' && ['10', '11'].includes(String(a.AccountCode).slice(0, 2));
const actorName = user => user.profile.fullName || user.profile.username || user.uid;

const canSetup = (user, cap) => moduleHasCapability('PAYROLLSETUP', cap, user.profile.role);
async function requireSetup(user, cap) {
  if (!(await canSetup(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Payroll Setup.');
  if (cap && !(await canSetup(user, cap))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
}
function checkAccount(coa, id, label, type, companyId) {
  const a = coa[id];
  if (!a) bad(label + ': account not found.');
  if (a.Status !== 'Active' || !a.IsPostable) bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' is not an active, postable account.');
  if (a.AccountType !== type) bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' must be ' + (type === 'Expense' ? 'an expense' : 'a liability') + '.');
  if (companyId === null && a.CompanyID) bad(label + ': the group\'s account must be a shared one; set company accounts as overrides.');
  if (companyId && a.CompanyID && a.CompanyID !== companyId) bad(label + ': ' + a.AccountCode + ' belongs to another company.');
}

// ---------- settings ----------

async function provisionSettings(companyId) {
  const s = (await SETTINGS().doc(companyId).get()).data() || {};
  return { Gratuity: Object.assign({}, calc.GRATUITY_DEFAULT, s.Gratuity || {}), LeaveSalary: Object.assign({}, calc.LEAVE_SALARY_DEFAULT, s.LeaveSalary || {}) };
}
async function accrualTypes() { return docs(await TYPES().get(), 'AccrualTypeID').sort((a, b) => a.Name.localeCompare(b.Name)); }
const accrualAccount = (t, side, co) => ((side === 'Expense' ? t.ExpenseByCompany : t.ProvisionByCompany) || {})[co] || (side === 'Expense' ? t.ExpenseAccountID : t.ProvisionAccountID) || '';

exports.getProvisionSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user);
  const companies = Object.entries((await rtdb.ref('companies').get()).val() || {}).filter(([id, c]) => c.Status === 'Active' && userCanAccessCompany(user.profile, id)).map(([id]) => id);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const accounts = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && ['Expense', 'Liability'].includes(a.AccountType) && (!a.CompanyID || companies.includes(a.CompanyID)))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName, AccountType: a.AccountType, CompanyID: a.CompanyID || '' }))
    .sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  const employees = docs(await firestore.collection('employees').get(), 'EmployeeID').filter(e => userCanAccessCompany(user.profile, e.CompanyID) && e.Status !== 'Left')
    .map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID })).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  const settings = [];
  for (const co of companies) settings.push(Object.assign({ CompanyID: co }, await provisionSettings(co)));
  return { settings, types: await accrualTypes(), accounts, employees, canWrite: await canSetup(user, 'write') };
});

function cleanGratuity(g, coa, co) {
  const x = g || {};
  const out = { Enabled: x.Enabled === true, Base: x.Base === 'Gross' ? 'Gross' : 'Basic', MinYears: num(x.MinYears) == null ? 0 : num(x.MinYears),
    DayRule: x.DayRule === 'Company' ? 'Company' : 'UAE365', CapYears: num(x.CapYears), StartsFrom: x.StartsFrom === 'DayOne' ? 'DayOne' : 'AfterYear',
    ExpenseAccountID: text(x.ExpenseAccountID, 80), ProvisionAccountID: text(x.ProvisionAccountID, 80) };
  if (!(out.MinYears >= 0 && out.MinYears <= 10)) bad('Gratuity: the years before any is due are 0 to 10.');
  if (out.CapYears != null && !(out.CapYears > 0 && out.CapYears <= 50)) bad('Gratuity: the cap is more than 0 years (or leave it empty for none).');
  out.Slabs = (Array.isArray(x.Slabs) ? x.Slabs : []).map((r, i) => {
    const s = { FromYear: num(r.FromYear), ToYear: num(r.ToYear), Days: num(r.Days) };
    if (!(s.FromYear >= 0) || (s.ToYear != null && !(s.ToYear > s.FromYear)) || !(s.Days >= 0 && s.Days <= 365)) bad('Gratuity, row ' + (i + 1) + ': from a year, to a later year (or empty for no end), 0 to 365 days a year.');
    return s;
  }).sort((a, b) => a.FromYear - b.FromYear);
  out.Slabs.forEach((s, i) => { const n = out.Slabs[i + 1]; if (n && (s.ToYear == null || s.ToYear > n.FromYear)) bad('Gratuity: the rows overlap (row ending ' + (s.ToYear == null ? 'never' : s.ToYear) + ', next from ' + n.FromYear + ').'); });
  if (out.Enabled) {
    if (!out.Slabs.length) bad('Gratuity: add at least one row.');
    checkAccount(coa, out.ExpenseAccountID, 'Gratuity expense', 'Expense', co);
    checkAccount(coa, out.ProvisionAccountID, 'Gratuity provision', 'Liability', co);
  }
  return out;
}
function cleanLeaveSalary(l, coa, co) {
  const x = l || {};
  const out = { Enabled: x.Enabled === true, Base: x.Base === 'Gross' ? 'Gross' : 'Basic', ExpenseAccountID: text(x.ExpenseAccountID, 80), ProvisionAccountID: text(x.ProvisionAccountID, 80) };
  if (out.Enabled) {
    checkAccount(coa, out.ExpenseAccountID, 'Leave salary expense', 'Expense', co);
    checkAccount(coa, out.ProvisionAccountID, 'Leave salary provision', 'Liability', co);
  }
  return out;
}

exports.saveProvisionSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user, 'write');
  const d = request.data || {};
  const co = text(d.companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  await SETTINGS().doc(co).set({ Gratuity: cleanGratuity(d.gratuity, coa, co), LeaveSalary: cleanLeaveSalary(d.leaveSalary, coa, co),
    UpdatedAt: new Date().toISOString(), UpdatedBy: user.uid }, { merge: true });
  return { success: true };
});

exports.saveAccrualType = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user, 'write');
  const d = (request.data || {}).accrualType || {};
  const id = text(d.AccrualTypeID, 80);
  const all = await accrualTypes();
  const cur = id ? all.find(t => t.AccrualTypeID === id) : null;
  if (id && !cur) throw new HttpsError('not-found', 'Accrual type not found.');
  const out = { Name: text(d.Name, 60), Code: text(d.Code, 10).toUpperCase(), Basis: d.Basis === 'Percent' ? 'Percent' : 'Fixed', Of: d.Of === 'Gross' ? 'Gross' : 'Basic',
    PaidAtLeaving: d.PaidAtLeaving === true, ExpenseAccountID: text(d.ExpenseAccountID, 80), ProvisionAccountID: text(d.ProvisionAccountID, 80), Active: d.Active !== false };
  if (!out.Name) bad('Name the accrual.');
  if (!/^[A-Z0-9_-]{1,10}$/.test(out.Code)) bad('The code is letters, digits, - or _ (up to 10): it\'s how a run\'s pasted inputs name it.');
  if (all.some(t => t.AccrualTypeID !== id && (t.Code === out.Code || t.Name.toLowerCase() === out.Name.toLowerCase()))) throw new HttpsError('already-exists', 'There is already an accrual "' + out.Name + '" or code ' + out.Code + '.');
  if ((await firestore.collection('hrPayElements').where('Code', '==', out.Code).get()).size) throw new HttpsError('already-exists', 'Code ' + out.Code + ' is a pay element\'s.');
  out.Rules = (Array.isArray(d.Rules) ? d.Rules : []).map((r, i) => {
    const x = { LevelFrom: num(r.LevelFrom), LevelTo: num(r.LevelTo), Value: num(r.Value) };
    if (!(x.LevelFrom >= 0 && x.LevelTo >= x.LevelFrom)) bad('Row ' + (i + 1) + ': grade levels from and to.');
    if (!(x.Value >= 0) || (out.Basis === 'Percent' && x.Value > 100)) bad('Row ' + (i + 1) + ': ' + (out.Basis === 'Percent' ? 'a % from 0 to 100.' : 'an amount a year, 0 or more.'));
    return x;
  });
  out.Rules.forEach((a, i) => out.Rules.forEach((b, j) => { if (j > i && a.LevelFrom <= b.LevelTo && b.LevelFrom <= a.LevelTo) bad('Rows ' + (i + 1) + ' and ' + (j + 1) + ' overlap: a grade level can match only one row.'); }));
  const coa = (await rtdb.ref('coa').get()).val() || {};
  checkAccount(coa, out.ExpenseAccountID, out.Name + ' expense', 'Expense', null);
  checkAccount(coa, out.ProvisionAccountID, out.Name + ' provision', 'Liability', null);
  out.ExpenseByCompany = Object.assign({}, (cur || {}).ExpenseByCompany); out.ProvisionByCompany = Object.assign({}, (cur || {}).ProvisionByCompany);
  for (const [side, key, type] of [['Expense', 'ExpenseByCompany', 'Expense'], ['Provision', 'ProvisionByCompany', 'Liability']]) {
    for (const [co, acc] of Object.entries(d[key] || {})) {
      if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
      const a = text(acc, 80);
      if (!a) { delete out[key][co]; continue; }
      checkAccount(coa, a, out.Name + ' ' + side.toLowerCase() + ' (' + co + ')', type, co);
      out[key][co] = a;
    }
  }
  // Employee exceptions (decision 32): excluded, or their own amount (or %).
  out.Exceptions = {};
  for (const [emp, ex] of Object.entries(d.Exceptions || {})) {
    const e = (await firestore.collection('employees').doc(text(emp, 80)).get()).data();
    if (!e || !userCanAccessCompany(user.profile, e.CompanyID)) bad('An exception\'s employee was not found.');
    const v = num(ex.Value);
    if (!ex.Excluded && !(v >= 0)) bad(e.FullName + ': exclude, or give their own ' + (out.Basis === 'Percent' ? '%' : 'amount a year') + '.');
    out.Exceptions[text(emp, 80)] = ex.Excluded ? { Excluded: true } : { Value: v };
  }
  const ref = cur ? TYPES().doc(cur.AccrualTypeID) : TYPES().doc();
  await ref.set(out);
  return { success: true, accrualTypeId: ref.id };
});

// ---------- opening provisions (go-live) ----------

// One row of the Master Data Import: the employee, the provision (Gratuity,
// Leave salary, or an accrual's code or name), the amount provided, and the
// date it was provided to. Already in the GL: nothing is posted.
async function saveProvisionOpening(user, d) {
  if (!(await canSetup(user, 'write'))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
  const empSnap = await firestore.collection('employees').doc(text(d.EmployeeID, 80) || '-').get();
  if (!empSnap.exists) bad('Employee not found.');
  const emp = empSnap.data();
  if (!userCanAccessCompany(user.profile, emp.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireNoSettlement(empSnap.id, emp.FullName); // step 7c: the settlement holds the provisions
  const what = text(d.Provision, 60).toLowerCase();
  let kind, typeId = '';
  if (what === 'gratuity') kind = 'Gratuity';
  else if (what === 'leave salary') kind = 'LeaveSalary';
  else {
    const t = (await accrualTypes()).find(x => x.Code.toLowerCase() === what || x.Name.toLowerCase() === what);
    if (!t) bad('Provision "' + d.Provision + '": Gratuity, Leave salary, or an accrual\'s code or name.');
    kind = 'Accrual'; typeId = t.AccrualTypeID;
  }
  const amount = round2(num(d.Amount));
  if (!(amount >= 0)) bad('The amount is 0 or more.');
  const asOf = text(d.AsOf, 10);
  if (!isDate(asOf)) bad('Enter the date it was provided to.');
  const id = [empSnap.id, kind, typeId].filter(Boolean).join('_');
  await OPENINGS().doc(id).set({ EmployeeID: empSnap.id, CompanyID: emp.CompanyID, Kind: kind, AccrualTypeID: typeId, Amount: amount, AsOf: asOf, Month: asOf.slice(0, 7),
    At: new Date().toISOString(), By: user.uid });
  return { success: true, id };
}

// ---------- what is provided (for the run, the balances, the settlement) ----------

const keyOf = (kind, typeId) => kind + (typeId ? ':' + typeId : '');
// Each employee's provided amounts by provision, before a month (the
// openings, then the posted runs after them), less the claims and the
// payouts paid with the salary. { [empId]: { [key]: amount } }
async function providedBefore(companyId, month, exceptRunId) {
  const out = {};
  const add = (emp, key, amt) => { const e = out[emp] = out[emp] || {}; e[key] = round2((e[key] || 0) + amt); };
  const openings = docs(await OPENINGS().where('CompanyID', '==', companyId).get(), 'OpeningID');
  const openFrom = {};
  openings.filter(o => o.Month < month).forEach(o => { const k = keyOf(o.Kind, o.AccrualTypeID); add(o.EmployeeID, k, o.Amount); openFrom[o.EmployeeID + '|' + k] = o.Month; });
  const runs = docs(await RUNS().where('CompanyID', '==', companyId).get(), 'RunID').filter(r => r.Status === 'Posted' && r.Month < month && r.RunID !== exceptRunId);
  for (const r of runs) {
    (await RUNS().doc(r.RunID).collection('slips').get()).docs.forEach(x => {
      const s = x.data();
      (s.Provisions || []).forEach(p => { const k = keyOf(p.Kind, p.AccrualTypeID); if (!(openFrom[s.EmployeeID + '|' + k] >= r.Month)) add(s.EmployeeID, k, p.Amount); });
      (s.Lines || []).filter(l => l.Source === 'AccrualPayout').forEach(l => add(s.EmployeeID, keyOf('Accrual', l.AccrualTypeID), -l.Amount));
    });
  }
  docs(await CLAIMS().where('CompanyID', '==', companyId).get(), 'ClaimID').filter(c => !c.ReversedAt && c.Date.slice(0, 7) < month)
    .forEach(c => add(c.EmployeeID, keyOf('Accrual', c.AccrualTypeID), -c.Amount));
  // A posted final settlement (step 5b) uses up what was provided.
  docs(await SETTLEMENTS().where('CompanyID', '==', companyId).get(), 'SettlementID').filter(s => s.Status === 'Posted' && s.LeavingDate.slice(0, 7) < month)
    .forEach(s => (s.Lines || []).filter(l => l.Provided).forEach(l => add(s.EmployeeID, l.Key, -l.Provided)));
  return out;
}

// ---------- balances and claims (Payroll; decision 33) ----------

// An employee whose final settlement is past its draft (step 5b): it holds
// the provisions, so claims wait for it.
async function requireNoSettlement(employeeId, name) {
  const s = (await SETTLEMENTS().doc('fs_' + employeeId).get()).data();
  if (s && s.Status !== 'Draft') throw failed(name + ' has a final settlement (' + s.Number + '): the provisions are settled there.');
}

const canRun = (user, cap) => moduleHasCapability('PAYROLL', cap, user.profile.role);
async function requirePayroll(user, cap) {
  if (!(await canRun(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Payroll.');
  if (cap && !(await canRun(user, cap))) throw new HttpsError('permission-denied', 'You do not have permission to pay accruals.');
}

// Each employee's provisions provided so far (the posted runs and openings,
// less claims and payouts), and the claims.
exports.getProvisionBalances = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePayroll(user);
  const co = text((request.data || {}).companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const [types, prov, empsSnap, claimsSnap] = await Promise.all([accrualTypes(), provisionSettings(co), firestore.collection('employees').where('CompanyID', '==', co).get(), CLAIMS().where('CompanyID', '==', co).get()]);
  const provided = await providedBefore(co, '9999-12');
  const columns = [prov.Gratuity.Enabled || null, prov.LeaveSalary.Enabled || null].map((on, i) => (on ? { Key: i ? 'LeaveSalary' : 'Gratuity', Name: i ? 'Leave salary' : 'Gratuity' } : null)).filter(Boolean)
    .concat(types.map(t => ({ Key: keyOf('Accrual', t.AccrualTypeID), Name: t.Name, AccrualTypeID: t.AccrualTypeID })));
  const employees = docs(empsSnap, 'EmployeeID').map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, Status: e.Status, Balances: provided[e.EmployeeID] || {} }))
    .filter(e => e.Status !== 'Left' || Object.values(e.Balances).some(v => v)).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const accounts = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && isCashOrBank(a) && (!a.CompanyID || a.CompanyID === co))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName })).sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  return { columns, employees, accounts, types: types.filter(t => t.Active !== false).map(t => ({ AccrualTypeID: t.AccrualTypeID, Name: t.Name, Code: t.Code })),
    claims: docs(claimsSnap, 'ClaimID').sort((a, b) => String(b.Date).localeCompare(String(a.Date))), canPay: await canRun(user, 'pay') };
});

const VOUCHER_TYPE = 'PayrollProvision';
async function postClaim(user, co, date, desc, ref, lines, extra) {
  return withGlobalLock(user.uid, async () => {
    try { return await writeStockGlEntry(user, VOUCHER_TYPE, date, desc, ref, lines, { CompanyID: co }, Object.assign({ ReversalOfJV: '' }, extra || {})); } catch (e) { throw failed(e.message); }
  });
}

// A claim against an accrual (a ticket bought, a school fee paid): Dr the
// provision / Cr a cash or bank account.
exports.recordAccrualClaim = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePayroll(user, 'pay');
  const d = request.data || {};
  const empSnap = await firestore.collection('employees').doc(text(d.employeeId, 80) || '-').get();
  if (!empSnap.exists) bad('Choose the employee.');
  const emp = empSnap.data();
  if (!userCanAccessCompany(user.profile, emp.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireNoSettlement(empSnap.id, emp.FullName);
  const t = (await accrualTypes()).find(x => x.AccrualTypeID === text(d.accrualTypeId, 80));
  if (!t) bad('Choose the accrual.');
  const date = text(d.date, 10);
  if (!isDate(date)) bad('Enter the date it was paid.');
  const amount = round2(num(d.amount));
  if (!(amount > 0)) bad('Enter the amount paid.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const provAcc = coa[accrualAccount(t, 'Provision', emp.CompanyID)];
  if (!provAcc) throw failed('Set the ' + t.Name + ' provision account in Payroll Setup → Provisions.');
  const cash = coa[text(d.accountId, 80)];
  if (!isCashOrBank(cash) || cash.Status !== 'Active' || !cash.IsPostable || (cash.CompanyID && cash.CompanyID !== emp.CompanyID)) bad('Choose the cash or bank account (of the company).');
  const label = t.Name + ' — ' + emp.FullName + (text(d.note, 200) ? ' — ' + text(d.note, 200) : '');
  const ref = CLAIMS().doc();
  const gl = await postClaim(user, emp.CompanyID, date, label, '', [
    { AccountCode: provAcc.AccountCode, Debit: amount, Credit: 0, Description: label }, { AccountCode: cash.AccountCode, Debit: 0, Credit: amount, Description: label }], { PayrollClaimID: ref.id, SourceTransactionID: ref.id });
  await ref.set({ EmployeeID: empSnap.id, EmployeeNo: emp.EmployeeNo || '', EmployeeName: emp.FullName || '', CompanyID: emp.CompanyID, AccrualTypeID: t.AccrualTypeID, TypeName: t.Name,
    Date: date, Amount: amount, Note: text(d.note, 200), JVID: gl.jvId, JVNumber: gl.jvNumber, By: actorName(user), At: new Date().toISOString(), ReversedAt: '' });
  return { success: true, claimId: ref.id, jvNumber: gl.jvNumber };
});

exports.reverseAccrualClaim = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePayroll(user, 'pay');
  const d = request.data || {};
  const reason = text(d.reason, 300);
  if (!reason) bad('Give the reason for reversing the claim.');
  const snap = await CLAIMS().doc(text(d.claimId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Claim not found.');
  const c = snap.data();
  if (!userCanAccessCompany(user.profile, c.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (c.ReversedAt) throw failed('The claim is already reversed.');
  await requireNoSettlement(c.EmployeeID, c.EmployeeName);
  const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(c.JVID);
  const e = (await glRef.get()).data();
  const gl = await postClaim(user, c.CompanyID, e.JVDate, 'Reversal of ' + e.JVNumber + ' — ' + reason, e.JVNumber,
    e.Lines.map(x => ({ AccountCode: x.AccountCode, Debit: x.Credit || 0, Credit: x.Debit || 0, Description: x.Description })), { PayrollClaimID: snap.id, ReversalOfJV: c.JVID });
  await glRef.update({ ReversedByJV: gl.jvId, UpdatedAt: new Date().toISOString() });
  await snap.ref.update({ ReversedAt: new Date().toISOString(), ReversalJVNumber: gl.jvNumber, ReversalReason: reason });
  return { success: true, reversalNumber: gl.jvNumber };
});

Object.assign(module.exports, { OPENINGS, requireNoSettlement, provisionSettings, accrualTypes, accrualAccount, saveProvisionOpening, providedBefore, keyOf, isCashOrBank, CLAIMS, round2, failed, isMonth, docs, withGlobalLock, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION, actorName, text, bad, num, isDate });
