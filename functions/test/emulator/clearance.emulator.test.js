// A leaver's clearance (UX round 2, item 28; docs/modules/LEAVER_CLEARANCE.md,
// Q278, Q301-Q304): the default steps when a company has none; started when
// the employee goes on notice, gone when active again; in order, a step opens
// once the ones before are signed (or all at once, as set up); only a step's
// team (or "manage") works on it; an amount to recover needs the set-up's
// deduction; the settlement waits for it and takes the amount as a deduction;
// reopening; the leaver's read-only view; Home; an empty set-up switches it off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, BEN, FINE;
const get = (uid, emp) => call(uid || 'u-admin', 'getClearance', { employeeId: emp || ALI }).then(r => r.clearance);
const states = c => c.Steps.map(s => s.Name + ':' + s.State);
const step = (uid, stepId, d, sign) => call(uid, sign ? 'signClearanceStep' : 'saveClearanceStep', Object.assign({ employeeId: ALI, stepId }, d || {}));

test.before(async () => {
  const f = baseFixture();
  f.users['u-it'] = { status: 'Active', role: 'Viewer', username: 'it', fullName: 'Ivy Tech', AssignedCompanies: ['C1'] };
  f.users['u-fin'] = { status: 'Active', role: 'Viewer', username: 'fin', fullName: 'Fred Ledger', AssignedCompanies: ['C1'] };
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-OTHINC': { AccountCode: '4900', AccountName: 'Other Income', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk' } })).designationId;
  const emp = (name, extra) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1' }, extra || {}) }).then(r => r.employeeId);
  ALI = await emp('Ali Hassan');
  BEN = await emp('Ben Okafor');
  FINE = (await call('u-admin', 'savePayElement', { element: { Code: 'ASSETREC', Name: 'Assets not returned', Kind: 'Deduction', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'savePayElementPayroll', { elementId: FINE, glAccountId: 'A-OTHINC' });
});

const onNotice = async id => {
  const e = (await firestore.collection('employees').doc(id).get()).data();
  const reason = (await call('u-admin', 'leavingReasonSetup', { action: 'list' })).reasons.find(r => r.Name === 'Relocation').ReasonID;
  return call('u-admin', 'saveEmployee', { employee: Object.assign({}, e, { EmployeeID: id, Status: 'On notice', LeavingDate: '2026-07-31', LeavingReasonID: reason }) });
};

test('the default steps, in order; started on notice; the team signs its own step; manage any; an amount to recover needs the deduction', async () => {
  const setup = (await call('u-admin', 'getClearanceSetup', { companyId: 'C1' })).setup;
  assert.deepEqual([setup.Default, setup.Mode, setup.Steps.map(s => s.Name)], [true, 'InOrder', ['Finance', 'IT', 'HR']]);
  assert.match((await call('u-admin', 'getClearance', { employeeId: ALI }).catch(e => e)).message, /has no clearance/);

  // Set up: IT's team is Ivy; Fred is on no team.
  const steps = setup.Steps.map(s => Object.assign({}, s, { TeamUserIDs: s.StepID === 'it' ? ['u-it'] : [] }));
  await assert.rejects(call('u-it', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps }), /permission to set up/);
  await assert.rejects(call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps: steps.map(s => Object.assign({}, s, { TeamUserIDs: ['u-other'] })) }), /active user with Clearances access/);
  await call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps });

  const saved = await onNotice(ALI);
  assert.equal(saved.success, true);
  let c = await get();
  assert.deepEqual(states(c), ['Finance:Open', 'IT:Waiting', 'HR:Waiting']);
  assert.deepEqual(c.Steps[1].Items.map(i => i.Text), ['Laptop returned', 'Phone returned', 'Access card returned', 'Email and system access closed']);

  await assert.rejects(step('u-it', 'it', {}, true), /opens once the steps before it are signed off/);
  await assert.rejects(step('u-fin', 'finance', {}, true), /Only Finance's team signs off/, 'Fred is on no team and has no manage');
  await step('u-admin', 'finance', { items: [true, true, true], notes: 'All settled' }, true);
  c = await get('u-it');
  assert.deepEqual(states(c), ['Finance:Signed', 'IT:Open', 'HR:Waiting']);
  assert.deepEqual(c.Steps.map(s => s.CanWork), [false, true, false], 'Ivy may work on IT only');

  // IT: the laptop not returned, an amount to recover.
  await assert.rejects(step('u-it', 'it', { items: [false, true, true, true], recoverAmount: 1500, recoverNote: '' }), /Say what the amount is for/);
  await assert.rejects(step('u-it', 'it', { items: [false, true, true, true], recoverAmount: 1500, recoverNote: 'Laptop not returned' }), /Choose the deduction/);
  await call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps, recoveryElementId: FINE });
  // The clearance keeps the steps it started with: the element is taken from the set-up at start.
  await firestore.collection('clearances').doc(ALI).update({ RecoveryElementID: FINE });
  await step('u-it', 'it', { items: [false, true, true, true], recoverAmount: 1500, recoverNote: 'Laptop not returned' }, true);

  // Home: the open HR step has no team, so it is Admin's (manage).
  const tasks = await call('u-admin', 'getClearanceTasksForUser', {});
  assert.deepEqual(tasks.map(t => [t.EmployeeName, t.Step, t.Progress]), [['Ali Hassan', 'HR', '2 of 3 signed']]);
  assert.deepEqual(await call('u-it', 'getClearanceTasksForUser', {}), []);

  // The leaver's view: states and what is outstanding, no notes or amounts.
  const mine = await require('../../src/clearance').forPortal(Object.assign({ EmployeeID: ALI }, (await firestore.collection('employees').doc(ALI).get()).data()));
  assert.deepEqual(mine.Steps.map(s => [s.Name, s.State, s.Outstanding]), [['Finance', 'Signed', []], ['IT', 'Signed', []], ['HR', 'Open', ['Company documents returned', 'Exit interview held']]]);
  assert.equal(JSON.stringify(mine).includes('Laptop not returned'), false);
  assert.equal(JSON.stringify(mine).includes('1500'), false);
});

test('the settlement waits for the clearance and takes its amount as a deduction; reopening; the list; active again', async () => {
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const s = (await call('u-admin', 'getSettlement', { employeeId: ALI })).settlement;
  const line = s.Lines.find(l => l.Key === 'Clearance:it');
  assert.deepEqual([line.Kind, line.Name, line.Amount, line.ElementID, line.Text], ['Deduction', 'Clearance: IT', 1500, FINE, 'Laptop not returned']);
  const sv = await call('u-admin', 'saveSettlement', { employeeId: ALI });
  await assert.rejects(call('u-admin', 'submitSettlement', { settlementId: sv.settlementId }), /Complete Ali Hassan's clearance first \(Clearances\): still open: HR\./);

  // HR signs; complete. Reopening IT (manage only, with a reason).
  await step('u-admin', 'hr', { items: [true, true] }, true);
  let c = await get();
  assert.equal(c.Status, 'Complete');
  await assert.rejects(call('u-it', 'reopenClearanceStep', { employeeId: ALI, stepId: 'it', reason: 'x' }), /permission to reopen/);
  await assert.rejects(call('u-admin', 'reopenClearanceStep', { employeeId: ALI, stepId: 'it', reason: '' }), /Give the reason/);
  await call('u-admin', 'reopenClearanceStep', { employeeId: ALI, stepId: 'it', reason: 'Laptop came back' });
  c = await get();
  assert.deepEqual([c.Status, states(c)[1]], ['Open', 'IT:Open']);
  await step('u-it', 'it', { items: [true, true, true, true], recoverAmount: 0 }, true);
  assert.equal((await get()).Status, 'Complete');
  const s2 = (await call('u-admin', 'getSettlement', { settlementId: sv.settlementId })).settlement;
  assert.equal(s2.Lines.find(l => l.Key === 'Clearance:it'), undefined, 'nothing to recover now');

  // The list: Ali complete; Ben not leaving, none.
  const list = await call('u-admin', 'getClearances', { companyId: 'C1' });
  assert.deepEqual(list.clearances.map(x => [x.EmployeeName, x.Status, x.Progress]), [['Ali Hassan', 'Complete', '3 of 3 signed']]);

  // Ben goes on notice, then is active again before anyone signed: his clearance goes.
  await onNotice(BEN);
  assert.equal((await firestore.collection('clearances').doc(BEN).get()).exists, true);
  const e = (await firestore.collection('employees').doc(BEN).get()).data();
  await call('u-admin', 'saveEmployee', { employee: Object.assign({}, e, { EmployeeID: BEN, Status: 'Active', LeavingDate: '' }) });
  assert.equal((await firestore.collection('clearances').doc(BEN).get()).exists, false);
});

test('all at once; an empty set-up switches clearance off', async () => {
  await call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'AllAtOnce', steps: [{ Name: 'IT', TeamUserIDs: ['u-it'], Checklist: ['Laptop returned'] }, { Name: 'HR', Checklist: [] }] });
  await onNotice(BEN);
  let c = await get('u-admin', BEN);
  assert.deepEqual(states(c), ['IT:Open', 'HR:Open']);
  const e = (await firestore.collection('employees').doc(BEN).get()).data();
  await call('u-admin', 'saveEmployee', { employee: Object.assign({}, e, { EmployeeID: BEN, Status: 'Active', LeavingDate: '' }) });

  await call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps: [] });
  await onNotice(BEN);
  assert.equal((await firestore.collection('clearances').doc(BEN).get()).exists, false);
  assert.match((await call('u-admin', 'getClearance', { employeeId: BEN }).catch(x => x)).message, /has no clearance/);
});
