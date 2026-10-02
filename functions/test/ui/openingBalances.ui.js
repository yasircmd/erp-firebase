// Opening Balances screen (owner, 2026-10-02; docs/modules/OPENING_BALANCES.md):
// set up the opening date and clearing account, paste a tab, check
// (issues by row and column, Post held back), fix, post (confirmed
// in-app), see the clearing balance and the batch, reverse it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/openingBalances.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.coa['A-OBC'] = { AccountCode: '3900', AccountName: 'Opening Balance Clearing', AccountType: 'Equity', Status: 'Active', IsPostable: true };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8159);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8159/?module=OPENINGBALANCES&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });

  await check('one company: chosen for the user; setup saved; the tabs appear', async () => {
    await page.waitForFunction(() => document.getElementById('ob-company').value === 'C1' && document.querySelectorAll('#ob-clearing option').length > 1, null, { timeout: 20000 });
    assert.ok(await page.$eval('#ob-work', e => e.classList.contains('hidden')), 'no tabs before the setup');
    assert.deepEqual(await page.$$eval('#ob-clearing option', os => os.map(o => o.textContent)), ['Select...', '3000 — Capital', '3900 — Opening Balance Clearing']);
    await page.fill('#ob-date', '2025-12-31');
    await page.selectOption('#ob-clearing', 'A-OBC');
    await page.click('#ob-save-setup');
    await page.waitForSelector('#ob-work:not(.hidden)', { timeout: 20000 });
    const saved = await val('openingBalances/settings/C1');
    assert.deepEqual([saved.OpeningDate, saved.ClearingAccountID], ['2025-12-31', 'A-OBC']);
    assert.deepEqual(await page.$$eval('.ob-tab', bs => bs.map(b => b.textContent)), ['GL opening balances', 'Opening stock', 'Open invoices and advances']);
    assert.match(await page.textContent('#ob-clearing-status'), /0\.00 — no batch posted/);
  });

  await check('a paste with issues: listed by row and column, Post held back', async () => {
    await page.fill('#ob-paste', 'Account\tDebit\tCredit\n1000\t500\t\n2000\t\t100');
    await page.click('#ob-check');
    await page.waitForSelector('#ob-issues-wrap:not(.hidden)', { timeout: 20000 });
    assert.deepEqual(await page.$$eval('#ob-issues li', lis => lis.map(l => l.textContent)),
      ['Row 2 · Account: 2000 is a vendor\'s Trade Payables account — it comes from the Open Invoices tab.']);
    assert.ok(await page.$eval('#ob-post', b => b.disabled));
  });

  await check('fixed, it posts (confirmed in-app); clearing and the batch shown; setup locked', async () => {
    await page.fill('#ob-paste', 'Account\tDebit\tCredit\n1000\t500\t\n3000\t\t100');
    await page.click('#ob-check');
    await page.waitForFunction(() => !document.getElementById('ob-post').disabled, null, { timeout: 20000 });
    assert.match(await page.textContent('#ob-status'), /2 rows checked, no issues\. Debits 500\.00, credits 100\.00; 400\.00 to clearing \(credit\)\./);
    await page.click('#ob-post');
    await page.waitForFunction(() => /posted:/.test(document.getElementById('ob-status').textContent), null, { timeout: 20000 });
    // (The message as the screen sends it; the shell shows the date as 31/12/2025.)
    assert.equal(page.__dialogs[page.__dialogs.length - 1], 'Post GL opening balances, dated 2025-12-31?');
    await page.waitForFunction(() => document.querySelectorAll('#ob-batches tr[data-batch]').length === 1, null, { timeout: 20000 });
    assert.match(await page.textContent('#ob-clearing-status'), /400\.00 Cr — GL 400\.00 Cr/);
    assert.ok(await page.$eval('#ob-date', e => e.disabled), 'setup locked');
    assert.ok(!(await page.$eval('#ob-setup-note', e => e.classList.contains('hidden'))));
  });

  await check('another tab shows its own columns; the batch reverses and clearing is back to zero', async () => {
    await page.click('.ob-tab[data-kind="STOCK"]');
    assert.deepEqual(await page.$$eval('#ob-columns tr td:first-child', tds => tds.map(t => t.textContent)), ['Item', 'Warehouse', 'Quantity', 'Unit Cost', 'Batch No', 'Expiry Date']);
    await page.click('.ob-reverse');
    await page.waitForFunction(() => /Reversed/.test(document.getElementById('ob-batches').textContent), null, { timeout: 20000 });
    assert.match(page.__dialogs.find(d => /^Reverse the GL batch/.test(d)) || '', /^Reverse the GL batch OB-25-01-\d{6} \(2 rows\)\?/);
    assert.match(await page.textContent('#ob-clearing-status'), /0\.00 — no batch posted/);
    assert.ok(!(await page.$eval('#ob-date', e => e.disabled)), 'setup open again');
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
