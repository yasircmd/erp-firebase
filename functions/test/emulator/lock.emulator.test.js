// The posting lock as a lease (docs/modules/LOCKING.md, Q423, Q426; owner,
// 2026-11-07), on the emulators with short timings: a holder working past
// the stale time keeps the lock while it renews; a dead holder's lock is
// taken over; a late release never frees the next holder's lock; a waiter
// gives up with the busy message; the ported code's LockService shim
// releases only its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, reset, baseFixture } = require('./_helpers');
const firebaseAdmin = require('../../src/firebaseAdmin');
const lock = require('../../src/lock');

test.after(async () => { await app.delete(); });
const pause = ms => new Promise(r => setTimeout(r, ms));
const inCorp = fn => firebaseAdmin.runInCorporate({ id: '100' }, fn);
const FAST = { staleMs: 1500, renewMs: 400, timeoutMs: 1200 };
const lockDoc = () => firestore.doc(lock.LOCK_DOC_PATH).get().then(s => (s.exists ? s.data() : null));

test.beforeEach(async () => { await reset(baseFixture()); await firestore.doc(lock.LOCK_DOC_PATH).delete(); });

test('a holder working past the stale time keeps the lock while it renews; the next waits for it', async () => {
  const order = [];
  const long = inCorp(() => lock.withGlobalLock('long posting', async () => { order.push('long start'); await pause(3500); order.push('long end'); }, FAST));
  await pause(2000); // past the stale time: before, the lock would have been taken over here
  await assert.rejects(inCorp(() => lock.withGlobalLock('waiter', async () => { order.push('waiter ran'); }, FAST)), new RegExp(lock.BUSY_MESSAGE.replace(/[.;]/g, '.')));
  await long;
  assert.equal(await lockDoc(), null, 'released');
  await inCorp(() => lock.withGlobalLock('next', async () => { order.push('next ran'); }, FAST));
  assert.deepEqual(order, ['long start', 'long end', 'next ran'], 'never two at once');
});

test('a dead holder (not renewed for the stale time) is taken over', async () => {
  await firestore.doc(lock.LOCK_DOC_PATH).set({ lockedAt: Date.now() - 60000, renewedAt: Date.now() - 2000, lockedBy: 'crashed', token: 'dead' });
  let ran = false;
  await inCorp(() => lock.withGlobalLock('after a crash', async () => { ran = true; }, FAST));
  assert.ok(ran);
});

test('a late release never frees the next holder\'s lock', async () => {
  // A holds without renewing (a stopped function), so B takes it over after the stale time.
  const a = await inCorp(() => lock.acquireGlobalLock('A', { staleMs: 1500, renewMs: 600000, timeoutMs: 1200 }));
  await pause(1700);
  const b = await inCorp(() => lock.acquireGlobalLock('B', FAST));
  await inCorp(() => lock.releaseGlobalLock(a)); // A comes back and releases
  const d = await lockDoc();
  assert.equal(d && d.token, b.token, 'still B\'s');
  await assert.rejects(inCorp(() => lock.acquireGlobalLock('C', FAST)), /busy posting/, 'C still waits for B');
  await inCorp(() => lock.releaseGlobalLock(b));
  assert.equal(await lockDoc(), null);
});

test('the wait is 20 s by default, with the busy message', () => {
  assert.equal(lock.LOCK_TIMEOUT_MS, 20000);
  assert.equal(lock.BUSY_MESSAGE, 'The system is busy posting; please try again in a moment.');
});

test('the ported code\'s LockService releases only its own lock', async () => {
  const { LockService, run } = require('../../src/legacy/runtime');
  await inCorp(() => run({ auth: { uid: 'u-admin' } }, async () => {
    const l = LockService.getScriptLock();
    await l.waitLock();
    const mine = (await lockDoc()).token;
    // Someone else's lock now (as after a takeover): the release leaves it.
    await firestore.doc(lock.LOCK_DOC_PATH).set({ lockedAt: Date.now(), renewedAt: Date.now(), lockedBy: 'other', token: 'other' });
    await l.releaseLock();
    assert.equal((await lockDoc()).token, 'other');
    assert.notEqual(mine, 'other');
  }));
  await firestore.doc(lock.LOCK_DOC_PATH).delete();
});
