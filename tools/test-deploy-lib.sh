#!/bin/bash
# Tests tools/deploy-lib.sh against stub firebase/gcloud commands (nothing
# reaches Google): batch sizes, retries and the parallel IAM step.
#   bash tools/test-deploy-lib.sh
cd "$(dirname "$0")/.." || exit 1
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/firebase" <<'STUB'
#!/bin/bash
echo "$*" >> "$STUB_LOG.fb"
[ -n "$FB_FAIL" ] && [[ "$*" == *"$FB_FAIL"* ]] && exit 1
exit 0
STUB
cat > "$T/gcloud" <<'STUB'
#!/bin/bash
echo "$3" >> "$STUB_LOG.iam"; sleep 0.2
[ "$3" = "$IAM_FAIL" ] && exit 1
exit 0
STUB
chmod +x "$T/firebase" "$T/gcloud"
export STUB_LOG="$T/log" RETRY_SLEEP=0
pass=0; failed=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else failed=$((failed+1)); echo "FAIL: $1 — expected [$3], got [$2]"; fi; }
fns=$(printf 'fn%02d ' $(seq 1 34))

# Runs the library in a fresh shell; prints "fail=<n>" last.
run() { env -u TMUX -u STY "$@" FIREBASE="$T/firebase" GCLOUD="$T/gcloud" bash -c '
  P=proj; source tools/deploy-lib.sh; fail=0
  deploy_batches "$0" '"$fns"'; grant_invokers '"$fns"'; echo "fail=$fail"' "${EXTRA:-}"; }
reset() { rm -f "$STUB_LOG".*; }

reset; out=$(run)
ok "outside tmux: batches of 6" "$(wc -l < "$STUB_LOG.fb")" 6
ok "last batch holds the remainder" "$(tail -1 "$STUB_LOG.fb")" "deploy --project proj --only functions:fn31,functions:fn32,functions:fn33,functions:fn34"
ok "every function bound once" "$(sort "$STUB_LOG.iam" | uniq | wc -l)/$(wc -l < "$STUB_LOG.iam")" "34/34"
ok "clean run" "$(echo "$out" | tail -1)" "fail=0"

reset; run TMUX=/tmp/x >/dev/null
ok "inside tmux: batches of 20" "$(wc -l < "$STUB_LOG.fb")" 2
reset; run STY=x BATCH=34 >/dev/null
ok "BATCH overrides" "$(wc -l < "$STUB_LOG.fb")" 1

reset; EXTRA=--force run BATCH=34 >/dev/null
ok "extra flags passed" "$(grep -c -- '--force$' "$STUB_LOG.fb")" 1

reset; out=$(run BATCH=20 FB_FAIL=fn21)
ok "failing batch tried 3 times, other batch once" "$(wc -l < "$STUB_LOG.fb")" 4
ok "failing batch sets fail" "$(echo "$out" | tail -1)" "fail=1"

reset; start=$(date +%s.%N); out=$(run IAM_FAIL=fn07)
ok "IAM failure reported by name" "$(echo "$out" | grep 'IAM FAILED')" "IAM FAILED: fn07"
ok "IAM failure sets fail" "$(echo "$out" | tail -1)" "fail=1"
# 34 calls x 0.2s: ~6.8s one at a time, ~1s 8 at a time.
ok "IAM calls run in parallel" "$(awk -v a="$start" -v b="$(date +%s.%N)" 'BEGIN{print (b-a<3)}')" 1

echo "$pass/$((pass+failed)) passed"; [ $failed = 0 ]
