// The last check at commit (docs/modules/LOCKING.md, step 2; Q423; owner,
// 2026-11-07): a posting's writes commit only while its lock is still its
// own. A holder whose lease was lost (frozen past the stale time, another
// posting now holding the lock) writes nothing: through commitFenced,
// through stockPosting.postStock, and through the ported code's LockService.
// Outside a lock the writes commit as a plain batch, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, reset, baseFixture } = require('./_helpers');
const firebaseAdmin = require('../../src/firebaseAdmin');
const lock = require('../../src/lock');
const { postStock } = require('../../src/stockPosting');

test.after(async () => { await app.delete(); });
const pause = ms => new Promise(r => setTimeout(r, ms));
const inCorp = fn => firebaseAdmin.runInCorporate({ id: '100' }, fn);
const marker = id => firestore.collection('fenceTest').doc(id);
const exists = async id => (await marker(id).get()).exists;
// A holder that stops renewing (a frozen function); B takes its lock after the stale time.
const FROZEN = { staleMs: 1200, renewMs: 600000, timeoutMs: 1000 };
const takeOver = () => inCorp(async () => { await pause(1400); return lock.acquireGlobalLock('B', { staleMs: 1200, renewMs: 400, timeoutMs: 2000 }); });

test.beforeEach(async () => { await reset(baseFixture()); await firestore.doc(lock.LOCK_DOC_PATH).delete(); });

test('the holder commits while the lock is its own; outside a lock, a plain batch', async () => {
  await inCorp(() => lock.withGlobalLock('A', () => lock.commitFenced([['set', [marker('held'), { ok: 1 }]]])));
  assert.ok(await exists('held'));
  await inCorp(() => lock.commitFenced([['set', [marker('nolock'), { ok: 1 }]]]));
  assert.ok(await exists('nolock'));
});

test('a holder whose lease was lost writes nothing and is told to post again', async () => {
  let b;
  await assert.rejects(inCorp(() => lock.withGlobalLock('A', async (held) => {
    b = await takeOver();
    await lock.commitFenced([['set', [marker('late'), { ok: 1 }]], ['set', [marker('late2'), { ok: 1 }]]]);
    assert.ok(held.lost);
  }, FROZEN)), new RegExp('took too long and was stopped before it was saved'));
  assert.equal(await exists('late'), false);
  assert.equal(await exists('late2'), false, 'all or nothing');
  assert.equal((await firestore.doc(lock.LOCK_DOC_PATH).get()).get('token'), b.token, 'B still holds the lock');
  await inCorp(() => lock.releaseGlobalLock(b));
});

test('postStock: a lost lease posts nothing', async () => {
  await assert.rejects(inCorp(() => lock.withGlobalLock('A', async () => {
    await takeOver();
    await postStock({ uid: 'u-admin', profile: { username: 'admin', AssignedCompanies: ['C1'] } }, null, {}, () => ({}),
      (w) => { w.set(marker('posted'), { ok: 1 }); });
  }, FROZEN)), /took too long/);
  assert.equal(await exists('posted'), false);
});

test('the ported code\'s LockService: its posting is checked against its own lock too', async () => {
  const { LockService, run } = require('../../src/legacy/runtime');
  await inCorp(() => run({ auth: { uid: 'u-admin' } }, async () => {
    const l = LockService.getScriptLock();
    await l.waitLock();
    await lock.commitFenced([['set', [marker('legacyOk'), { ok: 1 }]]]);
    // Someone else's lock now (as after a takeover).
    await firestore.doc(lock.LOCK_DOC_PATH).set({ lockedAt: Date.now(), renewedAt: Date.now(), lockedBy: 'other', token: 'other' });
    await assert.rejects(lock.commitFenced([['set', [marker('legacyLate'), { ok: 1 }]]]), /took too long/);
    await l.releaseLock();
  }));
  assert.ok(await exists('legacyOk'));
  assert.equal(await exists('legacyLate'), false);
  await firestore.doc(lock.LOCK_DOC_PATH).delete();
});
