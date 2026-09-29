#!/bin/bash
# Tests tools/deploy-hosting.sh in a throwaway git copy, against a stub
# firebase command (nothing reaches Google): its three guards, and the deploy.
#   bash tools/test-deploy-hosting.sh
cd "$(dirname "$0")/.." || exit 1
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/firebase" <<'STUB'
#!/bin/bash
echo "$*" >> "$STUB_LOG"
[ -n "$FB_FAIL" ] && exit 1
exit 0
STUB
chmod +x "$T/firebase"
export STUB_LOG="$T/log"
pass=0; failed=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else failed=$((failed+1)); echo "FAIL: $1 — expected [$3], got [$2]"; fi; }

R="$T/repo"; mkdir -p "$R/tools" "$R/public"
cp tools/deploy-hosting.sh "$R/tools/"
echo '<script>const firebaseConfig = { apiKey: "real" };</script>' > "$R/public/index.html"
echo '# public/' > "$R/public/README.md"
git -C "$R" init -q && git -C "$R" -c user.name=t -c user.email=t@t add -A && git -C "$R" -c user.name=t -c user.email=t@t commit -qm init
run() { rm -f "$STUB_LOG"; env "$@" FIREBASE="$T/firebase" bash "$R/tools/deploy-hosting.sh" 2>&1; echo "exit=$?"; }
commit() { git -C "$R" -c user.name=t -c user.email=t@t add -A && git -C "$R" -c user.name=t -c user.email=t@t commit -qm "$1"; }

out=$(run)
ok "clean copy: deploys Hosting only" "$(cat "$STUB_LOG")" "deploy --project erp1-8f4cd --only hosting"
ok "clean copy: succeeds" "$(echo "$out" | tail -2 | tr '\n' ' ')" "ALL DONE exit=0 "

out=$(run FB_FAIL=1)
ok "a failed deploy exits non-zero" "$(echo "$out" | tail -2 | tr '\n' ' ')" "HOSTING DEPLOY FAILED exit=1 "

echo '<!-- edit -->' >> "$R/public/index.html"
out=$(run)
ok "dirty copy: stops before deploying" "$([ -f "$STUB_LOG" ] && echo deployed || echo none)" "none"
ok "dirty copy: exits non-zero" "$(echo "$out" | tail -1)" "exit=1"
git -C "$R" checkout -q -- public/index.html

sed -i 's/"real"/"REPLACE_ME"/' "$R/public/index.html"; commit placeholder
out=$(run)
ok "placeholders: stops before deploying" "$([ -f "$STUB_LOG" ] && echo deployed || echo none)" "none"
ok "placeholders: says why" "$(echo "$out" | grep -c 'REPLACE_ME placeholders')" "1"
sed -i 's/"REPLACE_ME"/"real"/' "$R/public/index.html"; commit real

echo '<div>screen</div>' > "$R/public/GRN.html"; commit screen
out=$(run)
ok "a screen in public/: stops before deploying" "$([ -f "$STUB_LOG" ] && echo deployed || echo none)" "none"
ok "a screen in public/: names it" "$(echo "$out" | grep -c '^public/GRN.html$')" "1"

echo "$pass/$((pass+failed)) passed"; [ $failed = 0 ]
