// Stop salary: holding an employee's salary (UX round 2, item 29; owner,
// 2026-10-25; docs/modules/SALARY_HOLD.md, decisions Q279, Q299, Q300).
//   - A hold on an employee: from a payroll month, until a month or
//     open-ended, with a reason; placed and released by users with
//     Payroll's post right, no approval (Q299). Every hold and release goes
//     into the employee's history.
//   - The run computes the salary as usual and adds a Stop Salary deduction
//     equal to the net (payrollCalc.js), credited to the company's Salary
//     held account at posting (payrollPost.js): the payslip is normal, its
//     net zero (Q300).
//   - Released: what is still held (the Stop Salary lines of the posted runs
//     less the Salary released ones) is added to the next run as a Salary
//     released earning, debited to Salary held. A leaver's final settlement
//     takes what is still held the same way (payrollSettlement.js).
// Nothing is kept as a balance: what is held is worked out from the posted
// runs, so a reversed run gives its amount back by itself.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const R = require('./payrollRun');

const onCallOptions = { region: 'us-central1' };
const HOLDS = () => firestore.collection('salaryHolds');
const EMPLOYEES = () => firestore.collection('employees');
const HISTORY = () => firestore.collection('employeeHistory');
const STOP = 'Hold', RELEASE = 'HoldRelease'; // the payslip lines' Source
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '');
const round2 = n => Math.round(n * 100) / 100;
const failed = msg => new HttpsError('failed-precondition', msg);

// Is the hold in force for a payroll month?
function inForce(h, month) {
  return h.FromMonth <= month && (!h.UntilMonth || month <= h.UntilMonth) && (!h.ReleasedFromMonth || month < h.ReleasedFromMonth);
}
// The employee's holds, and the one in force for a month (if any).
async function holdsOf(employeeId) {
  return R.docs(await HOLDS().where('EmployeeID', '==', String(employeeId || '-')).get());
}
async function holdsByEmployee(companyId) {
  const out = {};
  R.docs(await HOLDS().where('CompanyID', '==', String(companyId || '-')).get()).forEach(h => (out[h.EmployeeID] = out[h.EmployeeID] || []).push(h));
  return out;
}
const holdFor = (holds, month) => (holds || []).find(h => inForce(h, month)) || null;

// What is still held for an employee: the Stop Salary lines of the given
// posted slips less the Salary released ones (and less a settlement's).
function heldFrom(slips) {
  let held = 0;
  const months = [];
  (slips || []).forEach(s => (s.Lines || []).forEach(l => {
    if (l.Source === STOP) { held += l.Amount; months.push(s.Month || l.Month || ''); }
    if (l.Source === RELEASE) held -= l.Amount;
  }));
  return { amount: round2(Math.max(0, held)), months: months.filter(Boolean) };
}
// The same from the company's posted runs before a month (one employee).
async function heldBefore(companyId, employeeId, beforeMonth) {
  const runs = R.docs(await R.RUNS().where('CompanyID', '==', companyId).get()).filter(r => r.Status === 'Posted' && (!beforeMonth || r.Month < beforeMonth));
  const slips = [];
  for (const r of runs) { const x = await R.SLIPS(r._id).doc(employeeId).get(); if (x.exists) slips.push(Object.assign({ Month: r.Month }, x.data())); }
  return heldFrom(slips);
}
// The first month a hold or release may start: after the latest posted run.
async function firstOpenMonth(companyId) {
  const posted = R.docs(await R.RUNS().where('CompanyID', '==', companyId).get()).filter(r => r.Status === 'Posted').map(r => r.Month).sort();
  return posted.length ? posted[posted.length - 1] : '';
}

async function requirePost(user) {
  await R.requireCap(user);
  if (!(await R.can(user, 'post'))) throw new HttpsError('permission-denied', 'You do not have permission to hold or release salaries.');
}
async function employeeOf(user, id) {
  const snap = await EMPLOYEES().doc(String(id || '-')).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Employee not found.');
  const e = Object.assign({ EmployeeID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, e.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return e;
}
const history = (user, employeeId, action, reason, change) => HISTORY().add({ EmployeeID: employeeId, Action: action, Reason: reason, By: user.uid, ByName: R.actorName(user), At: new Date().toISOString(),
  Changes: [Object.assign({ Field: 'SalaryHold', Label: 'Salary', Sensitive: true }, change)] });

// The holds of the user's companies (or one employee's), each with what is still held.
async function listHolds(user, d) {
  const companyId = R.text(d.companyId, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'Choose one of your companies.');
  const [byEmp, emps] = await Promise.all([holdsByEmployee(companyId), EMPLOYEES().where('CompanyID', '==', companyId).get()]);
  const names = Object.fromEntries(emps.docs.map(x => [x.id, x.data()]));
  const rows = [];
  for (const empId of Object.keys(byEmp)) {
    const held = await heldBefore(companyId, empId);
    byEmp[empId].forEach(h => rows.push(Object.assign({}, h, { _id: undefined, HoldID: h._id, EmployeeNo: (names[empId] || {}).EmployeeNo || '', EmployeeName: (names[empId] || {}).FullName || '', HeldAmount: held.amount, HeldMonths: held.months })));
  }
  const employees = emps.docs.map(x => Object.assign({ EmployeeID: x.id }, x.data())).filter(e => e.Status !== 'Left')
    .map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo || '', FullName: e.FullName || '' })).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  return { employees, holds: rows.sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)) || String(b.FromMonth).localeCompare(String(a.FromMonth))),
    firstOpenMonth: await firstOpenMonth(companyId), canHold: await R.can(user, 'post') };
}
exports.getSalaryHolds = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user);
  return listHolds(user, request.data || {});
});

exports.placeSalaryHold = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePost(user);
  const d = request.data || {};
  const e = await employeeOf(user, d.employeeId);
  const from = R.text(d.fromMonth, 7), until = R.text(d.untilMonth, 7), reason = R.text(d.reason, 300);
  if (!isMonth(from)) R.bad('Choose the payroll month the hold starts from.');
  if (until && !isMonth(until)) R.bad('The month it ends is a payroll month (or blank: until released).');
  if (until && until < from) R.bad('The hold ends before it starts.');
  if (!reason) R.bad('Give the reason for the hold.');
  const open = await firstOpenMonth(e.CompanyID);
  if (open && from <= open) R.bad('The payroll for ' + open + ' is posted: a hold starts from a later month.');
  if (!(await require('./payrollSetup').companySettings(e.CompanyID)).HeldAccountID) throw failed('Set the company\'s Salary held account in Payroll Setup → Payroll Accounting first.');
  const mine = await holdsOf(e.EmployeeID);
  const clash = mine.find(h => !h.ReleasedFromMonth && from <= (h.UntilMonth || '9999-12') && h.FromMonth <= (until || '9999-12'));
  if (clash) R.bad('There is already a hold from ' + clash.FromMonth + (clash.UntilMonth ? ' to ' + clash.UntilMonth : '') + ': release it, or change its months.');
  const now = new Date().toISOString();
  const ref = await HOLDS().add({ EmployeeID: e.EmployeeID, CompanyID: e.CompanyID, FromMonth: from, UntilMonth: until, Reason: reason, Status: 'Active',
    ReleasedFromMonth: '', ReleaseNote: '', CreatedAt: now, CreatedBy: user.uid, CreatedByName: R.actorName(user) });
  await history(user, e.EmployeeID, 'Salary held', reason, { From: '', To: 'Held from ' + from + (until ? ' to ' + until : ' until released') });
  return { success: true, holdId: ref.id };
});

exports.releaseSalaryHold = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePost(user);
  const d = request.data || {};
  const snap = await HOLDS().doc(R.text(d.holdId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Hold not found.');
  const h = snap.data();
  const e = await employeeOf(user, h.EmployeeID);
  if (h.ReleasedFromMonth) throw failed('This hold is already released.');
  const from = R.text(d.fromMonth, 7), note = R.text(d.note, 300);
  if (!isMonth(from)) R.bad('Choose the payroll month the salary is paid again from.');
  if (!note) R.bad('Add a note on the release.');
  const open = await firstOpenMonth(e.CompanyID);
  if (open && from <= open) R.bad('The payroll for ' + open + ' is posted: release from a later month.');
  const now = new Date().toISOString();
  await snap.ref.update({ Status: 'Released', ReleasedFromMonth: from, ReleaseNote: note, ReleasedAt: now, ReleasedBy: user.uid, ReleasedByName: R.actorName(user) });
  const held = await heldBefore(e.CompanyID, e.EmployeeID);
  await history(user, e.EmployeeID, 'Salary released', note, { From: 'Held from ' + h.FromMonth, To: 'Paid again from ' + from + (held.amount ? '; ' + held.amount.toFixed(2) + ' held is added to that run' : '') });
  return { success: true, heldAmount: held.amount };
});

Object.assign(exports, { inForce, holdsOf, holdsByEmployee, holdFor, heldFrom, heldBefore, STOP, RELEASE });
