# The posting lock: correctness first, then throughput

Status: **decisions made** (owner, 2026-11-07, Q423-Q426); building in steps (below).
CLAUDE.md: "The global lock (lock.js) is deliberately whole-system ... Don't
'improve' this without discussing it first." This is that discussion.

## The note raised (2026-11-07)

1. **One lock per corporate serialises every posting.** A waiting request
   gives up after 10 seconds ("Could not acquire lock — please try
   again."). With many users, or a busy retail counter during a payroll
   run, users will see it.
2. **A lock can be taken over while it is still in use.** After 30 seconds a
   lock is presumed abandoned. A long posting still running at that point
   then runs alongside another one, which risks double posting or wrong
   balances.

## What the code shows (checked 2026-11-07)

- **Confirmed: one lock per corporate.** `system/globalLock` sits in the
  corporate's own Firestore, so corporates don't wait on each other. Every
  posting of one corporate does, across every company, module and user.
  The ported code's `LockService` (legacy/runtime.js) is the same lock.
  37 files take it.
- **Confirmed: a 10 s wait.** The caller retries every 120-240 ms for up to
  10 s, then gives up.
- **Confirmed: a 30 s takeover, with no check that the holder is gone.**
  The holder never renews the lock while it works. So any posting that runs
  longer than 30 s can be overtaken while it is still running. Some work
  runs that long, because these calls may run for minutes:
  - posting Opening Balances: up to 540 s, one batch under one lock;
  - the depreciation run: one company's period under one lock;
  - Period Closing: up to 120 s;
  - a payroll run's post: one run under one lock.
- **Found in addition, and worse: the release deletes the lock whoever
  holds it.** If B takes over A's "stale" lock, then A finishes and deletes
  the lock document, B's lock is gone. A third posting C can then start
  while B is still running. So one slow posting can lead to three running
  at once.
- **What is not at risk:**
  - each posting's own writes are atomic (`stockPosting.postStock`, one
    Firestore batch: all or nothing);
  - a number is never used twice (numbering is a transaction).

  The risk is in the *checks* made before the batch: stock on hand, an
  invoice's open amount, an allocation's balance, "already reversed".
  Two postings can each pass them against the same balance.
- **Already measured.** Every call logs its lock wait and hold
  (`perf.js`: `lockWaitMs`, `lockHeldMs`, `lockTries`;
  docs/modules/PERFORMANCE.md, P1). Cloud Logging shows today's real
  contention, so the throughput step can be sized from facts, not guesses.

## The options

### A. Make the lock correct (needed at any scale)

1. **A lease, renewed while working.** The holder renews the lock every
   10 s while its work runs. A lock is "abandoned" only when it hasn't been
   renewed for 30 s: the holder crashed, or its function was stopped. A long
   posting is then never overtaken while it is alive.
2. **An owner token.** Each acquire writes its own token. Release deletes
   the lock only if the token is still its own, in a transaction, so it can
   never free someone else's lock.
3. **A last check at commit.** The posting batch also writes the lock
   document, guarded by the version it last saw. If the lease was lost (the
   holder was stopped and another took over), the batch fails and nothing is
   posted, instead of posting twice.

This keeps the whole-corporate lock exactly as it is, so nothing about
throughput changes yet. It removes the double-posting risk.

### B. Keep long jobs from blocking everyone

The long work (opening balances, the depreciation run, a payroll post)
holds the one lock for its whole run. During that time the retail counter
and every other user wait, and give up after 10 s. Two ways out:

- **Per document.** A long job takes the lock once per document (per
  asset, per batch of lines, per employee group) instead of once for the
  whole run. Each hold is short, so other postings fit in between. The
  job's own steps are already resumable: recurring runs work this way
  today (`postRecurringJournalRuns` takes the lock per run).
- **A longer wait.** For example 30 s instead of 10 s, with a "Busy,
  retrying…" message. This hides short queues, not long holds.

### C. Let postings that can't conflict run in parallel (only if measured)

- **Per company.** Each company's books are separate: its numbering, its
  documents and its periods. Postings of different companies could then
  run at once. This needs an audit of what companies share, which today
  includes:
  - shared accounts (no running balance, so safe);
  - shared items and warehouses: the stock ledger per item and warehouse
    is not per company, so not safe as is;
  - shared parties.
- **Per resource** (per item and warehouse, per party): the most
  parallel, and the riskiest. It needs every posting to declare what it
  touches, so it is not worth it at today's volume.

## Recommended

A now, as one change. B for the known long jobs. C only when the logs show
real waits that A and B don't cure. The lock stays one per corporate until
then, as CLAUDE.md wants.

## The owner's decisions (2026-11-07)

| # | Question | Decision |
|---|---|---|
| Q423 | Fix the lock's correctness now | **Yes:** a lease renewed while working, an owner token on release, and a last check in the posting batch. |
| Q424 | Long jobs (opening balances, the depreciation run, payroll post) | **One lock per document**, not one for the whole run; the jobs resumable, as recurring runs are. |
| Q425 | The lock's scope | **One per corporate, for now.** Decide on per company from the logs (lock waits over 500 ms) after steps 1-3. |
| Q426 | The wait | **20 s**, then "The system is busy posting; please try again in a moment." |

## Build plan

1. **lock.js** (Q423 parts 1-2, Q426):
   - the lease renewed every 10 s while the work runs;
   - taken over only after 30 s without a renewal;
   - an owner token on every acquire, and a release that deletes only its
     own lock, in a transaction;
   - the 20 s wait and the new message.

   Every caller is unchanged: the shim in legacy/runtime.js and
   `withGlobalLock` are the same functions. Tests:
   - emulator: a posting held past 30 s is not overtaken while renewed;
   - a dead holder is taken over after 30 s;
   - a late release doesn't free the new holder's lock;
   - each with a negative control.
2. **The last check at commit** (Q423 part 3): `stockPosting.postStock`
   and the other batch commits also write the lock document, guarded by its
   last version (Firestore's `lastUpdateTime` precondition). A holder that
   lost its lease then fails without posting.
3. **Long jobs per document** (Q424): opening balances, the depreciation
   run and the payroll post, each resumable.
4. **Measure** (Q425): read the logged lock waits; decide on per company.

## As built: step 1, the lease (2026-11-07)

- **lock.js:**
  - `acquireGlobalLock` writes `{ lockedAt, renewedAt, lockedBy, token }`
    (a new UUID per acquire) and returns the held lock;
  - the holder renews `renewedAt` every 10 s in a transaction. It stops
    on release, or when the lock turns out to be someone else's;
  - a lock is taken over only when `renewedAt` (or, for a lock written
    before this, `lockedAt`) is 30 s old;
  - `releaseGlobalLock(held)` deletes the lock in a transaction, only if
    its token is still the holder's;
  - the wait is 20 s, then "The system is busy posting; please try again
    in a moment." (`BUSY_MESSAGE`);
  - `withGlobalLock` is unchanged for its callers.
- **legacy/runtime.js** (the ported code's LockService shim, hand-written,
  not generated): it keeps the held lock with the request (or with the lock
  object outside one) and releases only that. It stays re-entrant as
  before.
- **Tests:** emulator/lock, 5 tests with short timings:
  - a holder working past the stale time keeps the lock while it renews,
    and the next waits;
  - a dead holder is taken over;
  - a late release leaves the next holder's lock, and a third still waits;
  - the 20 s wait and the message;
  - the shim releases only its own.

  unit/perf and emulator/perf follow the new shape and message.
  Negative controls, each caught and restored:
  - no renewal (test 1 fails);
  - a release that deletes whatever lock is there, as before (tests 3
    and 5 fail).
- **Results:** the full emulator regression, 803 passed, 0 failed (22 chunks); unit 240/240.
- **Still to do:** step 2 (the last check at commit), step 4 (measure). Step 3 below.

## As built: step 3, long jobs (2026-11-07)

- **The depreciation run** (fixedAssetsDepreciation.js) takes the lock per
  step, where it was held for the whole run:
  - starting or resuming the run;
  - each chunk of 200 assets;
  - the GL entry.

  Each chunk checks under its own lock that the run is still Posting and
  the chunk not yet written. So a second Post of the same run, or a resume,
  never writes a chunk twice. The GL step returns the posted result if
  another Post finished it, and refuses a run not fully written. Between
  steps, other postings go on. The company's other asset postings still
  wait for the run, because they refuse while `RunInProgress` is set, as
  before.
- **The payroll post** (payrollPost.js): the run's context and its
  journal's lines are worked out before the lock. Under it, the run is
  checked again (still Approved; `UpdatedAt` and `SubmittedAt` unchanged)
  and the journal and payslips are written. The payslips stay inside the
  lock, because Payroll Payment reads them as the posted state.
- **Opening balances: not split, a deviation from Q424 put to the owner.**
  An opening batch is checked again under the lock against duplicates and
  posted whole. Split, a failure would leave a half-posted opening batch,
  which is harder to reverse. It also runs once per company, at go-live,
  before users post. Since step 1 the lease keeps it safe however long it
  takes.
- **Tests:** emulator/lockLongJobs, a run of 230 assets interrupted after
  its first chunk. On resume that chunk is skipped, every asset is
  depreciated once, there is one GL entry, a second Post finds it posted,
  and a JV posts too. Negative control: without the per-chunk check under
  the lock, the first 200 assets are depreciated twice (the test fails);
  restored.

  The emulator serves one function's calls one at a time, so a true race
  of two Posts, and the payroll post's re-check under the lock, can't be
  reproduced there. Those checks are in place, but not demonstrated by a
  failing control.
- **Results:** emulator payroll (9 suites), fixedAssets, fixedAssetsCwip,
  lock and lockLongJobs: 71 passed, 0 failed; unit 240/240.
- **Deploy:** `lock-step3`, 14 functions.
