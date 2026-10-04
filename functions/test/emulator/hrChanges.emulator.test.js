// HR: Employee Changes, step 4 (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md):
// promotion / increment / transfer as documents; checks by type; one open
// change per employee; approval through Approval Configuration with the
// monthly increase as the amount; applied on approval (pay as a new
// version, job and organization on the employee, history); rejected and
// resubmitted; future-dated job changes applied on their date; pay seen
// with the sensitive right or by the change's approvers; Home tasks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb } = require('./_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });

const T = todayIn('Asia/Dubai');
let G = {}, D = {}, EMP, EL;
async function seed(withApproval) {
  const f = baseFixture();
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Finance', Status: 'Active', CompanyID: 'C1' };
  if (withApproval) {
    f.approvalConfigurations = { EMPCHANGE: { Enabled: true, ScopeType: 'Global' } };
    f.approvalLevels = { EMPCHANGE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }, { LevelNumber: 2, ApproverUserID: 'u-admin', ThresholdAmount: 1000 }] } } };
  }
  await reset(f);
  for (const [code, level] of [['G3', 3], ['G5', 5], ['G8', 8]]) {
    G[code] = (await call('u-admin', 'saveHrGrade', { grade: { Code: code, Level: level, Bands: { C1: { Min: level * 1000, Mid: level * 1500, Max: level * 2000 } } } })).gradeId;
  }
  D.acc = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  D.sen = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Senior Accountant' } })).designationId;
  EMP = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-03-01', DesignationID: D.acc, GradeID: G.G3, CostCenterID: 'CC1' } })).employeeId;
  EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: EMP, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 5000 }, { ElementID: EL.HRA, Amount: 2000 }] } });
}
const after = over => Object.assign({ CompanyID: 'C1', DesignationID: D.acc, GradeID: G.G3, CostCenterID: 'CC1', DivisionID: '', BranchID: '' }, over || {});
const newPay = (basic, hra) => ({ Lines: [{ ElementID: EL.BASIC, Amount: basic }, { ElementID: EL.HRA, Amount: hra == null ? 2000 : hra }] });
const draft = (change, uid) => call(uid || 'u-admin', 'saveEmployeeChange', { change: Object.assign({ EmployeeID: EMP, EffectiveDate: T }, change) });
const get = (id, uid) => call(uid || 'u-admin', 'getEmployeeChange', { changeId: id });
const emp = async () => (await call('u-admin', 'getEmployee', { employeeId: EMP })).employee;
const comp = async () => call('u-admin', 'getCompensation', { employeeId: EMP });

test('each type is checked; one open change per employee; only with the right to prepare', async () => {
  await seed(false);
  await assert.rejects(draft({ Type: 'Promotion', After: after({ GradeID: G.G3 }) }), /A promotion changes the grade or the designation/);
  // A draft can be deleted.
  const tmp = await draft({ Type: 'Transfer', After: after({ CostCenterID: 'CC2' }) });
  await call('u-admin', 'deleteEmployeeChange', { changeId: tmp.changeId });
  // A promotion moves up.
  const low = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G1', Level: 1 } })).gradeId;
  await assert.rejects(draft({ Type: 'Promotion', After: after({ GradeID: low }) }), /A promotion moves to a higher grade \(from G3\)/);
  await assert.rejects(draft({ Type: 'Increment', After: after() }), /An increment changes the pay/);
  await assert.rejects(draft({ Type: 'Increment', After: after({ CostCenterID: 'CC2' }), NewPay: newPay(5500) }), /An increment keeps the job and organization/);
  await assert.rejects(draft({ Type: 'Transfer', After: after() }), /A transfer changes the company, division, branch, cost center or work schedule/);
  await assert.rejects(draft({ Type: 'Transfer', After: after({ CostCenterID: 'CC2', GradeID: G.G5 }) }), /A transfer keeps the grade and designation/);
  await assert.rejects(draft({ Type: 'Increment', EffectiveDate: '2024-01-01', NewPay: newPay(5500), After: after() }), /before the date of joining/);
  await assert.rejects(draft({ Type: 'Increment', EffectiveDate: '2024-03-01', NewPay: newPay(5500), After: after() }), /can't change before its latest version starts \(2024-03-01\)/);
  await assert.rejects(draft({ Type: 'Increment', NewPay: newPay(5500), After: after() }, 'u-viewer'), /permission to prepare Employee Changes/);
  const first = await draft({ Type: 'Increment', NewPay: newPay(5500), After: after(), Reason: 'Annual review' });
  await assert.rejects(draft({ Type: 'Transfer', After: after({ CostCenterID: 'CC2' }) }), /Ali Hassan already has an open Employee Change: finish or delete it first/);
  // It shows in the preparer's My Drafts.
  const drafts = await call('u-admin', 'getMyDraftsForUser', {});
  assert.deepEqual(drafts.filter(x => x.ModuleID === 'EMPCHANGE').map(x => [x.DocumentID, x.Description, x.DocumentDate]), [[first.changeId, 'Increment — Ali Hassan', T]]);
});

test('no approval set up: applied at submit; the pay is a new version, the old one kept', async () => {
  await seed(false);
  const r = await draft({ Type: 'Increment', NewPay: newPay(5600), After: after() });
  const s = await call('u-admin', 'submitEmployeeChange', { changeId: r.changeId });
  assert.deepEqual([s.status, s.changeNumber], ['Approved', 'EC-' + T.slice(0, 4) + '-0001']);
  const c = await comp();
  assert.deepEqual(c.versions.filter(v => v.Status === 'Active').map(v => [v.EffectiveFrom, v.Basic, v.Source]), [[T, 5600, 'Employee Change'], ['2024-03-01', 5000, 'Initial']]);
  const g = (await get(r.changeId)).change;
  assert.deepEqual([g.Increase, g.IncreasePercent], [600, 8.57]);
  const h = (await call('u-admin', 'getEmployee', { employeeId: EMP })).history[0];
  assert.deepEqual([h.Action, h.Reason, h.Changes[0].To], ['Increment', s.changeNumber, 'From ' + T + ': 7,600.00 a month']);
});

test('approval: the increase decides the levels; approved level by level, then applied; warnings for approvers; Home tasks', async () => {
  await seed(true);
  const r = await draft({ Type: 'Promotion', After: after({ GradeID: G.G5, DesignationID: D.sen }), NewPay: newPay(6600, 2500), Reason: 'Took over the team' });
  assert.deepEqual(r.warnings, [], 'basic 6,600 is in the G5 band (5,000–10,000)');
  const s = await call('u-admin', 'submitEmployeeChange', { changeId: r.changeId });
  assert.equal(s.status, 'PendingApproval');
  const tasks = await call('u-approver', 'getPendingApprovalsForUser', {});
  assert.deepEqual(tasks.map(t => [t.ModuleID, t.DocumentID, t.ModuleLabel]), [['EMPCHANGE', r.changeId, 'Employee Change (promotion, increment, transfer)']]);
  const g = await get(r.changeId, 'u-approver');
  assert.deepEqual([g.myLevels, g.change.Increase, g.names.GradeID.Before, g.names.GradeID.After], [[1], 2100, 'G3', 'G5']);
  assert.equal(g.approval.Levels.length, 2, 'the increase (2,100) passes the 1,000 threshold of level 2');
  await assert.rejects(call('u-admin', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 1, decision: 'Approved' }), /not the assigned approver/);
  assert.equal((await call('u-approver', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 1, decision: 'Approved' })).status, 'Pending');
  assert.equal((await emp()).GradeID, G.G3, 'nothing applied before the last level');
  assert.equal((await call('u-admin', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 2, decision: 'Approved' })).status, 'Approved');
  const e = await emp();
  assert.deepEqual([e.GradeID, e.DesignationID], [G.G5, D.sen]);
  assert.equal((await comp()).current.Basic, 6600);
  const hist = (await call('u-admin', 'getEmployee', { employeeId: EMP })).history.filter(h => h.Action === 'Promotion');
  assert.deepEqual(hist.flatMap(h => h.Changes.map(c => c.Label + ': ' + c.From + ' → ' + c.To)).sort(),
    ['Designation: Accountant → Senior Accountant', 'Grade: G3 → G5', 'Pay: 7,000.00 → From ' + T + ': 9,100.00 a month']);
  // A band warning reaches the approvers.
  const r2 = await draft({ Type: 'Increment', EffectiveDate: addDays(T, 1), NewPay: newPay(11000, 2500), After: after({ GradeID: G.G5, DesignationID: D.sen }) });
  assert.deepEqual(r2.warnings, ['The basic 11,000.00 is above the G5 band (maximum 10,000.00).']);
});

test('rejected: corrected and resubmitted; the preparer\'s Home shows it until then', async () => {
  await seed(true);
  const r = await draft({ Type: 'Transfer', After: after({ CostCenterID: 'CC2' }) });
  await call('u-admin', 'submitEmployeeChange', { changeId: r.changeId });
  await assert.rejects(call('u-approver', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 1, decision: 'Rejected' }), /A reason is required/);
  await call('u-approver', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong department' });
  const g = (await get(r.changeId)).change;
  assert.deepEqual([g.Status, g.RejectionReason], ['Rejected', 'Wrong department']);
  assert.deepEqual((await call('u-admin', 'getMyRejectedSubmissions', {})).map(x => x.DocumentID), [r.changeId]);
  await call('u-admin', 'saveEmployeeChange', { change: { ChangeID: r.changeId, Type: 'Transfer', EffectiveDate: T, After: after({ CostCenterID: 'CC2', DivisionID: '' }) } });
  await call('u-admin', 'submitEmployeeChange', { changeId: r.changeId });
  assert.deepEqual(await call('u-admin', 'getMyRejectedSubmissions', {}), []);
  await call('u-approver', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 1, decision: 'Approved' });
  assert.equal((await emp()).CostCenterID, 'CC2');
  assert.equal((await get(r.changeId)).change.ChangeNumber, 'EC-' + T.slice(0, 4) + '-0001', 'the same number after resubmitting');
});

test('future-dated: the pay waits as upcoming, the job on its date; pay hidden without the right, shown to its approvers', async () => {
  await seed(true);
  const r = await draft({ Type: 'Transfer', EffectiveDate: addDays(T, 30), After: after({ CostCenterID: 'CC2' }), NewPay: newPay(5200) });
  await call('u-admin', 'submitEmployeeChange', { changeId: r.changeId });
  // Who sees the pay: not the Viewer; the approver even without the sensitive right.
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set([]);
  const asApprover = await get(r.changeId, 'u-approver');
  assert.equal(asApprover.canSeePay, true);
  assert.equal(asApprover.change.NewPay.Lines[0].Amount, 5200);
  const asViewer = await get(r.changeId, 'u-viewer');
  assert.deepEqual([asViewer.canSeePay, asViewer.change.NewPay, asViewer.change.Increase], [false, { Hidden: true }, null]);
  await rtdb.ref('permissions/EMPLOYEES/sensitive').set(['Admin']);
  await call('u-approver', 'decideEmployeeChangeApproval', { changeId: r.changeId, levelNumber: 1, decision: 'Approved' });
  assert.equal((await emp()).CostCenterID, 'CC1', 'not yet: it is effective in 30 days');
  const c = await comp();
  assert.deepEqual(c.upcoming.map(v => [v.EffectiveFrom, v.Basic]), [[addDays(T, 30), 5200]]);
  assert.equal((await get(r.changeId)).change.Scheduled, true);
  // The day comes: the first opening of Employees applies it.
  await firestore.collection('employeeChanges').doc(r.changeId).update({ EffectiveDate: T });
  await call('u-admin', 'getEmployees', {});
  assert.equal((await emp()).CostCenterID, 'CC2');
  const h = (await call('u-admin', 'getEmployee', { employeeId: EMP })).history.find(x => x.Action === 'Transfer' && x.Changes.some(y => y.Field === 'CostCenterID'));
  assert.equal(h.ByName, 'Employee Change (scheduled)');
  assert.equal((await get(r.changeId)).change.Scheduled, false);
});
