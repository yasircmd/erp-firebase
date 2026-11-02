// Timings of every call (docs/modules/PERFORMANCE.md, P1): one log line per
// callable, so the slow screens and postings can be found from data, not
// guesses. Each line says how long the call took, whether it was the first
// call this instance served (a cold start, and then how long the instance
// took to load), and how long the call waited for the global lock and held
// it (lock.js), or timed out waiting.
//
// Read them in Google Cloud's Logs Explorer: jsonPayload.message="perf".
// Not in the emulators (FUNCTIONS_EMULATOR), where the tests run.
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage(); // per request: this call's lock figures
let served = 0; // calls this instance has served (the instance's own, no corporate's data)

function line(fn, ms, t, cold, ok) {
  const out = { message: 'perf', fn, ms, ok, cold, corporate: t.corporate || null };
  if (cold) {
    out.loadMs = t.loadMs; // from the instance starting to this first call: the cold start's load
    out.lazy = process.env.ERP_LAZY === '1'; // index.js loaded only this function's code (P2)
  }
  if (t.locks || t.lockTimeout) Object.assign(out, { locks: t.locks, lockWaitMs: t.lockWaitMs, lockHeldMs: t.lockHeldMs, lockTries: t.lockTries });
  if (t.lockTimeout) out.lockTimeout = true;
  return out;
}

function enabled() { return process.env.FUNCTIONS_EMULATOR !== 'true' || process.env.ERP_PERF_LOG === '1'; }

// Runs fn as one timed call; logs its line when it ends, success or not.
async function timed(fn) {
  const cold = served === 0;
  served++;
  const t = { locks: 0, lockWaitMs: 0, lockHeldMs: 0, lockTries: 0, corporate: null, heldSince: null,
    loadMs: cold ? Math.round(process.uptime() * 1000) : undefined };
  const start = Date.now();
  let ok = true;
  try {
    return await store.run(t, fn);
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    if (enabled()) {
      const name = process.env.FUNCTION_TARGET || process.env.K_SERVICE || 'unknown';
      try { console.log(JSON.stringify(line(name, Date.now() - start, t, cold, ok))); } catch (e) { /* a log line never fails a call */ }
    }
  }
}

function current() { return store.getStore() || null; }
function setCorporate(id) { const t = current(); if (t) t.corporate = id; }

// lock.js reports here; outside a timed call these do nothing.
function lockAcquired(waitMs, tries) {
  const t = current(); if (!t) return;
  t.locks++; t.lockWaitMs += waitMs; t.lockTries += tries; t.heldSince = Date.now();
}
function lockReleased() {
  const t = current(); if (!t || t.heldSince == null) return;
  t.lockHeldMs += Date.now() - t.heldSince; t.heldSince = null;
}
function lockTimedOut(waitMs, tries) {
  const t = current(); if (!t) return;
  t.lockTimeout = true; t.lockWaitMs += waitMs; t.lockTries += tries;
}

module.exports = { timed, setCorporate, lockAcquired, lockReleased, lockTimedOut, _line: line };
