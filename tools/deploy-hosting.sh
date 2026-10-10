#!/bin/bash
# Deploys Firebase Hosting: public/index.html, the app shell (login, menu tree,
# Home tasks, the rpc bridge), and public/ess.html, the Employee Portal
# (docs/modules/EMPLOYEE_PORTAL.md; like the shell it holds no data). Same
# clean-copy rule as the other deploys, plus two guards: the real Firebase
# config, never REPLACE_ME placeholders, and nothing in public/ but those two
# pages (module screens stay behind getModuleFragment's access check, never
# on Hosting; owner 2026-09-26).
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
FIREBASE=${FIREBASE:-firebase}

if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi
for page in public/index.html public/ess.html; do
  if grep -n REPLACE_ME "$page"; then
    echo "STOP: $page still has REPLACE_ME placeholders — put the real Firebase config in."; exit 1
  fi
done
extra=$(find public -type f ! -path public/index.html ! -path public/ess.html ! -path public/README.md | sort)
if [ -n "$extra" ]; then
  echo "STOP: public/ must hold only index.html and ess.html (screens go through tools/release-screens.sh):"; echo "$extra"; exit 1
fi
echo "Deploying Hosting (public/index.html, public/ess.html) from $(git log -1 --format='%h %s')"
if $FIREBASE deploy --project "$P" --only hosting; then echo "ALL DONE"; else echo "HOSTING DEPLOY FAILED"; exit 1; fi
