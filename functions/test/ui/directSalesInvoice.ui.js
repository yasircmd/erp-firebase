// Direct sales invoice on screen (owner, 2026-10-16; docs/modules/
// DIRECT_SALES_INVOICE.md): the setting in Sales Invoice Configuration; on
// the invoice, an item typed (warehouse, quantity, the price list's price)
// and a line brought in from a Sales Order (locked to the order); posted, a
// Delivery Note is made for them; the invoice says so and prints a delivery
// slip without prices. Off, the item lines are not offered.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/directSalesInvoice.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };
const D = '2026-09-10';

(async () => {
  const f = baseFixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'AED' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 60, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } } };
  await reset(f);
  const so = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 5, UnitPrice: 50 }] } }));
  ok(await call('u-admin', 'confirmSalesOrder', { soId: so.soId }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8165);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8165/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  async function newInvoice(p) {
    await p.click('#cinv-new-btn');
    await p.selectOption('#cinv-form-company', 'C1');
    await p.selectOption('#cinv-form-customer', 'CU1');
    await p.selectOption('#cinv-form-costcenter', 'CC1');
    await p.fill('#cinv-form-date', D);
    await p.fill('#cinv-form-description', 'Counter sale');
  }

  await check('off by default: no item lines on the invoice', async () => {
    const p = await open('CUSTOMERINVOICE');
    await newInvoice(p);
    await p.waitForTimeout(1500);
    assert.ok(await p.isHidden('#cinv-items-section'));
    await p.close();
  });

  await check('Sales Invoice Configuration: switched on for the company', async () => {
    const p = await open('SALESINVOICESETUP');
    await p.selectOption('#sis-ds-company', 'C1');
    await p.waitForSelector('#sis-ds-on:not([disabled])', T);
    assert.equal(await p.isChecked('#sis-ds-on'), false);
    await p.check('#sis-ds-on');
    await p.click('#sis-ds-save');
    await p.waitForFunction(() => document.getElementById('sis-ds-note').textContent === 'Saved.', null, T);
    assert.deepEqual(await call('u-admin', 'getInvoiceStockSettings', { companyId: 'C1' }), { DirectStock: true });
    await p.close();
  });

  await check('an item typed (the price list\'s price) and a Sales Order line (locked to the order); posted, delivered with a Delivery Note', async () => {
    const p = await open('CUSTOMERINVOICE');
    await newInvoice(p);
    await p.waitForSelector('#cinv-items-section:not(.hidden)', T);
    await p.waitForFunction(() => /Retail/.test(document.getElementById('cinv-pricelist-note').textContent), null, T);
    await p.click('#cinv-item-add-btn');
    const row = '#cinv-item-body tr[data-i="0"] ';
    await p.fill(row + '[data-f="ItemCode"]', 'RM-001');
    await p.dispatchEvent(row + '[data-f="ItemCode"]', 'change');
    await p.waitForFunction(r => document.querySelector(r + '[data-f="UnitPrice"]').value === '60', row, T);
    await p.selectOption(row + '[data-f="WarehouseID"]', 'WH1');
    await p.fill(row + '[data-f="Quantity"]', '2');
    await p.click('#cinv-item-so-btn');
    await p.waitForSelector('#cinv-so-picker:not(.hidden) .cinv-so-pick', T);
    await p.check('.cinv-so-pick[data-i="0"]');
    await p.fill('.cinv-so-qty[data-i="0"]', '3');
    await p.click('#cinv-so-add');
    assert.equal(await p.isDisabled('#cinv-item-body tr[data-i="1"] [data-f="UnitPrice"]'), true, 'the order\'s price, locked');
    await p.selectOption('#cinv-item-salestype', 'ST1');
    // 2 × 60 + 3 × 50
    await p.waitForFunction(() => document.getElementById('cinv-subtotal-display').textContent.trim() === '270.00', null, T);
    await p.click('#cinv-post-btn');
    await p.click('#cinv-confirm-ok');
    await p.waitForSelector('#cinv-list-view:not(.hidden)', T);
    const inv = Object.values(await val('customerInvoices')).find(x => x.Status === 'Posted' && !x.ReversalOfInvoiceID);
    assert.ok(inv && inv.AutoDeliveryNoteID, 'posted with its delivery: ' + JSON.stringify(p.__dialogs));
    assert.equal(inv.Total, 270);
    assert.equal((await val('salesOrders/' + so.soId)).Lines[0].DeliveredQuantity, 3);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the posted invoice says it was delivered and prints a delivery slip without prices', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await p.waitForSelector('#cinv-table-body tr', T);
    await p.click('#cinv-table-body tr >> nth=0');
    await p.waitForSelector('#cinv-print-slip-btn:not(.hidden)', T);
    assert.match(await p.textContent('#cinv-item-delivered'), /Delivered with Delivery Note DN-/);
    assert.equal(await p.isHidden('#cinv-item-actions'), true, 'no adding to a posted invoice');
    await p.click('#cinv-print-slip-btn');
    assert.equal(await p.evaluate(() => window.__printed), 1);
    const slip = await p.textContent('#cinv-print-document');
    assert.match(slip, /DELIVERY SLIP[\s\S]*Retail Co[\s\S]*RM-001[\s\S]*2[\s\S]*RM-001[\s\S]*3/);
    assert.doesNotMatch(slip, /60\.00|50\.00|270/, 'no prices');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
