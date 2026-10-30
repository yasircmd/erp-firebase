#!/bin/bash
# Deploys Firebase Hosting: public/index.html, the app shell (login, menu tree,
# Home tasks, the rpc bridge), and public/ess.html, the Employee Portal
# (docs/modules/EMPLOYEE_PORTAL.md; like the shell it holds no data). Same
# clean-copy rule as the other deploys, plus two guards: the real Firebase
# config, never REPLACE_ME placeholders, and nothing in public/ but those two
# pages (module screens stay behind getModuleFragment's access check, never
# on Hosting; owner 2026-09-26) and the public Help: public/help/ and
# public/robots.txt, built from help/pages by tools/help/build.js
# (docs/modules/HELP.md, decision 148; the Deploy workflow's "Check help"
# step refuses any file there the build did not make).
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
# The styles, built ahead of time from the shell and every screen (docs/modules/PWA.md).
tools/build-styles.sh || { echo "STOP: the styles could not be built."; exit 1; }
# Also allowed: the installable app's files (PWA.md): the service worker, the
# two manifests, their icons, and the styles just built.
extra=$(find public -type f ! -path public/index.html ! -path public/ess.html ! -path public/README.md ! -path public/robots.txt \
  ! -path public/sw.js ! -path public/manifest.webmanifest ! -path public/ess.webmanifest \
  ! -path public/css/erp.css ! -path public/css/ess.css ! -regex 'public/icons/[a-z0-9-]+\.png' \
  ! -regex 'public/help/[a-z0-9-]+\.\(html\|css\|js\|json\|xml\)' | sort)
if [ -n "$extra" ]; then
  echo "STOP: public/ must hold only index.html, ess.html, the app's service worker, manifests, icons and styles, and the built Help (screens go through tools/release-screens.sh):"; echo "$extra"; exit 1
fi
echo "Deploying Hosting (public/index.html, public/ess.html, the styles, the app files, public/help/) from $(git log -1 --format='%h %s')"
if $FIREBASE deploy --project "$P" --only hosting; then echo "ALL DONE"; else echo "HOSTING DEPLOY FAILED"; exit 1; fi
