// Stock reports on screen (docs/modules/STOCK_REPORTS.md, decisions
// 144-147): the Expiry / Batch Report (rows per batch with their status, the
// totals by status, the "expiring within" window, the status filter, the
// search, items not batch-tracked when asked, Copy to Excel, a row to the Stock
// Ledger) and the
// Reorder / Low Stock Report (on hand, reserved, on order, available, the
// suggested order, "only below" off, one warehouse). Seeds its own data (it
// WIPES the emulator database, like the suites):
//   node functions/test/ui/stockReports.ui.js
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
  f.items.I1.BatchTracked = true;
  f.items.I1.ReorderLevel = 20;
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Bolts', Category: 'Consumable', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ReorderLevel: 2 };
  const ln = (item, wh, dir, qty, extra) => Object.assign({ ItemID: item, WarehouseID: wh, Direction: dir, Quantity: qty, UnitCost: 10, TotalValue: qty * 10 }, extra || {});
  const tx = (date, lines) => ({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', TransactionDate: date, Lines: lines });
  f.stock = {
    transactions: {
      G1: tx('2026-01-10', [ln('I1', 'WH1', 'In', 6, { BatchNumber: 'A', ExpiryDate: '2026-06-15' })]),
      G2: tx('2026-02-10', [ln('I1', 'WH1', 'In', 5, { BatchNumber: 'B', ExpiryDate: '2026-08-31' })]),
      G3: tx('2026-03-10', [ln('I1', 'WH2', 'In', 7, { BatchNumber: 'C', ExpiryDate: '2027-03-31' }), ln('I2', 'WH1', 'In', 3)])
    },
    ledger: { I1: { WH1: { Quantity: 11, AvgCost: 10, TotalValue: 110 }, WH2: { Quantity: 7, AvgCost: 10, TotalValue: 70 } }, I2: { WH1: { Quantity: 3, AvgCost: 10, TotalValue: 30 } } },
    reservations: { R1: { ItemID: 'I1', WarehouseID: 'WH1', CompanyID: 'C1', Quantity: 4, Status: 'Active', SourceType: 'SalesOrder' } }
  };
  f.purchaseOrders = { PO1: { PONumber: 'PO-1', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1', Lines: [{ LineID: 'L1', ItemCode: 'RM-001', Quantity: 5, ReceivedQuantity: 0, UnitPrice: 6, WarehouseID: 'WH1' }] } };
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8191);
  const browser = await chromium.launch();
  async function open(module) {
    const p = await browser.newPage();
    p.__errors = []; p.__dialogs = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    await onAppDialog(p, d => { p.__dialogs.push(d.type() + ': ' + d.message()); return d.accept(); });
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8191' });
    await p.goto('http://127.0.0.1:8191/?module=' + module + '&uid=u-admin');
    await p.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return p;
  }
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const statuses = p => p.$$eval('#be-body tr', rs => rs.map(r => [r.dataset.batch, r.querySelector('.be-status').textContent]));

  await check('Expiry / Batch: a row per batch with its status, the totals, the window, the status filter, the search, Copy', async () => {
    const p = await open('BATCHEXPIRY');
    await until(p, () => document.getElementById('be-company').options.length > 1);
    assert.equal(await p.inputValue('#be-within'), '90');
    assert.equal(await p.isChecked('#be-tracked'), true);
    await p.selectOption('#be-company', 'C1');
    await p.fill('#be-asof', '2026-06-30');
    await p.click('#be-run');
    await until(p, () => /2026-06-30|30\/06\/2026/.test(document.getElementById('be-title').textContent));
    assert.deepEqual(await statuses(p), [['A', 'Expired'], ['B', 'Expiring'], ['C', 'OK']]);
    assert.match(await p.textContent('#be-body tr[data-batch="A"]'), /RM-001[\s\S]*WH1[\s\S]*-15\s*6 PCS\s*60\.00/);
    assert.deepEqual(await Promise.all(['#be-t-expired', '#be-t-expiring', '#be-t-ok', '#be-t-none'].map(s => p.textContent(s))), ['60.00', '50.00', '70.00', '0.00']);
    assert.equal(await p.textContent('#be-t-expiring-label'), 'Expiring within 90 days');
    assert.equal(await p.textContent('#be-total'), '180.00');
    // A shorter window.
    await p.fill('#be-within', '30');
    await p.click('#be-run');
    await until(p, () => document.getElementById('be-t-expiring-label').textContent === 'Expiring within 30 days');
    assert.deepEqual(await statuses(p), [['A', 'Expired'], ['B', 'OK'], ['C', 'OK']]);
    // The status filter and the search, on screen only.
    await p.fill('#be-within', '90');
    await p.click('#be-run');
    await until(p, () => document.getElementById('be-t-expiring-label').textContent === 'Expiring within 90 days');
    await p.selectOption('#be-status', 'Expired,Expiring');
    assert.deepEqual(await statuses(p), [['A', 'Expired'], ['B', 'Expiring']]);
    assert.match(await p.textContent('#be-foot'), /Total \(2 of 3 batches\)\s*110\.00/);
    await p.selectOption('#be-status', '');
    await p.fill('#be-search', 'c');
    assert.deepEqual((await statuses(p)).map(x => x[0]), ['C']);
    await p.fill('#be-search', '');
    // Copy to Excel: tab-separated, the stored date form.
    await p.click('#be-copy');
    await until(p, () => /Copied/.test(document.getElementById('be-copy').textContent));
    const tsv = await p.evaluate(() => navigator.clipboard.readText());
    assert.equal(tsv.split('\n')[0].split('\t').join('|'), 'Item|Name|Category|Warehouse|Batch|Received|Expiry|Days to expiry|Quantity|UOM|Value|Status');
    assert.equal(tsv.split('\n').length, 4);
    assert.match(tsv.split('\n')[1], /^RM-001\tSteel Sheet\tRawMaterial\tWH1\tA\t\S+\t\S+\t-15\t6\tPCS\t60\.00\tExpired$/);
    // Items not batch-tracked when asked.
    await p.uncheck('#be-tracked');
    await p.click('#be-run');
    await until(p, () => document.getElementById('be-body').querySelectorAll('tr').length === 4);
    assert.equal(await p.textContent('#be-t-none'), '30.00');
    assert.equal(await p.textContent('#be-body tr[data-item="I2"] .be-status'), 'No expiry date');
    // A row opens the Stock Ledger for that item and warehouse; Back returns.
    await p.click('#be-body tr[data-batch="C"] .be-batch');
    await until(p, () => document.getElementById('sl-item-title') && /RM-001/.test(document.getElementById('sl-item-title').textContent));
    assert.equal(await p.inputValue('#sl-location'), 'WH2');
    assert.equal(await p.inputValue('#sl-from-date'), '2026-03-10');
    assert.match(await p.textContent('#sl-closing-qty'), /^7(\.0+)?$/);
    await p.click('#sl-back-btn');
    await until(p, () => !!document.getElementById('be-company'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Reorder: on hand, reserved, on order, available, the suggested order; all items; one warehouse', async () => {
    const p = await open('REORDER');
    await until(p, () => document.getElementById('ro-company').options.length > 1);
    assert.equal(await p.isChecked('#ro-below'), true);
    await p.selectOption('#ro-company', 'C1');
    await p.click('#ro-run');
    await until(p, () => !document.getElementById('ro-report').classList.contains('hidden'));
    // I1: 18 on hand − 4 reserved + 5 on order = 19 against 20; I2 (3 against 2) is not low.
    const cells = id => p.$eval('#ro-body tr[data-id="' + id + '"]', r => ['onhand', 'reserved', 'onorder', 'available', 'level', 'shortfall', 'suggested'].map(c => r.querySelector('.ro-' + c).textContent));
    assert.deepEqual(await p.$$eval('#ro-body tr', rs => rs.map(r => r.dataset.id)), ['I1']);
    assert.deepEqual(await cells('I1'), ['18 PCS', '4', '5', '19', '20', '1', '1 PCS']);
    assert.match(await p.textContent('#ro-scope'), /All warehouses · 1 below reorder level/);
    await p.uncheck('#ro-below'); // runs again
    await until(p, () => document.querySelectorAll('#ro-body tr').length === 2);
    assert.deepEqual(await cells('I2'), ['3 PCS', '—', '—', '3', '2', '—', '—']);
    assert.equal(await p.$eval('#ro-body tr[data-id="I2"]', r => r.classList.contains('ro-below')), false);
    await p.selectOption('#ro-warehouse', 'WH2');
    await p.click('#ro-run');
    await until(p, () => /Site Store/.test(document.getElementById('ro-scope').textContent));
    assert.deepEqual(await cells('I1'), ['7 PCS', '—', '—', '7', '20', '13', '13 PCS']);
    await p.check('#ro-below');
    await until(p, () => document.querySelectorAll('#ro-body tr').length === 2 && /below reorder level/.test(document.getElementById('ro-scope').textContent) && document.querySelectorAll('#ro-body tr.ro-below').length === 2);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
