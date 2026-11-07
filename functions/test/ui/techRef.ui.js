// Technical Reference (owner, 2026-11-07; docs/modules/TECH_REFERENCE.md): the
// screen over a release built from this repository: the overview, a module
// followed to its function and file, a document opened and its link to
// another followed, the search across the catalogue and the documents.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/techRef.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, rtdb } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/techRef.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  await reset(baseFixture());
  await rtdb.ref('permissions/TECHREF').set({ access: ['Admin'] });
  // buildHarness releases the working copy's screens with their Technical Reference (tools/screen-release.js).
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8219);
  const browser = await chromium.launch();
  async function open(uid, refused) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8219/?module=TECHREF&uid=' + uid);
    if (refused) await page.waitForFunction(() => /LOAD FAILED/.test(document.getElementById('module-container').textContent), null, T);
    else await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }

  await check('the overview, a module to its function and file, a document and its link, the search', async () => {
    const page = await open('u-admin');
    await page.waitForFunction(() => /commit [0-9a-f]{7,}/.test(document.getElementById('tr-release').textContent), null, T);
    assert.match(await page.textContent('#tr-detail'), /functions\s*\d{3}/);
    await page.click('.tr-tab[data-tab="modules"]');
    await page.fill('#tr-filter', 'correction');
    await page.click('#tr-list [data-key="CJV"]');
    await page.waitForFunction(() => /functions\/src\/correctionJv\.js/.test(document.getElementById('tr-detail').textContent), null, T);
    assert.match(await page.textContent('#tr-detail'), /firestore:journalEntries/);
    await page.click('#tr-detail [data-go="functions"][data-key="saveCorrectionJvDraft"]');
    await page.waitForFunction(() => /Defined in\s*functions\/src\/correctionJv\.js/.test(document.getElementById('tr-detail').textContent), null, T);
    await page.click('.tr-tab[data-tab="documents"]');
    await page.click('#tr-list [data-key="README.md"]');
    await page.waitForSelector('#tr-doc a[href="docs/ROADMAP.md"]', T);
    await page.click('#tr-doc a[href="docs/ROADMAP.md"]');
    await page.waitForFunction(() => /^docs\/ROADMAP\.md/.test(document.getElementById('tr-detail').textContent.trim()), null, T);
    await page.fill('#tr-search', 'reclassify correction');
    await page.waitForFunction(() => /CORRECTION_JV|Correction JV/.test(document.getElementById('tr-detail').textContent) && /In the documents/.test(document.getElementById('tr-detail').textContent), null, T);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('lists in pages of 25, Next / Previous; the tabs readable in the light theme', async () => {
    const page = await open('u-admin');
    await page.waitForFunction(() => /commit/.test(document.getElementById('tr-release').textContent), null, T);
    await page.click('.tr-tab[data-tab="functions"]');
    await page.waitForFunction(() => document.querySelectorAll('#tr-list [data-key]').length === 25, null, T);
    assert.match(await page.textContent('#tr-page'), /^1–25 of \d{3}$/);
    assert.ok(await page.isDisabled('#tr-prev'));
    await page.click('#tr-next');
    assert.match(await page.textContent('#tr-page'), /^26–50 of /);
    await page.click('#tr-prev');
    assert.match(await page.textContent('#tr-page'), /^1–25 of /);
    await page.fill('#tr-filter', 'saveCorrectionJvDraft');
    assert.equal(await page.$$eval('#tr-list [data-key]', x => x.length), 1);
    assert.ok(await page.isHidden('#tr-pager'), 'one page: no pager');
    // Light theme: the active tab's text dark on a light background (it was light blue on white).
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const [fg, bg] = await page.$eval('.tr-tab.active', b => { const c = getComputedStyle(b); return [c.color, c.backgroundColor]; });
    // A see-through background is seen over the white page: blend it before measuring.
    const over = rgb => { const v = rgb.match(/[\d.]+/g).map(Number); const a = v.length > 3 ? v[3] : 1; return 'rgb(' + v.slice(0, 3).map(c => Math.round(c * a + 255 * (1 - a))).join(',') + ')'; };
    const lum = rgb => { const [r, g, b] = over(rgb).match(/\d+/g).map(Number).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    assert.ok(ratio >= 4.5, 'contrast ' + ratio.toFixed(2) + ' (' + fg + ' on ' + bg + ')');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('a user without the right is refused', async () => {
    const page = await open('u-viewer', true);
    assert.match(await page.textContent('#module-container'), /do not have access/);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
