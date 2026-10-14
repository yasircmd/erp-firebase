// HR Payroll, step 2: the payroll run (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, "Step 2 design", decisions 12-15): one run
// per company and month, after its leave is locked; each employee's pay
// (part months, leave on its own deduction lines, overtime at the
// schedule's hours, inputs); warnings; the leave changing under a run;
// rights; the system elements.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, SARA, OMAR, TYPE, RUN, OT;
const amt = (slip, code) => { const l = slip.Lines.find(x => x.Code === code); return l ? l.Amount : undefined; };
const slipOf = (r, emp) => r.slips.find(s => s.EmployeeID === emp);
const getRun = (uid) => call(uid || 'u-admin', 'getPayrollRun', { runId: RUN });

test.before(async () => {
  await reset(baseFixture());
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, extra) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male' }, extra) }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan', { JoinDate: '2024-01-01', IBAN: 'AE070331234567890123456' });
  SARA = await emp('Sara Khan', { JoinDate: '2026-07-15', Gender: 'Female', IBAN: 'AE070331234567890123457' });
  OMAR = await emp('Omar Said', { JoinDate: '2025-01-01', Status: 'Left', LeavingDate: '2026-07-10', LeavingReason: 'Personal reasons' });
  await emp('Late Joiner', { JoinDate: '2026-08-01' });
  await emp('Long Gone', { JoinDate: '2024-01-01', Status: 'Left', LeavingDate: '2026-06-20', LeavingReason: 'Personal reasons' });
  const pay = (id, lines, from) => call('u-admin', 'saveCompensation', { employeeId: id, compensation: { EffectiveFrom: from, Lines: lines } });
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await pay(ALI, [{ ElementID: els.BASIC, Amount: 6000 }, { ElementID: els.HRA, Amount: 3000 }]);
  await pay(SARA, [{ ElementID: els.BASIC, Amount: 6000 }]);
  await pay(OMAR, [{ ElementID: els.BASIC, Amount: 3000 }]);
  // Overtime: basic ÷ the company's days ÷ the schedule's hours × 1.25.
  OT = (await call('u-admin', 'savePayElement', { element: { Code: 'OT', Name: 'Overtime', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'savePayElementPayroll', { elementId: OT, category: 'Overtime', overtime: { Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Schedule', Weightage: 1.25 } });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [], hoursPerDay: 10 });
  // Leave in July: Ali's annual leave is basic only at G3 (2 days), one unpaid day, one absent day.
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  await call('u-admin', 'saveLeavePayRules', { leaveTypeId: TYPE.ANNUAL, rows: [{ LevelFrom: 1, LevelTo: 99, Pay: 'Basic', Percent: 100 }] });
  const enter = async (code, from, to) => { const id = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: ALI, LeaveTypeID: TYPE[code], FromDate: from, ToDate: to } })).leaveId; await call('u-admin', 'submitLeave', { leaveId: id }); };
  await enter('ANNUAL', '2026-07-06', '2026-07-07');
  await enter('UNPAID', '2026-07-13', '2026-07-13');
  await enter('ABSENT', '2026-07-14', '2026-07-14');
});

test('a run needs the month\'s leave locked; one per company and month; the user\'s companies; the draft right', async () => {
  await assert.rejects(call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' }), /Lock the leave for 2026-07 first/);
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  await assert.rejects(call('u-viewer', 'createPayrollRun', { companyId: 'C1', month: '2026-07' }), /permission to prepare payroll runs/);
  await assert.rejects(call('u-admin', 'createPayrollRun', { companyId: 'C2', month: '2026-07' }), /access to that company/);
  RUN = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await assert.rejects(call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' }), /already a payroll run for C1, 2026-07/);
  const list = await call('u-viewer', 'getPayrollRuns', {});
  assert.deepEqual(list.runs.map(r => [r.Month, r.Status, r.Employees]), [['2026-07', 'Draft', 3]]);
  assert.equal(list.canDraft, false);
});

test('each employee\'s pay: part months, leave on its own lines, warnings; the register\'s columns and totals', async () => {
  const r = await getRun('u-viewer'); // Payroll access is enough to see the amounts (decision 14)
  assert.deepEqual(r.slips.map(s => s.EmployeeName), ['Ali Hassan', 'Sara Khan', 'Omar Said']);
  const ali = slipOf(r, ALI);
  // (6,000 + 3,000) ÷ 30 = 300 a day; basic-only leave takes out housing, 100 a day.
  assert.deepEqual([amt(ali, 'BASIC'), amt(ali, 'HRA'), amt(ali, 'REDUCEDLV'), amt(ali, 'UNPAIDLV'), amt(ali, 'ABSENCE'), ali.Net], [6000, 3000, 200, 300, 300, 8200]);
  assert.deepEqual(ali.Warnings, []);
  const sara = slipOf(r, SARA), omar = slipOf(r, OMAR);
  assert.deepEqual([amt(sara, 'BASIC'), sara.Warnings], [3200, []]); // 6,000 − 14 days × 200 (decision 12)
  assert.equal(amt(omar, 'BASIC'), 900); // left on 10 July: 3,000 − 21 × 100
  assert.deepEqual(omar.Warnings, ['No bank account / IBAN on the employee record.']);
  assert.deepEqual(r.run.Columns.map(c => c.Code), ['BASIC', 'HRA', 'UNPAIDLV', 'ABSENCE', 'REDUCEDLV']);
  assert.deepEqual([r.run.Earnings, r.run.Deductions, r.run.Net, r.run.Warnings], [13100, 800, 12300, 1]);
  assert.deepEqual([r.leaveChanged, r.methodLabel, r.inputElements.map(e => [e.Code, e.Hours])], [false, 'Monthly ÷ 30', [['BONUS', false], ['COMM', false], ['OT', true]]]);
});

test('inputs: overtime hours at the schedule\'s hours, amounts; checked; kept on recalculation', async () => {
  const save = rows => call('u-admin', 'savePayrollInputs', { runId: RUN, rows });
  await assert.rejects(save([{ EmployeeNo: 'EMP-9999', Code: 'BONUS', Amount: 1 }]), /Row 1: employee "EMP-9999" is not on payroll in the month/);
  await assert.rejects(save([{ EmployeeID: ALI, Code: 'BASIC', Amount: 1 }]), /Row 1: Basic Salary is not entered per run/);
  await assert.rejects(save([{ EmployeeID: ALI, Code: 'UNPAIDLV', Amount: 1 }]), /not entered per run/);
  await assert.rejects(save([{}, { EmployeeID: ALI, Code: 'OT', Amount: 100 }]), /Row 2: Overtime is paid by the hour/);
  await assert.rejects(save([{ EmployeeID: ALI, Code: 'BONUS' }]), /enter the Bonus amount/);
  await assert.rejects(call('u-viewer', 'savePayrollInputs', { runId: RUN, rows: [] }), /permission to prepare/);
  const no = slipOf(await getRun(), ALI).EmployeeNo;
  const out = await save([{ EmployeeNo: no, Code: 'ot', Hours: '10' }, { EmployeeNo: no, Code: 'BONUS', Amount: '1,500', Note: 'Q2 target' }, { EmployeeID: SARA, ElementID: OT, Hours: 4 }]);
  assert.equal(out.run.Net, 12300 + 10 * 25 + 1500 + 4 * 25); // 6,000 ÷ 30 ÷ 10 hours × 1.25 = 25 an hour
  let ali = slipOf(await getRun(), ALI);
  assert.deepEqual([amt(ali, 'OT'), amt(ali, 'BONUS')], [250, 1500]);
  assert.equal(ali.Lines.find(l => l.Code === 'OT').Text, '10 hours × 25.00 (6,000.00 (basic) ÷ 30 days ÷ 10 hours × 1.25 = 25.00 an hour)');
  assert.equal(amt(slipOf(await getRun(), SARA), 'OT'), 100, 'Sara: her basic in force at the month\'s end, 6,000');
  await call('u-admin', 'recalculatePayrollRun', { runId: RUN });
  ali = slipOf(await getRun(), ALI);
  assert.deepEqual([ali.Inputs.length, amt(ali, 'BONUS')], [2, 1500]);
});

test('the leave changing under a run: reopened, the run can\'t be recalculated; locked again, recalculating takes it in', async () => {
  await call('u-admin', 'reopenLeaveMonth', { companyId: 'C1', month: '2026-07', reason: 'A late sick note' });
  let r = await getRun();
  assert.deepEqual([r.leaveChanged, r.leaveLocked], [true, false]);
  await assert.rejects(call('u-admin', 'recalculatePayrollRun', { runId: RUN }), /Lock the leave for 2026-07 first/);
  await assert.rejects(call('u-admin', 'savePayrollInputs', { runId: RUN, rows: [] }), /Lock the leave/);
  // The absence was recorded in error.
  const leaves = (await call('u-admin', 'getLeaves', {})).leaves || [];
  const absent = leaves.find(l => l.EmployeeID === ALI && l.LeaveTypeID === TYPE.ABSENT);
  await call('u-admin', 'cancelLeave', { leaveId: absent.LeaveID, reason: 'He was on site' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  assert.equal((await getRun()).leaveChanged, true, 'locked again, but the run still has the old leave');
  await call('u-admin', 'recalculatePayrollRun', { runId: RUN });
  r = await getRun();
  assert.deepEqual([r.leaveChanged, amt(slipOf(r, ALI), 'ABSENCE')], [false, undefined]);
});

test('the system elements: set up in HR Setup → Payroll, not in Pay Elements; their codes are kept', async () => {
  assert.equal((await call('u-admin', 'getPayElements', {})).elements.some(e => e.System), false);
  const sys = (await call('u-admin', 'getPayrollSetup', {})).elements.filter(e => e.System).map(e => [e.Code, e.Kind]);
  assert.deepEqual(sys, [['UNPAIDLV', 'Deduction'], ['ABSENCE', 'Deduction'], ['REDUCEDLV', 'Deduction']]);
  await assert.rejects(call('u-admin', 'savePayElement', { element: { Code: 'ABSENCE', Name: 'Absent pay', Kind: 'Deduction', Nature: 'Fixed' } }), /kept for the payroll's own deductions/);
});

test('deleting a draft run', async () => {
  await assert.rejects(call('u-viewer', 'deletePayrollRun', { runId: RUN }), /permission to prepare/);
  await call('u-admin', 'deletePayrollRun', { runId: RUN });
  assert.deepEqual((await call('u-admin', 'getPayrollRuns', {})).runs, []);
  await assert.rejects(getRun(), /Payroll run not found/);
});
