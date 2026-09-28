#!/bin/bash
# Deploys a named set of functions for new development:
#   tools/deploy-functions.sh <set> [--screens]   (reads tools/deploy-sets/<set>.txt)
# --screens: after every batch and binding succeeded, release screens/
# (tools/release-screens.sh), so screens never go live before their functions.
# One function name per line, in deploy order (blank lines and # comments
# ignored). Same rules as the migration deploys: clean working copy only,
# batches with retries (6, or 20 inside tmux/screen: tools/deploy-lib.sh),
# then the public-invoker IAM binding for every function (2nd Gen doesn't
# add it). Idempotent: re-run after a timeout. Record the deploy in
# docs/DEPLOY_LOG.md afterwards.
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
source tools/deploy-lib.sh
SET="tools/deploy-sets/$1.txt"
[ -f "$SET" ] || { echo "usage: tools/deploy-functions.sh <set> [--screens]  (no $SET)"; ls tools/deploy-sets; exit 1; }
SCREENS=0; [ "$2" = "--screens" ] && SCREENS=1

# firebase deploy uploads the working copy, not the last commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi

mapfile -t FNS < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$SET" | grep -v '^$')
echo "Deploying ${#FNS[@]} functions from $(git log -1 --format='%h %s'):"; echo "${FNS[*]}"

fail=0
deploy_batches "" "${FNS[@]}"
grant_invokers "${FNS[@]}"
if [ $fail = 0 ] && [ $SCREENS = 1 ]; then tools/release-screens.sh || fail=1; fi
if [ $fail = 0 ]; then echo "ALL DONE"; else echo "SOME STEPS FAILED — re-run this script"; exit 1; fi
