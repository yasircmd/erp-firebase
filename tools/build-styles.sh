#!/bin/bash
# Builds the ERP's and the Employee Portal's styles ahead of time (owner,
# 2026-10-30; docs/modules/PWA.md, Q332): public/css/erp.css from the shell
# and every screen (their scripts' class strings too), public/css/ess.css
# from the portal, with the same Tailwind (v3) the CDN served, so a page no
# longer compiles its styles in the browser. Not committed (.gitignore): the
# Hosting deploy builds them (tools/deploy-hosting.sh), and a screens release
# builds and deploys them again (tools/release-screens.sh), so a new screen's
# classes are never missing.
#   tools/build-styles.sh
set -euo pipefail
cd "$(dirname "$0")/.."
TW="tailwindcss@3.4.17"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p public/css
cat > "$TMP/erp.config.js" <<CFG
module.exports = { content: ['$PWD/public/index.html', '$PWD/screens/*.html'] };
CFG
# The portal's dark mode is a class on <html> (public/ess.html).
cat > "$TMP/ess.config.js" <<CFG
module.exports = { darkMode: 'class', content: ['$PWD/public/ess.html'] };
CFG
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > "$TMP/input.css"
npx -y "$TW" -c "$TMP/erp.config.js" -i "$TMP/input.css" -o public/css/erp.css --minify 2>/dev/null || { echo "build-styles: building public/css/erp.css failed (is the npm registry reachable?)" >&2; exit 1; }
npx -y "$TW" -c "$TMP/ess.config.js" -i "$TMP/input.css" -o public/css/ess.css --minify 2>/dev/null || { echo "build-styles: building public/css/ess.css failed" >&2; exit 1; }
# A page whose classes all went missing would still build: refuse an empty or tiny file.
for f in public/css/erp.css public/css/ess.css; do
  [ "$(wc -c < "$f")" -gt 10000 ] || { echo "build-styles: $f is too small to be right" >&2; exit 1; }
done
echo "Built public/css/erp.css ($(wc -c < public/css/erp.css) bytes) and public/css/ess.css ($(wc -c < public/css/ess.css) bytes)."
