// HR: Attendance and Leave Register, step 2: the Leave Register (owner,
// 2026-10-03; docs/modules/HR_LEAVE.md): the day count (working days,
// holidays, half days), the balance (opening, monthly accrual by grade,
// adjustments), the excess over the balance split off as Unpaid, the pay
// of each day by grade level and day band, the rules (gender, probation,
// overlaps, limits, a document), approval, cancel, the return (early or
// late), the opening balances import, rights and My Drafts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const T = todayIn('Asia/Dubai');
const PDF = Buffer.from('%PDF-1.4\n% medical certificate\n').toString('base64');
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
let ALI, SARA, TYPE;

// Ali: G3 (level 3), joined 2024, opening Annual 5 days on 31 Jan 2026.
// Sara: G7 (level 7), joined 1 Jul 2025, probation to 31 Dec 2025.
// Annual: levels 1-4 earn 24 a year (2 a month) on basic only; 5+ earn 30
// on full salary. C1: Sat-Sun weekend, Eid 19-20 Mar 2026.
async function seed(withApproval) {
  const f = baseFixture();
  if (withApproval) {
    f.approvalConfigurations = { LEAVE: { Enabled: true, ScopeType: 'Global' } };
    f.approvalLevels = { LEAVE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  }
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const g7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  ALI = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  SARA = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Sara Khan', CompanyID: 'C1', JoinDate: '2025-07-01', ProbationEndDate: '2025-12-31', DesignationID: des, GradeID: g7, Gender: 'Female' } })).employeeId;
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 24 }, { LevelFrom: 5, LevelTo: 99, DaysPerYear: 30 }] });
  await call('u-admin', 'saveLeavePayRules', { leaveTypeId: TYPE.ANNUAL, rows: [{ LevelFrom: 1, LevelTo: 4, Pay: 'Basic', Percent: 100 }, { LevelFrom: 5, LevelTo: 99, Pay: 'Full', Percent: 100 }] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [{ From: '2026-03-19', To: '2026-03-20', Name: 'Eid' }] });
  const imp = await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '5', '31/01/2026']]) });
  assert.equal(imp.success, true, JSON.stringify(imp.issues));
}
const leave = (emp, code, from, to, extra) => Object.assign({ EmployeeID: emp, LeaveTypeID: TYPE[code], FromDate: from, ToDate: to }, extra || {});
const preview = (l, uid) => call(uid || 'u-admin', 'previewLeave', { leave: l }).then(r => r.preview);
const save = (l, uid) => call(uid || 'u-admin', 'saveLeave', { leave: l });
const submit = (id, uid) => call(uid || 'u-admin', 'submitLeave', { leaveId: id });
async function approved(l) { const id = (await save(l)).leaveId; const r = await submit(id); assert.equal(r.status, 'Approved'); return id; }
const balance = async (emp, asOf, code) => (await call('u-admin', 'getLeaveBalances', { employeeId: emp, asOf })).balances.find(b => b.Code === (code || 'ANNUAL'));
const summary = v => v.Summary.map(s => [s.Label, s.Days]);

test('the balance: opening, monthly accrual by grade (pro-rata by days), from joining when there is no opening', async () => {
  await seed();
  const b = await balance(ALI, '2026-03-31');
  assert.deepEqual([b.Opening, b.OpeningAsOf, b.Accrued, b.Taken, b.Booked, b.Available], [5, '2026-01-31', 4, 0, 0, 9]);
  assert.equal((await balance(ALI, '2026-02-14')).Available, 6); // 2 a month x 14/28
  // Sara: no opening, from joining at level 7 (30 a year): six months.
  assert.equal((await balance(SARA, '2025-12-31')).Accrued, 15);
  // Types without a balance show what's used this year.
  const all = (await call('u-admin', 'getLeaveBalances', { employeeId: ALI, asOf: '2026-03-31' })).balances;
  assert.deepEqual(all.find(x => x.Code === 'SICK'), { LeaveTypeID: TYPE.SICK, Code: 'SICK', Name: 'Sick Leave', UsesBalance: false, UsedThisYear: 0, MaxPerYear: 90 });
});

test('annual leave: working days skip the weekend and Eid; half days; paid by grade; the excess over the balance is split off as Unpaid', async () => {
  await seed();
  // 16-24 Mar: Mon-Wed, (Eid Thu-Fri, weekend), Mon-Tue = 5 days.
  const v = await preview(leave(ALI, 'ANNUAL', '2026-03-16', '2026-03-24'));
  assert.deepEqual(v.Lines.map(l => l.Date), ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-23', '2026-03-24']);
  assert.deepEqual([v.Days, v.TypeDays, v.UnpaidDays], [5, 5, 0]);
  assert.deepEqual(summary(v), [['Annual Leave — Basic only', 5]]);
  // 5 + Feb 2 + Mar 2 x 16/31 = 8.03 on the first day.
  assert.deepEqual(v.Balance, { Before: 8.03, After: 3.03 });
  assert.equal(v.ExpectedReturn, '2026-03-25');
  assert.equal((await preview(leave(ALI, 'ANNUAL', '2026-03-16', '2026-03-24', { HalfStart: true }))).Days, 4.5);
  await assert.rejects(preview(leave(ALI, 'ANNUAL', '2026-03-21', '2026-03-24')), /starts on a day off/);
  await assert.rejects(preview(leave(ALI, 'ANNUAL', '2026-03-16', '2026-03-19')), /ends on a day off/);
  const first = await approved(leave(ALI, 'ANNUAL', '2026-03-16', '2026-03-24', { Reason: 'Family visit' }));
  const l = (await call('u-admin', 'getLeave', { leaveId: first })).leave;
  assert.deepEqual([l.LeaveNumber, l.Status, l.Days], ['LV-2026-0001', 'Approved', 5]);
  // 6-17 Apr: 10 working days; the balance on 6 Apr is 5 + 2 + 2 + 0.4 - 5 = 4.4, so 4 annual and 6 unpaid.
  const over = await preview(leave(ALI, 'ANNUAL', '2026-04-06', '2026-04-17'));
  assert.deepEqual(summary(over), [['Annual Leave — Basic only', 4], ['Unpaid (over the balance)', 6]]);
  assert.deepEqual([over.TypeDays, over.UnpaidDays, over.Balance.Before, over.Balance.After], [4, 6, 4.4, 0.4]);
  assert.deepEqual(over.Lines.filter(x => x.Split).map(x => [x.Date, x.Code, x.Pay]).slice(0, 2), [['2026-04-10', 'UNPAID', 'Unpaid'], ['2026-04-13', 'UNPAID', 'Unpaid']]);
  assert.deepEqual(over.Warnings, ['6 days over the balance (4.4) will be unpaid.']);
  // Level 7 is paid the full salary.
  assert.deepEqual(summary(await preview(leave(SARA, 'ANNUAL', '2026-03-02', '2026-03-03'))), [['Annual Leave — Full salary', 2]]);
});

test('sick leave: calendar days paid in tiers through the year; the certificate needed to submit; at most 90 days a year', async () => {
  await seed();
  await call('u-admin', 'useTestDocumentStorage', {});
  const v = await preview(leave(SARA, 'SICK', '2026-02-01', '2026-02-20'));
  assert.deepEqual(summary(v), [['Sick Leave — Full salary', 15], ['Sick Leave — Full salary at 50%', 5]]);
  assert.equal(v.DocumentNeeded, true);
  const id = (await save(leave(SARA, 'SICK', '2026-02-01', '2026-02-20'))).leaveId;
  await assert.rejects(submit(id), /Attach the supporting document \(e\.g\. a medical certificate\)/);
  await call('u-admin', 'uploadAttachment', { module: 'LEAVE', docId: id, fileName: 'certificate.pdf', data: PDF });
  assert.equal((await submit(id)).status, 'Approved');
  // Days 21-50 of the year: 25 at half pay, then 5 unpaid.
  assert.deepEqual(summary(await preview(leave(SARA, 'SICK', '2026-03-01', '2026-03-30'))), [['Sick Leave — Full salary at 50%', 25], ['Sick Leave — Unpaid', 5]]);
  await assert.rejects(preview(leave(SARA, 'SICK', '2026-03-01', '2026-05-14')), /Sick Leave is at most 90 days a year: 20 days already taken or booked in 2026/);
  assert.equal((await balance(SARA, '2026-06-30', 'SICK')).UsedThisYear, 20);
});

test('the rules: gender, probation, overlaps, at most N at a time, whole days, a type without a pay rule', async () => {
  await seed();
  await assert.rejects(preview(leave(ALI, 'MATERNITY', '2026-06-01', '2026-06-10')), /Maternity Leave is for women/);
  await assert.rejects(preview(leave(SARA, 'ANNUAL', '2025-12-15', '2025-12-16')), /starts after probation \(ends 2025-12-31\)/);
  await approved(leave(ALI, 'ANNUAL', '2026-03-16', '2026-03-24'));
  await assert.rejects(preview(leave(ALI, 'UNPAID', '2026-03-24', '2026-03-25')), /already has leave LV-2026-0001 from 2026-03-16 to 2026-03-24/);
  await assert.rejects(preview(leave(ALI, 'COMPASSIONATE', '2026-06-01', '2026-06-06')), /at most 5 days at a time/);
  await assert.rejects(preview(leave(ALI, 'COMPASSIONATE', '2026-06-01', '2026-06-02', { HalfEnd: true })), /taken in whole days/);
  await assert.rejects(preview(leave(ALI, 'ANNUAL', '2023-12-29', '2023-12-29')), /before the date of joining/);
  const marriage = (await call('u-admin', 'saveLeaveType', { leaveType: { Code: 'MARRIAGE', Name: 'Marriage Leave', Kind: 'Leave', Counts: 'Working' } })).leaveTypeId;
  await assert.rejects(call('u-admin', 'previewLeave', { leave: { EmployeeID: ALI, LeaveTypeID: marriage, FromDate: '2026-06-01', ToDate: '2026-06-02' } }),
    /No leave pay rule for Marriage Leave at grade G3 \(level 3\), day 1 of 2026: set it in HR Setup/);
  // Business travel is duty: paid as working, no balance.
  assert.deepEqual(summary(await preview(leave(ALI, 'TRAVEL', '2026-06-06', '2026-06-07'))), [['Business Travel — paid as working', 2]]);
});

test('approval through Approval Configuration: pending counts as booked; approve; reject and correct', async () => {
  await seed(true);
  const id = (await save(leave(ALI, 'ANNUAL', '2026-04-27', '2026-04-28'))).leaveId;
  const s = await submit(id);
  assert.deepEqual([s.status, s.leaveNumber], ['PendingApproval', 'LV-2026-0001']);
  const b = await balance(ALI, '2026-04-30');
  assert.deepEqual([b.Taken, b.Booked], [0, 2]);
  await assert.rejects(call('u-admin', 'saveLeave', { leave: Object.assign(leave(ALI, 'ANNUAL', '2026-04-27', '2026-04-29'), { LeaveID: id }) }), /Only a draft or rejected leave can be edited/);
  const seen = await call('u-approver', 'getLeave', { leaveId: id });
  assert.deepEqual(seen.myLevels, [1]);
  assert.equal((await call('u-approver', 'decideLeaveApproval', { leaveId: id, levelNumber: 1, decision: 'Approved' })).status, 'Approved');
  assert.deepEqual([(await balance(ALI, '2026-04-30')).Taken, (await call('u-admin', 'getLeave', { leaveId: id })).leave.Status], [2, 'Approved']);
  const id2 = (await save(leave(ALI, 'UNPAID', '2026-06-01', '2026-06-03'))).leaveId;
  await submit(id2);
  await call('u-approver', 'decideLeaveApproval', { leaveId: id2, levelNumber: 1, decision: 'Rejected', reason: 'Busy month' });
  const r = (await call('u-admin', 'getLeave', { leaveId: id2 })).leave;
  assert.deepEqual([r.Status, r.RejectionReason], ['Rejected', 'Busy month']);
  await save(Object.assign(leave(ALI, 'UNPAID', '2026-06-08', '2026-06-09'), { LeaveID: id2 }));
  assert.equal((await submit(id2)).status, 'PendingApproval');
});

test('cancel before it starts; the return: early gives days back, late adds unpaid absence', async () => {
  await seed();
  const future = await approved(leave(ALI, 'UNPAID', addDays(T, 10), addDays(T, 12)));
  await assert.rejects(call('u-admin', 'cancelLeave', { leaveId: future }), /reason for cancelling/);
  await call('u-admin', 'cancelLeave', { leaveId: future, reason: 'Plans changed' });
  assert.equal((await call('u-admin', 'getLeave', { leaveId: future })).leave.Status, 'Cancelled');
  const started = await approved(leave(ALI, 'UNPAID', addDays(T, -2), addDays(T, 1)));
  await assert.rejects(call('u-admin', 'cancelLeave', { leaveId: started, reason: 'x' }), /has started: record the return/);
  await assert.rejects(call('u-admin', 'recordLeaveReturn', { leaveId: started, returnDate: addDays(T, 1), confirm: true }), /can't be in the future/);

  // Early: back on Mon 23 Mar instead of Wed 25: two days return.
  const early = await approved(leave(ALI, 'ANNUAL', '2026-03-16', '2026-03-24'));
  const p = await call('u-admin', 'recordLeaveReturn', { leaveId: early, returnDate: '2026-03-23' });
  assert.deepEqual([p.preview, p.early, p.daysReturned, p.lateDays], [true, true, 2, 0]);
  assert.equal((await call('u-admin', 'getLeave', { leaveId: early })).leave.Days, 5, 'the preview saves nothing');
  await call('u-admin', 'recordLeaveReturn', { leaveId: early, returnDate: '2026-03-23', confirm: true });
  const e = (await call('u-admin', 'getLeave', { leaveId: early })).leave;
  assert.deepEqual([e.Days, e.EffectiveTo, e.ReturnDate], [3, '2026-03-22', '2026-03-23']);
  assert.equal((await balance(ALI, '2026-03-31')).Taken, 3);
  await assert.rejects(call('u-admin', 'recordLeaveReturn', { leaveId: early, returnDate: '2026-03-24', confirm: true }), /was recorded on 2026-03-23/);
  // Late: due back Mon 11 May, back Wed 13: Mon-Tue absent, unpaid.
  const late = await approved(leave(ALI, 'ANNUAL', '2026-05-04', '2026-05-08'));
  const r = await call('u-admin', 'recordLeaveReturn', { leaveId: late, returnDate: '2026-05-13', confirm: true });
  assert.deepEqual([r.expected, r.lateDays, r.lateDates], ['2026-05-11', 2, ['2026-05-11', '2026-05-12']]);
  const l = (await call('u-admin', 'getLeave', { leaveId: late })).leave;
  assert.deepEqual([l.Days, l.LateDays, summary(l)], [5, 2, [['Annual Leave — Basic only', 5], ['Absent (late return), unpaid', 2]]]);
  assert.deepEqual(l.Lines.filter(x => x.Absence).map(x => [x.Code, x.Pay]), [['ABSENT', 'Unpaid'], ['ABSENT', 'Unpaid']]);
  // Absence doesn't use the balance.
  assert.equal((await balance(ALI, '2026-05-31')).Taken, 8);
});

test('opening balances import and adjustments; rights; My Drafts', async () => {
  await seed();
  const again = await call('u-admin', 'checkMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'],
    ['EMP-0001', 'ANNUAL', '3', '31/01/2026'], ['EMP-0002', 'SICK', '3', '31/01/2026'], ['EMP-0002', 'ANNUAL', '2.3', '31/01/2026']]) });
  const msgs = again.issues.map(i => 'R' + i.row + ' ' + i.column + ': ' + i.message);
  assert.ok(msgs.some(m => /R1 Leave Type: Ali Hassan already has an opening Annual Leave balance/.test(m)), msgs.join(' | '));
  assert.ok(msgs.some(m => /^R2 Leave Type:/.test(m)), 'a type without a balance is not a choice: ' + msgs.join(' | '));
  assert.ok(msgs.some(m => /R3 Days: Days are 0 or more, in half days/.test(m)), msgs.join(' | '));
  await assert.rejects(call('u-admin', 'adjustLeaveBalance', { employeeId: ALI, leaveTypeId: TYPE.ANNUAL, days: 2, date: '2026-03-01' }), /reason for the adjustment/);
  await assert.rejects(call('u-admin', 'adjustLeaveBalance', { employeeId: ALI, leaveTypeId: TYPE.SICK, days: 2, reason: 'x' }), /doesn't use a balance/);
  await call('u-admin', 'adjustLeaveBalance', { employeeId: ALI, leaveTypeId: TYPE.ANNUAL, days: 2.5, date: '2026-03-01', reason: 'Worked on a holiday' });
  assert.equal((await balance(ALI, '2026-03-31')).Available, 11.5);
  // Rights.
  assert.equal((await call('u-viewer', 'getLeaves', {})).canDraft, false);
  await assert.rejects(save(leave(ALI, 'UNPAID', '2026-06-01', '2026-06-01'), 'u-viewer'), /permission to enter leave/);
  const id = (await save(leave(ALI, 'UNPAID', '2026-06-01', '2026-06-01'))).leaveId;
  await assert.rejects(call('u-other', 'getLeave', { leaveId: id }), /access to that company/);
  const drafts = await call('u-admin', 'getMyDraftsForUser', {});
  assert.deepEqual(drafts.filter(x => x.ModuleID === 'LEAVE').map(x => [x.DocumentID, x.Description, x.DocumentDate]), [[id, 'Unpaid Leave — Ali Hassan', '2026-06-01']]);
  await call('u-admin', 'deleteLeave', { leaveId: id });
  assert.equal((await call('u-admin', 'getLeaves', {})).leaves.length, 0);
});
