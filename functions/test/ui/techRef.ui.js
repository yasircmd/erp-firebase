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
