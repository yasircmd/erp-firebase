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
  f.companies.C1.OutputTaxAccountID = 'A-VATOUT';
  f.companies.C1.PdcIssuedClearingAccountID = 'A-PDCI';
  f.coa['A-PDCI'] = { AccountCode: '2150', AccountName: 'PDC Issued Clearing', AccountType: 'Liability', Status: 'Active', IsPostable: true };
  f.coa['G-BANK'] = { AccountCode: '120000', AccountName: 'Bank Accounts', AccountType: 'Asset', Status: 'Active', IsPostable: false, OwnCashBank: 'Bank', CashBank: 'Bank' };
  f.coa['A-USDB'] = { AccountCode: '120002', AccountName: 'USD account', AccountType: 'Asset', Status: 'Active', IsPostable: true, ParentAccountID: 'G-BANK', CashBank: 'Bank', Currency: 'USD' };
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
  // After the statement's period: a taxed USD invoice, for the print.
  const taxed = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: '2026-10-01', Description: 'Taxed sale', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 200, Description: 'Consulting', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 5 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: taxed.invoiceId }));
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
    await p.waitForFunction(t => [...document.querySelectorAll('#cinv-table-body tr')].some(r => r.textContent.includes(t)), '(unposted)', T);
    await p.evaluate(t => [...document.querySelectorAll('#cinv-table-body tr')].find(r => r.textContent.includes(t)).click(), '(unposted)');
    await p.waitForFunction(() => document.getElementById('cinv-fx-rate').value === '3.6725', null, T);
    assert.equal((await p.textContent('#cinv-total-code')).trim(), 'USD');
    await p.waitForFunction(() => /3,672\.50/.test(document.getElementById('cinv-total-base-value').textContent), null, T);
    assert.equal(await p.isVisible('#cinv-total-base'), true);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the printed USD invoice gives the VAT and the total in AED at its rate', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.evaluate(() => { window.print = () => {}; });
    await p.waitForSelector('#cinv-table-body tr', T);
    await p.waitForFunction(t => [...document.querySelectorAll('#cinv-table-body tr')].some(r => r.textContent.includes(t)), '210.00', T);
    await p.evaluate(t => [...document.querySelectorAll('#cinv-table-body tr')].find(r => r.textContent.includes(t)).click(), '210.00');
    await p.waitForSelector('#cinv-print-btn:not(.hidden)', T);
    await p.click('#cinv-print-btn');
    const doc = await p.textContent('#cinv-print-document');
    // 200 USD + 5% = 210 USD at 3.70: VAT 10 USD = 37.00 AED, total 777.00 AED.
    assert.match(doc, /Total \(USD\)\s*210\.00/);
    assert.match(doc, /At 1 USD = 3\.7 AED/);
    assert.match(await p.textContent('#cinv-print-vat-base'), /VAT \(AED\)\s*37\.00/);
    assert.match(doc, /Total \(AED\)\s*777\.00/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the printed USD invoice with no VAT (an export) shows nothing in AED (decision 268)', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.evaluate(() => { window.print = () => {}; });
    await p.waitForSelector('#cinv-table-body tr', T);
    // The posted 1,000 USD invoice at 0% (the draft of the same amount is "(unposted)").
    const pick = () => { const r = [...document.querySelectorAll('#cinv-table-body tr')].find(x => x.textContent.includes('1,000.00') && !x.textContent.includes('(unposted)')); if (r) r.click(); return Boolean(r); };
    await p.waitForFunction(pick, null, T);
    await p.waitForSelector('#cinv-print-btn:not(.hidden)', T);
    await p.click('#cinv-print-btn');
    const doc = await p.textContent('#cinv-print-document');
    assert.match(doc, /Total \(USD\)\s*1,000\.00/);
    assert.doesNotMatch(doc, /AED/);
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

  await check('Chart of Accounts: a bank account shows its currency; the field is offered on a bank account only', async () => {
    const p = await open('COA');
    await p.waitForSelector('#coa-table-body .coa-currency', T);
    const row = p.locator('#coa-table-body tr', { hasText: 'USD account' }).first();
    assert.match(await row.textContent(), /USD/);
    await row.locator('.coa-edit').click();
    await p.waitForSelector('#coa-currency-field:not(.hidden)', T);
    assert.equal(await p.inputValue('#coa-form-currency'), 'USD');
    assert.deepEqual(await p.$$eval('#coa-form-currency option', os => os.map(o => o.value)), ['', 'USD'], 'not the base currency');
    await p.uncheck('#coa-form-postable');
    await p.waitForSelector('#coa-currency-field', { state: 'hidden', ...T });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Cash & Bank: the USD bank account asks for the rate and takes amounts in USD; a USD customer\'s line needs no second amount', async () => {
    const p = await open('CBT');
    await p.click('#cbt-new-btn');
    await p.click('.cbt-type-btn[data-type="Bank Receipt"]');
    await p.selectOption('#cbt-form-company', 'C1');
    await option(p, '#cbt-form-ledger', '120002');
    await p.fill('#cbt-form-date', PAY);
    await p.selectOption('#cbt-form-ledger', '120002');
    await p.waitForFunction(() => document.getElementById('cbt-fx-rate').value === '3.7', null, T);
    assert.equal((await p.textContent('#cbt-amount-head')).trim(), 'Amount (USD)');
    const acct = p.locator('#cbt-grid-body input[data-row="0"][data-col="0"]');
    await acct.fill('1200'); await acct.blur();
    const amt = p.locator('#cbt-grid-body input[data-row="0"][data-col="2"]');
    await amt.fill('100'); await amt.blur();
    await p.waitForSelector('.cbt-party-select', { state: 'visible', ...T });
    await p.selectOption('.cbt-party-select', 'Customer:CU1');
    await p.waitForTimeout(500);
    assert.equal(await p.locator('.cbt-fc-amount').count(), 0, 'the account is already in USD');
    await p.fill('#cbt-fx-rate', '3.75');
    await p.waitForSelector('#cbt-fx-reason:not(.hidden)', T);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('PDC Issued: a USD vendor\'s cheque asks for its USD amount', async () => {
    const p = await open('PDCISSUED');
    await p.click('#pdc-new-btn');
    await p.selectOption('#pdc-form-company', 'C1');
    await option(p, '#pdc-form-party', 'V9');
    await p.waitForLoadState('networkidle'); await p.waitForTimeout(3000); // the company's setup reloads the list
    await p.selectOption('#pdc-form-party', 'V9');
    await p.waitForFunction(() => !document.getElementById('pdc-fc').classList.contains('hidden'), null, T).catch(async e => {
      throw new Error(e.message + ' ' + JSON.stringify(await p.evaluate(() => [document.getElementById('pdc-form-party').value, document.getElementById('pdc-alloc-summary').textContent])) + JSON.stringify(p.__errors));
    });
    assert.equal((await p.textContent('#pdc-fc-label')).trim(), 'USD amount');
    await p.fill('.pdc-chq-amount', '370');
    await p.fill('.pdc-chq-fc', '100');
    await p.waitForFunction(() => /1 USD = 3\.7 AED/.test(document.getElementById('pdc-fc-note').textContent), null, T);
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
    await p.waitForFunction(() => /1,836\.25/.test((document.querySelector('.ag-row[data-id="CU1"] .ag-net') || {}).textContent || ''), null, T);
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
