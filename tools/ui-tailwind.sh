#!/bin/bash
# The Tailwind styles for the UI checks where cdn.tailwindcss.com is blocked
# (the cloud test container): built from npm with the same Tailwind (v3) the
# CDN serves, from the classes the pages use. Without them the checks of
# sizes, hover and hidden-on-small-screens fail for want of styles.
#   eval "$(tools/ui-tailwind.sh)"     # sets UI_TAILWIND_CSS and ESS_TAILWIND_CSS
#   node functions/test/ui/home.ui.js
# Optional: tools/ui-tailwind.sh <output directory> (default /tmp/ui-tailwind).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/ui-tailwind}"
TW="tailwindcss@3.4.17"
mkdir -p "$OUT"

# The ERP: the shell and every screen (their scripts' class strings too), as
# public/index.html loads the CDN with no config.
cat > "$OUT/erp.config.js" <<EOF
module.exports = { content: ['$REPO/public/index.html', '$REPO/screens/*.html'] };
EOF
# The Employee Portal sets darkMode: 'class' (public/ess.html).
cat > "$OUT/ess.config.js" <<EOF
module.exports = { darkMode: 'class', content: ['$REPO/public/ess.html'] };
EOF
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > "$OUT/input.css"

npx -y "$TW" -c "$OUT/erp.config.js" -i "$OUT/input.css" -o "$OUT/erp.css" >&2 2>/dev/null || { echo "ui-tailwind: building the ERP styles failed (is the npm registry reachable?)" >&2; exit 1; }
npx -y "$TW" -c "$OUT/ess.config.js" -i "$OUT/input.css" -o "$OUT/ess.css" >&2 2>/dev/null || { echo "ui-tailwind: building the portal styles failed" >&2; exit 1; }

echo "export UI_TAILWIND_CSS=$OUT/erp.css"
echo "export ESS_TAILWIND_CSS=$OUT/ess.css"
