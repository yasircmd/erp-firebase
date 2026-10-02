// Master Data Import screen (owner, 2026-10-02; docs/modules/MASTER_IMPORT.md):
// choose a master, copy its headers, paste rows, check (issues listed by
// row and column, the row highlighted, Import held back), fix, import.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/masterImport.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8156);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8156/?module=MASTERIMPORT&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#mimp-master option').length > 9, null, { timeout: 30000 });

  await check('the list is in import order; choosing one shows its columns and copies its headers', async () => {
    const options = await page.$$eval('#mimp-master option', os => os.map(o => o.textContent).filter(t => t !== 'Select...'));
    assert.deepEqual(options, ['1. Company', '2. Organizational Units', '3. Chart of Accounts', '4. Unit of Measure', '5. Item Sub-Category',
      '6. Items', '7. Vendors', '8. Customers', '9. Currencies']);
    await page.selectOption('#mimp-master', 'UOM');
    assert.deepEqual(await page.$$eval('#mimp-columns tr td:first-child', tds => tds.map(t => t.textContent)), ['Code', 'Name', 'Allow Decimals', 'Decimal Places']);
    await page.click('#mimp-copy-headers');
    await page.waitForFunction(() => /Copied/.test(document.getElementById('mimp-copy-headers').textContent));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Code\tName\tAllow Decimals\tDecimal Places');
  });

  await check('a paste with issues: listed by row and column, the row highlighted, Import held back', async () => {
    await page.fill('#mimp-paste', 'Code\tName\tAllow Decimals\tDecimal Places\nPCS\tPieces 2\tNo\t\nKG\tKilogram\tYes\t3');
    await page.click('#mimp-check');
    await page.waitForSelector('#mimp-issues-wrap:not(.hidden)', { timeout: 20000 });
    assert.deepEqual(await page.$$eval('#mimp-issues li', lis => lis.map(l => l.textContent)), ['Row 1 · Code: UOM code "PCS" is already in use.']);
    assert.ok(await page.$eval('#mimp-preview-body tr[data-row="1"]', tr => tr.className.includes('bg-red')));
    assert.ok(!(await page.$eval('#mimp-preview-body tr[data-row="2"]', tr => tr.className.includes('bg-red'))));
    assert.ok(await page.$eval('#mimp-import', b => b.disabled), 'Import stays off');
  });

  await check('fixed and checked again, it imports; the confirmation is in-app', async () => {
    await page.fill('#mimp-paste', 'Code\tName\tAllow Decimals\tDecimal Places\nBOX\tBox\tNo\t\nKG\tKilogram\tYes\t3');
    await page.click('#mimp-check');
    await page.waitForFunction(() => !document.getElementById('mimp-import').disabled, null, { timeout: 20000 });
    assert.match(await page.textContent('#mimp-status'), /2 rows checked, no issues/);
    await page.click('#mimp-import');
    await page.waitForFunction(() => /imported/.test(document.getElementById('mimp-status').textContent), null, { timeout: 20000 });
    assert.equal(await page.textContent('#mimp-status'), '2 Unit of Measure records imported.');
    assert.deepEqual(page.__dialogs, ['Import 2 rows into Unit of Measure?']);
    const codes = Object.values(await val('uoms')).map(u => u.Code).sort();
    assert.deepEqual(codes, ['BOX', 'KG', 'PCS']);
    assert.deepEqual(page.__errors, []);
  });

  await check('editing the paste after a clean check holds Import back until checked again', async () => {
    await page.fill('#mimp-paste', 'Code\tName\nDZ\tDozen');
    await page.click('#mimp-check');
    await page.waitForFunction(() => !document.getElementById('mimp-import').disabled, null, { timeout: 20000 });
    await page.fill('#mimp-paste', 'Code\tName\nDZ\tDozens');
    assert.ok(await page.$eval('#mimp-import', b => b.disabled));
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
