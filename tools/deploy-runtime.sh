#!/bin/bash
# Moves every deployed function onto the runtime in functions/package.json
# "engines.node" (Node 20 is decommissioned 2026-10-30). Redeploys, in
# batches (see tools/deploy-lib.sh), only the functions whose live runtime differs, so it is
# idempotent: re-run after a timeout and it picks up where it stopped.
# Existing functions keep their public-invoker IAM binding across a redeploy.
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
source tools/deploy-lib.sh
WANT="nodejs$(node -p 'require("./functions/package.json").engines.node')"

# firebase deploy uploads the working copy, not the last commit.
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: working copy not clean — commit or 'git stash push -u' first:"; git status --short; exit 1
fi

todo=()
while IFS=$'\t' read -r name runtime; do
  [ "$runtime" != "$WANT" ] && todo+=("$name")
done < <(gcloud functions list --project=$P --regions=us-central1 --format="value(name.basename(),buildConfig.runtime)")
if [ ${#todo[@]} -eq 0 ]; then echo "All functions already on $WANT."; exit 0; fi
echo "Redeploying ${#todo[@]} functions onto $WANT from $(git log -1 --format='%h %s')"

fail=0
deploy_batches --force "${todo[@]}"
if [ $fail = 0 ]; then echo "ALL DONE"; else echo "SOME STEPS FAILED — re-run this script"; exit 1; fi
