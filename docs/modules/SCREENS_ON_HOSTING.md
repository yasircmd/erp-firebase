# Screens released without a function deploy

**Status:** deployed 2026-09-26 ([DEPLOY_LOG.md](../DEPLOY_LOG.md)) · **Roadmap:** follow-up "Design: serve screens from Hosting" ([ROADMAP.md](../ROADMAP.md))

(File name kept from the first draft, which proposed serving screens from Hosting.)

## Purpose

Make a screen-only change (a label, a layout fix, a client-side check)
quick to release. Today every screen is bundled into the
`getModuleFragment` function, so changing one line of HTML means
redeploying a function.

## Owner decisions (2026-09-26)

| # | Question | Decision |
|---|---|---|
| 1 | A: public screen files on Hosting; B: keep the sign-in and access check, move the files out of the function; C: not now | **B.** Screen code stays downloadable only by a signed-in user whose role has access to that module, exactly as today |
| 2 | Where `canWrite` comes from | Agreed, but not needed under B: `getModuleFragment` keeps returning it |
| 3 | Keep `no-cache` so a fix shows on the next open | Agreed. Under B it becomes: a release shows on the next screen open (see "Releases") |
| 4 | Keep the old function one week for tabs opened earlier | Agreed, but not needed under B: the shell and the function's reply don't change, so open tabs keep working |
| 5 | Switch all screens at once | **Yes**, all 50 in one release |
| 6 | Where the screens are kept: Firestore or Cloud Storage? Option B was first described with Cloud Storage | **Firestore.** The project has no Storage bucket yet (only Google's internal function-source buckets). Storage would add a bucket, storage rules and the Storage emulator in tests. Firestore is already set up: its rules block every direct browser read or write (`firestore.rules`), the tests already use its emulator, and the largest screen (GRN, 97 KB) is far under its 1 MB limit per record. Either way, users see no difference |
| 7 | How many past releases to keep for rollback | **The last 10.** Older ones are deleted by the release script, never the active one |

## What existed before (from the code)

- **Screens:** 50 files in `functions/modules/<ID>.html`, 1.9 MB in all,
  named after their `MODULE_REGISTRY` id. Each one is HTML plus an inline
  `<script>` that defines `window.initModule(token, canWrite)`.
- **`getModuleFragment`** (`functions/src/getModuleFragment.js`, ported
  from Code.gs): signed-in user → module must be in `MODULE_REGISTRY` →
  the user's role must have the `access` capability for it → reads the
  file from its own deploy package → returns `{ html, canWrite }`.
  `canWrite` = the module has `write` in the registry **and** the role
  has `write` in the permissions table (RTDB).
- **The shell** (`public/index.html`, `openModule`) calls it, injects the
  HTML and calls `initModule(null, canWrite)`. **Under B the shell
  doesn't change.**
- **Written by tools:** `tools/build-soa-screens.js` (SOA screens) and
  `tools/legacy-port/generate.js` + `check-shell-deps.js` (ported
  screens) write to or read `functions/modules/`.
- **Tests:** `stockModules.emulator.test.js` calls `getModuleFragment`;
  every UI check's harness loads screens through it. The emulator suites
  wipe the emulator database.
- **Deploy order rule:** `getModuleFragment` goes last in a deploy set,
  so a new screen can't go live before the functions it calls.

## What it saves

- **Screen-only fixes:** one script run that writes 50 Firestore records
  and takes seconds, instead of a function deploy. This is the case the
  design is for.
- **Screen + server changes** (most new modules): little saved. The
  functions still deploy, then the screens are released.
- **History:** none of the last 40 commits that touched
  `functions/modules/` changed only screens. The saving shows up as
  changes become UI tweaks from users.
- **For users:** no change. Screens open as today, plus one small
  Firestore read, and the check still runs on every open.
- **Adding a module** still needs a function deploy until the separate
  "lists out of the code" item is done (the registry is in the code).

## Design

**Files:** `functions/modules/*.html` → `screens/<ID>.html` at the repo
root (git move, contents unchanged). They're outside `functions/`, so
they're no longer bundled into every function, and outside `public/`,
so Hosting never publishes them. `functions/modules/README.md` moves
with them and is rewritten.

**Firestore layout** (the Admin SDK only; the rules keep blocking
browsers):
- `screenReleases/{releaseId}`: `{ commit, createdAt, createdBy, count }`
- `screenReleases/{releaseId}/screens/{ID}`: `{ html, sha256 }`
- `system/screens`: `{ activeRelease }`, the release every user gets (next to `system/globalLock`)

`releaseId` = UTC time plus the git commit, for example
`20260926T103015Z-4063763`, so the list sorts by date.

**Releases** (`tools/release-screens.sh`, with the logic in
`tools/screen-release.js` so tests can call it):
1. Refuses to run unless the working copy is clean, as for deploys.
2. Checks that every `MODULE_REGISTRY` id has a screen file and that no
   screen contains `google.script.run`.
3. Writes the new release: every screen, its hash, then the release
   record.
4. Reads the release back and compares each hash. Stops on any mismatch
   and leaves the active release as it was.
5. Points `system/screens.activeRelease` at it. This one write switches
   every user at once, so no one sees half a release.
6. Deletes releases beyond the last 10 (question 7), never the active
   one.
- `--list` shows the releases (active marked). `--rollback <releaseId>`
  points back to an earlier one, which is a single write.
- `compare` (2026-10-02) checks each screen's stored hash against
  `screens/`. It lists screens that changed, are new, or were removed,
  and exits 3 if any differ.
  - The Deploy workflow runs it after a "functions set" without screens,
    and shows a "Screens not released" warning on the run when they
    differ.
  - It was added because runs #40 and #43 deployed functions whose
    screens then stayed old until a separate "screens only" run.

**`getModuleFragment`** (behavior change, recorded here and in the
roadmap): the same checks in the same order with the same error
messages. Only where the HTML comes from changes:
1. Signed in, known module, `access` capability: unchanged, and done
   **before** anything is read, so a refused user never gets screen
   content.
2. Reads `system/screens` (one small read per open, so a release or
   rollback shows on the next open).
3. Takes the screen from an in-memory cache, or reads it from
   `screenReleases/{active}/screens/{ID}` and caches it. The cache is
   dropped whenever the active release changes, and a release never
   changes after it's written, so the cache is never stale.
4. No active release, or no screen for this id: the same message as
   today's missing file, "Module "X" has no fragment file yet."
5. Returns `{ html, canWrite }` exactly as today.

**Switch-over order** (no gap for users). This order matters: the new
function finds no screens until a release exists.
1. `tools/release-screens.sh`. The live function still reads its bundled
   files and ignores Firestore, so nothing changes for users yet.
2. Deploy the new `getModuleFragment`. From then on it serves the
   release, which has the same contents.
3. Open a few screens in the app, then record both steps in the deploy
   log.

**Deploy rule after the switch:** functions first, then
`tools/release-screens.sh`, so a screen can't go live before its
functions. That's the same rule as "getModuleFragment last", in a new
form. `tools/deploy-functions.sh` gets an optional `--screens` flag that
runs the release after the last batch and bindings succeed.

**Tools:** `build-soa-screens.js`, `legacy-port/generate.js` and
`check-shell-deps.js` get the new path. They're tooling, not
`functions/src/legacy/`, and the generated screens stay byte-identical.

## Tests

- **Emulator, `getModuleFragment`:**
  - serves the active release's screen, with `canWrite` as today
  - after a new release, the next call serves the new content, and
    after a rollback the old content, even with a warm cache
  - no access: refused, and no screen is read
  - unknown module, not signed in, no active release, missing screen:
    today's messages
- **Emulator, release script logic:**
  - a release with a missing screen or `google.script.run` is refused
  - a hash mismatch leaves the active release unchanged
  - only the last 10 releases are kept, and the active one is never
    deleted
  - the script refuses to run against production unless `--project`
    is given
- **Setup:** the suites wipe the database. Releasing after every wipe
  would add about 1.5 minutes to the full run (127 resets × 0.7 s), so
  only what opens screens releases them: the UI harness
  (`buildHarness.js`) before each UI check, the new suite, and the one
  `getModuleFragment` test in `stockModules`. The UI checks then load
  screens exactly as production does.
- **Negative controls (all run, all caught, all restored):**
  - access check moved after the screen read: "no access is refused
    before any screen is looked up" failed
  - cache never dropped on a release change: "a new release, then a
    rollback…" failed
  - pointer flipped before verification: "a release that fails
    verification…" failed
  - pruning allowed to delete the active release: "keeps the last 10…"
    failed
- **Results (2026-09-26):** the new suite 8/8. Full emulator run 213/213.
  Smoke 101/101, dynamic toggle 2/2, stock screens 12/12, party payments
  3/3, and purchase return, sales return and statements 4/4 each.
- **Not covered by automated tests:** `tools/release-screens.sh` (a test
  would write to production) and the `--screens` option of
  `deploy-functions.sh`. Both are a few lines around the tested release
  logic. The first production release is their check.

## Change 2026-09-27: read-back in groups

Three production releases in a row failed with `DEADLINE_EXCEEDED`
(5 minutes): every screen was written, but the single verify query
reading all 59 back (~2 MB) stalled on a slow Cloud Shell link, so the
pointer never moved (users unaffected; the attempts are listed as
INCOMPLETE and pruned later). `tools/screen-release.js` now reads the
screens back 10 at a time with `getAll`, each group limited to 60 s and
tried up to 3 times, plus an ids-only query for the count (an
unexpected extra screen still fails verification). It prints progress
(`written n/59`, `verified n/59`). Same checks, same pointer rule. Tests:
two new in the screenRelease suite (10/10), negative controls on the
count check and the retry.

## Not in scope

- Moving the module, approval and voucher-type lists out of the code
  (the separate roadmap item that saves most on new-module deploys).
- Any change to screen contents, permissions, the shell or Hosting.
