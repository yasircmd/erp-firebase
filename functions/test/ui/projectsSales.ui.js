// The sales chain's screens with the entry layout and projects (owner,
// 2026-11-03; docs/modules/ENTRY_LAYOUT.md, PROJECTS_DIMENSIONS.md step 2):
// Delivery Note, Customer Invoice, Sales Return: the actions in the sticky
// bar, the key fields in one row with a narrow date, every id once; Project
// after Profit Center (Delivery Note, Customer Invoice, with a Project column
// on the invoice's direct lines); a Delivery Note takes its order's project
// when an order line is ticked; a Sales Return shows its invoice's project.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/projectsSales.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = '2026-10-10';

(async () => {
  const f = baseFixture();
  f.orgUnits['PRJ-A'] = { Type: 'Project', Code: 'P-100', Name: 'Tower A', CompanyID: 'C1', Status: 'Active' };
  f.coa['A-SRET'] = { AccountCode: '410000', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 30, TotalValue: 1500 } } } };
  await reset(f);
  // An order for Tower A (open, for the Delivery Note), and a posted invoice for Tower A (for the return).
  const so = await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', ProjectID: 'PRJ-A', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 10, UnitPrice: 50 }] } });
  await call('u-admin', 'confirmSalesOrder', { soId: so.soId });
  const lineId = (await val('salesOrders/' + so.soId)).Lines[0].LineID;
  const dn = await call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', ProjectID: 'PRJ-A',
    Lines: [{ SourceSOID: so.soId, SourceSOLineID: lineId, Quantity: 4, Description: 'Ship' }] } });
  await call('u-admin', 'postDeliveryNote', { dnId: dn.dnId });
  const inv = await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Stage 1', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', ProjectID: 'PRJ-A',
    SourceDeliveryNotes: [{ DeliveryNoteID: dn.dnId, SalesTypeID: 'ST1' }], DirectLines: [], Discount: 0, TaxPercent: 0 } });
  assert.equal((await call('u-admin', 'postCustomerInvoice', { invoiceId: inv.invoiceId })).success, true);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8207);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(mod, p) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8207/?module=' + mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.click('#' + p + '-new-btn');
    await page.waitForSelector('#' + p + '-entry-view:not(.hidden)', T);
    await page.selectOption('#' + p + '-form-company', 'C1');
    await page.dispatchEvent('#' + p + '-form-company', 'change');
    return page;
  }
  const cellBox = (page, id) => page.evaluate(id => { const el = document.getElementById(id); const b = (el.closest('.entry-fields > *') || el).getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width) }; }, id);
  async function layout(page, p, keys, actions) {
    const tops = await Promise.all(keys.map(k => cellBox(page, k)));
    assert.ok(Math.max(...tops.map(t => t.top)) - Math.min(...tops.map(t => t.top)) <= 4, 'key row: ' + JSON.stringify(tops));
    for (const a of actions) assert.ok(await page.evaluate(id => Boolean(document.getElementById(id).closest('.entry-sticky .entry-bar')), a), a + ' in the sticky bar');
    const dupes = await page.evaluate(() => { const seen = {}; document.querySelectorAll('#module-container [id]').forEach(e => { seen[e.id] = (seen[e.id] || 0) + 1; }); return Object.keys(seen).filter(k => seen[k] > 1); });
    assert.deepEqual(dupes, []);
  }

  await check('Delivery Note: the layout; the date narrow; Project after Profit Center; ticking an order line takes the order\'s project', async () => {
    const page = await open('DELIVERYNOTE', 'dn');
    await layout(page, 'dn', ['dn-form-company', 'dn-form-customer', 'dn-form-date', 'dn-form-reference'], ['dn-save-draft-btn', 'dn-post-btn']);
    assert.ok((await cellBox(page, 'dn-form-date')).width <= 165);
    await page.waitForSelector('#dn-project-field:not(.hidden)', T); // once the org units are in
    const [pc, proj] = [await cellBox(page, 'dn-form-profitcenter'), await cellBox(page, 'dn-form-project')];
    assert.ok(proj.top === pc.top && proj.left > pc.left, JSON.stringify({ pc, proj }));
    assert.equal(await page.inputValue('#dn-form-project'), '');
    await page.selectOption('#dn-form-customer', 'CU1');
    await page.dispatchEvent('#dn-form-customer', 'change');
    await page.waitForSelector('.dn-so-line-checkbox:not([disabled])', T);
    await page.check('.dn-so-line-checkbox:not([disabled])');
    await page.waitForFunction(() => document.getElementById('dn-form-project').value === 'PRJ-A', null, T);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Customer Invoice: the layout; Project after Profit Center; a Project column on the direct lines', async () => {
    const page = await open('CUSTOMERINVOICE', 'cinv');
    await layout(page, 'cinv', ['cinv-form-company', 'cinv-form-customer', 'cinv-form-date', 'cinv-form-description'], ['cinv-save-draft-btn', 'cinv-post-btn']);
    await page.waitForSelector('#cinv-project-field:not(.hidden)', T); // once the org units are in
    const [pc, proj] = [await cellBox(page, 'cinv-form-profitcenter'), await cellBox(page, 'cinv-form-project')];
    assert.ok(proj.top === pc.top && proj.left > pc.left, JSON.stringify({ pc, proj }));
    await page.selectOption('#cinv-form-project', 'PRJ-A');
    await page.click('#cinv-add-line-btn');
    assert.ok(await page.isVisible('#cinv-project-head'));
    assert.equal(await page.inputValue('#cinv-grid-body tr:last-child .cinv-line-project'), 'PRJ-A', 'a new line takes the invoice\'s project');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Sales Return: the layout; choosing the invoice shows its project (read-only)', async () => {
    const page = await open('SALESRETURN', 'srt');
    await layout(page, 'srt', ['srt-form-company', 'srt-form-customer', 'srt-form-invoice', 'srt-form-date'], ['srt-save-draft-btn', 'srt-post-btn']);
    assert.equal(await page.isVisible('#srt-project-field'), false);
    await page.selectOption('#srt-form-customer', 'CU1');
    await page.dispatchEvent('#srt-form-customer', 'change');
    await page.waitForFunction(id => Array.from(document.querySelectorAll('#srt-form-invoice option')).some(o => o.value === id), inv.invoiceId, T);
    await page.selectOption('#srt-form-invoice', inv.invoiceId);
    await page.dispatchEvent('#srt-form-invoice', 'change');
    await page.waitForFunction(() => /P-100 — Tower A/.test(document.getElementById('srt-project-value').textContent), null, T);
    assert.ok(await page.isVisible('#srt-project-field'));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
