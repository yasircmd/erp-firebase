// Approval instances in Firestore (functions/src/approvalStore.js;
// docs/modules/TRANSACTIONS_FIRESTORE.md, T5): the same shape RTDB gave
// through every kind of write, their queries, and transact() behaving as
// RTDB's transaction() did for the delegation code.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const movedPaths = require('../../src/movedPaths');
const { approvalInstances } = require('../../src/approvalStore');
const { rtdb, reset } = require('./_helpers');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

const holes = v => JSON.stringify(v, (k, x) => (x === undefined ? '<hole>' : x));
const SCRATCH = 'rtdbCopy/';
async function both(path, method, payload) {
  const ref = rtdb.ref(SCRATCH + path);
  if (method === 'put') await ref.set(payload === undefined ? null : JSON.parse(JSON.stringify(payload)));
  else if (method === 'patch') await ref.update(payload);
  else if (method === 'delete') await ref.remove();
  await movedPaths.request(path, method, payload);
}
async function same(path, why) {
  assert.equal(holes(await movedPaths.request(path, 'get')), holes((await rtdb.ref(SCRATCH + path).get()).val()), why || path);
}

const inst = (o) => Object.assign({
  ModuleID: 'GRN', DocumentID: 'G1', DocumentNumber: '', ScopeKey: 'C1', Amount: 0, CreatedBy: 'u-admin',
  RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-anna' }, { LevelNumber: 2, ApproverUserID: 'u-ben' }], Decisions: [], Status: 'Pending',
  CreatedAt: '2026-10-18T10:00:00Z', UpdatedAt: '2026-10-18T10:00:00Z'
}, o || {});

test('approval instances come back exactly as RTDB gives them, through every kind of write', async () => {
  await reset({});
  await both('approvalInstances/A1', 'put', inst());
  await both('approvalInstances/A2', 'put', inst({ Status: 'Approved', Decisions: [{ LevelNumber: 1, Decision: 'Approved' }] }));
  await same('approvalInstances/A1', 'an empty Decisions list vanishes, as in RTDB');
  await same('approvalInstances');
  await both('approvalInstances/A1', 'patch', { Decisions: [{ LevelNumber: 1, Decision: 'Approved', Reason: '' }], Status: 'Pending', UpdatedAt: 'x' });
  await same('approvalInstances/A1');
  await both('approvalInstances/A1/RequiredLevels/1/ApproverUserID', 'put', 'u-cara');
  await same('approvalInstances/A1', 'a level re-assigned below the document');
  await both('approvalInstances/A2', 'delete');
  await same('approvalInstances');
});

test('queries: status, module or config key, document, and any approver a level names', async () => {
  await reset({});
  await approvalInstances.set('A1', inst());
  await approvalInstances.set('A2', inst({ Status: 'Rejected', ModuleID: 'CBT', ConfigKey: 'CBT_BANKPAYMENT', RequiredLevels: [{ LevelNumber: 1, ApproverUserID: 'u-cara' }] }));
  const ids = async f => Object.keys(await approvalInstances.query(f));
  assert.deepEqual(await ids({ Status: 'Pending' }), ['A1']);
  assert.deepEqual(await ids({ ConfigKey: 'CBT_BANKPAYMENT' }), ['A2']);
  assert.deepEqual(await ids({ ApproverUserID: 'u-ben' }), ['A1']);
  // A delegated level counts its new approver (the query field follows the write).
  await approvalInstances.update('A1', { 'RequiredLevels/1/ApproverUserID': 'u-dan' });
  assert.deepEqual(await ids({ ApproverUserID: 'u-dan' }), ['A1']);
  assert.deepEqual(await ids({ ApproverUserID: 'u-ben' }), []);
});

test('transact: as RTDB\'s transaction — undefined aborts, a document is written whole, a missing one stays missing', async () => {
  await reset({});
  await approvalInstances.set('A1', inst());
  const aborted = await approvalInstances.transact('A1', () => undefined);
  assert.equal(aborted.committed, false);
  assert.equal(aborted.snapshot.val().Status, 'Pending', 'the current record');
  const done = await approvalInstances.transact('A1', cur => Object.assign(cur, { Delegations: [{ LevelNumber: 1, ToUserID: 'u-cara' }] }));
  assert.equal(done.committed, true);
  assert.equal((await approvalInstances.get('A1')).Delegations[0].ToUserID, 'u-cara');
  // The callback gets a copy: changing it without returning it writes
  // nothing, and the aborted result still shows the record as it is.
  const changedThenAborted = await approvalInstances.transact('A1', cur => { cur.Status = 'Mutated'; return undefined; });
  assert.equal(changedThenAborted.snapshot.val().Status, 'Pending');
  assert.equal((await approvalInstances.get('A1')).Status, 'Pending');
  const missing = await approvalInstances.transact('NOPE', cur => cur);
  assert.deepEqual([missing.committed, missing.snapshot.val()], [true, null]);
  assert.equal(await approvalInstances.get('NOPE'), null);
});
