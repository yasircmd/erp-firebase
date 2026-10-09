// Item barcodes, step 3 (owner, 2026-10-09; docs/modules/ITEM_BARCODES.md,
// decisions 72-75): Item Master → Barcodes & Labels (the company's settings,
// numbers for own products previewed then saved, labels for chosen items);
// labels from a posted Production (one a unit produced, batch and expiry)
// and a posted GRN. The printed page is captured through
// window.__labelPrintHook instead of printing.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/labelPrinting.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = new Date().toISOString().slice(0, 10);

(async () => {
  const f = baseFixture();
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS', BatchTracked: true };
  f.items.FG2 = { ItemCode: 'FG-002', ItemName: 'Door', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  await reset(f);
  // The emulator starts each function on its first call: start the slow ones before the browser times them.
  await call('u-admin', 'getBarcodeSettings', { companyId: 'C1' });
  await call('u-admin', 'generateItemBarcodes', { companyId: 'C1', itemIds: ['FG2'], save: false });
  const prod = await call('u-admin', 'saveProductionDraft', { prodData: { TransactionDate: D, Description: 'Run', CompanyID: 'C1',
    Lines: [{ ItemID: 'FG1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 3, UnitCost: 10, Description: 'Run', CostCenterID: 'CC1', BatchNumber: 'B-77', ExpiryDate: '2027-06-30' }] } });
  assert.equal(prod.success, true, prod.error);
  assert.equal((await call('u-admin', 'postProduction', { prodId: prod.prodId })).success, true);
  const grn = await call('u-admin', 'saveGrnDraft', { TransactionDate: D, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, UnitCost: 4, Description: 'in' }] });
  await call('u-admin', 'postGrn', { grnId: grn.grnId });
  await call('u-admin', 'getLabelSheet', { companyId: 'C1', lines: [{ ItemID: 'I1', Copies: 1 }] });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8184);
  const browser = await chromium.launch();
  async function open(module, uid, params) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8184/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => { window.__printed = []; window.__labelPrintHook = html => window.__printed.push(html); });
    if (params) await page.evaluate(([m, p]) => openModule(m, p), [module, params]);
    return page;
  }
  const printed = async p => { await p.waitForFunction(() => window.__printed.length > 0, null, { timeout: 30000 }); return p.evaluate(() => window.__printed.pop()); };
  const count = html => html.split('<div class="lbl">').length - 1;

  await check('Item Master: settings saved; numbers for own products previewed, then saved and shown; labels for chosen items with the price option', async () => {
    const p = await open('ITEMMASTER', 'u-admin');
    await p.waitForSelector('#im-table-body tr:has-text("FG-002")', { timeout: 30000 });
    await p.click('#im-lbl-btn');
    await p.waitForSelector('#im-lbl-settings:not(.hidden)', { timeout: 30000 });
    assert.equal(await p.inputValue('#im-lbl-rw'), '50');
    await p.fill('#im-lbl-rw', '45');
    await p.click('#im-lbl-save');
    for (let i = 0; i < 100 && !p.__dialogs.length; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(p.__dialogs.splice(0), ['Settings saved.']);
    assert.equal((await call('u-admin', 'getBarcodeSettings', { companyId: 'C1' })).settings.RollWidthMm, 45);
    await p.selectOption('#im-lbl-gen-cat', 'FinishedGood');
    await p.click('#im-lbl-preview');
    await p.waitForFunction(() => document.querySelectorAll('#im-lbl-gen-body tr').length === 2, null, { timeout: 30000 });
    assert.match(await p.textContent('#im-lbl-gen-body'), /FG-001[\s\S]*2000000000015[\s\S]*FG-002[\s\S]*2000000000022/);
    assert.equal(Object.keys((await call('u-admin', 'getBarcodeIndex', {})).index).length, 0, 'a preview saves nothing');
    await p.click('#im-lbl-gen-save');
    for (let i = 0; i < 100 && !p.__dialogs.length; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(p.__dialogs.splice(0), ['2 barcodes saved (In-store).']);
    await p.waitForFunction(() => /2000000000022/.test(document.getElementById('im-table-body').textContent), null, { timeout: 30000 });
    await p.fill('#im-lbl-search', 'door');
    await p.waitForFunction(() => document.querySelectorAll('#im-lbl-items tr').length === 1 && /2000000000022/.test(document.getElementById('im-lbl-items').textContent), null, { timeout: 30000 });
    await p.fill('#im-lbl-items .im-lbl-n', '4');
    await p.click('#im-lbl-print');
    const html = await printed(p);
    assert.equal(count(html), 4);
    assert.match(html, /@page\{size:45mm 25mm;margin:0\}/);
    assert.match(html, />2000000000022<\/text>/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Production (posted): Labels — one a unit produced, with the batch and expiry; A4 sheets', async () => {
    const p = await open('PRODUCTION', 'u-admin', { OpenEntryId: prod.prodId });
    await p.waitForSelector('#prd-labels-btn:not(.hidden)', { timeout: 30000 });
    await p.click('#prd-labels-btn');
    await p.waitForSelector('#prd-lbl:not(.hidden)', { timeout: 15000 });
    assert.equal(await p.inputValue('.prd-lbl-n'), '3');
    await p.selectOption('#prd-lbl-stock', 'Sheet');
    await p.click('#prd-lbl-print');
    const html = await printed(p);
    assert.equal(count(html), 3);
    assert.match(html, /@page\{size:A4;margin:10mm\}/);
    assert.match(html, /Batch B-77 · Exp 30\/06\/2027/);
    assert.match(html, />2000000000015<\/text>/, 'the number just generated for FG-001');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('GRN (posted): Labels — an item without a barcode prints its item code; a count of 0 leaves it out', async () => {
    const p = await open('GRN', 'u-admin', { OpenEntryId: grn.grnId });
    await p.waitForSelector('#grn-labels-btn:not(.hidden)', { timeout: 30000 });
    await p.click('#grn-labels-btn');
    await p.waitForSelector('#grn-lbl:not(.hidden)', { timeout: 15000 });
    assert.equal(await p.inputValue('.grn-lbl-n'), '2');
    await p.click('#grn-lbl-print');
    const html = await printed(p);
    assert.equal(count(html), 2);
    assert.match(html, />RM-001<\/text>/);
    await p.fill('.grn-lbl-n', '0');
    await p.click('#grn-lbl-print');
    for (let i = 0; i < 100 && !p.__dialogs.length; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(p.__dialogs, ['Give at least one label (copies more than 0).']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Viewer: no settings or numbers, but can print labels', async () => {
    const p = await open('ITEMMASTER', 'u-viewer');
    await p.waitForSelector('#im-table-body tr:has-text("FG-002")', { timeout: 30000 });
    await p.click('#im-lbl-btn');
    await p.waitForFunction(() => document.querySelectorAll('#im-lbl-items tr').length >= 3, null, { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    assert.ok(await p.isHidden('#im-lbl-settings'));
    assert.ok(await p.isHidden('#im-lbl-gen'));
    assert.ok(await p.isVisible('#im-lbl-print'));
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
