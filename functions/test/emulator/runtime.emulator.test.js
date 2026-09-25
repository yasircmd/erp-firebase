// Direct tests of functions/src/legacy/runtime.js — the Admin-SDK stand-in
// for Code.gs's REST primitives. Each assertion is a REST behavior the
// verbatim-ported code relies on.
// The runtime uses the functions' default Admin app (src/firebaseAdmin.js):
// point it at the emulators and create it BEFORE the helpers' named app.
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'erp1-8f4cd';
const R = require('../../src/legacy/runtime');
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_helpers');

test.before(async () => { await H.reset({ seed: true }); });
test.after(async () => { await H.app.delete(); const { admin } = require('../../src/firebaseAdmin'); await Promise.all(admin.apps.map(a => a.delete())); });

test('RTDB put/patch drop undefined keys like JSON; post returns {name}; delete returns null; get missing = null', async () => {
  assert.deepEqual(await R.firebaseDbRequest_('rt/a', 'put', { x: 1, y: undefined, z: [1, undefined] }), { x: 1, z: [1, null] });
  assert.deepEqual(await H.val('rt/a'), { x: 1, z: [1] }); // RTDB itself drops the null array slot
  assert.deepEqual(await R.firebaseDbRequest_('rt/a', 'patch', { y: 2, x: null }), { y: 2, x: null });
  assert.deepEqual(await H.val('rt/a'), { y: 2, z: [1] }, 'patch null deletes a key');
  const p = await R.firebaseDbRequest_('/rt/list/', 'post', { v: 1 });
  assert.ok(p.name && (await H.val('rt/list/' + p.name)).v === 1);
  assert.equal(await R.firebaseDbRequest_('rt/a', 'delete', null), null);
  assert.equal(await R.firebaseDbRequest_('rt/a', 'get', null), null);
});

test('Firestore: set = replace; update = top-level merge that UPSERTS and replaces whole maps; _id attached', async () => {
  const s = await R.firestoreSet_('rtTest', 'd1', { a: 1, m: { p: 1, q: 2 }, u: undefined });
  assert.deepEqual(s, { a: 1, m: { p: 1, q: 2 }, _id: 'd1' });
  const u = await R.firestoreUpdate_('rtTest', 'd1', { m: { p: 9 }, b: 'x' });
  assert.deepEqual(u, { a: 1, m: { p: 9 }, b: 'x', _id: 'd1' }, 'm replaced wholesale, a kept');
  const up = await R.firestoreUpdate_('rtTest', 'new', { z: 1 });
  assert.deepEqual(up, { z: 1, _id: 'new' }, 'PATCH+updateMask creates a missing doc');
  assert.equal(await R.firestoreGet_('rtTest', 'missing'), null);
  await R.firestoreDelete_('rtTest', 'missing'); // no throw
  const added = await R.firestoreAdd_('rtTest', { k: 1 });
  assert.ok(added._id);
});

test('Firestore query/count: EQUAL, IN, orderBy DESCENDING, limit', async () => {
  for (const [id, st, t] of [['q1', 'Posted', '1'], ['q2', 'Draft', '2'], ['q3', 'Posted', '3']]) await R.firestoreSet_('rtQ', id, { Status: st, T: t });
  const rows = await R.firestoreQuery_('rtQ', [['Status', 'IN', ['Posted', 'Draft']]], [['T', 'DESCENDING']], 2);
  assert.deepEqual(rows.map(r => r._id), ['q3', 'q2']);
  assert.equal(await R.firestoreCount_('rtQ', [['Status', 'EQUAL', 'Posted']]), 2);
});

test('LockService: re-entrant within one request, released at depth 0', async () => {
  const lockDoc = () => H.firestore.doc('system/globalLock').get().then(s => s.exists);
  await R.run({ auth: { uid: 'u-admin' } }, async () => {
    const l = R.LockService.getScriptLock();
    await l.waitLock(10000);
    await l.waitLock(10000); // nested (GAS allows this within one execution)
    await l.releaseLock();
    assert.equal(await lockDoc(), true, 'still held after inner release');
    await l.releaseLock();
    assert.equal(await lockDoc(), false, 'released after outer release');
  });
});
