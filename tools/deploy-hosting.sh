#!/bin/bash
# Deploys Firebase Hosting: public/index.html, the app shell (login, menu tree,
# Home tasks, the rpc bridge). Same clean-copy rule as the other deploys, plus
# two guards: the real Firebase config, never REPLACE_ME placeholders, and
# nothing in public/ but the shell (module screens stay behind
# getModuleFragment's access check, never on Hosting; owner 2026-09-26).
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
FIREBASE=${FIREBASE:-firebase}

if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi
if grep -n REPLACE_ME public/index.html; then
  echo "STOP: public/index.html still has REPLACE_ME placeholders — put the real Firebase config in."; exit 1
fi
extra=$(find public -type f ! -path public/index.html ! -path public/README.md | sort)
if [ -n "$extra" ]; then
  echo "STOP: public/ must hold only index.html (screens go through tools/release-screens.sh):"; echo "$extra"; exit 1
fi
echo "Deploying Hosting (public/index.html) from $(git log -1 --format='%h %s')"
if $FIREBASE deploy --project "$P" --only hosting; then echo "ALL DONE"; else echo "HOSTING DEPLOY FAILED"; exit 1; fi
