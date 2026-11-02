// Timings of every call (docs/modules/PERFORMANCE.md, P1): one log line per
// call, with the cold start and the global lock's wait and held time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const perf = require('../../src/perf');
const pause = ms => new Promise(r => setTimeout(r, ms));

// The lines logged while fn runs.
async function logged(fn, env) {
  const lines = [];
  const orig = console.log;
  const saved = {};
  Object.entries(env || {}).forEach(([k, v]) => { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; });
  console.log = (s) => { try { const j = JSON.parse(s); if (j.message === 'perf') { lines.push(j); return; } } catch (e) { /* not ours */ } orig(s); };
  try { await fn(); } finally {
    console.log = orig;
    Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
  return lines;
}
const ENV = { FUNCTIONS_EMULATOR: null, FUNCTION_TARGET: 'postGrn', ERP_LAZY: '1' };

test('one line per call: the first is the cold start (load time, lazy), then warm; the lock\'s wait and held time; a failure', async () => {
  const lines = await logged(async () => {
    assert.equal(await perf.timed(async () => { perf.setCorporate('200'); await pause(5); return 'a'; }), 'a');
    await perf.timed(async () => {
      perf.lockAcquired(40, 3);
      await pause(30);
      perf.lockReleased();
      perf.lockAcquired(0, 1);
      perf.lockReleased();
    });
    await assert.rejects(perf.timed(async () => { perf.lockTimedOut(10000, 42); throw new Error('Could not acquire lock — please try again.'); }), /Could not acquire lock/);
  }, ENV);
  assert.equal(lines.length, 3);
  const [a, b, c] = lines;
  assert.deepEqual([a.fn, a.ok, a.cold, a.lazy, a.corporate, typeof a.loadMs], ['postGrn', true, true, true, '200', 'number']);
  assert.ok(a.ms >= 5 && a.loadMs > 0 && a.locks === undefined, JSON.stringify(a));
  assert.deepEqual([b.cold, b.loadMs, b.lazy, b.locks, b.lockWaitMs, b.lockTries], [false, undefined, undefined, 2, 40, 4]);
  assert.ok(b.lockHeldMs >= 25 && b.lockHeldMs < 1000, 'held ' + b.lockHeldMs);
  assert.deepEqual([c.ok, c.lockTimeout, c.lockWaitMs, c.lockTries, c.locks], [false, true, 10000, 42, 0]);
});

test('concurrent calls keep their own figures; outside a call the lock reports nothing', async () => {
  perf.lockAcquired(5, 1); perf.lockReleased(); perf.lockTimedOut(1, 1); // no call: nothing, no error
  const lines = await logged(() => Promise.all([
    perf.timed(async () => { await pause(10); perf.lockAcquired(100, 5); await pause(20); perf.lockReleased(); }),
    perf.timed(async () => { perf.lockAcquired(1, 1); perf.lockReleased(); await pause(40); })
  ]), ENV);
  const byWait = lines.sort((x, y) => x.lockWaitMs - y.lockWaitMs);
  assert.deepEqual(byWait.map(l => [l.locks, l.lockWaitMs, l.lockTries]), [[1, 1, 1], [1, 100, 5]]);
});

test('not logged in the emulators (unless asked); a log failure never fails the call', async () => {
  assert.deepEqual(await logged(() => perf.timed(async () => 1), { FUNCTIONS_EMULATOR: 'true', ERP_PERF_LOG: null }), []);
  assert.equal((await logged(() => perf.timed(async () => 1), { FUNCTIONS_EMULATOR: 'true', ERP_PERF_LOG: '1' })).length, 1);
  const orig = console.log;
  console.log = () => { throw new Error('logging down'); };
  try { assert.equal(await perf.timed(async () => 'still'), 'still'); } finally { console.log = orig; }
});

test('every callable is timed, and the lock reports to it', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
  assert.match(src('callable.js'), /return onCall\(options, \(request\) => perf\.timed\(async \(\) => \{\n\s+const corporate = await resolveCorporate\(request\);\n\s+perf\.setCorporate/);
  const lock = src('lock.js');
  assert.match(lock, /if \(acquired\) \{ perf\.lockAcquired\(Date\.now\(\) - started, tries\); return; \}/);
  assert.match(lock, /perf\.lockTimedOut\(Date\.now\(\) - started, tries\);\n\s+throw new Error\('Could not acquire lock/);
  assert.match(lock, /async function releaseGlobalLock\(\) \{\n\s+perf\.lockReleased\(\);/);
});
