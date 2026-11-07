const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { firestore } = require('./firebaseAdmin');
const perf = require('./perf'); // the call's lock wait and held time (docs/modules/PERFORMANCE.md, P1)

// Replaces LockService.getScriptLock() — GAS's own script-wide mutex,
// used throughout Code.gs to serialize every commit-posting function
// against every other one. Kept GLOBAL (one per corporate: the lock
// document is in the corporate's own Firestore), deliberately: finer
// locking is decided from the logged lock waits (docs/modules/LOCKING.md,
// Q425), not here.
//
// Firestore transactions make it a mutex: a transaction's read-then-write
// is atomic against every other transaction on the same document, so two
// instances racing for the lock can never both believe they hold it.
//
// A LEASE (docs/modules/LOCKING.md, Q423; owner, 2026-11-07). Each holder
// writes its own token and renews the lock every LOCK_RENEW_MS while its
// work runs. A lock is taken over only when it hasn't been renewed for
// LOCK_STALE_MS: its holder crashed or its function was stopped (a Cloud
// Function has no GAS-style auto-release). Before this, a holder never
// renewed, so a posting longer than 30 s could be overtaken while still
// running; and its release deleted the lock whoever held it, freeing the
// next holder's too. Now a release deletes only its own lock, in a
// transaction.
//
//   system/globalLock { lockedAt, renewedAt, lockedBy, token }
const LOCK_DOC_PATH = 'system/globalLock';
const LOCK_TIMEOUT_MS = 20000; // the wait (Q426; it was 10 s, as lock.waitLock(10000))
const LOCK_STALE_MS = 30000;   // not renewed for this long: abandoned
const LOCK_RENEW_MS = 10000;   // the holder renews this often
const BUSY_MESSAGE = 'The system is busy posting; please try again in a moment.';
const LOST_MESSAGE = 'This posting took too long and was stopped before it was saved, so nothing was posted: please post it again.';
// The lock held by the current request, for the last check at commit
// (Q423, step 3 of the lease): per request, never shared.
const heldStore = new AsyncLocalStorage();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
const lastSeen = d => (d && (d.renewedAt || d.lockedAt)) || 0;

// A held lock: { token, lost, stop() }. The renewal stops on release, or
// when the lock turns out not to be ours any more (lost = true).
function startRenewal(lockRef, held, renewMs) {
  const timer = setInterval(() => {
    firestore.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      if (!snap.exists || snap.get('token') !== held.token) { held.lost = true; return; }
      tx.update(lockRef, { renewedAt: Date.now() });
    }).catch(() => { /* a missed renewal is retried on the next tick; 3 missed in a row lose the lease */ })
      .then(() => { if (held.lost) clearInterval(timer); });
  }, renewMs);
  if (timer.unref) timer.unref();
  held.stop = () => clearInterval(timer);
}

// opts (the tests): { timeoutMs, staleMs, renewMs }.
async function acquireGlobalLock(actor, opts) {
  const o = Object.assign({ timeoutMs: LOCK_TIMEOUT_MS, staleMs: LOCK_STALE_MS, renewMs: LOCK_RENEW_MS }, opts || {});
  const lockRef = firestore.doc(LOCK_DOC_PATH);
  const started = Date.now();
  const deadline = started + o.timeoutMs;
  const token = randomUUID();
  let tries = 0;

  while (Date.now() < deadline) {
    tries++;
    const acquired = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const now = Date.now();
      // Held, and renewed lately: genuinely in use. Not renewed for staleMs: abandoned, taken over.
      if (snap.exists && now - lastSeen(snap.data()) < o.staleMs) return false;
      tx.set(lockRef, { lockedAt: now, renewedAt: now, lockedBy: actor || 'unknown', token });
      return true;
    });
    if (acquired) {
      perf.lockAcquired(Date.now() - started, tries);
      const held = { token, lost: false, stop: () => {} };
      startRenewal(lockRef, held, o.renewMs);
      return held;
    }
    // Jittered retry — a fixed delay would have every waiting caller
    // retry in lockstep, repeatedly colliding with each other on the
    // very next attempt too.
    await sleep(120 + Math.random() * 120);
  }
  perf.lockTimedOut(Date.now() - started, tries);
  throw new Error(BUSY_MESSAGE);
}

// Releases the lock `held` (from acquireGlobalLock), and only if it is
// still that holder's: a lock taken over meanwhile is the new holder's.
async function releaseGlobalLock(held) {
  perf.lockReleased();
  if (!held) return;
  held.stop();
  const lockRef = firestore.doc(LOCK_DOC_PATH);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (snap.exists && snap.get('token') === held.token) tx.delete(lockRef);
  });
}

// The preferred way to use this lock — acquire, run fn, release, the
// release happening even if fn throws. Every posting goes through this
// (or the LockService shim in legacy/runtime.js, which uses the same two
// functions).
async function withGlobalLock(actor, fn, opts) {
  const held = await acquireGlobalLock(actor, opts);
  try {
    return await heldStore.run(held, () => fn(held));
  } finally {
    await releaseGlobalLock(held);
  }
}

// The lock the current request holds: withGlobalLock's, or the ported
// code's LockService (legacy/runtime.js keeps it with the request).
function currentHeld() {
  return heldStore.getStore() || require('./legacy/runtime').currentLockHeld();
}

// A posting's writes, recorded ({ set, update, delete } as on a batch), to
// commit with commitFenced.
function recorder() {
  const w = { ops: [] };
  ['set', 'update', 'delete'].forEach(m => { w[m] = (...a) => { w.ops.push([m, a]); return w; }; });
  return w;
}

// THE LAST CHECK AT COMMIT (docs/modules/LOCKING.md, step 2; Q423): a
// posting's writes commit in one transaction that first reads the lock and
// checks it is still this request's (its token). A holder whose lease was
// lost meanwhile (its function frozen past the stale time, another posting
// now holding the lock) writes nothing and is told to post again, instead of
// posting alongside the new holder. Outside a held lock, a plain batch as
// before. All or nothing either way; at most 500 writes, as a batch.
async function commitFenced(ops) {
  const held = currentHeld();
  if (!held) {
    const batch = firestore.batch();
    ops.forEach(([m, a]) => batch[m](...a));
    await batch.commit();
    return;
  }
  const lockRef = firestore.doc(LOCK_DOC_PATH);
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (!snap.exists || snap.get('token') !== held.token) { held.lost = true; throw new Error(LOST_MESSAGE); }
    ops.forEach(([m, a]) => tx[m](...a));
  });
}

module.exports = { acquireGlobalLock, releaseGlobalLock, withGlobalLock, currentHeld, recorder, commitFenced,
  LOCK_DOC_PATH, LOCK_TIMEOUT_MS, LOCK_STALE_MS, LOCK_RENEW_MS, BUSY_MESSAGE, LOST_MESSAGE };
