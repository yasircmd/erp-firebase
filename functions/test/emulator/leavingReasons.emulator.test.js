// Leaving reasons (owner, 2026-10-14; docs/modules/HR_EMPLOYEES.md,
// "Leaving reasons"): HR Setup's list (Payroll Setup's until 2026-10-24) with its defaults, and an
// employee on notice or who has left having one of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });

let G, D;
test.beforeEach(async () => {
  await reset(baseFixture());
  G = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G5', Name: 'Grade 5', Level: 5 } })).gradeId;
  D = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant', GradeFromID: G, GradeToID: G } })).designationId;
});
const emp = over => Object.assign({ FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-03-01', DesignationID: D, GradeID: G, CostCenterID: 'CC1' }, over || {});
const save = e => call('u-admin', 'saveEmployee', { employee: e });
const setup = (action, data, uid) => call(uid || 'u-admin', 'leavingReasonSetup', Object.assign({ action }, data || {}));
const doc = async id => (await firestore.collection('employees').doc(id).get()).data();
const reasonId = async name => (await setup('list')).reasons.find(r => r.Name === name).ReasonID;

test('HR Setup: the default reasons by type; add one; names unique; the type checked; who may change them', async () => {
  const l = await setup('list');
  assert.deepEqual(l.types, ['Resignation', 'Termination', 'Other']);
  assert.deepEqual(l.reasons.map(r => r.Type + ': ' + r.Name), [
    'Resignation: Better opportunity', 'Resignation: Further studies', 'Resignation: Personal reasons', 'Resignation: Relocation',
    'Termination: Absconding', 'Termination: End of contract', 'Termination: Misconduct', 'Termination: Performance', 'Termination: Redundancy',
    'Other: Death', 'Other: Mutual agreement', 'Other: Retirement']);
  assert.equal(l.canWrite, true);
  // Read twice: seeded once.
  assert.equal((await setup('list')).reasons.length, 12);
  const id = (await setup('save', { reason: { Name: 'Career change', Type: 'Resignation' } })).reasonId;
  assert.ok((await setup('list')).reasons.some(r => r.ReasonID === id && r.Name === 'Career change' && r.Active === true));
  await assert.rejects(setup('save', { reason: { Name: 'career CHANGE', Type: 'Other' } }), /already a reason "career CHANGE"/);
  await assert.rejects(setup('save', { reason: { Name: 'Visa', Type: 'Quit' } }), /Choose the type/);
  await assert.rejects(setup('save', { reason: { Name: '', Type: 'Other' } }), /Name the reason/);
  // A Viewer may read (to choose), not change.
  assert.equal((await setup('list', {}, 'u-viewer')).canWrite, false);
  await assert.rejects(setup('save', { reason: { Name: 'X', Type: 'Other' } }, 'u-viewer'), /permission to change HR Setup/);
});

test('an employee on notice or who has left: a reason from the list, by id or by name; Active clears it', async () => {
  const id = (await save(emp())).employeeId;
  const e = await doc(id);
  await assert.rejects(save(Object.assign({}, e, { EmployeeID: id, Status: 'On notice', LeavingDate: '2026-11-30' })), /Choose the leaving reason of an employee who is on notice/);
  await assert.rejects(save(Object.assign({}, e, { EmployeeID: id, Status: 'On notice', LeavingDate: '2026-11-30', LeavingReason: 'Bored' })), /Unknown leaving reason "Bored"/);
  // By id (the screen), with a note.
  const relocation = await reasonId('Relocation');
  await save(Object.assign({}, e, { EmployeeID: id, Status: 'On notice', LeavingDate: '2026-11-30', LeavingReasonID: relocation, LeavingNote: 'Moving to Muscat.' }));
  let x = await doc(id);
  assert.deepEqual([x.LeavingReasonID, x.LeavingReason, x.LeavingType, x.LeavingNote], [relocation, 'Relocation', 'Resignation', 'Moving to Muscat.']);
  // By name (an import), any case.
  await save(Object.assign({}, x, { EmployeeID: id, Status: 'Left', LeavingReasonID: '', LeavingReason: 'misconduct' }));
  x = await doc(id);
  assert.deepEqual([x.Status, x.LeavingReason, x.LeavingType], ['Left', 'Misconduct', 'Termination']);
  // The history names the reason.
  const hist = (await call('u-admin', 'getEmployee', { employeeId: id })).history || [];
  assert.ok(JSON.stringify(hist).includes('Misconduct'), 'history shows the reason');
  // Back to Active: the leaving details are cleared.
  await save(Object.assign({}, x, { EmployeeID: id, Status: 'Active' }));
  x = await doc(id);
  assert.deepEqual([x.LeavingDate, x.LeavingReason, x.LeavingReasonID, x.LeavingType, x.LeavingNote], ['', '', '', '', '']);
});

test('a reason no longer in use: not for a new leaver, kept by those who have it; a reason typed before the list is kept until the status or reason changes', async () => {
  const studies = await reasonId('Further studies');
  const a = (await save(emp({ FullName: 'Ana', Status: 'On notice', LeavingDate: '2026-12-31', LeavingReasonID: studies }))).employeeId;
  await setup('save', { reason: { ReasonID: studies, Name: 'Further studies', Type: 'Resignation', Active: false } });
  await assert.rejects(save(emp({ FullName: 'Bob', Status: 'On notice', LeavingDate: '2026-12-31', LeavingReasonID: studies })), /"Further studies" is no longer in use/);
  // Ana keeps it while other details change.
  await save(Object.assign({}, await doc(a), { EmployeeID: a, Mobile: '050 222' }));
  assert.equal((await doc(a)).LeavingReason, 'Further studies');
  // Before the list: free text, no id.
  const c = (await save(emp({ FullName: 'Cy' }))).employeeId;
  await firestore.collection('employees').doc(c).update({ Status: 'Left', LeavingDate: '2026-01-31', LeavingReason: 'Went home', LeavingReasonID: '' });
  await save(Object.assign({}, await doc(c), { EmployeeID: c, Mobile: '050 333' }));
  assert.deepEqual([(await doc(c)).LeavingReason, (await doc(c)).Mobile], ['Went home', '050 333'], 'kept on an ordinary edit');
  await assert.rejects(save(Object.assign({}, await doc(c), { EmployeeID: c, Status: 'On notice' })), /Unknown leaving reason "Went home"/);
});

// In HR Setup since 2026-10-24 (owner, UX_ROUND2.md item 10): HR Setup's
// write right changes the list, Payroll Setup's no longer does.
test('who may change them: HR Setup write, not Payroll Setup write', async () => {
  const f = baseFixture();
  f.roles.Payroll = { Name: 'Payroll', Status: 'Active' };
  f.roles.HR = { Name: 'HR', Status: 'Active' };
  f.users['u-pay'] = { status: 'Active', role: 'Payroll', username: 'pay', fullName: 'Pay Clerk', AssignedCompanies: ['C1'] };
  f.users['u-hr'] = { status: 'Active', role: 'HR', username: 'hr', fullName: 'HR Officer', AssignedCompanies: ['C1'] };
  f.permissions.PAYROLLSETUP = { access: ['Admin', 'Payroll'], write: ['Admin', 'Payroll'] };
  f.permissions.HRSETUP = { access: ['Admin', 'HR'], write: ['Admin', 'HR'] };
  await reset(f);
  await assert.rejects(setup('list', {}, 'u-pay'), /do not have access to the leaving reasons/);
  await assert.rejects(setup('save', { reason: { Name: 'Visa issue', Type: 'Other' } }, 'u-pay'), /permission to change HR Setup/);
  assert.equal((await setup('list', {}, 'u-hr')).canWrite, true);
  assert.equal((await setup('save', { reason: { Name: 'Visa issue', Type: 'Other' } }, 'u-hr')).success, true);
});
