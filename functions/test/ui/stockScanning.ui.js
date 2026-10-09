// Item barcodes, step 2 (owner, 2026-10-09; docs/modules/ITEM_BARCODES.md,
// decisions 68-71): the stock screens take the products' own barcodes —
// the Scan box adds the item, or adds to its line (a carton's units in the
// base unit); an unknown barcode is named; the item cell also takes a
// barcode (on Enter). GRN, Material Issue, Stock Adjustment, Warehouse
// Movement, Physical Count.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/stockScanning.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  await call('u-admin', 'saveItemBarcodes', { itemId: 'I1', barcodes: [{ Barcode: '6291041500213' }, { Barcode: '16291041500210', PackQty: 12 }] });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8183);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8183/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    return page;
  }
  const dialogs = async (p, n) => { for (let i = 0; i < 100 && p.__dialogs.length < n; i++) await new Promise(r => setTimeout(r, 100)); };
  const SCREENS = [['GRN', 'grn', 'quantity'], ['MATERIALISSUE', 'mi', 'quantity'], ['STOCKADJUSTMENT', 'adj', 'quantity'], ['WAREHOUSEMOVEMENT', 'wm', 'quantity'], ['PHYSICALCOUNT', 'pc', 'counted']];

  for (const [mod, p, qf] of SCREENS) {
    await check(mod + ': the Scan box adds the item, a carton adds 12 to its line, an unknown barcode is named', async () => {
      const page = await open(mod, 'u-admin');
      await page.click('#' + p + '-new-btn');
      await page.waitForSelector('#' + p + '-scan:visible', { timeout: 30000 });
      const item = r => page.inputValue('#' + p + '-grid-body [data-row="' + r + '"][data-field="item"]');
      const q = r => page.inputValue('#' + p + '-grid-body [data-row="' + r + '"][data-field="' + qf + '"]');
      const scan = async code => { await page.fill('#' + p + '-scan', code); await page.press('#' + p + '-scan', 'Enter'); };
      await scan('6291041500213');
      await page.waitForFunction(sel => document.querySelector(sel) && document.querySelector(sel).value === 'RM-001', '#' + p + '-grid-body [data-row="0"][data-field="item"]', { timeout: 15000 });
      assert.equal(await q(0), '1');
      assert.equal(await page.inputValue('#' + p + '-scan'), '', 'the box is cleared for the next scan');
      await scan('16291041500210');
      await page.waitForFunction(sel => document.querySelector(sel).value === '13', '#' + p + '-grid-body [data-row="0"][data-field="' + qf + '"]', { timeout: 15000 });
      assert.equal(await item(1), '', 'the same line, not a new one');
      await scan('rm-001'.toUpperCase());
      await page.waitForFunction(sel => document.querySelector(sel).value === '14', '#' + p + '-grid-body [data-row="0"][data-field="' + qf + '"]', { timeout: 15000 });
      await scan('4006381333931');
      await dialogs(page, 1);
      assert.deepEqual(page.__dialogs, ['No item with barcode 4006381333931.']);
      assert.equal(await q(0), '14');
      assert.deepEqual(page.__errors, []);
      await page.close();
    });
  }

  await check('GRN: the item cell takes a barcode on Enter (a carton fills its 12 units); typed codes work as before', async () => {
    const page = await open('GRN', 'u-admin');
    await page.click('#grn-new-btn');
    await page.waitForSelector('#grn-grid-body [data-row="0"][data-field="item"]', { timeout: 30000 });
    await page.fill('#grn-grid-body [data-row="0"][data-field="item"]', '16291041500210');
    await page.press('#grn-grid-body [data-row="0"][data-field="item"]', 'Enter');
    await page.waitForFunction(() => document.querySelector('#grn-grid-body [data-row="0"][data-field="item"]').value === 'RM-001', null, { timeout: 15000 });
    assert.equal(await page.inputValue('#grn-grid-body [data-row="0"][data-field="quantity"]'), '12');
    await page.fill('#grn-grid-body [data-row="1"][data-field="item"]', 'RM-001');
    assert.equal(await page.inputValue('#grn-grid-body [data-row="1"][data-field="item"]'), 'RM-001');
    assert.equal(await page.inputValue('#grn-grid-body [data-row="1"][data-field="quantity"]'), '', 'a typed code sets no quantity');
    assert.deepEqual([page.__errors, page.__dialogs], [[], []]);
    await page.close();
  });

  await check('a Viewer (no Item Master access) still scans: the index is open to any user', async () => {
    await rtdb.ref('permissions/ITEMMASTER/access').set(['Admin']);
    const page = await open('PHYSICALCOUNT', 'u-viewer');
    const calls = await page.evaluate(() => window.__rpcLog.filter(c => c.name === 'getBarcodeIndex').map(c => c.ok));
    assert.deepEqual(calls, [true]);
    await page.close();
    await rtdb.ref('permissions/ITEMMASTER/access').set(['Admin', 'Viewer']);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
