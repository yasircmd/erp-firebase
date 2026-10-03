// HR: Attendance and Leave Register, step 1: the setup (owner, 2026-10-03;
// docs/modules/HR_LEAVE.md): leave types (nine to start, more added),
// entitlements by grade level and service (one set for the group), leave
// pay rules by grade level and day band, with overlaps refused and gaps
// warned against the real grades; the working calendar per company.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');
const { countedDays } = require('../../src/workCalendar');

test.after(async () => { await app.delete(); });

let G3, G7;
test.beforeEach(async () => {
  await reset(baseFixture());
  G3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  G7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
});
const types = async uid => (await call(uid || 'u-admin', 'getLeaveSetup', {})).leaveTypes;
const byCode = async code => (await types()).find(t => t.Code === code);

test('leave types: nine to start with their settings; read by Employees users, changed by HR Setup writers; a new one', async () => {
  const s = await call('u-viewer', 'getLeaveSetup', {});
  assert.equal(s.canWrite, false);
  assert.deepEqual(s.leaveTypes.map(t => t.Code), ['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY', 'TRAVEL', 'HAJJ', 'COMPASSIONATE', 'STUDY']);
  const t = Object.fromEntries(s.leaveTypes.map(x => [x.Code, x]));
  assert.deepEqual([t.ANNUAL.UsesBalance, t.ANNUAL.Counts, t.ANNUAL.ConfirmReturn, t.ANNUAL.CarryForwardCap], [true, 'Working', true, 30]);
  assert.deepEqual([t.SICK.UsesBalance, t.SICK.Counts, t.SICK.MaxPerYear], [false, 'Calendar', 90]);
  assert.deepEqual(t.SICK.PayRules.map(r => [r.DayFrom, r.DayTo, r.Pay, r.Percent]), [[1, 15, 'Full', 100], [16, 45, 'Full', 50], [46, null, 'Unpaid', 0]]);
  assert.equal(t.MATERNITY.Gender, 'Female');
  assert.deepEqual([t.TRAVEL.Kind, t.TRAVEL.PayRules], ['Duty', []]);
  // The seeds cover every grade: no warnings.
  assert.deepEqual(t.ANNUAL.Warnings, { entitlements: [], payRules: [] });
  assert.deepEqual(t.TRAVEL.Warnings, {});

  await assert.rejects(call('u-viewer', 'saveLeaveType', { leaveType: { Code: 'X', Name: 'X', Kind: 'Leave', Counts: 'Calendar' } }), /permission to change HR Setup/);
  await assert.rejects(call('u-admin', 'saveLeaveType', { leaveType: { Code: 'sick', Name: 'Sick 2', Kind: 'Leave', Counts: 'Calendar' } }), /Code "SICK" is already in use/);
  await assert.rejects(call('u-admin', 'saveLeaveType', { leaveType: { Code: 'X', Name: 'annual leave', Kind: 'Leave', Counts: 'Calendar' } }), /already a leave type "annual leave"/);
  await assert.rejects(call('u-admin', 'saveLeaveType', { leaveType: { Code: 'X', Name: 'X', Kind: 'Leave', Counts: 'Calendar', MaxPerYear: 5, MaxPerInstance: 10 } }), /maximum at a time can't be more/);
  await assert.rejects(call('u-admin', 'saveLeaveType', { leaveType: { Code: 'X', Name: 'X', Kind: 'Leave', Counts: 'Hours' } }), /working days or calendar days/);
  // Duty never uses a balance.
  const tr = (await call('u-admin', 'saveLeaveType', { leaveType: { Code: 'TRAINING', Name: 'Training', Kind: 'Duty', Counts: 'Calendar', UsesBalance: true } })).leaveTypeId;
  const id = (await call('u-admin', 'saveLeaveType', { leaveType: { Code: 'marriage', Name: 'Marriage Leave', Kind: 'Leave', Counts: 'Working', MaxPerInstance: 5 } })).leaveTypeId;
  const after = await types();
  assert.equal(after.find(x => x.LeaveTypeID === tr).UsesBalance, false);
  const m = after.find(x => x.LeaveTypeID === id);
  assert.deepEqual([m.Code, m.Sort, m.PayRules], ['MARRIAGE', 11, []]);
  assert.deepEqual(m.Warnings.payRules, ['G3 (level 3): no rule.', 'G7 (level 7): no rule.']);
  // Editing the settings keeps the rules.
  await call('u-admin', 'saveLeaveType', { leaveType: Object.assign({}, t.SICK, { MaxPerYear: 60 }) });
  const sick = await byCode('SICK');
  assert.equal(sick.MaxPerYear, 60);
  assert.equal(sick.PayRules.length, 3);
});

test('entitlements: by grade level and service, overlaps refused, gaps warned, a carry-forward cap; only for types with a balance', async () => {
  const annual = await byCode('ANNUAL');
  const save = (rows, cap) => call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: annual.LeaveTypeID, rows, carryForwardCap: cap });
  await assert.rejects(call('u-viewer', 'saveLeaveEntitlements', { leaveTypeId: annual.LeaveTypeID, rows: [], carryForwardCap: 0 }), /permission to change HR Setup/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 22 }, { LevelFrom: 4, LevelTo: 99, DaysPerYear: 30 }], 10), /Rows 1 and 2 overlap/);
  await assert.rejects(save([{ LevelFrom: 5, LevelTo: 1, DaysPerYear: 22 }], 10), /run from the lower to the higher/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 22.3 }], 10), /in half days/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 30 }], ''), /most days that carry into the next year/);
  // The same levels with different service years don't overlap.
  const r = await save([{ LevelFrom: 1, LevelTo: 4, ServiceFrom: 0, ServiceTo: 4, DaysPerYear: 22 }, { LevelFrom: 1, LevelTo: 4, ServiceFrom: 6, DaysPerYear: 26 }], 15);
  assert.deepEqual(r.warnings, ['G3 (level 3): no rule for service year 5.', 'G7 (level 7): no rule.']);
  const a = await byCode('ANNUAL');
  assert.equal(a.CarryForwardCap, 15);
  assert.deepEqual(a.Entitlements.map(x => [x.LevelFrom, x.LevelTo, x.ServiceFrom, x.ServiceTo, x.DaysPerYear]), [[1, 4, 0, 4, 22], [1, 4, 6, null, 26]]);
  assert.deepEqual(a.Warnings.entitlements, r.warnings);
  // No balance, no entitlement.
  await assert.rejects(call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: (await byCode('SICK')).LeaveTypeID, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 5 }], carryForwardCap: 0 }), /doesn't use a balance/);
});

test('leave pay rules: the owner\'s example (basic only below level 5, full above); day bands; overlaps refused, gaps warned; fixed earnings only', async () => {
  const annual = await byCode('ANNUAL');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  const save = rows => call('u-admin', 'saveLeavePayRules', { leaveTypeId: annual.LeaveTypeID, rows });
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, DayFrom: 1, DayTo: 20, Pay: 'Full', Percent: 100 }, { LevelFrom: 5, LevelTo: 99, DayFrom: 10, Pay: 'Basic', Percent: 100 }]), /Rows 1 and 2 overlap/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, Pay: 'Full', Percent: 120 }]), /at most 100/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, Pay: 'Full' }]), /% paid is more than 0/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, Pay: 'Elements', Percent: 100, Elements: [] }]), /tick the pay elements/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, Pay: 'Elements', Percent: 100, Elements: [els.BASIC, els.BONUS] }]), /only fixed earnings/);
  await assert.rejects(save([{ LevelFrom: 1, LevelTo: 99, Pay: 'Holiday', Percent: 100 }]), /how the days are paid/);
  const r = await save([
    { LevelFrom: 1, LevelTo: 4, Pay: 'Basic', Percent: 100 },
    { LevelFrom: 5, LevelTo: 99, DayFrom: 1, DayTo: 15, Pay: 'Elements', Percent: 100, Elements: [els.BASIC, els.HRA] },
    { LevelFrom: 5, LevelTo: 99, DayFrom: 21, Pay: 'Unpaid', Percent: 75 }]);
  assert.deepEqual(r.warnings, ['G7 (level 7): no rule for days 16–20.']);
  const a = await byCode('ANNUAL');
  assert.deepEqual(a.PayRules.map(x => [x.LevelFrom, x.LevelTo, x.DayFrom, x.DayTo, x.Pay, x.Percent, x.Elements]), [
    [1, 4, 1, null, 'Basic', 100, []], [5, 99, 1, 15, 'Elements', 100, [els.BASIC, els.HRA]], [5, 99, 21, null, 'Unpaid', 0, []]]);
  // Duty is paid as working.
  await assert.rejects(call('u-admin', 'saveLeavePayRules', { leaveTypeId: (await byCode('TRAVEL')).LeaveTypeID, rows: [{ LevelFrom: 1, LevelTo: 99, Pay: 'Full', Percent: 100 }] }), /paid as working/);
});

test('working calendar: weekend and holidays per company and year; the working days; other years kept; own companies only', async () => {
  const get = (year, co, uid) => call(uid || 'u-admin', 'getWorkCalendar', { companyId: co || 'C1', year });
  const c = await get(2026);
  assert.deepEqual([c.weekend, c.holidays, c.workingDays, c.canWrite], [[0, 6], [], 261, true]);
  const save = (year, holidays, weekend) => call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year, weekend: weekend || [0, 6], holidays });
  await assert.rejects(save(2026, [{ From: '2026-02-30', Name: 'X' }]), /real date/);
  await assert.rejects(save(2026, [{ From: '2027-01-01', Name: 'X' }]), /starts outside 2026/);
  await assert.rejects(save(2026, [{ From: '2026-03-20', To: '2026-03-19', Name: 'X' }]), /end is before the start/);
  await assert.rejects(save(2026, [{ From: '2026-03-20', To: '2026-03-22', Name: 'Eid' }, { From: '2026-03-22', Name: 'Other' }]), /"Eid" \(2026-03-20\) and "Other" \(2026-03-22\) overlap/);
  await assert.rejects(save(2026, [{ From: '2026-03-20' }]), /enter its name/);
  // New Year (Thu) and National Day (Wed-Thu): 261 - 3.
  const r = await save(2026, [{ From: '2026-12-02', To: '2026-12-03', Name: 'National Day' }, { From: '2026-01-01', Name: 'New Year' }]);
  assert.equal(r.workingDays, 258);
  await save(2027, [{ From: '2027-01-01', Name: 'New Year' }]);
  const c26 = await get(2026), c27 = await get(2027);
  assert.deepEqual(c26.holidays.map(h => [h.From, h.To, h.Name]), [['2026-01-01', '2026-01-01', 'New Year'], ['2026-12-02', '2026-12-03', 'National Day']]);
  assert.deepEqual(c27.lastYearHolidays.map(h => h.Name), ['New Year', 'National Day']);
  // A Friday-only weekend.
  assert.equal((await save(2026, c26.holidays, [5])).workingDays, 365 - 52 - 3);
  // Days for the Leave Register: Thu 31 Dec 2026 to Mon 4 Jan 2027 (New Year Fri, weekend Fri).
  const cal = { Weekend: [5], Holidays: (await get(2026)).holidays.concat((await get(2027)).holidays) };
  assert.deepEqual(countedDays(cal, '2026-12-31', '2027-01-04', 'Working'), ['2026-12-31', '2027-01-02', '2027-01-03', '2027-01-04']);
  assert.equal(countedDays(cal, '2026-12-31', '2027-01-04', 'Calendar').length, 5);
  // Rights: read with Employees access, no change; not another company's.
  const v = await get(2026, 'C1', 'u-viewer');
  assert.equal(v.canWrite, false);
  await assert.rejects(call('u-viewer', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] }), /permission to change HR Setup/);
  await assert.rejects(get(2026, 'C2'), /access to that company/);
  await assert.rejects(call('u-admin', 'saveWorkCalendar', { companyId: 'C2', year: 2026, weekend: [0, 6], holidays: [] }), /access to that company/);
});
