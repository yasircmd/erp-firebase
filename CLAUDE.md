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
- **Changing a ported module:** its existing behavior, including the
  quirks listed in docs/MIGRATION.md, was deliberately kept as in Apps
  Script. Change it only when asked, or for a real bug. Record any
  behavior change in the module's doc or the roadmap.
- **Tests:** every new or changed function needs tests before it's
  considered done, including at least one verified negative control
  (deliberately break the logic, confirm a test catches it, then restore).
- **Shared logic** is in functions/src/{glWriting,stockMovement,
  commitAttempt,approvals,lock,reservations}.js. Check these before
  writing new logic that might already exist there.
- **The global lock** (lock.js) is deliberately whole-system, not
  per-item, matching the original LockService. Don't "improve" this
  without discussing it first.
- **Keep docs/ROADMAP.md current** after every finished step, then commit
  and push, so a fresh session can continue from GitHub. Record every
  deploy in docs/DEPLOY_LOG.md.

## Deployment facts learned the hard way — don't rediscover these
- RTDB auth: the Apps Script Code.gs used a REAL user ID token for RTDB
  (firebaseDbRequest_) but IAM/OAuth for Firestore (firestoreRequest_).
  These have different Security Rules implications. Confirm the current
  database.rules.json state before ever touching RTDB rules again.
- Every onCall Cloud Function needs an explicit public-invoker IAM binding
  after deploy (2nd Gen quirk, not automatic):
  gcloud functions add-invoker-policy-binding FUNCTION_NAME --region=us-central1 --member=allUsers --gen2
- Deploy from a clean checkout only (`git status --porcelain` empty), in
  batches of ≤6 functions. Details: README → Deploying.
- Firebase config in public/index.html must be the REAL values, not
  REPLACE_ME placeholders. Verify with: grep REPLACE_ME public/index.html
  (should return nothing).
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
