// GRN and Delivery Note lists: the Invoice column (Pending invoice / On
// draft invoice / invoice number), the invoicing filter with its count and
// value, and the invoice number opening the invoice (owner, 2026-09-28).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/invoiceState.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = '2026-09-10';

async function seed() {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  const dn = n => ({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'DN-00' + n, TransactionDate: D,
    Description: 'Delivery ' + n, CreatedAt: '2026-09-10T00:00:0' + n, Lines: [{ ItemCode: 'RM-001', Quantity: n, UnitPrice: 100, CostCenterID: 'CC1' }] });
  const grn = n => ({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionNumber: 'GRN-00' + n, TransactionDate: D,
    Description: 'Receipt ' + n, CreatedAt: '2026-09-10T00:00:0' + n, Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', Direction: 'In', Quantity: n, UnitCost: 10, TotalValue: n * 10 }] });
  f.stock = { transactions: { G1: grn(1), G2: grn(2), G3: grn(3), N1: dn(1), N2: dn(2), N3: dn(3) } };
  await reset(f);
  // G1 / N1 invoiced, G2 / N2 on a draft invoice, G3 / N3 pending.
  const vi = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Bill', VendorRefNumber: 'A-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [{ GRNID: 'G1' }], DirectLines: [] } });
  await call('u-admin', 'postVendorInvoice', { invoiceId: vi.invoiceId });
  await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Bill 2', VendorRefNumber: 'A-2', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [{ GRNID: 'G2' }], DirectLines: [] } });
  const ci = await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Inv', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }], DirectLines: [] } });
  await call('u-admin', 'postCustomerInvoice', { invoiceId: ci.invoiceId });
  await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Inv 2', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', SourceDeliveryNotes: [{ DeliveryNoteID: 'N2', SalesTypeID: 'ST1' }], DirectLines: [] } });
}

(async () => {
  await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8144);
  const browser = await chromium.launch();

  async function open(module) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await page.goto('http://127.0.0.1:8144/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  // Number → Invoice cell text, for the rows shown.
  const rows = (page, body) => page.evaluate(b => Object.fromEntries([...document.querySelectorAll('#' + b + ' tr')].map(tr => {
    const td = tr.querySelectorAll('td'); return [td[0].textContent.trim(), td[td.length - 2].textContent.trim()];
  })), body);

  for (const [mod, p, body, nums, invoiceRe, target] of [
    ['GRN', 'grn', 'grn-table-body', ['GRN-001', 'GRN-002', 'GRN-003'], /^VINV-/, 'VENDORINVOICE'],
    ['DELIVERYNOTE', 'dn', 'dn-table-body', ['DN-001', 'DN-002', 'DN-003'], /^CINV-/, 'CUSTOMERINVOICE']
  ]) {
    await check(mod + ': Invoice column, invoicing filter with count and value, invoice number opens the invoice', async () => {
      const page = await open(mod);
      // The list itself, not just a quiet network: a slow emulator can still
      // be showing "No ... found." (one cell) after networkidle.
      await page.waitForFunction(([b, n]) => [...document.querySelectorAll('#' + b + ' tr td:first-child')].some(td => td.textContent.trim() === n), [body, nums[2]], { timeout: 30000 });
      const all = await rows(page, body);
      assert.match(all[nums[0]], invoiceRe, 'invoiced shows the invoice number');
      assert.equal(all[nums[1]], 'On draft invoice');
      assert.equal(all[nums[2]], 'Pending invoice');

      await page.selectOption('#' + p + '-invoice-filter', 'Pending');
      await page.waitForTimeout(300);
      assert.deepEqual(Object.keys(await rows(page, body)), [nums[2]]);
      const value = mod === 'GRN' ? '30.00' : '300.00';
      assert.equal(await page.textContent('#' + p + '-invoice-summary'), '1 pending invoice — value ' + value);
      await page.selectOption('#' + p + '-invoice-filter', 'OnDraftInvoice');
      await page.waitForTimeout(300);
      assert.deepEqual(Object.keys(await rows(page, body)), [nums[1]]);
      await page.selectOption('#' + p + '-invoice-filter', '');
      await page.waitForTimeout(300);
      assert.ok(!(await page.isVisible('#' + p + '-invoice-summary')));

      await page.evaluate(() => { window.__opened = []; const o = window.openModule; window.openModule = (m, params) => { window.__opened.push([m, params && params.OpenEntryId]); }; });
      await page.click('.' + p + '-inv-link >> nth=0');
      const opened = await page.evaluate(() => window.__opened);
      assert.equal(opened.length, 1);
      assert.equal(opened[0][0], target);
      assert.ok(opened[0][1], 'with the invoice id');
      assert.ok(await page.isVisible('#' + p + '-list-view'), 'the row click did not also open the entry');
      assert.deepEqual(page.__errors, []);
      await page.close();
    });
  }

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
