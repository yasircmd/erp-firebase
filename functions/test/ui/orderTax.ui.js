// Estimated tax on orders (docs/modules/TAX_ENGINE.md, part 4), India GST:
// the Sales Order's grid shows the tax by each item's code and the total
// with tax, and its Proforma Invoice prints them; the Purchase Order's grid
// shows the vendor's tax; a company without a Tax Configuration shows none.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/orderTax.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore } = require('../emulator/_helpers');
const engine = require('../../src/taxEngine');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };

(async () => {
  const f = baseFixture();
  Object.assign(f.items.I1, { TaxCode: 'GST18', HSNCode: '7208' });
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Example Buyer LLC', Status: 'Active', CompanyID: 'C1', AddressLine1: '1 Sample Street', TaxRegistrationType: 'Registered', TaxState: '27' } };
  Object.assign(f.vendors.V1, { TaxRegistrationType: 'Registered', TaxState: '29' });
  f.salesOrders = { SO1: { CompanyID: 'C1', CustomerID: 'CU1', SODate: '2026-10-20', CreatedAt: '2026-10-20T08:00:00Z', Status: 'Reserved', SONumber: 'SO-26-01-000007',
    Lines: [{ LineID: 'L1', ItemCode: 'RM-001', OrderedQuantity: 2, UnitPrice: 50, LineTotal: 100 }, { LineID: 'L2', ItemCode: 'RM-001', OrderedQuantity: 1, UnitPrice: 25.5, LineTotal: 25.5 }] } };
  f.purchaseOrders = { PO1: { PODate: '2026-10-20', Status: 'Draft', PONumber: '', CompanyID: 'C1', CostCenterID: 'CC1', VendorID: 'V1', CreatedAt: '2026-10-20T08:00:00Z',
    Lines: [{ LineID: 'P1', ItemCode: 'RM-001', Description: 'Steel sheet', Quantity: 10, UnitPrice: 50, WarehouseID: 'WH1' }] } };
  await reset(f);
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-VATOUT'; c.InputAccountID = 'A-VATIN'; });
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8173);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module, rowText) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.goto('http://127.0.0.1:8173/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    const body = module === 'SALESORDER' ? '#so-table-body' : '#po-table-body';
    await page.waitForSelector(body + ' tr', T);
    await page.waitForTimeout(800);
    await page.click(body + ' tr:has-text("' + rowText + '")');
    return page;
  }
  const text = (p, sel) => p.textContent(sel).then(t => t.trim());

  await check('a Sales Order: CGST + SGST estimated at the item\'s 18% (each line\'s components rounded, as the invoice will), the total with tax; printed on the Proforma Invoice', async () => {
    const p = await open('SALESORDER', 'SO-26-01-000007');
    await p.waitForSelector('#so-tax-row:not(.hidden)', T);
    await p.waitForFunction(() => document.getElementById('so-tax-amount').textContent.trim() === '22.60', null, T);
    assert.equal(await text(p, '#so-taxtotal-amount'), '148.10');
    await p.click('#so-proforma-btn');
    await p.waitForFunction(() => window.__printed === 1, null, T);
    const doc = await text(p, '#so-print-document');
    assert.match(doc, /GST18 18%\s*22\.60/);
    assert.match(await text(p, '#so-print-taxtotal'), /Total with tax\s*148\.10/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Purchase Order: the vendor\'s IGST estimated', async () => {
    const p = await open('PURCHASEORDER', 'Draft');
    await p.waitForSelector('#po-tax-row:not(.hidden)', T);
    await p.waitForFunction(() => document.getElementById('po-tax-amount').textContent.trim() === '90.00', null, T);
    assert.equal(await text(p, '#po-taxtotal-amount'), '590.00');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('no Tax Configuration: no estimate shown', async () => {
    await firestore.collection('taxConfig').doc('C1').delete();
    const p = await open('SALESORDER', 'SO-26-01-000007');
    await p.waitForTimeout(2000);
    assert.equal(await p.isHidden('#so-tax-row'), true);
    await p.click('#so-proforma-btn');
    await p.waitForFunction(() => window.__printed === 1, null, T);
    assert.equal(await p.$('#so-print-taxtotal'), null);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
