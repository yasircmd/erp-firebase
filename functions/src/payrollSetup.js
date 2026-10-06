// HR Payroll, step 1: the setup (owner, 2026-10-04; docs/modules/HR_PAYROLL.md).
//   - Per company: the daily-rate method (owner point 1: ÷30, ÷ the
//     month's days, ×12 ÷ 365/366) and the Salaries Payable account.
//   - Per pay element: the GL account (owner point 2; one for the group,
//     a company may override it, decision 3), whether it is prorated (for
//     joiners, leavers and unpaid days) and whether it counts in the gross
//     (leave pay, overtime on gross).
//   - Overtime elements (owner point 3; variable earnings): an amount, or
//     hours × (the basic or the gross ÷ the days ÷ the hours a day × the
//     weightage); the days by the company's method or fixed (decision 2),
//     the hours by the employee's schedule or fixed.
// Changed with the Payroll Setup "write" right (step 4; HR Setup's before), for the
// user's own companies.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const pay = require('./hrPay');
const calc = require('./payrollCalc');

const onCallOptions = { region: 'us-central1' };
const SETTINGS = () => firestore.collection('payrollSettings');
const ELEMENTS = () => firestore.collection('hrPayElements');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const OT_BASES = ['Basic', 'Gross'];

async function canSetup(user, cap) { return moduleHasCapability('PAYROLLSETUP', cap, user.profile.role); }
async function requireWrite(user) {
  if (!(await canSetup(user, 'write'))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
}
async function requireRead(user) {
  if (await canSetup(user, 'access')) return;
  throw new HttpsError('permission-denied', 'You do not have access to Payroll Setup.');
}

// An element's payroll settings, with their defaults: fixed elements are
// prorated; fixed earnings count in the gross.
function payrollOf(e) {
  const fixed = e.Nature === 'Fixed';
  return {
    GLAccountID: e.GLAccountID || '', GLByCompany: e.GLByCompany || {},
    Prorated: e.Prorated === undefined ? fixed : Boolean(e.Prorated),
    InGross: e.InGross === undefined ? fixed && e.Kind === 'Earning' : Boolean(e.InGross),
    Category: e.Category || 'Normal', Overtime: e.Overtime || null
  };
}
async function payrollElements() { return (await pay.allElements()).map(e => Object.assign({}, e, payrollOf(e))); }

// A postable, active account of the right type(s), shared or the company's.
function checkAccount(coa, id, label, types, companyId) {
  const a = coa[id];
  if (!a) bad(label + ': account not found.');
  if (a.Status !== 'Active' || !a.IsPostable) bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' is not an active, postable account.');
  if (types && !types.includes(a.AccountType)) bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' must be ' + types.join(' or ') + '.');
  if (companyId === null && a.CompanyID) bad(label + ': the group\'s account must be a shared one (' + a.AccountCode + ' belongs to one company); set company accounts as overrides.');
  if (companyId && a.CompanyID && a.CompanyID !== companyId) bad(label + ': ' + a.AccountCode + ' belongs to another company.');
}

async function companySettings(companyId) {
  const s = (await SETTINGS().doc(companyId).get()).data() || {};
  return { CompanyID: companyId, DailyRateMethod: s.DailyRateMethod || 'DIV30', PayableAccountID: s.PayableAccountID || '', ReceivableAccountID: s.ReceivableAccountID || '',
    // Leave deductions in the GL (step 6, decision 46): their own ledger, or pro rata on the earnings.
    LeaveDeductionGL: s.LeaveDeductionGL === 'ProRata' ? 'ProRata' : 'Ledger' };
}

exports.getPayrollSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireRead(user);
  const [companiesSnap, coaSnap] = await Promise.all([rtdb.ref('companies').get(), rtdb.ref('coa').get()]);
  const companies = Object.entries(companiesSnap.val() || {}).filter(([id, c]) => c.Status === 'Active' && userCanAccessCompany(user.profile, id)).map(([id]) => id);
  const coa = coaSnap.val() || {};
  const accounts = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && (!a.CompanyID || companies.includes(a.CompanyID)))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName, AccountType: a.AccountType, CompanyID: a.CompanyID || '' }))
    .sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  const els = (await payrollElements()).map(e => Object.assign({}, e, { GLByCompany: Object.fromEntries(Object.entries(e.GLByCompany).filter(([co]) => companies.includes(co))) }));
  return { settings: await Promise.all(companies.map(companySettings)), elements: els, accounts, methods: calc.METHODS, canWrite: await canSetup(user, 'write') };
});

exports.savePayrollCompany = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const d = request.data || {};
  const co = text(d.companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  const method = text(d.dailyRateMethod, 20);
  if (!calc.METHODS[method]) bad('Choose how the daily rate is worked out.');
  const payable = text(d.payableAccountId, 80);
  const receivable = text(d.receivableAccountId, 80);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  if (payable) checkAccount(coa, payable, 'Salaries Payable', ['Liability'], co);
  // A net shortfall carried to the next run (decision 9) waits here.
  if (receivable) checkAccount(coa, receivable, 'Recoverable from employees', ['Asset'], co);
  const leaveGL = d.leaveDeductionGL === 'ProRata' ? 'ProRata' : 'Ledger';
  await SETTINGS().doc(co).set({ DailyRateMethod: method, PayableAccountID: payable, ReceivableAccountID: receivable, LeaveDeductionGL: leaveGL, UpdatedAt: new Date().toISOString(), UpdatedBy: user.uid });
  return { success: true };
});

function cleanOvertime(o) {
  const x = o || {};
  const out = { Mode: text(x.Mode, 10), Base: text(x.Base, 10) || 'Basic', DaysMode: text(x.DaysMode, 10) || 'Company', HoursMode: text(x.HoursMode, 10) || 'Schedule',
    FixedDays: null, FixedHours: null, Weightage: Number(x.Weightage) };
  if (!['Amount', 'Hours'].includes(out.Mode)) bad('Overtime is an amount, or worked out from hours.');
  if (out.Mode === 'Amount') return { Mode: 'Amount' };
  if (!OT_BASES.includes(out.Base)) bad('The overtime base is the basic or the gross.');
  if (!['Company', 'Fixed'].includes(out.DaysMode) || !['Schedule', 'Fixed'].includes(out.HoursMode)) bad('Choose the days and the hours.');
  if (out.DaysMode === 'Fixed') {
    out.FixedDays = Number(x.FixedDays);
    if (!(out.FixedDays >= 1 && out.FixedDays <= 31)) bad('The fixed days are 1 to 31.');
  }
  if (out.HoursMode === 'Fixed') {
    out.FixedHours = Number(x.FixedHours);
    if (!(out.FixedHours >= 1 && out.FixedHours <= 24)) bad('The fixed hours are 1 to 24.');
  }
  if (!(out.Weightage > 0 && out.Weightage <= 10)) bad('The weightage is more than 0 and at most 10 (e.g. 1.25, 1.5, 2).');
  return out;
}

exports.savePayElementPayroll = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireWrite(user);
  const d = request.data || {};
  const el = (await payrollElements()).find(x => x.ElementID === text(d.elementId, 80));
  if (!el) throw new HttpsError('not-found', 'Pay element not found.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const types = el.Kind === 'Earning' ? ['Expense'] : null; // a deduction: any postable account (a liability, a receivable, ...)
  const out = { GLAccountID: text(d.glAccountId, 80), Prorated: d.prorated === true, InGross: d.inGross === true, Category: text(d.category, 20) || 'Normal' };
  if (out.GLAccountID) checkAccount(coa, out.GLAccountID, el.Name, types, null);
  // Company accounts: the user's companies; others stay as they are.
  const by = Object.assign({}, el.GLByCompany);
  for (const [co, id] of Object.entries(d.glByCompany || {})) {
    if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const acc = text(id, 80);
    if (!acc) { delete by[co]; continue; }
    checkAccount(coa, acc, el.Name + ' (' + co + ')', types, co);
    by[co] = acc;
  }
  out.GLByCompany = by;
  if (!['Normal', 'Overtime'].includes(out.Category)) bad('Unknown category.');
  if (out.Category === 'Overtime') {
    if (el.Kind !== 'Earning' || el.Nature !== 'Variable') bad('Overtime is a variable earning: set the element as Earning, Variable first.');
    out.Overtime = cleanOvertime(d.overtime);
    out.Prorated = false; out.InGross = false;
  } else out.Overtime = null;
  if (el.Nature !== 'Fixed') out.Prorated = false; // only monthly amounts are prorated
  if (out.InGross && el.Kind !== 'Earning') bad('Only earnings count in the gross.');
  await ELEMENTS().doc(el.ElementID).set(out, { merge: true });
  return { success: true };
});

// The worked examples the screen shows: the daily rate for a month, and an
// overtime element's hourly rate.
exports.previewPayrollFormula = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireRead(user);
  const d = request.data || {};
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(text(d.month, 7)) ? text(d.month, 7) : todayIn('Asia/Dubai').slice(0, 7);
  const method = calc.METHODS[d.method] ? d.method : 'DIV30';
  const basic = Number(d.basic) || 5000, gross = Number(d.gross) || 8000, hoursPerDay = Number(d.hoursPerDay) || 8;
  const out = { month, daily: calc.dailyText(basic, method, month), divisor: calc.divisor(method, month) };
  if (d.overtime) {
    const ot = cleanOvertime(d.overtime);
    if (ot.Mode === 'Hours') out.overtime = calc.overtimeRate(ot, { basic, gross, method, month, hoursPerDay }).text;
  }
  return out;
});

module.exports.payrollElements = payrollElements;
module.exports.companySettings = companySettings;
module.exports.accountFor = calc.accountFor;
