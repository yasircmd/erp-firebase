# ERP on Firebase — Project Instructions

A multi-company ERP on native Firebase (Cloud Functions, Hosting,
Firestore/RTDB), migrated from Google Apps Script. The migration finished
2026-09-25. The project is now in **new development**. Read these every
session:
- README.md: how the system is laid out, tested and deployed.
- docs/ROADMAP.md: what's being built, each module's status, and
  pending decisions.

docs/MIGRATION.md is the frozen migration record (deviations from Code.gs,
preserved quirks). Read it when touching a ported module.

## Standing conventions, non-negotiable
- **Design before code.** A new module starts as docs/modules/<MODULE>.md.
  Its open questions are the owner's business decisions: ask, don't guess,
  and don't start coding until the owner has agreed the design.
- **New code is hand-written.** It goes in functions/src/<module>.js, with
  grn.js as the model. Never edit functions/src/legacy/ (codegs.js,
  callables.js): it's regenerated from Code.gs by tools/legacy-port/.
  The ported modules' screens (screens/<ID>.html for the modules in
  tools/legacy-port/modules.json, e.g. VENDORMASTER, STOCKVALUATION) are
  generated too: change them through SCREEN_EDITS in
  tools/legacy-port/generate.js, never by hand (run #133 failed on that).
- **Changing a ported module:** its existing behavior, including the
  quirks listed in docs/MIGRATION.md, was deliberately kept as in Apps
  Script. Change it only when asked, or for a real bug. Record any
  behavior change in the module's doc or the roadmap.
- **Tests:** every new or changed function needs tests before it's
  considered done, including at least one verified negative control
  (deliberately break the logic, confirm a test catches it, then restore).
- **No browser popups** (owner, 2026-09-29). Messages, confirmations
  and questions use the shell's in-app dialogs: `appAlert(msg)`,
  `await appConfirm(msg)`, `await appPrompt(msg, default)` (null on
  Cancel). Never `confirm()` / `prompt()`: the Deploy workflow refuses
  them (functions/test/unit/noBrowserDialogs.test.js). `alert()` is
  routed in-app by the shell, but write `appAlert` in new code. UI tests
  answer dialogs with test/ui/_appDialogs.js. Details:
  docs/modules/APP_DIALOGS.md.
- **Dates show dd/mm/yyyy, periods Sep-2026** (owner, 2026-09-29). Store
  and send yyyy-mm-dd (yyyy-mm); the shell's DATE FORMAT block formats
  every date shown, printed, alerted or copied to Excel. So write dates
  as yyyy-mm-dd in screens and never format them yourself
  (toLocaleDateString etc.); for a time use `window.isoLocalDateTime(d)`.
  Date entry fields keep the browser picker. An element that must show
  the stored form gets class `keep-iso`. The Deploy workflow checks it
  (functions/test/unit/dateFormat.test.js). Details:
  docs/modules/DATE_FORMAT.md.
- **Shared logic** is in functions/src/{glWriting,stockMovement,
  stockPosting,approvals,lock,reservations}.js. Check these before
  writing new logic that might already exist there.
- **Transaction documents are in Firestore** (docs/modules/
  TRANSACTIONS_FIRESTORE.md, T1–T5): reach them through their store
  (stockStore, salesStore, purchaseStore, jobStore, approvalStore, all on
  docStore.js) or by their old RTDB path through movedPaths.js, never
  `rtdb.ref` on a moved path. Read with an equality query, not the whole
  collection (unit/stockReads and unit/movedReads check it). A posting is
  one `stockPosting.postStock` batch: its GL entry, its documents and
  everything it changes.
- **One request, one corporate** (docs/modules/MULTI_CORPORATE.md, M1).
  Every function runs in its request's corporate: a callable through
  callable.js (`onCallWithMessages` / `onCallInCorporate`, never `onCall`),
  anything else inside `runInCorporate`. Take `rtdb`, `firestore` and
  `admin.auth()` from firebaseAdmin.js; they reach the current corporate's
  project. Keep no data in module scope: it would be shared between
  corporates. Use `firebaseAdmin.firm` (the firm's own project) only for
  what the firm keeps (the directory, the screens release), never a
  corporate's data. unit/corporateContext checks all of this. Which
  modules a corporate has is entitlements.js (M2): check a module through
  `moduleHasCapability`, which refuses one the corporate does not have.
- **The global lock** (lock.js) is deliberately whole-system, not
  per-item, matching the original LockService. Don't "improve" this
  without discussing it first.
- **Help follows every change** (owner, 2026-10-12). The public Help is
  built from help/pages/*.md into public/help/. A change to a module's
  screen, or to a file its page names, means updating that page (or
  confirming nothing in it changes), then `node tools/help/stamp.js
  <page>`, which also rebuilds. A new module goes into an area in
  help/areas.json. The Deploy workflow refuses otherwise
  (functions/test/unit/help.test.js). Help is public: made-up examples,
  never real names, accounts or figures. Details: docs/modules/HELP.md.
  **And always** (owner, 2026-10-16): every change users will see adds a
  dated entry, newest first, to help/pages/whats-new.md ("What's new", in
  Getting started), in the same PR, linking to the screen's page; then
  stamp it.
- **Keep docs/ROADMAP.md current** after every finished step, then commit
  and push, so a fresh session can continue from GitHub. Record every
  deploy in docs/DEPLOY_LOG.md.

## Deployment facts learned the hard way — don't rediscover these
- Security rules are deny-all on both RTDB and Firestore: every read and
  write goes through a Cloud Function with the Admin SDK. RTDB was
  `auth != null` only while the Apps Script system (which read RTDB with
  users' own ID tokens) was in use. It was retired 2026-09-28 (owner).
  Deploy rules with tools/deploy-rules.sh (or the Deploy workflow's
  "database rules" task). Never open a path to clients as a shortcut for
  something a Cloud Function should do.
- Every onCall Cloud Function needs an explicit public-invoker IAM binding
  after deploy (2nd Gen quirk, not automatic):
  gcloud functions add-invoker-policy-binding FUNCTION_NAME --region=us-central1 --member=allUsers --gen2
- Deploy from a clean checkout only (`git status --porcelain` empty),
  inside tmux: batches of 20 there, 6 outside (the old limit, from Cloud
  Shell connection timeouts). Details: README → Deploying.
- **A change to functions/src/moduleRegistry.js (or auth.js) reaches every
  function**: auth.js seeds the default permissions from it, and
  getModuleFragment and the legacy port check module ids against it. Its
  deploy set is then all functions, not the require closure of the rest of
  the change (wave 3 missed 175 and Tree Management refused
  "Unknown module: PROJECTREPORT", 2026-10-17).
- **An RTDB query needs its index deployed first.** Read by Status
  through functions/src/rtdbStatus.js only. Each path there has
  `.indexOn` in database.rules.json, and without it the database refuses
  the query ("Index not defined"). So the rules deploy goes before the
  functions that query.
- Screens (screens/*.html) go live with tools/release-screens.sh, not a
  function deploy. Functions first, then the release (or
  deploy-functions.sh <set> --screens). Never put screens in public/:
  they stay behind getModuleFragment's access check (owner, 2026-09-26).
- Firebase config in public/index.html must be the REAL values, not
  REPLACE_ME placeholders. Verify with: grep REPLACE_ME public/index.html
  (should return nothing). tools/deploy-hosting.sh (the Deploy workflow's
  "hosting" task) checks this before deploying Hosting.
- Watch for duplicate project copies outside ~/erp-firebase/: a prior
  double-unzip caused a wrong-directory deploy. Always confirm `pwd` before
  git or firebase commands if anything behaves unexpectedly.
- Functions runtime is Node 24 (engines.node); all live functions moved
  2026-09-25. After a future engines.node bump, run tools/deploy-runtime.sh
  from a clean worktree.

## Testing
Real-package tests against the local Firebase emulators, one suite per
module in functions/test/emulator/ plus UI checks in functions/test/ui/.
Commands, the emulator memory caveat and the no-hot-reload caveat are in
README → Testing.
