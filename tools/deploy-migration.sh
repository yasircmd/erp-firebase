#!/bin/bash
# Deploys every committed-but-not-yet-deployed generated-port function
# (from tools/legacy-port/status.js --pending, so this file never needs
# editing between batches), plus the hand-ported helpers those screens
# call, in batches (see tools/deploy-lib.sh), then grants public invoker to each.
# Idempotent: re-run after a timeout. Afterwards, add the modules to
# tools/legacy-port/deployed.json and run: node tools/legacy-port/status.js
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
source tools/deploy-lib.sh

# firebase deploy uploads the working copy, not the last commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi

# Hand-ported functions (functions/src/*.js, not the generated port): the helpers
# the stock/production/purchasing screens call on load, plus reverseGrn (GRN
# reversal guards, deviation #15). Harmless to redeploy if already live; required if not.
HAND=(getActiveItems getActiveUOMs getActiveOrgUnits getActiveVendors getModulePermissionsForUser getMyPendingApprovalLevel
      getJournalEntryDetail getStockLedgerEntryPublic updatePostedDescription reverseGrn)
read -r -a PENDING <<< "$(node tools/legacy-port/status.js --pending)"
FNS=("${PENDING[@]}" "${HAND[@]}")
if [ ${#PENDING[@]} -eq 0 ]; then echo "Nothing pending in tools/legacy-port/status.js."; exit 0; fi
echo "Deploying ${#FNS[@]} functions from $(git log -1 --format='%h %s'):"; echo "${FNS[*]}"

fail=0
deploy_batches "" "${FNS[@]}"
grant_invokers "${FNS[@]}"
if [ $fail = 0 ]; then echo "ALL DONE"; else echo "SOME STEPS FAILED — re-run this script"; exit 1; fi
