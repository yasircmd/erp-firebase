// HR Payroll, step 2: the payroll run (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, "Step 2 design", decisions 12-15).
//   - One run per company and month, for a month whose leave is locked.
//     It takes every employee of the company on payroll in the month.
//   - Each employee's pay by element (payrollCalc.computeEmployee): fixed
//     elements from the compensation in force (part months by deducting the
//     days not employed, decision 12), leave and absence on their own
//     deduction lines (decision 13), and the run's inputs: overtime hours or
//     amounts, bonus, commission and one-off additions and deductions, each
//     against a pay element (decision 15).
//   - A draft in this step: inputs, recalculation, review, delete.
//     Submitting, approval and posting come in step 3.
// Module PAYROLL: access to see runs and their amounts (decision 14), draft
// to make and change them; for the user's own companies.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { calendarFor, leaveTypes } = require('./hrLeaveSetup');
const { hoursOn } = require('./workCalendar');
const lv = require('./hrLeave');
const pay = require('./hrPay');
const setup = require('./payrollSetup');
const calc = require('./payrollCalc');
const loans = require('./payrollLoans');
const P = require('./payrollProvisions');

const onCallOptions = { region: 'us-central1' };
const RUNS = () => firestore.collection('payrollRuns');
const SLIPS = runId => RUNS().doc(runId).collection('slips');
const EMPLOYEES = () => firestore.collection('employees');
const COMP = () => firestore.collection('employeeCompensation');
const LEAVES = () => firestore.collection('leaveRequests');
const MONTHS = () => firestore.collection('leaveMonths');

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const round2 = n => Math.round(n * 100) / 100;
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const docs = snap => snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
const byNo = (a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo));

const can = (user, cap) => moduleHasCapability('PAYROLL', cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Payroll.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'post' ? 'You do not have permission to reverse payroll runs.' : 'You do not have permission to prepare payroll runs.');
}
async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}
async function loadRun(user, id) {
  const snap = await RUNS().doc(text(id, 120) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Payroll run not found.');
  const run = Object.assign({ RunID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, run.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return run;
}
const requireDraft = run => { if (run.Status !== 'Draft') throw new HttpsError('failed-precondition', 'The run is ' + run.Status + ': it can no longer change.'); };
async function leaveMonth(co, month) { return (await MONTHS().doc(co + '_' + month).get()).data() || null; }
async function requireLocked(co, month) {
  const rec = await leaveMonth(co, month);
  if (!rec || rec.Status !== 'Locked') throw new HttpsError('failed-precondition', 'Lock the leave for ' + month + ' first (Leave Register → Month close): the run pays the month\'s locked leave.');
  return rec;
}
// The elements a run's inputs go against: variable, in use, not the system ones.
const inputElements = els => els.filter(e => e.Nature === 'Variable' && e.Active !== false && !e.System);
// An accrual paid with the salary (step 5a, decision 33): a run input, paid
// from its provision rather than the expense.
const withAccruals = async els => els.concat((await P.accrualTypes()).filter(t => t.Active !== false).map(t => ({ ElementID: 'acc-' + t.AccrualTypeID, Code: t.Code,
  Name: t.Name + ' (from the provision)', Kind: 'Earning', Nature: 'Variable', Active: true, Category: 'AccrualPayout', AccrualTypeID: t.AccrualTypeID })));
const byHours = e => e.Category === 'Overtime' && e.Overtime && e.Overtime.Mode === 'Hours';

// Back pay and a shortfall brought forward (step 3), from the company's
// earlier posted runs: posted (by month), postedSlips (run id → employee →
// slip), versions (the employee's compensation), leaveBy (pay month →
// employee → leave lines).
function extrasFor(e, x) {
  const extra = [], mine = x.versions, posted = x.posted, postedSlips = x.postedSlips;
  const last = posted.filter(r => postedSlips[r._id][e.EmployeeID]).pop();
  const carry = last ? postedSlips[last._id][e.EmployeeID].CarryForward || 0 : 0;
  if (carry > 0) extra.push({ ElementID: 'sys-bfwd', Code: 'BFWD', Name: 'Brought forward', Kind: 'Deduction', Source: 'CarryForward', Amount: carry, Text: 'Net shortfall from ' + last.Month });
  posted.forEach(r => {
    const was = postedSlips[r._id][e.EmployeeID];
    if (!was || !mine.some(v => String(v.CreatedAt || '') > String(r.PostedAt || '') && v.EffectiveFrom <= calc.monthEnd(r.Month))) return;
    const again = calc.computeEmployee({ month: r.Month, method: r.Method, emp: e, versions: mine, elements: x.elements, leave: (x.leaveBy[r.Month] || {})[e.EmployeeID] || [], inputs: [], system: x.system });
    const paid = was.Lines.concat(...posted.filter(q => q.Month > r.Month).map(q => ((postedSlips[q._id][e.EmployeeID] || {}).Lines || []).filter(l => l.Source === 'Arrears' && l.ForMonth === r.Month)));
    calc.arrearsFor(r.Month, again, paid, x.elements).forEach(l => extra.push(l));
  });
  return extra;
}

// The employees whose final settlement, past its draft, pays the month
// (step 5c): left off the month's run.
async function settledIn(co, month) {
  const out = {};
  docs(await firestore.collection('payrollSettlements').where('CompanyID', '==', co).get())
    .filter(s => s.Status !== 'Draft' && (s.SalaryMonths || []).includes(month))
    .forEach(s => { out[s.EmployeeID] = { EmployeeID: s.EmployeeID, EmployeeNo: s.EmployeeNo || '', EmployeeName: s.EmployeeName || '', Number: s.Number || '' }; });
  return out;
}

// The months a leaver's final settlement can pay (step 5c): from the month
// after the last posted run with the employee on it to the leaving month;
// with none, from the company's first run (before it, pay was outside this
// system), else just the leaving month; never before joining. Each with the
// company's run for it, if any, and whether the employee is on it.
async function unpaidMonths(emp) {
  const co = emp.CompanyID, leaving = emp.LeavingDate.slice(0, 7), joined = String(emp.JoinDate).slice(0, 7);
  const all = docs(await RUNS().where('CompanyID', '==', co).get()).sort((a, b) => a.Month.localeCompare(b.Month));
  const runs = all.filter(r => r.Month <= leaving);
  const onRun = {};
  for (const r of runs) onRun[r._id] = (await SLIPS(r._id).doc(emp.EmployeeID).get()).exists;
  const lastPaid = runs.filter(r => r.Status === 'Posted' && onRun[r._id]).map(r => r.Month).pop() || '';
  let m = lastPaid ? lv.nextMonth(lastPaid) : all.length && all[0].Month < leaving ? all[0].Month : leaving;
  if (m < joined) m = joined;
  const out = [];
  for (; m <= leaving; m = lv.nextMonth(m)) {
    const r = runs.find(x => x.Month === m);
    out.push({ Month: m, Run: r ? { RunID: r._id, Status: r.Status, OnRun: onRun[r._id], RunNumber: r.RunNumber || '' } : null });
  }
  return { lastPaid, months: out };
}

// A final settlement's salary (step 5c): each month it pays, worked out as
// the run does: the pay in force to the leaving date, the leave not yet paid
// by a posted run, the month's inputs; the first month also takes what the
// posted runs carried forward and their arrears. No loan instalment: the
// settlement deducts each loan's whole balance.
async function salaryFor(emp, months, inputsByMonth) {
  if (!months.length) return [];
  const co = emp.CompanyID, leaving = months[months.length - 1];
  const [settings, els, versionsSnap, leaves, cal] = await Promise.all([setup.companySettings(co), setup.payrollElements(), COMP().where('EmployeeID', '==', emp.EmployeeID).get(),
    LEAVES().where('EmployeeID', '==', emp.EmployeeID).get(), calendarFor(emp)]);
  const elements = Object.fromEntries(els.map(e => [e.ElementID, e]));
  const system = Object.fromEntries(els.filter(e => e.System).map(e => [e.Code, e]));
  const versions = docs(versionsSnap);
  const leaveBy = {};
  docs(leaves).filter(l => l.Status === 'Approved' || l.Status === 'Cancelled')
    .forEach(l => (l.Lines || []).forEach(x => { const m = lv.payMonthOf(x); const b = leaveBy[m] = leaveBy[m] || {}; (b[emp.EmployeeID] = b[emp.EmployeeID] || []).push(x); }));
  const posted = docs(await RUNS().where('CompanyID', '==', co).get()).filter(r => r.Status === 'Posted' && r.Month < months[0]).sort((a, b) => a.Month.localeCompare(b.Month));
  const postedSlips = {};
  for (const r of posted) { const x = await SLIPS(r._id).doc(emp.EmployeeID).get(); postedSlips[r._id] = x.exists ? { [emp.EmployeeID]: x.data() } : {}; }
  return months.map((month, i) => {
    // The leaving month also takes leave whose pay month is later (entered after its lock).
    const leave = Object.entries(leaveBy).filter(([m]) => m === month || (month === leaving && m > leaving)).reduce((a, [, b]) => a.concat(b[emp.EmployeeID] || []), []);
    const end = calc.monthEnd(month);
    const r = calc.computeEmployee({ month, method: settings.DailyRateMethod, emp, versions, elements, leave, inputs: inputsByMonth[month] || [],
      hoursPerDay: hoursOn(cal, emp.LeavingDate < end ? emp.LeavingDate : end), system,
      extra: i === 0 ? extrasFor(emp, { posted, postedSlips, versions, leaveBy, elements, system }) : [] });
    return Object.assign({ Month: month }, r);
  });
}

async function companyEmployees(co, month) {
  const start = month + '-01', end = calc.monthEnd(month);
  return docs(await EMPLOYEES().where('CompanyID', '==', co).get()).map(e => Object.assign(e, { EmployeeID: e._id }))
    .filter(e => e.JoinDate && e.JoinDate <= end && !(e.LeavingDate && e.LeavingDate < start)).sort(byNo);
}

// Works out every employee's pay and writes the run; the inputs entered so
// far are kept (those of employees no longer on it are dropped).
async function calculate(run, user, inputsByEmp) {
  const co = run.CompanyID, month = run.Month, end = calc.monthEnd(month);
  const locked = await requireLocked(co, month);
  const [settings, els, emps, existing] = await Promise.all([setup.companySettings(co), setup.payrollElements().then(withAccruals), companyEmployees(co, month), docs(await SLIPS(run.RunID).get())]);
  const elements = Object.fromEntries(els.map(e => [e.ElementID, e]));
  const system = Object.fromEntries(els.filter(e => e.System).map(e => [e.Code, e]));
  const inputs = inputsByEmp || Object.fromEntries(existing.map(s => [s.EmployeeID, s.Inputs || []]));
  const ids = new Set(emps.map(e => e.EmployeeID));
  const versions = {};
  docs(await COMP().get()).forEach(v => { if (ids.has(v.EmployeeID)) (versions[v.EmployeeID] = versions[v.EmployeeID] || []).push(v); });
  // The leave lines by the month they're paid in, and employee.
  const leaveBy = {};
  docs(await LEAVES().where('CompanyID', '==', co).get()).filter(l => l.Status === 'Approved' || l.Status === 'Cancelled')
    .forEach(l => (l.Lines || []).forEach(x => { const m = lv.payMonthOf(x); const b = leaveBy[m] = leaveBy[m] || {}; (b[l.EmployeeID] = b[l.EmployeeID] || []).push(x); }));
  const leave = leaveBy[month] || {};
  // The company's earlier posted runs: their shortfalls carried forward
  // (decision 9) and the months a later pay change reaches back to (10).
  const posted = docs(await RUNS().where('CompanyID', '==', co).get()).filter(r => r.Status === 'Posted' && r.Month < month).sort((a, b) => a.Month.localeCompare(b.Month));
  const postedSlips = {};
  for (const r of posted) postedSlips[r._id] = Object.fromEntries(docs(await SLIPS(r._id).get()).map(x => [x.EmployeeID, x]));
  const extraFor = e => extrasFor(e, { posted, postedSlips, versions: versions[e.EmployeeID] || [], leaveBy, elements, system });
  const loansBy = await loans.loansDue(co, month, run.RunID);
  // An employee whose final settlement pays this month (step 5c) is left off.
  const settled = await settledIn(co, month);
  const bands = {};
  // Provisions (step 5a): what each employee has provided so far, the
  // company's gratuity and leave-salary rules, the accruals, the grades.
  const prov = await P.provisionSettings(co);
  const accruals = (await P.accrualTypes()).filter(t => t.Active !== false);
  const anyProvision = prov.Gratuity.Enabled || prov.LeaveSalary.Enabled || accruals.length;
  const provided = anyProvision ? await P.providedBefore(co, month, run.RunID) : {};
  const levels = anyProvision ? Object.fromEntries((await firestore.collection('hrGrades').get()).docs.map(d => [d.id, d.data().Level])) : {};
  const balanceTypes = prov.LeaveSalary.Enabled ? (await leaveTypes()).filter(t => t.Kind === 'Leave' && t.UsesBalance && t.Active !== false) : [];
  async function provisionsFor(e, r) {
    if (!anyProvision) return [];
    const last = e.LeavingDate && e.LeavingDate < end ? e.LeavingDate : end;
    const mine = provided[e.EmployeeID] || {};
    const out = [];
    const push = (kind, typeId, name, liability, amount, textOut) => { if (liability || amount) out.push({ Kind: kind, AccrualTypeID: typeId || '', Name: name, Liability: round2(liability), Provided: round2(mine[P.keyOf(kind, typeId)] || 0), Amount: round2(amount), Text: textOut }); };
    if (prov.Gratuity.Enabled) {
      const unpaid = Object.values(leaveBy).reduce((t, byEmp) => t + (byEmp[e.EmployeeID] || []).filter(x => x.Pay === 'Unpaid' && x.Date <= last).reduce((a, x) => a + x.Fraction, 0), 0);
      const g = calc.gratuityFor(prov.Gratuity, { base: prov.Gratuity.Base === 'Gross' ? r.Gross : r.Basic, joinDate: e.JoinDate, asOf: last, unpaidDays: unpaid, method: settings.DailyRateMethod, month, provision: true });
      push('Gratuity', '', 'Gratuity', g.amount, g.amount - (mine.Gratuity || 0), g.text);
    }
    if (prov.LeaveSalary.Enabled) {
      const cache = { leaves: await lv.leavesOf(e.EmployeeID), grade: await lv.gradeLevel(e) };
      let days = 0;
      for (const t of balanceTypes) { const b = await lv.balanceOf(e, t, last, null, cache); days += b.Available + b.Booked; }
      const l = calc.leaveSalaryFor({ days: Math.max(0, days), base: prov.LeaveSalary.Base === 'Gross' ? r.Gross : r.Basic, method: settings.DailyRateMethod, month });
      push('LeaveSalary', '', 'Leave salary', l.amount, l.amount - (mine.LeaveSalary || 0), l.text);
    }
    const first = e.JoinDate > month + '-01' ? e.JoinDate : month + '-01';
    const employed = Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1);
    accruals.forEach(t => {
      const a = calc.accrualShareFor(t, { employeeId: e.EmployeeID, level: e.GradeID ? levels[e.GradeID] : null, basic: r.Basic, gross: r.Gross, employedDays: employed, monthDays: calc.daysInMonth(month) });
      const before = mine[P.keyOf('Accrual', t.AccrualTypeID)] || 0;
      push('Accrual', t.AccrualTypeID, t.Name, before + a.amount, a.amount, a.text);
    });
    return out;
  }
  const slips = [];
  for (const e of emps.filter(x => !settled[x.EmployeeID])) {
    const cal = await calendarFor(e);
    const r = calc.computeEmployee({ month, method: settings.DailyRateMethod, emp: e, versions: versions[e.EmployeeID] || [], elements,
      leave: leave[e.EmployeeID] || [], inputs: inputs[e.EmployeeID] || [], hoursPerDay: hoursOn(cal, e.LeavingDate && e.LeavingDate < end ? e.LeavingDate : end), system,
      extra: extraFor(e), loans: loansBy[e.EmployeeID] || [] });
    if (!e.IBAN) r.Warnings.push('No bank account / IBAN on the employee record.');
    const key = (e.GradeID || '') + '|' + co;
    if (!(key in bands)) bands[key] = await pay.band(e);
    const bw = pay.bandWarning(r.Basic || null, bands[key]);
    if (bw) r.Warnings.push(bw);
    slips.push(Object.assign({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo || '', EmployeeName: e.FullName || '', CostCenterID: e.CostCenterID || '',
      JoinDate: e.JoinDate, LeavingDate: e.LeavingDate || '', Inputs: inputs[e.EmployeeID] || [], Provisions: await provisionsFor(e, r) }, r));
  }
  // The register's columns: earnings, then deductions, in the elements' order.
  const used = new Set();
  slips.forEach(s => s.Lines.forEach(l => used.add(l.ElementID)));
  const order = els.map(e => e.ElementID);
  const columns = [...used]
    .map(id => { const l = slips.reduce((f, s) => f || s.Lines.find(x => x.ElementID === id), null); return { ElementID: id, Code: l.Code, Name: l.Name, Kind: l.Kind, Order: l.Kind === 'Deduction' ? 1 : 0, Sort: order.indexOf(id) }; })
    .sort((a, b) => a.Order - b.Order || a.Sort - b.Sort).map(c => { delete c.Order; delete c.Sort; return c; });
  const totals = slips.reduce((t, s) => ({ Earnings: t.Earnings + s.Earnings, Deductions: t.Deductions + s.Deductions, Net: t.Net + s.Net }), { Earnings: 0, Deductions: 0, Net: 0 });
  const now = new Date().toISOString();
  const keep = new Set(slips.map(s => s.EmployeeID));
  const writes = slips.map(s => b => b.set(SLIPS(run.RunID).doc(s.EmployeeID), s))
    .concat(existing.filter(s => !keep.has(s.EmployeeID)).map(s => b => b.delete(SLIPS(run.RunID).doc(s._id))));
  for (let i = 0; i < writes.length; i += 400) { const b = firestore.batch(); writes.slice(i, i + 400).forEach(w => w(b)); await b.commit(); }
  const out = { Method: settings.DailyRateMethod, Employees: slips.length, Earnings: round2(totals.Earnings), Deductions: round2(totals.Deductions), Net: round2(totals.Net),
    Warnings: slips.filter(s => s.Warnings.length).length, Columns: columns, Settled: Object.values(settled),
    Provisions: round2(slips.reduce((t, s) => t + (s.Provisions || []).reduce((a, x) => a + x.Amount, 0), 0)), CalculatedAt: now, CalculatedBy: user.uid, CalculatedByName: actorName(user), LeaveLockedAt: locked.LockedAt || '',
    UpdatedAt: now, UpdatedBy: user.profile.username || user.uid }; // My Drafts matches the username
  await RUNS().doc(run.RunID).update(out);
  return out;
}

// ---------- callables ----------

exports.getPayrollRuns = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const companies = Object.entries((await rtdb.ref('companies').get()).val() || {}).filter(([id, c]) => c.Status === 'Active' && userCanAccessCompany(user.profile, id)).map(([id]) => id);
  const runs = docs(await RUNS().get()).filter(r => userCanAccessCompany(user.profile, r.CompanyID))
    .map(r => ({ RunID: r._id, CompanyID: r.CompanyID, Month: r.Month, Status: r.Status, Employees: r.Employees || 0, Earnings: r.Earnings || 0, Deductions: r.Deductions || 0,
      Net: r.Net || 0, Warnings: r.Warnings || 0, CalculatedAt: r.CalculatedAt || '' }))
    .sort((a, b) => b.Month.localeCompare(a.Month) || a.CompanyID.localeCompare(b.CompanyID));
  return { runs, companies, canDraft: await can(user, 'draft') };
});

exports.createPayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const co = await companyFor(user, d.companyId);
  const month = text(d.month, 7);
  if (!isMonth(month)) bad('Choose the month.');
  await requireLocked(co, month);
  const ref = RUNS().doc(co + '_' + month);
  const run = { CompanyID: co, Month: month, Status: 'Draft', Description: 'Payroll ' + co + ' ' + month, CreatedAt: new Date().toISOString(), CreatedBy: user.uid, CreatedByName: actorName(user) };
  try { await ref.create(run); } catch (e) {
    if (e.code === 6 || /already exists/i.test(e.message)) throw new HttpsError('already-exists', 'There is already a payroll run for ' + co + ', ' + month + '.');
    throw e;
  }
  await calculate(Object.assign({ RunID: ref.id }, run), user);
  return { success: true, runId: ref.id };
});

// The run's approval (step 3): its levels and decisions, and the levels
// the user may decide now.
async function approvalOf(run, user) {
  if (!run.ApprovalInstanceID) return null;
  const inst = (await rtdb.ref('approvalInstances/' + run.ApprovalInstanceID).get()).val();
  if (!inst) return null;
  const decided = new Set((inst.Decisions || []).map(x => x.LevelNumber));
  return { Status: inst.Status, Levels: (inst.RequiredLevels || []).map(l => ({ LevelNumber: l.LevelNumber, ApproverUserID: l.ApproverUserID })), Decisions: inst.Decisions || [],
    MyLevels: run.Status === 'PendingApproval' && inst.Status === 'Pending' ? (inst.RequiredLevels || []).filter(l => l.ApproverUserID === user.uid && !decided.has(l.LevelNumber)).map(l => l.LevelNumber) : [] };
}

exports.getPayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const run = await loadRun(user, (request.data || {}).runId);
  const [slips, els, rec] = await Promise.all([docs(await SLIPS(run.RunID).get()), setup.payrollElements().then(withAccruals), leaveMonth(run.CompanyID, run.Month)]);
  // The leave changed since the run was worked out: reopened, or locked again.
  const leaveChanged = run.Status === 'Draft' && (!rec || rec.Status !== 'Locked' || (rec.LockedAt || '') !== (run.LeaveLockedAt || ''));
  return {
    run, slips: slips.map(s => { delete s._id; return s; }).sort(byNo), leaveChanged, leaveLocked: Boolean(rec && rec.Status === 'Locked'),
    inputElements: inputElements(els).map(e => ({ ElementID: e.ElementID, Code: e.Code, Name: e.Name, Kind: e.Kind, Hours: byHours(e) })),
    methodLabel: calc.METHODS[run.Method] || '', canDraft: run.Status === 'Draft' && await can(user, 'draft'), canPost: await can(user, 'post'),
    approval: await approvalOf(run, user)
  };
});

// Replaces the run's inputs with rows typed or pasted from Excel: employee
// (id or no.), element (id or code), hours (overtime by hours) or amount,
// and a note. Then works the run out again.
exports.savePayrollInputs = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const run = await loadRun(user, d.runId);
  requireDraft(run);
  const rows = Array.isArray(d.rows) ? d.rows : [];
  if (rows.length > 5000) bad('At most 5,000 inputs.');
  const [slips, els] = await Promise.all([docs(await SLIPS(run.RunID).get()), setup.payrollElements().then(withAccruals)]);
  const allowed = inputElements(els);
  const out = Object.fromEntries(slips.map(s => [s.EmployeeID, []]));
  rows.forEach((r, n) => {
    const i = n + 1;
    const empKey = text(r.EmployeeID, 80) || text(r.EmployeeNo, 40), elKey = text(r.ElementID, 80) || text(r.Code, 20).toUpperCase();
    const hasValue = [r.Hours, r.Amount].some(v => v !== '' && v != null);
    if (!empKey && !elKey && !hasValue && !text(r.Note)) return; // a blank row
    const s = slips.find(x => x.EmployeeID === empKey || (x.EmployeeNo && x.EmployeeNo === empKey));
    if (!s) bad('Row ' + i + ': employee "' + empKey + '" is not on this run.');
    const el = els.find(x => x.ElementID === elKey || x.Code === elKey);
    if (!el) bad('Row ' + i + ': pay element "' + elKey + '" not found.');
    if (!allowed.includes(el)) bad('Row ' + i + ': ' + el.Name + ' is not entered per run (only variable elements are: overtime, bonus, commission, one-offs).');
    const num = v => Number(String(v == null ? '' : v).replace(/,/g, ''));
    const row = { ElementID: el.ElementID, Note: text(r.Note, 150) };
    if (byHours(el)) {
      row.Hours = num(r.Hours);
      if (!(row.Hours > 0 && row.Hours <= 744)) bad('Row ' + i + ': ' + el.Name + ' is paid by the hour: enter the hours (more than 0).');
    } else {
      row.Amount = round2(num(r.Amount));
      if (!(row.Amount > 0)) bad('Row ' + i + ': enter the ' + el.Name + ' amount (more than 0).');
    }
    out[s.EmployeeID].push(row);
  });
  const totals = await calculate(run, user, out);
  return { success: true, run: totals };
});

exports.recalculatePayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const run = await loadRun(user, (request.data || {}).runId);
  requireDraft(run);
  return { success: true, run: await calculate(run, user) };
});

exports.deletePayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const run = await loadRun(user, (request.data || {}).runId);
  requireDraft(run);
  const slips = await SLIPS(run.RunID).get();
  for (let i = 0; i < slips.docs.length; i += 400) { const b = firestore.batch(); slips.docs.slice(i, i + 400).forEach(x => b.delete(x.ref)); await b.commit(); }
  await RUNS().doc(run.RunID).delete();
  return { success: true };
});

// The document behind a payroll journal (step 6, docs/modules/HR_PAYROLL.md):
// the GL report opens a payroll journal in its module, which asks here for
// the run, settlement, loan, interim batch or claim it belongs to.
exports.getPayrollJournalSource = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const snap = await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(text((request.data || {}).jvId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Journal entry not found.');
  const e = snap.data();
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (e.PayrollInterimID) return { ModuleID: 'PAYROLLIP', ID: e.PayrollInterimID, JVNumber: e.JVNumber };
  if (e.PayrollSettlementID) return { ModuleID: 'PAYROLLFS', ID: e.PayrollSettlementID, JVNumber: e.JVNumber };
  if (e.PayrollLoanID) return { ModuleID: 'PAYROLLLOAN', ID: e.PayrollLoanID, JVNumber: e.JVNumber };
  if (e.PayrollRunID) return { ModuleID: 'PAYROLL', ID: e.PayrollRunID, JVNumber: e.JVNumber };
  if (e.PayrollClaimID) return { ModuleID: 'PAYROLL', View: 'Provisions', CompanyID: e.CompanyID, JVNumber: e.JVNumber };
  throw new HttpsError('failed-precondition', e.JVNumber + ' is not a payroll journal.');
});

// Shared with payrollPost.js (step 3).
Object.assign(module.exports, { RUNS, SLIPS, docs, text, bad, actorName, can, requireCap, loadRun, requireDraft, leaveMonth, requireLocked, approvalOf,
  inputElements, settledIn, unpaidMonths, salaryFor });
