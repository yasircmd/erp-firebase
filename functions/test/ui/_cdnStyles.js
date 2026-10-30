// The styles the shell takes from CDNs, for a UI check: Tailwind
// (cdn.tailwindcss.com) and Font Awesome (cdnjs). Where those are blocked
// (the cloud test container), set UI_TAILWIND_CSS (built by
// tools/ui-tailwind.sh): Tailwind comes from that file and each icon gets a
// 1em box, the size it takes on screen, so a button holding only an icon is
// not 0 px tall. _essPage.js does the same for the Employee Portal with
// ESS_TAILWIND_CSS.
const fs = require('fs');

// The shell now links /css/erp.css, built ahead of time (tools/build-styles.sh;
// docs/modules/PWA.md): from UI_TAILWIND_CSS, else the repository's built file.
const BUILT = require('path').join(__dirname, '../../../public/css/erp.css');
const cssFile = process.env.UI_TAILWIND_CSS || (fs.existsSync(BUILT) ? BUILT : '');
const css = cssFile ? fs.readFileSync(cssFile, 'utf8') : null;
const ICONS = '.fa,.fa-solid,.fa-regular,.fa-brands,.fas,.far,.fab{display:inline-block;width:1em;height:1em;line-height:1}';
const FA_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/';

// The Tailwind script's stand-in: the styles in a <style>, and window.tailwind
// for a page that sets tailwind.config.
const tailwindStub = () => 'window.tailwind = {}; (function () { const s = document.createElement("style"); s.textContent = ' + JSON.stringify(css) + '; document.head.appendChild(s); })();';
const inline = text => '<style>' + text.replace(/<\/style/gi, '<\\/style') + '</style>';

// What buildHarness.js puts in its <head>.
const harnessHead = () => css
  ? inline(css) + '\n' + inline(ICONS)
  : '<script src="https://cdn.tailwindcss.com"></script>\n<link href="' + FA_URL + '6.0.0/css/all.min.css" rel="stylesheet">';

// For a page or a browser context that loads the real shell.
async function routeCdnStyles(target) {
  await target.route('https://cdn.tailwindcss.com/**', async route => {
    if (css) return route.fulfill({ contentType: 'application/javascript', body: tailwindStub() });
    try { await route.fulfill({ response: await route.fetch() }); } catch (e) {
      throw new Error('the Tailwind CDN is unreachable: eval "$(tools/ui-tailwind.sh)" first');
    }
  });
  await target.route('**/css/erp.css', route => {
    if (!css) throw new Error('no built styles: run tools/build-styles.sh (or eval "$(tools/ui-tailwind.sh)")');
    return route.fulfill({ contentType: 'text/css', body: css });
  });
  if (css) await target.route(FA_URL + '**', route => route.fulfill({ contentType: 'text/css', body: ICONS }));
}

module.exports = { harnessHead, routeCdnStyles };
