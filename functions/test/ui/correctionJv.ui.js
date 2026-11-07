// Correction JV (owner, 2026-11-07; docs/modules/CORRECTION_JV.md): a posted
// JV found by its number, a line ticked and split between two cost centres,
// saved and posted as a CJV; a vendor's line locked; the CJV reversed.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/correctionJv.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, call, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/correctionJv.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };
const D = '2026-10-10';

(async () => {
  const f = baseFixture();
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  await reset(f);
  const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Workshop supplies', CompanyID: 'C1', Lines: [
    { AccountCode: '5100', Debit: 100, Description: 'Paint', CostCenterID: 'CC1' }, { AccountCode: '2000', Credit: 100, Description: 'Owed', PartyType: 'Vendor', PartyID: 'V1' }] } });
  const p = await call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  assert.equal(p.success, true, p.error);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8218);
  const browser = await chromium.launch();
  const dialogs = [];
  async function open(module) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(D) : d.accept(); });
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.goto('http://127.0.0.1:8218/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }

  await check('a JV line split between two cost centres by a CJV; the vendor\'s line locked; posted and reversed', async () => {
    const page = await open('CJV');
    await page.waitForSelector('#cjv-new:not(.hidden)', T);
    await page.click('#cjv-new');
    await page.selectOption('#cjv-company', 'C1');
    await page.fill('#cjv-number', p.jvNumber);
    await page.click('#cjv-find');
    await page.waitForSelector('#cjv-lines tr[data-line="0"] .cjv-pick', T);
    assert.equal(await page.$$eval('#cjv-lines tr[data-line="1"] .cjv-pick', x => x.length), 0, 'the vendor\'s line has no tick');
    assert.match(await page.textContent('#cjv-lines tr[data-line="1"]'), /not corrected/);
    assert.equal(await page.inputValue('#cjv-date'), D, 'the original\'s date by default');
    await page.check('#cjv-lines tr[data-line="0"] .cjv-pick');
    await page.fill('tr[data-line="0"][data-part="0"] input[data-k="Amount"]', '70');
    await page.press('tr[data-line="0"][data-part="0"] input[data-k="Amount"]', 'Tab');
    await page.click('#cjv-lines .cjv-split');
    await page.selectOption('tr[data-line="0"][data-part="1"] select[data-k="CostCenterID"]', 'CC2');
    assert.match(await page.textContent('#cjv-lines .cjv-total'), /Parts 100\.00 of 100\.00/);
    await page.click('#cjv-post');
    await page.waitForFunction(() => /^CJV/.test(document.getElementById('cjv-title').textContent), null, T);
    assert.ok(dialogs.some(m => /^Posted as CJV/.test(m)), dialogs.join(' | '));
    const id = await page.evaluate(() => document.querySelector('#cjv-body tr[data-id]').dataset.id);
    const e = (await firestore.collection('journalEntries').doc(id).get()).data();
    assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.CostCenterID]), [['5100', 0, 100, 'CC1'], ['5100', 70, 0, 'CC1'], ['5100', 30, 0, 'CC2']]);
    await page.waitForSelector('#cjv-reverse:not(.hidden)', T);
    await page.click('#cjv-print');
    await page.waitForFunction(() => window.__printed === 1, null, T);
    assert.match(await page.textContent('#cjv-print-document'), new RegExp('Corrects: ' + p.jvNumber));
    await page.click('#cjv-reverse');
    await page.waitForFunction(() => /Reversed/.test(document.getElementById('cjv-badge').textContent), null, T);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
