// HR Payroll, step 0: work schedules (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, point 4 and decision 1): schedules in HR
// Setup; the company's hours a day; an employee's schedule from joining,
// changed from a date by an Employee Change (Transfer), corrected; leave
// counted by the schedule in force on each day; the who-is-away calendar
// shading each employee's own days off; the Employees import.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

const tsv = rows => rows.map(r => r.join('\t')).join('\n');
let SIX, ALI, AHMED, TYPE, G3, DES;
test.before(async () => {
  await reset(baseFixture());
  G3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  DES = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Driver' } })).designationId;
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
});
const emp = (name, extra) => Object.assign({ FullName: name, CompanyID: 'C1', JoinDate: '2025-01-01', DesignationID: DES, GradeID: G3, Gender: 'Male' }, extra || {});
const study = (e, from, to) => call('u-admin', 'previewLeave', { leave: { EmployeeID: e, LeaveTypeID: TYPE.STUDY, FromDate: from, ToDate: to } }).then(r => r.preview);

test('work schedules in HR Setup: name, weekend, hours a day; checked; read with the setup; the company\'s hours', async () => {
  await assert.rejects(call('u-viewer', 'saveHrWorkSchedule', { schedule: { Name: 'X', Weekend: [5], HoursPerDay: 8 } }), /permission to change HR Setup/);
  await assert.rejects(call('u-admin', 'saveHrWorkSchedule', { schedule: { Name: 'X', Weekend: [5], HoursPerDay: 0 } }), /Hours in a working day: 1 to 24/);
  await assert.rejects(call('u-admin', 'saveHrWorkSchedule', { schedule: { Name: 'X', Weekend: [0, 1, 2, 3], HoursPerDay: 8 } }), /At most three weekend days/);
  await assert.rejects(call('u-admin', 'saveHrWorkSchedule', { schedule: { Name: '', Weekend: [5], HoursPerDay: 8 } }), /Enter the schedule's name/);
  SIX = (await call('u-admin', 'saveHrWorkSchedule', { schedule: { Name: 'Six-day (Friday off)', Weekend: [5], HoursPerDay: 9 } })).scheduleId;
  await assert.rejects(call('u-admin', 'saveHrWorkSchedule', { schedule: { Name: 'six-day (friday off)', Weekend: [5], HoursPerDay: 8 } }), /already a schedule/);
  const s = await call('u-viewer', 'getHrSetup', {});
  assert.deepEqual(s.workSchedules.map(w => [w.Name, w.Weekend, w.HoursPerDay, w.Active]), [['Six-day (Friday off)', [5], 9, true]]);
  // The company's own hours (the default schedule).
  assert.equal((await call('u-admin', 'getWorkCalendar', { companyId: 'C1', year: 2026 })).hoursPerDay, 8);
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [], hoursPerDay: 8.5 });
  assert.equal((await call('u-admin', 'getWorkCalendar', { companyId: 'C1', year: 2026 })).hoursPerDay, 8.5);
  await assert.rejects(call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [], hoursPerDay: 30 }), /Hours in a working day/);
});

test('an employee on a schedule from joining: leave counted by its weekend, the others by the company\'s', async () => {
  ALI = (await call('u-admin', 'saveEmployee', { employee: emp('Ali Hassan') })).employeeId;
  AHMED = (await call('u-admin', 'saveEmployee', { employee: emp('Ahmed Rafi', { ScheduleID: SIX }) })).employeeId;
  const a = (await call('u-admin', 'getEmployee', { employeeId: AHMED })).employee;
  assert.deepEqual([a.ScheduleID, a.ScheduleName, a.Schedules], [SIX, 'Six-day (Friday off)', [{ From: '2025-01-01', ScheduleID: SIX }]]);
  // Mon 2 - Sun 8 Mar 2026: Ahmed works Saturday and Sunday, not Friday.
  assert.deepEqual((await study(AHMED, '2026-03-02', '2026-03-08')).Lines.map(l => l.Date), ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-07', '2026-03-08']);
  await assert.rejects(study(AHMED, '2026-03-06', '2026-03-07'), /starts on a day off/);
  await assert.rejects(study(ALI, '2026-03-02', '2026-03-08'), /ends on a day off/);
  assert.equal((await study(ALI, '2026-03-02', '2026-03-06')).Days, 5);
  // A schedule in use keeps its weekend; its hours can change.
  await assert.rejects(call('u-admin', 'saveHrWorkSchedule', { schedule: { ScheduleID: SIX, Name: 'Six-day (Friday off)', Weekend: [4], HoursPerDay: 9 } }), /its weekend can't change/);
  await call('u-admin', 'saveHrWorkSchedule', { schedule: { ScheduleID: SIX, Name: 'Six-day (Friday off)', Weekend: [5], HoursPerDay: 8 } });
  // After creation the schedule changes only through an Employee Change (or Correct).
  await assert.rejects(call('u-admin', 'saveEmployee', { employee: Object.assign({}, a, { ScheduleID: '' }) }), /Work schedule change through an Employee Change/);
});

test('a new schedule from a date (Transfer): days before it keep the old weekend, days after use the new', async () => {
  // From 1 Apr 2026 Ahmed follows the company's calendar (Saturday and Sunday off).
  await assert.rejects(call('u-admin', 'saveEmployeeChange', { change: { EmployeeID: AHMED, Type: 'Transfer', EffectiveDate: '2026-04-01', After: { CompanyID: 'C1', ScheduleID: SIX } } }),
    /A transfer changes the company, division, branch, cost center, cost split or work schedule/);
  const id = (await call('u-admin', 'saveEmployeeChange', { change: { EmployeeID: AHMED, Type: 'Transfer', EffectiveDate: '2026-04-01', After: { CompanyID: 'C1', ScheduleID: '' }, Reason: 'Moved to the office' } })).changeId;
  const c = (await call('u-admin', 'getEmployeeChange', { changeId: id }));
  assert.deepEqual([c.names.ScheduleID.Before, c.names.ScheduleID.After], ['Six-day (Friday off)', '']);
  assert.equal((await call('u-admin', 'submitEmployeeChange', { changeId: id })).status, 'Approved');
  const a = (await call('u-admin', 'getEmployee', { employeeId: AHMED })).employee;
  assert.deepEqual([a.ScheduleID, a.Schedules], ['', [{ From: '2025-01-01', ScheduleID: SIX }, { From: '2026-04-01', ScheduleID: '' }]]);
  // Mon 30 Mar - Mon 6 Apr: Mon, Tue (old: Friday off); Wed, Thu, Fri, Mon (new: weekend off).
  assert.deepEqual((await study(AHMED, '2026-03-30', '2026-04-06')).Lines.map(l => l.Date),
    ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-06']);
  const h = (await call('u-admin', 'getEmployee', { employeeId: AHMED })).history;
  assert.ok(h.some(x => x.Action === 'Transfer' && x.Changes.some(ch => ch.Label === 'Work schedule' && ch.From === 'Six-day (Friday off)' && ch.To === '')));
});

test('Correct fixes the schedule in force now; the who-is-away calendar shades each one\'s days off; the import', async () => {
  const e = (await call('u-admin', 'getEmployee', { employeeId: ALI })).employee;
  await call('u-admin', 'saveEmployee', { employee: Object.assign({}, e, { ScheduleID: SIX }), correction: 'Works six days since joining' });
  const a = (await call('u-admin', 'getEmployee', { employeeId: ALI })).employee;
  assert.deepEqual(a.Schedules, [{ From: '2025-01-01', ScheduleID: SIX }]);
  const cal = await call('u-admin', 'getLeaveCalendar', { companyId: 'C1', month: '2026-03' });
  const off = id => cal.rows.find(r => r.EmployeeID === id).Off;
  assert.deepEqual(off(ALI), ['2026-03-06', '2026-03-13', '2026-03-20', '2026-03-27']); // Fridays
  assert.ok(off(AHMED).includes('2026-03-06') && !off(AHMED).includes('2026-03-07'));
  // The Employees import takes the schedule by name.
  const r = await call('u-admin', 'runMasterImport', { master: 'EMPLOYEE', text: tsv([['Full Name', 'Company', 'Date of Joining', 'Designation', 'Grade', 'Work Schedule'],
    ['Sami Noor', '01', '01/06/2025', 'Driver', 'G3', 'Six-day (Friday off)']]) });
  assert.equal(r.success, true, JSON.stringify(r.issues));
  const sami = (await call('u-admin', 'getEmployees', {})).employees.find(x => x.FullName === 'Sami Noor');
  const s = (await call('u-admin', 'getEmployee', { employeeId: sami.EmployeeID })).employee;
  assert.deepEqual(s.Schedules, [{ From: '2025-06-01', ScheduleID: SIX }]);
  const bad = await call('u-admin', 'checkMasterImport', { master: 'EMPLOYEE', text: tsv([['Full Name', 'Company', 'Date of Joining', 'Designation', 'Grade', 'Work Schedule'],
    ['Zed', '01', '01/06/2025', 'Driver', 'G3', 'Night shift']]) });
  assert.ok(bad.issues.some(i => i.column === 'Work Schedule'), JSON.stringify(bad.issues));
});
