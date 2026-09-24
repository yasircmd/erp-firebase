#!/bin/bash
# Deploys the generated-port batch 1 (UOM, ITEMSUBCAT, ORGUNITS, COMPANYMASTER,
# CURRENCYCONFIG) in batches of <=6 functions, then grants public invoker to each.
# Idempotent: unchanged functions are skipped; re-run after a timeout.
cd "$(dirname "$0")/.." || exit 1
P=erp1-8f4cd
FNS=(getModuleFragment getUOMs saveUOM deactivateUOM reactivateUOM getItemSubCategories
     saveItemSubCategory deactivateItemSubCategory reactivateItemSubCategory getOrgUnits saveOrgUnit deactivateOrgUnit
     reactivateOrgUnit getCompanies saveCompany deactivateCompany reactivateCompany getChartOfAccounts
     getCurrencies saveCurrency deactivateCurrency reactivateCurrency)
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
