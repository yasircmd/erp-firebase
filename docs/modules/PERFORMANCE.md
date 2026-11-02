# Speed: waiting to open a module or after posting

Raised 2026-11-02 (owner): in busy hours there is "more waiting to load a
module or after posting an entry". The owner is not sure whether users see
the lock's message ("Could not acquire lock — please try again").

## What the code shows (2026-11-02)

No production figures were available (this needs Google Cloud's logs), so
these are the likely causes, read from the code:

1. **Cold starts (opening a module).** Each of the ~640 functions is its own
   Cloud Run service with no minimum instances. After about 15 idle minutes
   it stops, and the next call starts it again. Every start loaded the whole
   codebase (150 of our modules, including the 570 KB generated port), though
   a function needs only its own: about 290 ms against 150 ms for one module
   here, warm; more on Cloud Run's start, from a cold disk. Opening a screen
   calls several functions, any of which may be cold.
2. **The global lock (after posting).** lock.js: one lock per corporate (each
   corporate has its own Firestore), shared by all of its companies and all
   125 posting paths, held for the whole posting. Others wait, retrying every
   120-240 ms, up to 10 s, then get the message above. Kept whole-system on
   purpose (CLAUDE.md): changing it needs data and a discussion first.
3. **Distance.** Everything is in us-central1; from the Gulf or India each
   call costs roughly a 250 ms round trip. Moving region means a new
   project: not proposed.

## The plan (owner, 2026-11-02: "Go ahead")

- **P1 Timings:** one log line per call, to find from data which of these
  it is. Built 2026-11-02.
- **P2 Lazy loading:** a function's instance loads only its own module.
  Free; shortens every cold start. Built 2026-11-02.
- **After about a week of P1's figures, decide:**
  - **P3 The lock:** per company, or less work while it is held (checks
    and reads before taking it): only if the figures show waits.
  - **P4 Warm instances** (minimum instances 1) for the busiest functions:
    only if cold starts still matter after P2. Roughly $5-10 a month per
    function (check Google's pricing).

## As built: P1, timings (2026-11-02)

- functions/src/perf.js. callable.js times every callable (`perf.timed`),
  from before its corporate is found to its answer. lock.js reports each
  acquire (wait, tries), release (held time) and timeout to it.
- One JSON line per call to the function's log (stdout, so Cloud Logging
  reads it as fields): `message: "perf"`, `fn`, `ms`, `ok`, `cold` (the
  first call this instance served), `corporate`; on a cold call `loadMs`
  (from the instance starting to that call) and `lazy` (P2 took effect);
  when it took the lock, `locks`, `lockWaitMs`, `lockHeldMs`, `lockTries`;
  `lockTimeout: true` when it gave up waiting (the message above).
- No user data in it (no names, no amounts), only the corporate's id.
- Not logged in the emulators (FUNCTIONS_EMULATOR), unless ERP_PERF_LOG=1.
- A failure to log never fails the call.
- **Reading them:** Google Cloud console → Logging → Logs Explorer, project
  erp1-8f4cd (and a client corporate's own project for its calls), query:
  - all: `jsonPayload.message="perf"`
  - slow calls: `jsonPayload.message="perf" AND jsonPayload.ms>3000`
  - cold starts: `jsonPayload.message="perf" AND jsonPayload.cold=true`
  - lock waits: `jsonPayload.message="perf" AND jsonPayload.lockWaitMs>500`
  - lock timeouts: `jsonPayload.message="perf" AND jsonPayload.lockTimeout=true`
- These are Logs Explorer queries, not shell commands. In Cloud Shell, run
  one through `gcloud logging read` (single quotes around the query), e.g.
  the cold starts of the last day:
  `gcloud logging read 'jsonPayload.message="perf" AND jsonPayload.cold=true' --freshness=1d --limit=30 --format='table(timestamp, jsonPayload.fn, jsonPayload.ms, jsonPayload.loadMs, jsonPayload.lazy)'`
- Tests: unit/perf (4: the line, cold then warm, the lock's figures, a
  timeout's wait, concurrent calls kept apart, emulator silence, a log
  failure), emulator/perf (2: two postings with the real lock, the second
  waiting; a timeout on a held lock).

## As built: P2, lazy loading (2026-11-02)

- tools/build-lazy-exports.js loads index.js and maps each exported
  function to the module under functions/src that exports the very same
  function object (640 of 640). It writes functions/lazy-exports.json.
- It runs at every functions deploy: firebase.json `functions.predeploy`,
  so the map is built from the very source being uploaded and is never out
  of date. The file is not committed (.gitignore), so the clean-checkout
  check is unaffected.
- index.js, at the top: only in a deployed instance (FUNCTION_TARGET and
  K_SERVICE set, not the emulators), it loads the map and exports only
  that function, from its own module. Everywhere else (the Firebase CLI
  reading the list of functions, the emulators, tests), or without the map,
  or for a function not in it, everything loads as before.
- getModuleFragment's instance now loads 7 of our modules instead of 150;
  a generated-port function loads the port, and only that.
- Full regression (2026-11-02): 747 passed, 1 failed (essPortal "who is away
  today", date-dependent, fails on main too); unit 220 of 220.
- Tests: unit/lazyExports (4: every function mapped to the same object; a
  deployed instance loads only its own; the CLI, emulators, no map and an
  unmapped function load everything; the predeploy and .gitignore).
- After the deploy, the cold lines' `lazy: true` confirms it took effect.

## Negative controls (2026-11-02)

Each made, caught, then restored:
- lock.js not reporting its acquire: unit/perf and emulator/perf fail.
- the lazy path without its K_SERVICE guard (it would have shown the CLI
  one function): unit/lazyExports fails.
- a timed-out call's wait dropped from its line: unit/perf and
  emulator/perf fail. (This was a real bug, found by the first test run.)

## Live (2026-11-02)

Deployed 2026-11-02, run #274 (12:11-14:23 UTC, every function, 107
batches, no errors; the predeploy mapped 640 of 640 each time). To confirm
P2 in production: a cold line shows `lazy: true`
(`jsonPayload.message="perf" AND jsonPayload.cold=true`). The figures for
P3 and P4 are read about a week later (from 2026-11-09).

## Deploy

Every function (`perf-p1`), from Cloud Shell inside tmux (README →
Deploying, "Which way"). No screens, no rules, no Hosting.
