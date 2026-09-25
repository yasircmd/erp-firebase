#!/bin/bash
# Deploys a named set of functions for new development:
#   tools/deploy-functions.sh <set>      (reads tools/deploy-sets/<set>.txt)
# One function name per line, in deploy order (blank lines and # comments
# ignored). Same rules as the migration deploys: clean working copy only,
# batches of <=6 with retries, then the public-invoker IAM binding for
# every function (2nd Gen doesn't add it). Idempotent: re-run after a
# timeout. Record the deploy in docs/DEPLOY_LOG.md afterwards.
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
SET="tools/deploy-sets/$1.txt"
[ -f "$SET" ] || { echo "usage: tools/deploy-functions.sh <set>  (no $SET)"; ls tools/deploy-sets; exit 1; }

# firebase deploy uploads the working copy, not the last commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi

mapfile -t FNS < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$SET" | grep -v '^$')
echo "Deploying ${#FNS[@]} functions from $(git log -1 --format='%h %s'):"; echo "${FNS[*]}"

fail=0
for ((i=0; i<${#FNS[@]}; i+=6)); do
  batch=("${FNS[@]:i:6}"); only=$(printf 'functions:%s,' "${batch[@]}"); only=${only%,}
  for attempt in 1 2 3; do
    firebase deploy --project $P --only "$only" && break
    [ $attempt = 3 ] && fail=1; echo "retrying batch ($attempt)..."; sleep 10
  done
done
for f in "${FNS[@]}"; do
  gcloud functions add-invoker-policy-binding $f --region=us-central1 --member=allUsers --gen2 --project=$P >/dev/null 2>&1 || { echo "IAM FAILED: $f"; fail=1; }
done
[ $fail = 0 ] && echo "ALL DONE" || echo "SOME STEPS FAILED — re-run this script"
