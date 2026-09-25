# ERP Firebase Migration — Project Instructions

This project ports a Google Apps Script + Firebase ERP system to native
Firebase (Cloud Functions, Hosting, Firestore/RTDB). Full status, what's
ported, what's deliberately not, and design rationale: see README.md —
read it first, every session.

## Standing conventions, non-negotiable
- Port faithfully unless a bug genuinely corrupts data (rare — see README's
  live-bug section for the one confirmed case). Preserve pre-existing quirks
  that are merely odd, not broken; disclose them in comments, don't silently
  "improve" them.
- Every ported function needs tests before being considered done — including
  at least one verified negative control (deliberately break the logic,
  confirm the test catches it, then restore).
- Shared logic goes in functions/src/{glWriting,stockMovement,commitAttempt,
  approvals,lock,reservations}.js — check these before writing new logic
  that might already exist there.
- The global lock (lock.js) is deliberately whole-system scope, not
  per-item — matches original LockService behavior, don't "improve" this
  without discussing it first.

## Deployment facts learned the hard way — don't rediscover these
- RTDB auth: current Code.gs uses a REAL user ID token for RTDB
  (firebaseDbRequest_) but IAM/OAuth for Firestore (firestoreRequest_) —
  these have different Security Rules implications. Confirm current
  database.rules.json state before ever touching RTDB rules again.
- Every onCall Cloud Function needs an explicit public-invoker IAM binding
  after deploy (2nd Gen quirk, not automatic):
  gcloud functions add-invoker-policy-binding FUNCTION_NAME --region=us-central1 --member=allUsers --gen2
- Firebase config in public/index.html must be the REAL values, not
  REPLACE_ME placeholders — verify with: grep REPLACE_ME public/index.html
  (should return nothing)
- Watch for duplicate project copies outside ~/erp-firebase/ — a prior
  double-unzip caused a wrong-directory deploy. Always confirm `pwd` before
  git or firebase commands if anything behaves unexpectedly.
- Functions runtime is Node 24 (engines.node), and all live functions moved
  2026-09-25. After a future engines.node bump, run tools/deploy-runtime.sh
  from a clean worktree.

## Testing
Real-package tests against the local Firebase emulators, one suite per
module in functions/test/emulator/ plus UI checks in functions/test/ui/.
Commands and the emulator memory caveat: README's "To continue with the
next modules", step 3. The old stub-based tests are history (see README's
Testing approach section).
