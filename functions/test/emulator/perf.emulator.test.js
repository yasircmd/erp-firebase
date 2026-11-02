// Timings of every call (docs/modules/PERFORMANCE.md, P1), on the emulators
// with the real global lock: two postings at once, the second waiting for the
// first; a third timing out on a lock someone holds (its wait still logged);
// and a real callable's line.
process.env.ERP_PERF_LOG = '1'; // the emulators don't log timings unless asked
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');
const firebaseAdmin = require('../../src/firebaseAdmin');
const lock = require('../../src/lock');
const perf = require('../../src/perf');

test.after(async () => { await app.delete(); });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function logged(fn) {
  const lines = []; const orig = console.log;
  console.log = (s) => { try { const j = JSON.parse(s); if (j.message === 'perf') return lines.push(j); } catch (e) { /* not ours */ } orig(s); };
  try { await fn(); } finally { console.log = orig; }
  return lines;
}
const posting = (who, holdMs) => perf.timed(() => firebaseAdmin.runInCorporate({ id: '100' }, () => lock.withGlobalLock(who, () => pause(holdMs))));

test('two postings at once: the second waits for the first; the held time; a timeout still logs its wait', async () => {
  await reset(baseFixture());
  await firestore.doc(lock.LOCK_DOC_PATH).delete();
  const lines = await logged(async () => {
    await Promise.all([posting('first', 600), pause(100).then(() => posting('second', 50))]);
  });
  const [first, second] = lines.sort((a, b) => a.lockWaitMs - b.lockWaitMs);
  assert.deepEqual([first.locks, second.locks, first.lockTries], [1, 1, 1]);
  assert.ok(first.lockHeldMs >= 550, 'first held ' + first.lockHeldMs);
  assert.ok(second.lockWaitMs >= 350 && second.lockTries > 1, 'second waited ' + second.lockWaitMs + ' ms, ' + second.lockTries + ' tries');
  assert.ok(second.ms >= second.lockWaitMs + 40, 'its time includes the wait');

  await firestore.doc(lock.LOCK_DOC_PATH).set({ lockedAt: Date.now(), lockedBy: 'a long posting' });
  const [late] = await logged(() => assert.rejects(posting('late', 0), /Could not acquire lock/));
  assert.deepEqual([late.ok, late.lockTimeout, late.locks], [false, true, 0]);
  assert.ok(late.lockWaitMs >= lock.LOCK_TIMEOUT_MS - 50, 'waited ' + late.lockWaitMs);
  await firestore.doc(lock.LOCK_DOC_PATH).delete();
});

test('a real callable logs its line (in the emulator\'s own log, so here only that it still answers)', async () => {
  const r = await call('u-admin', 'getActiveCompanies', {});
  assert.ok(Array.isArray(r) && r.length >= 1);
});
