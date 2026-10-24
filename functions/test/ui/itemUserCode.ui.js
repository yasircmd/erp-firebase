// Item user code in the shell (owner, 2026-10-24; docs/modules/
// ITEM_USER_CODE.md, decisions Q276, Q293): wherever an item's system code
// shows, its user code does (the system code in the tooltip); an item box
// takes the user code and the screen gets the system code; a chosen box
// shows the user code beside it; Copy gives the user code, Paste takes it;
// Item Master keeps the system code, the user code beneath.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/itemUserCode.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.items.I1.UserCode = 'STEEL-1';
  f.priceListLines = { L1: { ItemCode: 'RM-001', UnitPrice: 9 } };
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Example Buyer LLC', Status: 'Active' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 4, TotalValue: 40 } } } };
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8161);
  const browser = await chromium.launch();
  async function open(mod, ready) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    // A clipboard to watch: what is copied, and what a paste reads.
    await page.addInitScript(() => {
      window.__copied = null; window.__toPaste = '';
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); }, readText: () => Promise.resolve(window.__toPaste) } });
    });
    await page.goto('http://127.0.0.1:8161/?module=' + mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector(ready, { timeout: 30000 });
    await page.waitForTimeout(800);
    return page;
  }

  await check('shown text: Stock Availability shows the user code, the system code in its tooltip', async () => {
    const page = await open('STOCKAVAILABILITY', '#sa-company-select');
    await page.waitForSelector('#sa-table-body tr td', { timeout: 30000 });
    const cell = page.locator('#sa-table-body tr td').first();
    assert.equal((await cell.textContent()).trim(), 'STEEL-1');
    assert.equal(await cell.getAttribute('title'), 'System code: RM-001');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('an item box takes the user code; the screen gets the item; the box shows the user code beside it; Copy and Paste use it', async () => {
    const page = await open('SALESORDER', '#so-new-btn:not(.hidden)');
    await page.click('#so-new-btn');
    await page.selectOption('#so-form-company', 'C1');
    await page.selectOption('#so-form-customer', 'CU1');
    await page.click('#so-add-line-btn');
    const box = page.locator('#so-grid-body input[data-field="item"]').first();
    await box.fill('steel-1');
    await box.press('Tab'); // as a user leaves the box: change, then blur
    await page.waitForTimeout(300);
    const first = page.locator('#so-grid-body tr').first();
    assert.match(await first.textContent(), /Steel Sheet/, 'the screen found the item');
    assert.match(await page.inputValue('#so-grid-body input[data-field="item"] >> nth=0'), /^RM-001/, 'the screen holds the system code');
    assert.equal((await page.textContent('#so-grid-body .item-ucode')).trim(), 'STEEL-1');
    // Copy: the user code; Paste: the user code taken.
    await page.fill('#so-grid-body input[data-field="quantity"] >> nth=0', '2');
    await page.dispatchEvent('#so-grid-body input[data-field="quantity"] >> nth=0', 'change');
    await page.click('#so-copy-btn');
    await page.waitForFunction(() => window.__copied !== null);
    const copied = await page.evaluate(() => window.__copied);
    assert.match(copied, /\nSTEEL-1\t/, copied);
    assert.doesNotMatch(copied, /RM-001/);
    await page.evaluate(() => { window.__toPaste = 'Item Code\tWarehouse\tQuantity\tUnit Price\nSTEEL-1\tWH1\t3\t9'; });
    await page.click('#so-paste-btn');
    await page.waitForTimeout(500);
    const codes = await page.$$eval('#so-grid-body input[data-field="item"]', ins => ins.map(i => i.value).filter(Boolean));
    assert.equal(codes.filter(c => /^RM-001/.test(c)).length, 2, 'the pasted line is the item: ' + codes.join(', '));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the search picker lists the user code and finds the item by it', async () => {
    const page = await open('SALESORDER', '#so-new-btn:not(.hidden)');
    await page.click('#so-new-btn');
    await page.selectOption('#so-form-company', 'C1');
    await page.selectOption('#so-form-customer', 'CU1');
    await page.click('#so-add-line-btn');
    await page.locator('#so-grid-body input[data-field="item"]').first().pressSequentially('STE');
    await page.waitForSelector('#erp-picker:not(.hidden) .erp-picker-row', { timeout: 10000 });
    assert.match(await page.textContent('#erp-picker .erp-picker-row'), /STEEL-1/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Item Master keeps the system code, the user code beneath, and finds the item by either', async () => {
    const page = await open('ITEMMASTER', '#im-table-body tr');
    const cell = page.locator('#im-table-body tr:has-text("Steel Sheet") td').first();
    assert.match((await cell.textContent()).replace(/\s+/g, ' ').trim(), /^RM-001 ?STEEL-1$/);
    await page.fill('#im-search-input', 'steel-1');
    await page.dispatchEvent('#im-search-input', 'input');
    assert.equal(await page.locator('#im-table-body tr:has-text("Steel Sheet")').count(), 1);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
