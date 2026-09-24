const { firestore } = require('./firebaseAdmin');

// Replaces LockService.getScriptLock() — GAS's own script-wide mutex,
// used throughout Code.gs to serialize every commit-posting function
// against every other one (JV, Stock Adjustment, Vendor Invoice, all
// of them share this single lock today — see the grep this file's
// own commit message/PR, if any, cites). Kept GLOBAL here too,
// deliberately: this migration's job is to reproduce today's actual
// behavior faithfully, not to introduce finer-grained (per-item,
// per-module) locking as a bonus while also changing everything else.
// That's a legitimate future optimization, but bundling it into an
// already high-stakes migration is its own risk, worth taking on
// separately once this simpler, faithful port is proven stable.
//
// Firestore transactions are what make this safe under real
// concurrency — a transaction's own read-then-write is atomic against
// every other transaction touching the same document, which is
// exactly the guarantee a mutex needs. Two Cloud Function instances
// racing to acquire the lock will have exactly one succeed and one
// retry, never both believing they hold it.
const LOCK_DOC_PATH = 'system/globalLock';
const LOCK_TIMEOUT_MS = 10000; // mirrors lock.waitLock(10000) exactly
// A Cloud Function that crashes or times out mid-commit, still
// holding the lock, has no equivalent of GAS's own script-execution-
// ending auto-release — a Firestore lock document has no such
// guarantee. Without a staleness fallback, one crashed function would
// permanently deadlock every future commit, forever, since nothing
// would ever delete that lock document again. A lock older than this
// is presumed abandoned and can be taken over.
const LOCK_STALE_MS = 30000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function acquireGlobalLock(actor) {
  const lockRef = firestore.doc(LOCK_DOC_PATH);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const acquired = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const now = Date.now();
      if (snap.exists) {
        const data = snap.data();
        const lockedAt = data && data.lockedAt || 0;
        if (now - lockedAt < LOCK_STALE_MS) {
          return false; // still genuinely held, and not stale
        }
        // Stale — treat as abandoned, take over below.
      }
      tx.set(lockRef, { lockedAt: now, lockedBy: actor || 'unknown' });
      return true;
    });
    if (acquired) return;
    // Jittered retry — a fixed delay would have every waiting caller
    // retry in lockstep, repeatedly colliding with each other on the
    // very next attempt too.
    await sleep(120 + Math.random() * 120);
  }
  throw new Error('Could not acquire lock — please try again.');
}

async function releaseGlobalLock() {
  await firestore.doc(LOCK_DOC_PATH).delete();
}

// The preferred way to use this lock — acquire, run fn, release,
// release happening even if fn throws. Every existing GAS-era
// try { ... } finally { lock.releaseLock(); } block ported to Cloud
// Functions should become withGlobalLock(actor, async () => { ... }),
// not manual acquire/release calls: a forgotten release() (a real risk
// with 15+ commit functions eventually needing this) leaks the lock
// for the full LOCK_STALE_MS on every single failure, not just
// unhandled ones — this wrapper makes that mistake structurally
// impossible rather than relying on every future port remembering the
// same finally block.
async function withGlobalLock(actor, fn) {
  await acquireGlobalLock(actor);
  try {
    return await fn();
  } finally {
    await releaseGlobalLock();
  }
}

module.exports = { acquireGlobalLock, releaseGlobalLock, withGlobalLock, LOCK_DOC_PATH, LOCK_TIMEOUT_MS, LOCK_STALE_MS };
