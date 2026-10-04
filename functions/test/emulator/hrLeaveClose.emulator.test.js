// HR: Attendance and Leave Register, step 3 (owner, 2026-10-04;
// docs/modules/HR_LEAVE.md, decisions 9-13): absences (their own approval,
// always unpaid); unpaid days stop accrual; the month lock (after the month
// ends, in order, not over undecided leave; the summary for payroll; the
// accrual posted at the grade then); back-dated leave and cancellations
// after a lock land in the next open month; reopening the latest month;
// the year close (carry to the cap, the rest lapses, once).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');
const { todayIn } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
let ALI, SARA, TYPE, G7;

// As the step 2 suite: Ali G3 (24 a year, 2 a month), opening Annual 5 on
// 31 Jan 2026; Sara G7 (30 a year), joined 1 Jul 2025. Annual carries up to 10.
async function seed(absenceApproval) {
  const f = baseFixture();
  if (absenceApproval) {
    f.approvalConfigurations = { LEAVE_ABSENCE: { Enabled: true, ScopeType: 'Global' } };
    f.approvalLevels = { LEAVE_ABSENCE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  }
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  G7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  ALI = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  SARA = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Sara Khan', CompanyID: 'C1', JoinDate: '2025-07-01', DesignationID: des, GradeID: G7, Gender: 'Female' } })).employeeId;
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 24 }, { LevelFrom: 5, LevelTo: 99, DaysPerYear: 30 }] });
  await call('u-admin', 'saveLeavePayRules', { leaveTypeId: TYPE.ANNUAL, rows: [{ LevelFrom: 1, LevelTo: 4, Pay: 'Basic', Percent: 100 }, { LevelFrom: 5, LevelTo: 99, Pay: 'Full', Percent: 100 }] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '5', '31/01/2026']]) });
}
const leave = (emp, code, from, to) => ({ EmployeeID: emp, LeaveTypeID: TYPE[code], FromDate: from, ToDate: to });
async function enter(l) { const id = (await call('u-admin', 'saveLeave', { leave: l })).leaveId; const r = await call('u-admin', 'submitLeave', { leaveId: id }); return { id, status: r.status }; }
const balance = async (emp, asOf) => (await call('u-admin', 'getLeaveBalances', { employeeId: emp, asOf })).balances.find(b => b.Code === 'ANNUAL');
const lock = (month, uid) => call(uid || 'u-admin', 'lockLeaveMonth', { companyId: 'C1', month });
const summary = async month => (await call('u-admin', 'getLeaveMonthSummary', { companyId: 'C1', month }));
const rowOf = (s, emp) => s.rows.find(r => r.EmployeeID === emp);

test('absences: always unpaid, no balance, their own approval entry; cancelled when recorded in error', async () => {
  await seed(true);
  const v = (await call('u-admin', 'previewLeave', { leave: leave(ALI, 'ABSENT', '2026-03-09', '2026-03-10') })).preview;
  assert.deepEqual(v.Summary.map(s => [s.Label, s.Days]), [['Absent, unpaid', 2]]);
  assert.deepEqual([v.Balance, v.Lines.every(x => x.Absence && x.Pay === 'Unpaid' && x.Code === 'ABSENT')], [null, true]);
  const a = await enter(leave(ALI, 'ABSENT', '2026-03-09', '2026-03-10'));
  assert.equal(a.status, 'PendingApproval', 'the absence entry has approval set up');
  assert.equal((await enter(leave(ALI, 'UNPAID', '2026-04-06', '2026-04-06'))).status, 'Approved', 'leave has none');
  await call('u-approver', 'decideLeaveApproval', { leaveId: a.id, levelNumber: 1, decision: 'Approved' });
  // Started long ago, but an absence can be cancelled (recorded in error).
  await call('u-admin', 'cancelLeave', { leaveId: a.id, reason: 'He was on site' });
  assert.equal((await call('u-admin', 'getLeave', { leaveId: a.id })).leave.Status, 'Cancelled');
});

test('unpaid days stop accrual: unpaid leave and absences take their share of the month', async () => {
  await seed();
  await enter(leave(ALI, 'UNPAID', '2026-02-02', '2026-02-08')); // 7 calendar days
  await enter(leave(ALI, 'ABSENT', '2026-03-09', '2026-03-10')); // 2 working days
  assert.equal((await balance(ALI, '2026-02-28')).Accrued, 1.5); // 2 x 21/28
  assert.equal((await balance(ALI, '2026-03-31')).Accrued, 3.37); // + 2 x 29/31 = 1.87
});

test('the month lock: after it ends, in order, not over undecided leave; the summary; the accrual at the grade then; reopening the latest', async () => {
  await seed();
  const thisMonth = todayIn('Asia/Dubai').slice(0, 7);
  await assert.rejects(lock(thisMonth), /locked after it ends/);
  await assert.rejects(lock('2026-02', 'u-viewer'), /permission to lock months/);
  await enter(leave(ALI, 'UNPAID', '2026-02-02', '2026-02-08'));
  const draft = (await call('u-admin', 'saveLeave', { leave: leave(ALI, 'UNPAID', '2026-02-20', '2026-02-20') })).leaveId;
  await assert.rejects(lock('2026-02'), /Decide or delete the leave dated up to the month's end first: draft \(Ali Hassan\)/);
  await call('u-admin', 'deleteLeave', { leaveId: draft });
  assert.equal((await lock('2026-02')).employees, 2);
  await assert.rejects(lock('2026-04'), /in order: the next to lock is 2026-03/);
  await assert.rejects(lock('2026-02'), /already locked/);
  const feb = await summary('2026-02');
  assert.equal(feb.status, 'Locked');
  assert.deepEqual([rowOf(feb, ALI).UnpaidDays, rowOf(feb, ALI).Accrued], [7, [{ Code: 'ANNUAL', Days: 1.5 }]]);
  assert.deepEqual(rowOf(feb, SARA).Accrued, [{ Code: 'ANNUAL', Days: 2.5 }]);
  // Promoted to G7 after February was locked: February stays at G3.
  const e = (await call('u-admin', 'getEmployee', { employeeId: ALI })).employee;
  await call('u-admin', 'saveEmployee', { employee: Object.assign({}, e, { GradeID: G7 }), correction: 'Promoted in March' });
  assert.equal((await balance(ALI, '2026-02-28')).Accrued, 1.5);
  assert.equal((await balance(ALI, '2026-03-31')).Accrued, 4); // + 2.5 for March at G7
  // Back-dated into locked February: paid (and taken off accrual) in March, an adjustment.
  await enter(leave(ALI, 'UNPAID', '2026-02-23', '2026-02-24'));
  await enter(leave(ALI, 'ABSENT', '2026-03-09', '2026-03-10'));
  const marOpen = await summary('2026-03');
  assert.equal(marOpen.status, 'Open');
  assert.deepEqual([rowOf(marOpen, ALI).UnpaidDays, rowOf(marOpen, ALI).AbsentDays, rowOf(marOpen, ALI).AdjustmentDays], [4, 2, 2]);
  await lock('2026-03');
  const mar = await summary('2026-03');
  assert.deepEqual(rowOf(mar, ALI).Accrued, [{ Code: 'ANNUAL', Days: 2.18 }]); // 2.5 x (31 - 4) / 31
  // Reopening: the latest only, with a reason; its accrual is taken back.
  await assert.rejects(call('u-admin', 'reopenLeaveMonth', { companyId: 'C1', month: '2026-02', reason: 'x' }), /Only the latest locked month \(2026-03\)/);
  await assert.rejects(call('u-admin', 'reopenLeaveMonth', { companyId: 'C1', month: '2026-03' }), /reason for reopening/);
  await call('u-admin', 'reopenLeaveMonth', { companyId: 'C1', month: '2026-03', reason: 'Absence entered wrongly' });
  const months = (await call('u-admin', 'getLeaveMonths', { companyId: 'C1' })).months;
  const m = months.find(x => x.Month === '2026-03');
  assert.deepEqual([m.Status, m.History.map(h => h.Event)], ['Open', ['Locked', 'Reopened']]);
  assert.equal((await call('u-admin', 'getLeaveMonths', { companyId: 'C1' })).nextLockable, '2026-03');
  assert.equal((await balance(ALI, '2026-03-31')).Accrued, 3.68); // projected again: 1.5 + 2.5 x 27/31
});

test('a cancellation after the lock is reversed in the next open month', async () => {
  await seed();
  const a = await enter(leave(ALI, 'ABSENT', '2026-03-09', '2026-03-10'));
  await lock('2026-03');
  await call('u-admin', 'cancelLeave', { leaveId: a.id, reason: 'Recorded in error' });
  assert.deepEqual([rowOf(await summary('2026-03'), ALI).AbsentDays], [2], 'the locked month keeps what was paid');
  const apr = rowOf(await summary('2026-04'), ALI);
  assert.deepEqual([apr.UnpaidDays, apr.AbsentDays, apr.AdjustmentDays], [-2, -2, -2]);
  const l = (await call('u-admin', 'getLeave', { leaveId: a.id })).leave;
  assert.deepEqual(l.Lines.map(x => [x.Date, x.Fraction, x.PayMonth, x.Reversal]), [['2026-03-09', -1, '2026-04', true], ['2026-03-10', -1, '2026-04', true]]);
});

test('the year close: after December is locked, carry to the cap, the rest lapses as an adjustment; once', async () => {
  await seed();
  const pre = await call('u-admin', 'closeLeaveYear', { companyId: 'C1', year: 2025 });
  assert.equal(pre.decemberLocked, false);
  // Sara: 6 months at 30 a year = 15; carry 10, lapse 5. Ali's balance starts in 2026.
  assert.deepEqual(pre.rows.map(r => [r.EmployeeName, r.Code, r.Balance, r.Carry, r.Lapse]), [['Sara Khan', 'ANNUAL', 15, 10, 5]]);
  await assert.rejects(call('u-admin', 'closeLeaveYear', { companyId: 'C1', year: 2025, confirm: true }), /Lock December 2025 first/);
  await lock('2025-12');
  await assert.rejects(call('u-viewer', 'closeLeaveYear', { companyId: 'C1', year: 2025, confirm: true }), /permission to lock months or close the leave year/);
  const r = await call('u-admin', 'closeLeaveYear', { companyId: 'C1', year: 2025, confirm: true });
  assert.equal(r.lapsed, 5);
  const b = await balance(SARA, '2026-01-31');
  assert.deepEqual([b.Adjustments, b.Available], [-5, 12.5]);
  await assert.rejects(call('u-admin', 'closeLeaveYear', { companyId: 'C1', year: 2025, confirm: true }), /already closed/);
  assert.equal((await call('u-admin', 'closeLeaveYear', { companyId: 'C1', year: 2025 })).closed, true);
  await assert.rejects(call('u-admin', 'reopenLeaveMonth', { companyId: 'C1', month: '2025-12', reason: 'x' }), /2025 is closed: December stays locked/);
});
