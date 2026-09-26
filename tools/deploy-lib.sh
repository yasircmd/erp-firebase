#!/bin/bash
# Shared steps for the deploy scripts in tools/ (sourced, not run).
#
# Batch size: the <=6 limit exists because a dropped Cloud Shell connection
# kills a long `firebase deploy`. Inside tmux or screen the deploy survives a
# disconnect, so batches default to 20 there (the CLI deploys a batch's
# functions in parallel, and every batch repeats the source upload and
# function discovery). Override either default with BATCH=N.
if [ -n "$BATCH" ]; then :
elif [ -n "$TMUX" ] || [ -n "$STY" ]; then BATCH=20
else BATCH=6; echo "(not inside tmux/screen: batches of 6 — run in 'tmux new -s deploy' for batches of 20)"
fi
FIREBASE=${FIREBASE:-firebase}
GCLOUD=${GCLOUD:-gcloud}   # FIREBASE, GCLOUD, RETRY_SLEEP: overridable for tools/test-deploy-lib.sh

# deploy_batches <extra firebase flags> fn... — sets fail=1 if a batch fails 3 times.
deploy_batches() {
  local extra=$1; shift
  local fns=("$@") n=$# i attempt batch only
  for ((i=0; i<n; i+=BATCH)); do
    batch=("${fns[@]:i:BATCH}"); only=$(printf 'functions:%s,' "${batch[@]}"); only=${only%,}
    echo "== batch $((i/BATCH+1))/$(( (n+BATCH-1)/BATCH )): ${batch[*]}"
    for attempt in 1 2 3; do
      $FIREBASE deploy --project "$P" --only "$only" $extra && break
      [ $attempt = 3 ] && fail=1; echo "retrying batch ($attempt)..."; sleep "${RETRY_SLEEP:-10}"
    done
  done
}

# grant_invokers fn... — the public-invoker binding for each, 8 at a time.
# Idempotent, so every function in the set is (re)bound: a function created
# by an earlier, interrupted run still gets its binding. Sets fail=1 on error.
grant_invokers() {
  local out
  out=$(printf '%s\n' "$@" | xargs -P 8 -I{} sh -c \
    '"$1" functions add-invoker-policy-binding "$2" --region=us-central1 --member=allUsers --gen2 --project="$3" >/dev/null 2>&1 || echo "IAM FAILED: $2"' \
    _ "$GCLOUD" {} "$P")
  [ -n "$out" ] && { echo "$out"; fail=1; }
  return 0
}
