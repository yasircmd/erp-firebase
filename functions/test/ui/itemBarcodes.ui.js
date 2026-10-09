// Item barcodes on screen (owner, 2026-10-09; docs/modules/ITEM_BARCODES.md):
// Item Master's Barcodes section (several, a pack's units), a scanner's
// Enter not submitting the form, a wrong check digit or a barcode on
// another item named with the item kept saved, the list and search
// showing them, read-only without the write right.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/itemBarcodes.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'FG-001', ItemName: 'Olive Oil 1L', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  await reset(f);
  // The emulator starts each function on its first call (slow after a
  // restart): start the ones a save uses before the browser times them.
  await call('u-admin', 'getItems', {});
  await call('u-admin', 'saveItemBarcodes', { itemId: 'I2', barcodes: [] });
  await call('u-admin', 'saveItem', { itemData: Object.assign({ ItemID: 'I2' }, f.items.I2) }).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8182);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8182/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#im-table-body tr:has-text("RM-001")', { timeout: 30000 });
    return page;
  }
  const edit = async (p, code) => { await p.click('#im-table-body tr:has-text("' + code + '") .im-edit'); await p.waitForSelector('#im-modal:not(.hidden)', { timeout: 15000 }); };
  const addRow = async (p, code, pack) => {
    await p.click('#im-bc-add');
    const row = p.locator('#im-bc-body .im-bc-row').last();
    await row.locator('.im-bc-code').fill(code);
    if (pack) await row.locator('.im-bc-pack').fill(pack);
    return row;
  };

  await check('Item Master: barcodes added (a carton with its units), a scanner\'s Enter not saving; shown in the list and found by search', async () => {
    const p = await open('ITEMMASTER', 'u-admin');
    await edit(p, 'RM-001');
    assert.equal(await p.locator('#im-bc-body .im-bc-row').count(), 0);
    await addRow(p, '6291041500213');
    await p.press('#im-bc-body .im-bc-row >> nth=0 >> .im-bc-code', 'Enter');
    assert.ok(await p.isVisible('#im-modal'), 'Enter from the scanner did not submit');
    await addRow(p, '16291041500210', '12');
    await p.click('#im-save-btn');
    await p.waitForSelector('#im-modal.hidden', { state: 'attached', timeout: 60000 });
    await p.waitForFunction(() => /16291041500210 ×12, 6291041500213/.test((document.querySelector('#im-table-body tr .im-bc-list') || {}).textContent || ''), null, { timeout: 30000 });
    assert.deepEqual((await call('u-admin', 'getItemBarcodes', {})).barcodes.I1, [{ Barcode: '16291041500210', PackQty: 12 }, { Barcode: '6291041500213', PackQty: 1 }]);
    await p.fill('#im-search-input', '629104150021');
    assert.deepEqual(await p.$$eval('#im-table-body tr', t => t.map(r => r.cells[0].textContent.trim())), ['RM-001']);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a wrong check digit, or a barcode on another item: named, the item kept saved and the form open; fixed and saved', async () => {
    const p = await open('ITEMMASTER', 'u-admin');
    await edit(p, 'RM-001');
    assert.deepEqual(await p.$$eval('#im-bc-body .im-bc-code', x => x.map(i => i.value)), ['16291041500210', '6291041500213']);
    assert.equal(await p.inputValue('#im-bc-body .im-bc-row >> nth=0 >> .im-bc-pack'), '12');
    const bad = await addRow(p, '6291041500214');
    await p.click('#im-save-btn');
    await p.waitForSelector('#im-form-error:not(.hidden)', { timeout: 60000 });
    assert.equal(await p.textContent('#im-form-error'), 'The item is saved (RM-001), but not its barcodes: Barcode 6291041500214: the check digit is wrong (an EAN/UPC barcode of 13 digits). Check it was typed right.');
    assert.ok(await p.isVisible('#im-modal'));
    await bad.locator('.im-bc-del').click();
    await p.click('#im-save-btn');
    await p.waitForSelector('#im-modal.hidden', { state: 'attached', timeout: 60000 });
    assert.equal(Object.keys((await call('u-admin', 'getItems', {})) || {}).length, 2, 'the retry saved the same item, not a second one');
    await edit(p, 'FG-001');
    await addRow(p, '6291041500213');
    await p.click('#im-save-btn');
    await p.waitForSelector('#im-form-error:not(.hidden)', { timeout: 60000 });
    assert.match(await p.textContent('#im-form-error'), /Barcode 6291041500213 is already on item RM-001 — /);
    assert.equal((await call('u-admin', 'getItemBarcodes', {})).barcodes.I2, undefined);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a new item with a wrong barcode: saved once; fixed and saved again, still one item', async () => {
    const p = await open('ITEMMASTER', 'u-admin');
    await p.click('#im-add-btn');
    await p.waitForSelector('#im-modal:not(.hidden)', { timeout: 15000 });
    await p.selectOption('#im-form-category', 'FinishedGood');
    await p.dispatchEvent('#im-form-category', 'change');
    await p.fill('#im-form-name', 'Olive Oil 5L');
    await p.selectOption('#im-form-uom', 'UOM-PCS');
    await p.selectOption('#im-form-inventory-account', 'A-INV');
    await p.selectOption('#im-form-consumption-account', 'A-CONS');
    const bad = await addRow(p, '96385075');
    await p.click('#im-save-btn');
    await p.waitForSelector('#im-form-error:not(.hidden)', { timeout: 60000 });
    assert.match(await p.textContent('#im-form-error'), /^The item is saved \(FG-\d+\), but not its barcodes: Barcode 96385075: the check digit is wrong/);
    await bad.locator('.im-bc-code').fill('96385074');
    await p.click('#im-save-btn');
    await p.waitForSelector('#im-modal.hidden', { state: 'attached', timeout: 60000 });
    const items = await call('u-admin', 'getItems', {});
    assert.deepEqual(items.filter(i => i.ItemName === 'Olive Oil 5L').length, 1, 'one item, not two');
    const id = items.find(i => i.ItemName === 'Olive Oil 5L').ItemID;
    assert.deepEqual((await call('u-admin', 'getItemBarcodes', {})).barcodes[id], [{ Barcode: '96385074', PackQty: 1 }]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('without the write right: barcodes shown, not editable', async () => {
    const p = await open('ITEMMASTER', 'u-viewer');
    await p.waitForFunction(() => /6291041500213/.test(document.getElementById('im-table-body').textContent), null, { timeout: 30000 });
    assert.equal(await p.locator('.im-edit').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
