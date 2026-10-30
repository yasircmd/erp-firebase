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
# The styles' build (tools/build-styles.sh) stubbed: it writes the two files, or fails when BUILD_FAIL is set.
cat > "$R/tools/build-styles.sh" <<'STUB'
#!/bin/bash
[ -n "$BUILD_FAIL" ] && exit 1
mkdir -p public/css && echo 'x{}' > public/css/erp.css && echo 'x{}' > public/css/ess.css
STUB
chmod +x "$R/tools/build-styles.sh"
printf 'public/css/\n' > "$R/.gitignore"
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

git -C "$R" rm -q public/GRN.html; commit "no screen"

# The public Help (docs/modules/HELP.md): its built files deploy; a screen
# put under public/help/ with another kind of name, or a nested folder, does not.
mkdir -p "$R/public/help"
for f in index.html getting-started.html help.css help.js search.json sitemap.xml; do echo x > "$R/public/help/$f"; done
echo 'User-agent: *' > "$R/public/robots.txt"; commit help
out=$(run)
ok "the built Help: deploys" "$(echo "$out" | tail -2 | tr '\n' ' ')" "ALL DONE exit=0 "
mkdir -p "$R/public/help/screens"; echo '<div>screen</div>' > "$R/public/help/screens/GRN.html"; echo x > "$R/public/help/GRN.HTML.bak"; commit "screen under help"
out=$(run)
ok "a screen under public/help/: stops before deploying" "$([ -f "$STUB_LOG" ] && echo deployed || echo none)" "none"
ok "a screen under public/help/: names both" "$(echo "$out" | grep -cE '^public/help/(screens/GRN.html|GRN.HTML.bak)$')" "2"

git -C "$R" rm -rq public/help/screens public/help/GRN.HTML.bak; commit "no screen under help"

# The installable app (docs/modules/PWA.md): the styles are built first, a failed
# build stops the deploy; the service worker, manifests and icons deploy; any
# other file beside them still stops it.
out=$(run BUILD_FAIL=1)
ok "the styles not built: stops before deploying" "$([ -f "$STUB_LOG" ] && echo deployed || echo none)" "none"
ok "the styles not built: says so" "$(echo "$out" | grep -c 'styles could not be built')" "1"
mkdir -p "$R/public/icons"
echo 'self' > "$R/public/sw.js"; echo '{}' > "$R/public/manifest.webmanifest"; echo '{}' > "$R/public/ess.webmanifest"; echo x > "$R/public/icons/erp-192.png"; commit app
out=$(run)
ok "the app's files and the built styles: deploy" "$(echo "$out" | tail -2 | tr '\n' ' ')" "ALL DONE exit=0 "
echo x > "$R/public/icons/GRN.html"; echo x > "$R/public/app.js"; commit "stray files"
out=$(run)
ok "a stray file beside the app's: stops before deploying" "$([ -f "$STUB_LOG" ] && echo deployed || echo none)" "none"
ok "a stray file beside the app's: names both" "$(echo "$out" | grep -cE '^public/(icons/GRN.html|app.js)$')" "2"

echo "$pass/$((pass+failed)) passed"; [ $failed = 0 ]
