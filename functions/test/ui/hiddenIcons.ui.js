// A hidden icon stays hidden (owner, 2026-11-03: Cash and Bank showed all
// five transaction-type ticks). In the live app Font Awesome's stylesheet
// loads after css/erp.css and gives its icons display: inline-block, which
// beat Tailwind's .hidden on <i class="hidden fa-solid ...">. The UI harness
// forces .hidden with !important, so the screens' suites could not see it:
// this check rebuilds the live order (erp.css, Font Awesome's display rule,
// then the page's own <style>) for the ERP shell and the Employee Portal.
//   node functions/test/ui/hiddenIcons.ui.js
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const root = path.join(__dirname, '../../..');
const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
// The first <style> block of the page (the one after the Font Awesome link).
const firstStyle = file => { const s = fs.readFileSync(path.join(root, 'public', file), 'utf8'); return s.slice(s.indexOf('<style>') + 7, s.indexOf('</style>')); };

(async () => {
  const browser = await chromium.launch();
  for (const [file, css] of [['index.html', 'erp.css'], ['ess.html', 'ess.css']]) {
    await check(file + ': a hidden Font Awesome icon is not shown; shown once .hidden is removed', async () => {
      const page = await browser.newPage();
      const tw = fs.existsSync(path.join(root, 'public/css', css)) ? fs.readFileSync(path.join(root, 'public/css', css), 'utf8') : '.hidden{display:none}';
      await page.setContent('<style>' + tw + '</style>' +
        '<style>.fa,.fa-solid,.fa-regular,.fa-brands{display:var(--fa-display,inline-block)}</style>' + // Font Awesome 6, loaded after
        '<style>' + firstStyle(file) + '</style>' +
        '<button class="cbt-type-btn"><i id="tick" class="cbt-type-check hidden fa-solid fa-circle-check"></i>Cash Receipt</button>');
      const display = () => page.evaluate(() => getComputedStyle(document.getElementById('tick')).display);
      assert.equal(await display(), 'none', 'hidden');
      await page.evaluate(() => document.getElementById('tick').classList.remove('hidden'));
      assert.equal(await display(), 'inline-block', 'shown when chosen');
      await page.close();
    });
  }
  await browser.close();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
