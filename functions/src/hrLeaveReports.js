// HR: Attendance and Leave Register, step 4: reports and Home (owner,
// 2026-10-03; docs/modules/HR_LEAVE.md, sections 5 and 7).
//   - Leave Reports (module LEAVEREPORTS): balances on a date; the register
//     for a period (each leave's days, unpaid and absent days in it);
//     absences; the who-is-away calendar for a month.
//   - Home: who is on leave today (with the day they're back), and the
//     returns still to record (approved leave of a "HR confirms the return"
//     type whose last day has passed).
// All for the companies the user may see.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const { leaveTypes, calendar, calendarFor } = require('./hrLeaveSetup');
const { addDay, countedDays } = require('./workCalendar');
const lv = require('./hrLeave');

const onCallOptions = { region: 'us-central1' };
const LEAVES = () => firestore.collection('leaveRequests');
const EMPLOYEES = () => firestore.collection('employees');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const today = () => todayIn('Asia/Dubai');
const round2 = n => Math.round(n * 100) / 100;
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const docs = snap => snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
const sum = list => round2(list.reduce((s, x) => s + x.Fraction, 0));

async function requireReports(user) {
  if (!(await moduleHasCapability('LEAVEREPORTS', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Leave Reports.');
}
// The companies asked for: one (if the user may see it), or all theirs.
function companyFilter(user, id) {
  const co = text(id, 80);
  if (co && !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return c => (co ? c === co : userCanAccessCompany(user.profile, c));
}
async function employeesFor(ok) { return docs(await EMPLOYEES().get()).filter(e => ok(e.CompanyID)).map(e => Object.assign(e, { EmployeeID: e._id })); }
async function leavesFor(ok) { return docs(await LEAVES().get()).filter(l => ok(l.CompanyID)).map(l => Object.assign(l, { LeaveID: l._id })); }
const byNo = (a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo));

// ---------- reports ----------

// The leave types, for the reports' filter.
exports.getLeaveReportTypes = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReports(user);
  return { types: (await leaveTypes()).filter(t => t.Active !== false).map(t => ({ LeaveTypeID: t.LeaveTypeID, Code: t.Code, Name: t.Name, Kind: t.Kind })) };
});

// Each employee's balances on a date (types that use one).
exports.getLeaveBalanceReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReports(user);
  const d = request.data || {};
  const asOf = text(d.asOf, 10) || today();
  if (!isDate(asOf)) bad('Enter the date.');
  const ok = companyFilter(user, d.companyId);
  const types = (await leaveTypes()).filter(t => t.Kind === 'Leave' && t.UsesBalance);
  const emps = (await employeesFor(ok)).filter(e => e.JoinDate <= asOf && !(e.Status === 'Left' && e.LeavingDate && e.LeavingDate < asOf)).sort(byNo);
  const rows = [];
  for (const e of emps) {
    const cache = { leaves: await lv.leavesOf(e.EmployeeID), grade: await lv.gradeLevel(e) };
    for (const t of types) {
      const b = await lv.balanceOf(e, t, asOf, null, cache);
      rows.push(Object.assign({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, EmployeeName: e.FullName, CompanyID: e.CompanyID, Grade: cache.grade ? cache.grade.Code : '', Code: t.Code, Name: t.Name }, b));
    }
  }
  return { asOf, rows };
});

// Approved leave with days in a period: each leave's days, unpaid and
// absent days within it. absencesOnly: the leave with absent days (an
// absence entry, or a late return).
exports.getLeaveRegisterReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReports(user);
  const d = request.data || {};
  const from = text(d.from, 10), to = text(d.to, 10);
  if (!isDate(from) || !isDate(to)) bad('Enter the period.');
  if (to < from) bad('The end of the period is before its start.');
  const ok = companyFilter(user, d.companyId);
  const typeId = text(d.leaveTypeId, 80);
  const withFiles = await lv.leavesWithFiles();
  // The supporting document (payroll step 6, decision 44): attached, or missing and who accepted it.
  const documentOf = l => !l.DocumentNeeded ? '' : withFiles.has(l.LeaveID) ? 'Attached'
    : 'Missing' + (l.AcceptedWithoutDocument ? ', accepted by ' + l.AcceptedWithoutDocument.By : '');
  const rows = (await leavesFor(ok)).filter(l => l.Status === 'Approved' && (!typeId || l.LeaveTypeID === typeId)).map(l => {
    const lines = (l.Lines || []).filter(x => lv.live(x) && x.Date >= from && x.Date <= to);
    const absent = lines.filter(x => x.Absence);
    return { LeaveID: l.LeaveID, LeaveNumber: l.LeaveNumber, EmployeeID: l.EmployeeID, EmployeeNo: l.EmployeeNo, EmployeeName: l.EmployeeName, CompanyID: l.CompanyID,
      LeaveTypeName: l.LeaveTypeName, Kind: l.Kind, FromDate: l.FromDate, ToDate: l.EffectiveTo || l.ToDate, ReturnDate: l.ReturnDate || '',
      Days: sum(lines.filter(x => !x.Absence)), UnpaidDays: sum(lines.filter(x => x.Pay === 'Unpaid' && !x.Absence)), AbsentDays: sum(absent),
      Reason: l.Kind === 'Absence' ? (l.Reason || '') : absent.length ? 'Late return (due ' + l.ExpectedReturn + ')' : '', Document: documentOf(l), _n: lines.length };
  }).filter(r => r._n && (!d.absencesOnly || r.AbsentDays))
    .map(r => { delete r._n; return r; })
    .sort((a, b) => a.FromDate.localeCompare(b.FromDate) || byNo(a, b));
  return { from, to, rows };
});

// Who is away in a month: each day of each employee's approved (and
// pending, marked) leave, with the company's weekend and holidays.
exports.getLeaveCalendar = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireReports(user);
  const d = request.data || {};
  const month = text(d.month, 7);
  if (!isMonth(month)) bad('Choose a month.');
  const co = text(d.companyId, 80);
  if (!co) bad('Choose the company.');
  const ok = companyFilter(user, co);
  const start = month + '-01', end = lv.monthEnd(start);
  const days = [];
  for (let x = start; x <= end; x = addDay(x, 1)) days.push(x);
  const cal = await calendar(co);
  const leaves = (await leavesFor(ok)).filter(l => l.Status === 'Approved' || l.Status === 'PendingApproval');
  const emps = (await employeesFor(ok)).filter(e => e.JoinDate <= end && !(e.Status === 'Left' && e.LeavingDate && e.LeavingDate < start)).sort(byNo);
  const rows = [];
  for (const e of emps) {
    // The employee's days off: their schedule's weekend and the holidays.
    const ecal = await calendarFor(e);
    const working = new Set(countedDays(ecal, start, end, 'Working'));
    const cells = {};
    leaves.filter(l => l.EmployeeID === e.EmployeeID).forEach(l => (l.Lines || []).filter(x => lv.live(x) && x.Date >= start && x.Date <= end).forEach(x => {
      const c = cells[x.Date] || { Codes: [], Fraction: 0 };
      if (!c.Codes.includes(x.Code)) c.Codes.push(x.Code);
      c.Fraction = round2(c.Fraction + x.Fraction);
      c.Pending = c.Pending || l.Status === 'PendingApproval';
      c.Absence = c.Absence || Boolean(x.Absence);
      c.Name = x.Absence ? 'Absent' : x.Split ? l.LeaveTypeName + ' (unpaid part)' : l.LeaveTypeName;
      c.LeaveID = l.LeaveID;
      cells[x.Date] = c;
    }));
    rows.push({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, EmployeeName: e.FullName, Cells: cells, Off: days.filter(x => !working.has(x)),
      Away: round2(Object.values(cells).reduce((s, c) => s + c.Fraction, 0)) });
  }
  return { month, days, weekend: cal.Weekend, holidays: cal.Holidays.filter(h => h.To >= start && h.From <= end), rows };
});

// ---------- Home ----------

// Leave tasks (payroll step 7, decision 59): "on leave today" and "returns
// to record" go only to the employee (their linked ERP user) and their line
// manager (the manager's linked user), when assigned; no one else.
exports.getLeaveTasksForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const t = today();
  const emps = docs(await EMPLOYEES().get()).map(e => Object.assign(e, { EmployeeID: e._id }));
  const mine = emps.filter(e => e.UserUID && e.UserUID === user.uid).map(e => e.EmployeeID);
  if (!mine.length) return { today: t, onLeaveToday: [], returnsToRecord: [] };
  // Whose leave this user hears about: their own, and their direct reports'.
  const role = {};
  emps.forEach(e => {
    if (mine.includes(e.EmployeeID)) role[e.EmployeeID] = 'Own';
    else if (e.ManagerID && mine.includes(e.ManagerID)) role[e.EmployeeID] = 'Report';
  });
  const leaves = docs(await LEAVES().where('Status', '==', 'Approved').get()).map(l => Object.assign(l, { LeaveID: l._id })).filter(l => role[l.EmployeeID]);
  const item = l => ({ ModuleID: 'LEAVE', DocumentID: l.LeaveID, LeaveNumber: l.LeaveNumber, EmployeeID: l.EmployeeID, EmployeeNo: l.EmployeeNo, EmployeeName: l.EmployeeName,
    LeaveTypeName: l.LeaveTypeName, Kind: l.Kind, FromDate: l.FromDate, ToDate: l.EffectiveTo || l.ToDate, ExpectedReturn: l.ExpectedReturn || '', As: role[l.EmployeeID] === 'Own' ? 'Employee' : 'Line manager' });
  const onLeaveToday = leaves.filter(l => l.Kind !== 'Absence' && (l.Lines || []).some(x => lv.live(x) && !x.Absence && x.Date === t))
    .map(item).sort((a, b) => a.ExpectedReturn.localeCompare(b.ExpectedReturn) || byNo(a, b));
  // Due once the expected return (the next working day after the leave) has come.
  const due = l => l.ExpectedReturn || addDay(l.ToDate, 1);
  const returnsToRecord = leaves.filter(l => l.Kind === 'Leave' && l.ConfirmReturn && !l.ReturnDate && due(l) <= t)
    .map(l => Object.assign(item(l), { DaysOverdue: Math.round((Date.parse(t) - Date.parse(due(l))) / 86400000) }))
    .sort((a, b) => a.ExpectedReturn.localeCompare(b.ExpectedReturn));
  return { today: t, onLeaveToday, returnsToRecord };
});
