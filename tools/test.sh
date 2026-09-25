#!/bin/bash
# One-command test runner against the local emulators (README → Testing).
#
#   tools/test.sh                 quick: only what this branch changed vs origin/main
#   tools/test.sh NAME...         quick: named suites / screens, e.g.
#                                   tools/test.sh purchaseReturn PURCHASERETURN
#                                 (camelCase = emulator suite, plus its *.ui.js if
#                                  one exists; UPPERCASE = smoke-load that screen)
#   tools/test.sh full            everything, split to fit Cloud Shell's memory
#   tools/test.sh --plan [NAME...]  show what a quick run would test, run nothing
#
# It (re)starts the emulators itself, since they don't hot-reload, and runs
# from this checkout. Only one run at a time: a second tab's run waits for
# the first. The suites WIPE the emulator database.
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
P=erp1-8f4cd
LOGDIR=$(mktemp -d "${TMPDIR:-/tmp}/erp-test.XXXX")
SUMMARY=()
FAILED=0
START=$SECONDS
PLAN=0; [ "$1" = --plan ] && { PLAN=1; shift; }

guard_emulators() {
  # Shared by every checkout and tab on this machine: the emulator ports are fixed.
  exec 9>"${TMPDIR:-/tmp}/erp-emulators.lock"
  if ! flock -n 9; then echo "Another test run holds the emulators; waiting..."; flock 9; fi
  
  # Emulators started by hand (or by an older script) in a different checkout
  # belong to someone else's run: don't kill them.
  for pid in $(pgrep -f '[e]mulators:start'); do
    cwd=$(readlink "/proc/$pid/cwd")
    if [ "$cwd" != "$ROOT" ]; then
      echo "STOP: emulators are running from $cwd (pid $pid), not this checkout."
      echo "Wait for that run to finish, or stop them: pkill -f '[e]mulators:start'"; exit 1
    fi
  done
}
[ $PLAN = 1 ] || guard_emulators

restart_emulators() {
  pkill -f '[e]mulators:start'; pkill -f '[f]unctionsEmulatorRuntime'
  timeout 30 bash -c 'while pgrep -f "[e]mulators:start" >/dev/null; do sleep 1; done'
  local log="$LOGDIR/emulators-$SECONDS.log"
  # 9>&-: the emulators outlive this run and must not inherit its lock.
  nohup firebase emulators:start --only auth,database,firestore,functions --project $P > "$log" 2>&1 9>&- &
  if ! timeout 180 bash -c "until grep -q 'All emulators ready' '$log'; do sleep 2; done"; then
    echo "STOP: emulators did not start. Log: $log"; tail -20 "$log"; exit 1
  fi
  echo "== emulators ready ($((SECONDS - START))s)"
}

run_suites() {  # emulator suite files
  [ $# -eq 0 ] && return
  local log="$LOGDIR/suites-$SECONDS.log"
  echo "== ${#@} suite(s): $(basename -a "$@" | sed 's/.emulator.test.js//' | tr '\n' ' ')"
  node --test --test-concurrency=1 --test-reporter=spec "$@" 2>&1 | tee "$log" | grep -E '^\s*✖|^ℹ (tests|pass|fail)'
  local pass fail
  pass=$(grep -oP '^ℹ pass \K\d+' "$log"); fail=$(grep -oP '^ℹ fail \K\d+' "$log")
  SUMMARY+=("suites ($(basename -a "$@" | sed 's/.emulator.test.js//' | tr '\n' ' ' | cut -c1-60)): ${pass:-0} pass, ${fail:-?} fail")
  [ "${fail:-1}" = 0 ] || { FAILED=1; SUMMARY+=("   full output: $log"); }
}

run_ui() {  # UI script name + args
  local name=$1; shift
  local log="$LOGDIR/ui-$name-$SECONDS.log"
  echo "== UI $name $*"
  node "functions/test/ui/$name.ui.js" "$@" > "$log" 2>&1; local rc=$?
  grep -E '^FAIL|HARNESS ERROR|passed$' "$log"
  SUMMARY+=("UI $name: $(grep -E 'passed$' "$log" | tail -1 || echo 'no result')")
  [ $rc = 0 ] && ! grep -q '^FAIL' "$log" || { FAILED=1; SUMMARY+=("   full output: $log"); }
}

suite_file() { local f="functions/test/emulator/$1.emulator.test.js"; [ -f "$f" ] && echo "$f"; }
has_ui() { [ -f "functions/test/ui/$1.ui.js" ] && [[ ! $1 =~ ^(smoke|dynamicToggle|buildHarness)$ ]]; }

finish() {
  echo; echo "==== SUMMARY ($(( (SECONDS - START) / 60 ))m $(( (SECONDS - START) % 60 ))s)"
  printf '%s\n' "${SUMMARY[@]}"
  [ $FAILED = 0 ] && echo "ALL PASSED" || echo "SOME TESTS FAILED"
  exit $FAILED
}

if [ "$1" = full ]; then
  mapfile -t ALL < <(ls functions/test/emulator/*.emulator.test.js)
  half=$(( (${#ALL[@]} + 1) / 2 ))
  # The functions emulator never frees a worker (~100 MB each), so the suite
  # runs in two halves and each UI stage gets a fresh emulator.
  restart_emulators; run_suites "${ALL[@]:0:half}"
  restart_emulators; run_suites "${ALL[@]:half}"
  # Smoke and dynamic toggle need seeded data; partyPayments.ui needs exactly
  # the fixture the partyPayments suite leaves behind.
  restart_emulators; run_suites "$(suite_file partyPayments)"
  run_ui smoke; run_ui dynamicToggle; run_ui partyPayments
  restart_emulators
  for f in functions/test/ui/*.ui.js; do
    n=$(basename "$f" .ui.js)
    [ "$n" = partyPayments ] && continue
    has_ui "$n" && [ -n "$(suite_file "$n")" ] && { run_suites "$(suite_file "$n")"; run_ui "$n"; }
  done
  finish
fi

# ---- quick mode
SUITES=(); SCREENS=(); SHARED=()
add_suite() {  # fails only when there is no such suite
  suite_file "$1" >/dev/null || return 1
  [[ " ${SUITES[*]} " =~ " $1 " ]] || SUITES+=("$1")
}
add_screen() { [[ " ${SCREENS[*]} " =~ " $1 " ]] || SCREENS+=("$1"); }
if [ $# -gt 0 ]; then
  for n in "$@"; do
    if [[ $n =~ ^[A-Z0-9_]+$ ]]; then
      [ -f "functions/modules/$n.html" ] || { echo "STOP: no screen functions/modules/$n.html"; exit 1; }
      add_screen "$n"
    elif ! add_suite "$n"; then echo "STOP: no suite functions/test/emulator/$n.emulator.test.js"; exit 1; fi
  done
else
  base=$(git merge-base HEAD origin/main)
  while read -r f; do
    case "$f" in
      functions/test/emulator/_helpers.js) SHARED+=("$f") ;;
      functions/test/emulator/*.emulator.test.js) add_suite "$(basename "$f" .emulator.test.js)" ;;
      functions/test/ui/*.ui.js) n=$(basename "$f" .ui.js); has_ui "$n" && add_suite "$n" || SHARED+=("$f") ;;
      functions/modules/*.html) add_screen "$(basename "$f" .html)" ;;
      functions/src/glWriting.js|functions/src/stockMovement.js|functions/src/commitAttempt.js|functions/src/approvals.js|functions/src/lock.js|functions/src/reservations.js|functions/src/legacy/*|functions/index.js|functions/package*.json|public/*)
        SHARED+=("$f") ;;
      functions/src/*.js) add_suite "$(basename "$f" .js)" || SHARED+=("$f") ;;
    esac
  done < <( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
fi

if [ ${#SUITES[@]} -eq 0 ] && [ ${#SCREENS[@]} -eq 0 ]; then
  echo "Nothing module-specific changed${SHARED:+ (shared code did: ${SHARED[*]})}."
  echo "Run: tools/test.sh full"; exit 0
fi
echo "Quick run: suites [${SUITES[*]}] screens [${SCREENS[*]}]${SHARED:+ (shared code changed: ${SHARED[*]})}"
[ $PLAN = 1 ] && exit 0
restart_emulators
# Smoke needs some seeded data; any suite leaves it.
[ ${#SUITES[@]} -eq 0 ] && add_suite runtime
for s in "${SUITES[@]}"; do run_suites "$(suite_file "$s")"; has_ui "$s" && run_ui "$s"; done
[ ${#SCREENS[@]} -gt 0 ] && run_ui smoke "${SCREENS[@]}"
if [ ${#SHARED[@]} -gt 0 ]; then
  SUMMARY+=("NOTE: shared code changed (${SHARED[*]}): run 'tools/test.sh full' before committing")
fi
finish
