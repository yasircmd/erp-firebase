// A leaver's sign-in (owner, 2026-10-14; docs/modules/HR_EMPLOYEES.md,
// "A leaver's access"): ERP and portal access until the final settlement
// is paid (not before the last working day), at most 30 days after the last
// working day; HR extends it, keeps it, or goes back to the rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = n => { const d = new Date(today() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let G, D;
test.beforeEach(async () => {
  await reset(baseFixture());
  G = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G5', Name: 'Grade 5', Level: 5 } })).gradeId;
  D = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant', GradeFromID: G, GradeToID: G } })).designationId;
});
const save = e => call('u-admin', 'saveEmployee', { employee: e });
const doc = async id => (await firestore.collection('employees').doc(id).get()).data();
const userUntil = async () => (await rtdb.ref('users/u-viewer/AccessUntil').get()).val();
const signIn = () => call('u-viewer', 'restoreSession');
const portal = () => call('u-viewer', 'essPortal', { action: 'requests' });
async function leaver(leftDaysAgo) {
  const id = (await save({ FullName: 'Vic Viewer', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: D, GradeID: G, CostCenterID: 'CC1', UserUID: 'u-viewer' })).employeeId;
  await save(Object.assign({}, await doc(id), { EmployeeID: id, Status: 'Left', LeavingDate: day(-leftDaysAgo), LeavingReason: 'Relocation' }));
  return id;
}
const access = (id, mode, x) => call('u-admin', 'setLeaverAccess', Object.assign({ employeeId: id, mode, reason: 'Handing over' }, x || {}));

test('left 10 days ago, no settlement paid: ERP and portal until 30 days after the last working day', async () => {
  const id = await leaver(10);
  assert.equal((await doc(id)).AccessUntil, day(20));
  assert.equal(await userUntil(), day(20));
  await signIn();
  await portal();
});

test('left 31 days ago: access has ended, in the ERP and the portal', async () => {
  await leaver(31);
  assert.equal(await userUntil(), day(-1));
  await assert.rejects(signIn(), new RegExp('Your access ended on ' + day(-1)));
  await assert.rejects(portal(), new RegExp('Your portal access ended on ' + day(-1)));
});

test('the settlement paid: access ends with the payment date (never before the last working day); a reversed payment brings the 30 days back', async () => {
  const id = await leaver(10);
  const fs = firestore.collection('payrollSettlements').doc('FS1');
  await fs.set({ EmployeeID: id, Status: 'Posted', PaidAt: new Date().toISOString(), PaymentDate: day(-5) });
  await access(id, 'Rule'); // works the date out again
  assert.equal(await userUntil(), day(-5));
  await assert.rejects(signIn(), /Your access ended/);
  // Paid before the last working day: access lasts to the last working day.
  await fs.update({ PaymentDate: day(-20) });
  await access(id, 'Rule');
  assert.equal(await userUntil(), day(-10));
  await fs.update({ PaidAt: '', PaymentDate: '' });
  await access(id, 'Rule');
  assert.equal(await userUntil(), day(20));
  await signIn();
});

test('HR extends, keeps, or goes back to the rule, with a reason, in the history; checks and rights', async () => {
  const id = await leaver(31);
  await assert.rejects(call('u-viewer', 'setLeaverAccess', { employeeId: id, mode: 'Keep', reason: 'x' }), /inactive|access ended|permission/);
  await assert.rejects(access(id, 'Extend', { until: day(-1) }), /Extend to a date from today on/);
  await assert.rejects(call('u-admin', 'setLeaverAccess', { employeeId: id, mode: 'Keep' }), /Give the reason/);
  await access(id, 'Extend', { until: day(5) });
  assert.equal(await userUntil(), day(5));
  assert.equal((await doc(id)).AccessOverride.Mode, 'Extend');
  await signIn();
  await access(id, 'Keep');
  assert.equal(await userUntil(), null);
  assert.equal((await doc(id)).AccessUntil, '');
  await signIn();
  await portal();
  await access(id, 'Rule');
  await assert.rejects(signIn(), /Your access ended/);
  const hist = (await call('u-admin', 'getEmployee', { employeeId: id })).history.filter(h => h.Action === 'Access after leaving');
  assert.equal(hist.length, 3);
  assert.match(JSON.stringify(hist), /kept \(no end\)/);
});

test('back to Active: no end, the override cleared; an ERP user unlinked loses the date; existing leavers filled in once', async () => {
  const id = await leaver(31);
  await save(Object.assign({}, await doc(id), { EmployeeID: id, Status: 'Active' }));
  assert.deepEqual([(await doc(id)).AccessUntil, (await doc(id)).AccessOverride, await userUntil()], ['', null, null]);
  await signIn();
  // Unlinked while leaving: the old user's date goes.
  await save(Object.assign({}, await doc(id), { EmployeeID: id, Status: 'On notice', LeavingDate: day(3), LeavingReason: 'Relocation' }));
  assert.equal(await userUntil(), day(33));
  await save(Object.assign({}, await doc(id), { EmployeeID: id, UserUID: '' }));
  assert.equal(await userUntil(), null);
  // Before this went live: a leaver without a last day, filled in once.
  await firestore.collection('employees').doc(id).update({ UserUID: 'u-viewer', Status: 'Left', LeavingDate: day(-40), AccessUntil: '' });
  assert.equal((await call('u-admin', 'refreshLeaverAccess', {})).done, 1);
  assert.equal(await userUntil(), day(-10));
  assert.equal((await call('u-admin', 'refreshLeaverAccess', {})).done, 0, 'once');
});
