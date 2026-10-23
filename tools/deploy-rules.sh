#!/bin/bash
# Deploys the security rules in database.rules.json (RTDB, with its indexes),
# firestore.rules with firestore.indexes.json (the Firestore composite indexes) and
# storage.rules (Cloud Storage: the Support attachments, MULTI_CORPORATE.md M3;
# Storage must be set up in the Firebase console first). All are deny-all: every read and write goes through a Cloud Function with
# the Admin SDK, which bypasses rules by design. RTDB was "auth != null" only
# while the Apps Script system (which read RTDB with users' own ID tokens)
# was in use; it was retired 2026-09-28. Same clean-copy rule as the other deploys.
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
FIREBASE=${FIREBASE:-firebase}

if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi
echo "Deploying database.rules.json, firestore.rules, firestore.indexes.json and storage.rules from $(git log -1 --format='%h %s'):"
cat database.rules.json
if ! $FIREBASE deploy --project "$P" --only database,firestore:rules,firestore:indexes,storage; then echo "RULES DEPLOY FAILED"; exit 1; fi
# Then every client corporate's project, its tree and the leavers
# (tools/release-corporates.js; MULTI_CORPORATE.md M4).
if FIREBASE="$FIREBASE" node tools/release-corporates.js; then echo "ALL DONE"; else echo "RELEASE TO CORPORATES FAILED"; exit 1; fi
