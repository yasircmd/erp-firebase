// Foreign currency on screen (owner, 2026-10-16; docs/modules/MULTI_CURRENCY.md):
// Currency Configuration lists a currency's rates; a USD customer's new
// invoice shows the rate on its date (another rate asks for a reason) and a
// saved one its own rate and the total in AED; a USD vendor's invoice says
// direct lines only; Cash & Bank asks a USD customer's line for its USD
// amount; the statement and the aging show USD with AED beside it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/multiCurrency.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };
const D = '2026-09-10', PAY = '2026-09-20';

(async () => {
  const f = baseFixture();
  f.currencies = { CUR1: { Code: 'AED', Name: 'UAE Dirham', IsDefault: true, Status: 'Active' }, CUR2: { Code: 'USD', Name: 'US Dollar', IsDefault: false, Status: 'Active' } };
  f.coa['A-FX'] = { AccountCode: '4950', AccountName: 'Exchange Gain / Loss', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Global Imports', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', DefaultCurrency: 'USD', PaymentTermsDays: 30 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Local Trading', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0 }
  };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.vendors.V9 = { VendorCode: 'V009', VendorName: 'Overseas Supplier', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP', DefaultCurrency: 'USD' };
  await reset(f);
  ok(await call('u-admin', 'saveExchangeRate', { code: 'USD', effectiveDate: '2026-09-01', rate: 3.6725 }));
  ok(await call('u-admin', 'saveExchangeRate', { code: 'USD', effectiveDate: '2026-09-15', rate: 3.7 }));
  ok(await call('u-admin', 'saveFxSettings', { companyId: 'C1', gainLossAccountId: 'A-FX', costCenterId: 'CC1' }));
  // A posted USD invoice of 1,000, half received at 3.70; and a draft of 1,000.
  const posted = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Consulting', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 1000, Description: 'Consulting', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: posted.invoiceId }));
  const rc = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Receipt', SelectedAccountCode: '1100', JVDate: PAY, Description: 'Part payment', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '1200', Amount: '1850', FcCurrency: 'USD', FcAmount: 500, Description: 'Receipt', CostCenterID: 'CC1', PartyType: 'Customer', PartyID: 'CU1',
      Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:' + posted.invoiceId, Amount: 500 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: rc.jvId }));
  ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Draft for review', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 1000, Description: 'Consulting', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8100);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8100/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  const option = (page, sel, value) => page.waitForFunction(([s, v]) => [...document.querySelectorAll(s + ' option')].some(o => o.value === v), [sel, value], T);

  await check('Currency Configuration: Rates on the USD row lists its rates, newest first', async () => {
    const p = await open('CURRENCYCONFIG');
    await p.waitForSelector('.cc-rates-btn', T);
    await p.click('.cc-rates-btn');
    await p.waitForSelector('#cc-rates:not(.hidden) #cc-rates-body tr', T);
    const rows = await p.$$eval('#cc-rates-body tr', trs => trs.map(t => t.children[1].textContent.trim()));
    assert.deepEqual(rows, ['3.7', '3.6725']);
    assert.match(await p.textContent('#cc-rates-title'), /USD/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Invoice: a USD customer shows the rate on the date; another rate asks for a reason; a local customer none', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.click('#cinv-new-btn');
    await p.selectOption('#cinv-form-company', 'C1');
    await option(p, '#cinv-form-customer', 'CU1');
    await p.fill('#cinv-form-date', D);
    await p.selectOption('#cinv-form-customer', 'CU1');
    await p.waitForFunction(() => document.getElementById('cinv-fx-rate').value === '3.6725', null, T);
    assert.equal(await p.isVisible('#cinv-fx'), true);
    assert.equal((await p.textContent('#cinv-fx-code')).trim(), 'USD');
    assert.match(await p.textContent('#cinv-fx-note'), /2026-09-01|01\/09\/2026/);
    assert.equal(await p.isHidden('#cinv-fx-reason'), true);
    await p.fill('#cinv-fx-rate', '3.65');
    await p.waitForSelector('#cinv-fx-reason:not(.hidden)', T);
    await p.selectOption('#cinv-form-customer', 'CU2');
    await p.waitForSelector('#cinv-fx', { state: 'hidden', ...T });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Invoice: a saved USD draft shows its rate and the total in AED', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.waitForSelector('#cinv-table-body tr', T);
    await p.locator('#cinv-table-body tr', { hasText: 'Draft for review' }).first().click();
    await p.waitForFunction(() => document.getElementById('cinv-fx-rate').value === '3.6725', null, T);
    assert.equal((await p.textContent('#cinv-total-code')).trim(), 'USD');
    await p.waitForFunction(() => /3,672\.50/.test(document.getElementById('cinv-total-base-value').textContent), null, T);
    assert.equal(await p.isVisible('#cinv-total-base'), true);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Vendor Invoice: a USD vendor shows the rate and says direct lines only', async () => {
    const p = await open('VENDORINVOICE');
    await p.click('#vinv-new-btn');
    await p.selectOption('#vinv-form-company', 'C1');
    await option(p, '#vinv-form-vendor', 'V9');
    await p.fill('#vinv-form-date', D);
    await p.selectOption('#vinv-form-vendor', 'V9');
    await p.waitForFunction(() => document.getElementById('vinv-fx-rate').value === '3.6725', null, T);
    assert.match(await p.textContent('#vinv-fx'), /direct lines only, GRNs stay in AED/);
    await p.selectOption('#vinv-form-vendor', 'V1');
    await p.waitForSelector('#vinv-fx', { state: 'hidden', ...T });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Cash & Bank: a USD customer\'s line asks for its USD amount', async () => {
    const p = await open('CBT');
    await p.click('#cbt-new-btn');
    await p.click('.cbt-type-btn[data-type="Bank Receipt"]');
    await p.selectOption('#cbt-form-company', 'C1');
    await option(p, '#cbt-form-ledger', '1100');
    await p.selectOption('#cbt-form-ledger', '1100');
    const acct = p.locator('#cbt-grid-body input[data-row="0"][data-col="0"]');
    await acct.fill('1200'); await acct.blur();
    const amt = p.locator('#cbt-grid-body input[data-row="0"][data-col="2"]');
    await amt.fill('1850'); await amt.blur();
    await p.waitForSelector('.cbt-party-select', { state: 'visible', ...T });
    await p.selectOption('.cbt-party-select', 'Customer:CU1');
    await p.waitForSelector('.cbt-fc-amount', { state: 'visible', ...T });
    assert.match(await p.locator('.cbt-fc-amount').locator('xpath=..').textContent(), /USD amount/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer SOA: in USD with the AED balance beside it', async () => {
    const p = await open('CUSTOMERSOA');
    await option(p, '#soa-company', 'C1');
    await p.selectOption('#soa-company', 'C1');
    await option(p, '#soa-party', 'CU1');
    await p.selectOption('#soa-party', 'CU1');
    await p.fill('#soa-from', '2026-09-01');
    await p.fill('#soa-to', '2026-09-30');
    await p.click('#soa-run-btn');
    await p.waitForSelector('#soa-report:not(.hidden)', T);
    assert.match(await p.textContent('#soa-currency'), /Amounts in USD/);
    assert.equal(await p.isVisible('th.soa-fc-col >> nth=0'), true);
    // 1,000 USD at 3.6725 less 500 USD received at 3.70 (1,850) plus the 13.75 exchange line = 1,836.25.
    assert.equal((await p.textContent('#soa-closing')).trim(), '500.00');
    assert.equal((await p.textContent('#soa-closing-base')).trim(), '1,836.25');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Aging: the USD customer in AED, its USD net beneath', async () => {
    const p = await open('CUSTOMERAGING');
    await option(p, '#ag-company', 'C1');
    await p.selectOption('#ag-company', 'C1');
    await p.fill('#ag-asof', '2026-09-30');
    await p.click('#ag-run');
    await p.waitForSelector('.ag-row[data-id="CU1"]', T);
    const net = await p.textContent('.ag-row[data-id="CU1"] .ag-net');
    assert.match(net, /1,836\.25/);
    assert.match(net, /USD 500\.00/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
