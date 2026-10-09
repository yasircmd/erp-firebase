// HR: Attendance and Leave Register, step 4 (owner, 2026-10-03;
// docs/modules/HR_LEAVE.md): the reports (balances on a date, the register
// for a period, absences, who is away), the Home tasks (on leave today,
// returns to record), company access and rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb, firestore } = require('./_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const T = todayIn('Asia/Dubai');
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
let ALI, SARA, OMAR, TYPE, IDS = {};

// Ali (G3, opening Annual 5 on 31 Jan 2026) and Sara (G7, joined 1 Jul
// 2025) in C1; Omar in C2. Absences need approval (for a pending one).
async function seed() {
  const f = baseFixture();
  f.users['u-other'].AssignedCompanies = ['C2'];
  f.approvalConfigurations = { LEAVE_ABSENCE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { LEAVE_ABSENCE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const g7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  ALI = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  SARA = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Sara Khan', CompanyID: 'C1', JoinDate: '2025-07-01', DesignationID: des, GradeID: g7, Gender: 'Female' } })).employeeId;
  OMAR = (await call('u-other', 'saveEmployee', { employee: { FullName: 'Omar Said', CompanyID: 'C2', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 24 }, { LevelFrom: 5, LevelTo: 99, DaysPerYear: 30 }] });
  for (const co of ['C1', 'C2']) for (const y of [2026, Number(T.slice(0, 4)) + 1]) await call(co === 'C1' ? 'u-admin' : 'u-other', 'saveWorkCalendar', { companyId: co, year: y, weekend: [0, 6], holidays: [] }).catch(() => {});
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '5', '31/01/2026']]) });
  const enter = async (uid, emp, code, from, to) => { const id = (await call(uid, 'saveLeave', { leave: { EmployeeID: emp, LeaveTypeID: TYPE[code], FromDate: from, ToDate: to } })).leaveId; await call(uid, 'submitLeave', { leaveId: id }); return id; };
  IDS.aliAnnual = await enter('u-admin', ALI, 'ANNUAL', '2026-03-16', '2026-03-20');
  IDS.aliUnpaid = await enter('u-admin', ALI, 'UNPAID', '2026-04-01', '2026-04-02');
  IDS.aliAbsent = await enter('u-admin', ALI, 'ABSENT', '2026-04-06', '2026-04-06');
  await call('u-approver', 'decideLeaveApproval', { leaveId: IDS.aliAbsent, levelNumber: 1, decision: 'Approved' });
  IDS.saraAnnual = await enter('u-admin', SARA, 'ANNUAL', '2026-03-30', '2026-04-03');
  await call('u-admin', 'recordLeaveReturn', { leaveId: IDS.saraAnnual, returnDate: '2026-04-08', confirm: true }); // due 6 Apr: 2 days late
  IDS.saraPending = await enter('u-admin', SARA, 'ABSENT', '2026-04-20', '2026-04-20');
  IDS.saraMay = await enter('u-admin', SARA, 'ANNUAL', '2026-05-04', '2026-05-08'); // no return recorded
  IDS.omar = await enter('u-other', OMAR, 'UNPAID', '2026-04-01', '2026-04-01');
}
test.before(seed);

test('balances on a date: each employee and type, the user\'s companies only', async () => {
  const r = await call('u-admin', 'getLeaveBalanceReport', { asOf: '2026-03-31' });
  // Ali: 5 + 2 + 2 - 5 taken. Sara: 9 months x 2.5, 2 days taken, 8 booked (1-3 Apr, 4-8 May).
  assert.deepEqual(r.rows.map(x => [x.EmployeeName, x.Code, x.Opening, x.Accrued, x.Taken, x.Booked, x.Available]), [
    ['Ali Hassan', 'ANNUAL', 5, 4, 5, 0, 4], ['Sara Khan', 'ANNUAL', 0, 22.5, 2, 8, 12.5]]);
  assert.deepEqual((await call('u-other', 'getLeaveBalanceReport', { asOf: '2026-03-31' })).rows.map(x => x.EmployeeName), ['Omar Said']);
  await assert.rejects(call('u-admin', 'getLeaveBalanceReport', { asOf: '2026-03-31', companyId: 'C2' }), /access to that company/);
  await assert.rejects(call('u-admin', 'getLeaveBalanceReport', { asOf: '2026-02-30' }), /Enter the date/);
});

test('the register for a period: days, unpaid and absent days within it; by type; absences and late returns', async () => {
  const r = await call('u-admin', 'getLeaveRegisterReport', { from: '2026-04-01', to: '2026-04-30' });
  assert.deepEqual(r.rows.map(x => [x.EmployeeName, x.LeaveTypeName, x.Days, x.UnpaidDays, x.AbsentDays, x.Reason]), [
    ['Sara Khan', 'Annual Leave', 3, 0, 2, 'Late return (due 2026-04-06)'],
    ['Ali Hassan', 'Unpaid Leave', 2, 2, 0, ''],
    ['Ali Hassan', 'Absence (unauthorised)', 0, 0, 1, '']]);
  const annual = await call('u-admin', 'getLeaveRegisterReport', { from: '2026-03-01', to: '2026-03-31', leaveTypeId: TYPE.ANNUAL });
  assert.deepEqual(annual.rows.map(x => [x.EmployeeName, x.Days]), [['Ali Hassan', 5], ['Sara Khan', 2]]);
  const abs = await call('u-admin', 'getLeaveRegisterReport', { from: '2026-04-01', to: '2026-04-30', absencesOnly: true });
  assert.deepEqual(abs.rows.map(x => [x.EmployeeName, x.AbsentDays]), [['Sara Khan', 2], ['Ali Hassan', 1]], 'pending absences are not in the register');
  await assert.rejects(call('u-admin', 'getLeaveRegisterReport', { from: '2026-04-30', to: '2026-04-01' }), /end of the period is before its start/);
});

test('who is away in a month: each day, absences and pending marked; one company', async () => {
  const r = await call('u-admin', 'getLeaveCalendar', { companyId: 'C1', month: '2026-04' });
  assert.deepEqual([r.days.length, r.days[0], r.weekend], [30, '2026-04-01', [0, 6]]);
  const ali = r.rows.find(x => x.EmployeeID === ALI), sara = r.rows.find(x => x.EmployeeID === SARA);
  assert.deepEqual(Object.keys(ali.Cells).sort(), ['2026-04-01', '2026-04-02', '2026-04-06']);
  assert.deepEqual([ali.Cells['2026-04-01'].Codes, ali.Cells['2026-04-06'].Absence, ali.Away], [['UNPAID'], true, 3]);
  assert.deepEqual([sara.Cells['2026-04-03'].Codes, sara.Cells['2026-04-07'].Absence, sara.Cells['2026-04-20'].Pending, sara.Away], [['ANNUAL'], true, true, 6]);
  assert.equal(r.rows.some(x => x.EmployeeID === OMAR), false);
  await assert.rejects(call('u-admin', 'getLeaveCalendar', { companyId: 'C2', month: '2026-04' }), /access to that company/);
  await assert.rejects(call('u-admin', 'getLeaveCalendar', { companyId: 'C1', month: '2026-13' }), /Choose a month/);
});

test('Home: on leave today and returns to record go only to the employee and their line manager (step 7, decision 59)', async () => {
  const today = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: ALI, LeaveTypeID: TYPE.UNPAID, FromDate: addDays(T, -1), ToDate: addDays(T, 1) } })).leaveId;
  await call('u-admin', 'submitLeave', { leaveId: today });
  // Ali is u-viewer's employee record; Sara (u-approver) reports to Ali.
  await firestore.collection('employees').doc(ALI).update({ UserUID: 'u-viewer' });
  await firestore.collection('employees').doc(SARA).update({ UserUID: 'u-approver', ManagerID: ALI });
  const ago = d => Math.round((Date.parse(T) - Date.parse(d)) / 86400000);
  // The manager: their own leave, and their report's.
  const r = await call('u-viewer', 'getLeaveTasksForUser', {});
  assert.deepEqual(r.onLeaveToday.map(x => [x.DocumentID, x.EmployeeName, x.ModuleID, x.As]), [[today, 'Ali Hassan', 'LEAVE', 'Employee']]);
  assert.ok(r.onLeaveToday[0].ExpectedReturn > addDays(T, 1));
  // Annual leave (HR confirms the return) with none recorded: Ali's in March, Sara's in May; Sara's March one was recorded.
  assert.deepEqual(r.returnsToRecord.map(x => [x.DocumentID, x.ExpectedReturn, x.DaysOverdue, x.As]),
    [[IDS.aliAnnual, '2026-03-23', ago('2026-03-23'), 'Employee'], [IDS.saraMay, '2026-05-11', ago('2026-05-11'), 'Line manager']]);
  // The employee: only their own, not their manager's.
  const s2 = await call('u-approver', 'getLeaveTasksForUser', {});
  assert.deepEqual([s2.onLeaveToday, s2.returnsToRecord.map(x => [x.DocumentID, x.As])], [[], [[IDS.saraMay, 'Employee']]]);
  // Anyone else, Leave Register users (HR) included: nothing.
  for (const uid of ['u-admin', 'u-other']) {
    const x = await call(uid, 'getLeaveTasksForUser', {});
    assert.deepEqual([x.onLeaveToday, x.returnsToRecord], [[], []], uid);
  }
  await rtdb.ref('permissions/LEAVEREPORTS/access').set(['Admin']);
  await assert.rejects(call('u-viewer', 'getLeaveBalanceReport', {}), /access to Leave Reports/);
});
