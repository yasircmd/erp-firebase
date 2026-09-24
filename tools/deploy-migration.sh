#!/bin/bash
# Deploys every committed-but-not-yet-deployed generated-port function
# (from tools/legacy-port/status.js --pending, so this file never needs
# editing between batches), plus the hand-ported helpers those screens
# call, in batches of <=6, then grants public invoker to each.
# Idempotent: re-run after a timeout. Afterwards, add the modules to
# tools/legacy-port/deployed.json and run: node tools/legacy-port/status.js
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd

# firebase deploy uploads the working copy, not the last commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi

# Hand-ported helpers (functions/src/masterData.js) the stock/production screens
# call on load. Harmless to redeploy if already live; required if not.
HAND=(getActiveItems getActiveUOMs getActiveOrgUnits getModulePermissionsForUser getMyPendingApprovalLevel
      getJournalEntryDetail getStockLedgerEntryPublic updatePostedDescription)
read -r -a PENDING <<< "$(node tools/legacy-port/status.js --pending)"
FNS=("${PENDING[@]}" "${HAND[@]}")
if [ ${#PENDING[@]} -eq 0 ]; then echo "Nothing pending in tools/legacy-port/status.js."; exit 0; fi
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
