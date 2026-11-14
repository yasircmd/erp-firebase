// The item-catalogue measurement (owner, 2026-11-13; docs/modules/UX4.md
// item 3, Q510; docs/modules/ITEMS_FIRESTORE.md): today's functions and
// screens on a small catalogue and on a 50,000-item one, in the emulators.
// Not a test: it prints a table. Emulator times are not production times,
// but the sizes are the same, and the ratio between the two catalogues
// shows what grows with the catalogue.
//   node functions/test/perf/items50k.perf.js [sizes...]   (default: 500 50000)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { call, reset, baseFixture, rtdb, today } = require('../emulator/_helpers');

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = SIZES.length ? SIZES : [500, 50000];
const CATEGORIES = ['RawMaterial', 'FinishedGood', 'Consumable', 'Trading'];

function item(i) {
  const n = String(i).padStart(6, '0');
  return {
    ItemCode: 'IT-' + n, ItemName: 'Test item ' + n + ' ' + ['steel', 'bolt', 'paint', 'cable', 'pipe', 'valve'][i % 6], Category: CATEGORIES[i % 4],
    Status: i % 20 === 0 ? 'Inactive' : 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS',
    COGSAccountID: 'A-COGS', RevenueAccountID: 'A-REV', Description: 'A made-up item for the measurement, number ' + n, SalesPrice: (i % 500) + 0.5,
    ReorderLevel: i % 50, Barcode: '200' + n + '0', CreatedAt: '2026-01-01T00:00:00.000Z', CreatedBy: 'measure'
  };
}

async function seed(size) {
  // In chunks: one 20 MB write is more than the database emulator takes.
  const items = {};
  for (let i = 1; i <= size; i++) items['I' + i] = item(i);
  items.I1 = Object.assign(items.I1, { ItemName: 'Steel Sheet', Status: 'Active' });
  const t = Date.now();
  const f = baseFixture();
  delete f.items;
  await reset(f);
  const ids = Object.keys(items);
  for (let i = 0; i < ids.length; i += 2500) {
    const part = {};
    ids.slice(i, i + 2500).forEach(id => { part[id] = items[id]; });
    await require('../../src/itemStore').store.putMany(part);
  }
  return { ms: Date.now() - t, mb: Buffer.byteLength(JSON.stringify(items)) / 1048576 };
}

async function timed(label, fn, runs) {
  const times = [];
  let bytes = 0, error = '';
  for (let r = 0; r < (runs || 3); r++) {
    const t = Date.now();
    try { const out = await Promise.race([fn(), new Promise((_r, no) => setTimeout(() => no(new Error('no answer within 120 s')), 120000))]); bytes = Buffer.byteLength(JSON.stringify(out === undefined ? null : out)); } catch (e) { error = e.message.slice(0, 80); }
    times.push(Date.now() - t);
  }
  times.sort((a, b) => a - b);
  return { label, ms: times[Math.floor(times.length / 2)], first: times[0], kb: Math.round(bytes / 1024), error };
}

const line = { ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 5, UnitCost: 4, Description: 'Steel', CostCenterID: 'CC1' };
const CALLS = [
  ['getActiveItems', () => call('u-admin', 'getActiveItems', {})],
  ['getItems (Item Master list)', () => call('u-admin', 'getItems', {})],
  ['getSellableItems', () => call('u-admin', 'getSellableItems', { __positional: ['C1'] })],
  ['getStockAvailabilityList', () => call('u-admin', 'getStockAvailabilityList', { companyId: 'C1' })],
  ['getReorderReport', () => call('u-admin', 'getReorderReport', { companyId: 'C1' })],
  ['saveGrnDraft (1 line)', () => call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Measure', CompanyID: 'C1', VendorID: 'V1', Lines: [line] })],
  ['saveGrnDraft + postGrn', async () => { const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Measure', CompanyID: 'C1', VendorID: 'V1', Lines: [line] }); return call('u-admin', 'postGrn', { grnId: s.grnId }); }],
  ['getStockValuationReport', () => call('u-admin', 'getStockValuationReport', { params: { CompanyID: 'C1', AsOfDate: today } })]
];
const SCREENS = ['ITEMMASTER', 'GRN', 'SALESORDER', 'STOCKAVAILABILITY', 'RETAILSALES'];

async function screens() {
  const { chromium } = require('playwright');
  require('../ui/buildHarness');
  const harness = fs.readFileSync(path.join(__dirname, '../ui/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8126);
  const browser = await chromium.launch();
  const out = [];
  for (const mod of SCREENS) {
    const page = await browser.newPage();
    const t = Date.now();
    let error = '', heap = 0, received = 0;
    page.on('response', async r => { try { if (/127\.0\.0\.1:5001/.test(r.url())) received += (await r.body()).length; } catch (e) { /* closed */ } });
    try {
      await page.goto('http://127.0.0.1:8126/?module=' + mod + '&uid=u-admin');
      await page.waitForFunction(() => window.__moduleReady === true || /^LOAD FAILED/.test(document.getElementById('module-container').textContent), null, { timeout: 150000 });
      await page.waitForLoadState('networkidle', { timeout: 150000 });
      heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0));
    } catch (e) { error = e.message.split('\n')[0].slice(0, 80); }
    out.push({ label: 'screen ' + mod, ms: Date.now() - t, kb: Math.round(received / 1024), heap, error });
    await page.close();
  }
  await browser.close(); server.close();
  return out;
}

(async () => {
  const report = {};
  for (const size of sizes) {
    const s = await seed(size);
    console.log('# ' + size + ' items: ' + s.mb.toFixed(1) + ' MB in RTDB, seeded in ' + s.ms + ' ms');
    const rows = [];
    const show = r => console.log([r.label.padEnd(30), String(r.ms).padStart(7) + ' ms', String(r.kb).padStart(7) + ' KB', r.heap ? r.heap + ' MB heap' : '', r.error].join('  '));
    for (const [label, fn] of CALLS) { const r = await timed(label, fn, size > 5000 ? 2 : 3); rows.push(r); show(r); }
    for (const r of await screens()) { rows.push(r); show(r); }
    if (false) rows.forEach(r => console.log([r.label.padEnd(30), String(r.ms).padStart(7) + ' ms', String(r.kb).padStart(7) + ' KB', r.heap ? r.heap + ' MB heap' : '', r.error].join('  ')));
    report[size] = { seeded: s, rows };
  }
  fs.writeFileSync(path.join(__dirname, 'items50k.last.json'), JSON.stringify(report, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
