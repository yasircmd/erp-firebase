// Retail Sales on screen (owner, 2026-10-09; docs/modules/RETAIL_SALES.md):
// the Setup tab creates the Retail Customer and a payment method; the
// counter adds items by code, splits the payment (cash over-tendered,
// card), shows the change and confirms; the invoice prints without a
// customer block when no details were entered, with one when they were; a
// sale is reversed with a reason; a sale's journal opens the sale.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/retailSales.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-CARD': { AccountCode: '1150', AccountName: 'Card Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-DISC': { AccountCode: '4100', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISC', OutputTaxAccountID: 'A-VATOUT' });
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } } } };
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Local Sales', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Beta Trading', Classification: 'Local', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', AddressLine1: 'Dubai', TaxRegistrationNumber: '100200300' } };
  f.customerCounters = { CL: 1 };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active' } };
  f.priceListLines = { P1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 52.5, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  await reset(f);
  await call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: { Name: 'Card', Kind: 'Card', AccountID: 'A-CARD', NeedsReference: true } });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8178);
  const browser = await chromium.launch();
  async function open(module, uid, answer) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(answer ? answer(d) : undefined); });
    await page.goto('http://127.0.0.1:8178/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });

  await check('Setup: saving creates the Retail Customer; a Cash method mapped to its ledger', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => !document.getElementById('rs-no-setup').classList.contains('hidden'));
    await p.click('.rs-tab[data-tab="setup"]');
    await p.selectOption('#rs-s-salestype', 'ST1');
    await p.selectOption('#rs-s-warehouse', 'WH1');
    await p.selectOption('#rs-s-costcenter', 'CC1');
    await p.selectOption('#rs-s-pricelist', 'PL1');
    await p.selectOption('#rs-s-receivables', 'A-AR');
    await p.fill('#rs-s-tax', '5');
    await p.click('#rs-s-save');
    await until(p, () => /Retail Customer \(CL-000002\)/.test(document.getElementById('rs-s-customer').textContent));
    await p.click('#rs-m-add');
    const row = '#rs-methods tr:last-child';
    await p.fill(row + ' [data-f="Name"]', 'Cash');
    await p.selectOption(row + ' [data-f="AccountID"]', 'A-CASH');
    await p.click(row + ' .rs-m-save');
    await until(p, () => document.querySelectorAll('#rs-methods tr[data-id^="RPM-"]').length === 2);
    assert.deepEqual(p.__dialogs, ['Setup saved.', 'Payment method saved.']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  let saleId = '';
  await check('the counter: items by code, cash over-tendered with a card, the change shown; confirmed; the invoice prints with no customer block', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => !document.getElementById('rs-counter-body').classList.contains('hidden') && document.getElementById('rs-items').options.length === 1);
    assert.equal(await p.inputValue('#rs-customer'), (await val('retailSales/settings/C1')).RetailCustomerID);
    await p.fill('#rs-item', 'RM-001');
    await p.press('#rs-item', 'Enter');
    await p.fill('#rs-item', 'rm-001');
    await p.press('#rs-item', 'Enter');
    await until(p, () => document.getElementById('rs-total').textContent === '105.00');
    // Cash (the default row) 100, card 5: no change yet; then cash 120 → change 20.
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '100');
    assert.ok(await p.isDisabled('#rs-confirm'));
    await p.click('#rs-add-pay');
    await p.selectOption('#rs-payments [data-i="1"] [data-f="MethodID"]', { label: 'Card' });
    await p.fill('#rs-payments [data-i="1"] [data-f="Amount"]', '5');
    await p.fill('#rs-payments [data-i="1"] [data-f="Reference"]', 'SLIP-9');
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '120');
    await until(p, () => document.getElementById('rs-change') && document.getElementById('rs-change').textContent === '20.00');
    await p.click('#rs-confirm');
    await until(p, () => !document.getElementById('rs-sale-view').classList.contains('hidden'));
    assert.match(p.__dialogs[0], /^Sale RS-\d{2}-01-\d{6} confirmed: 105\.00\. Change 20\.00\.$/);
    const sales = Object.entries(await val('stock/transactions')).filter(([, t]) => t.TransactionType === 'RetailSale');
    assert.equal(sales.length, 1);
    saleId = sales[0][0];
    assert.deepEqual(sales[0][1].Payments.map(x => [x.Name, x.Posted]), [['Cash', 100], ['Card', 5]]);
    assert.equal(await p.locator('#rs-print-document .rs-billto').count(), 0);
    assert.match(await p.textContent('#rs-print-document'), /Tax Invoice/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('an existing customer: their details on the invoice; a balance left on account', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    await p.selectOption('#rs-customer', 'CU1');
    assert.equal(await p.inputValue('#rs-billto-name'), 'Beta Trading');
    await p.fill('#rs-item', 'RM-001');
    await p.press('#rs-item', 'Enter');
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '50');
    await until(p, () => document.getElementById('rs-due') && document.getElementById('rs-due').textContent === '2.50');
    await p.click('#rs-confirm');
    await until(p, () => !document.getElementById('rs-sale-view').classList.contains('hidden'));
    assert.match(p.__dialogs[0], /Left on account 2\.50/);
    assert.match(await p.textContent('#rs-print-document .rs-billto'), /Beta Trading.*Dubai.*TRN 100200300/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a sale reversed with a reason; its journal opens the sale', async () => {
    const p = await open('RETAILSALES', 'u-admin', d => (d.type() === 'prompt' ? 'Wrong item' : undefined));
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    const jv = (await val('stock/transactions/' + saleId)).LinkedJVID;
    await p.evaluate(id => openModule('RETAILSALES', { OpenEntryId: id }), jv);
    await until(p, () => !document.getElementById('rs-sale-view').classList.contains('hidden') && /RS-/.test(document.getElementById('rs-sale-heading').textContent));
    await p.click('#rs-reverse');
    await until(p, () => /reversed: Wrong item/.test(document.getElementById('rs-sale-heading').textContent));
    assert.match(p.__dialogs[0], /^Reverse sale RS-.* \(105\.00\)\?/);
    assert.match(p.__dialogs[1], /^Sale reversed: RS-/);
    assert.equal((await val('stock/ledger/I1/WH1')).Quantity, 9);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Viewer sees the counter but cannot confirm or change the setup', async () => {
    const p = await open('RETAILSALES', 'u-viewer');
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    await p.fill('#rs-item', 'RM-001');
    await p.press('#rs-item', 'Enter');
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '60');
    assert.ok(await p.isDisabled('#rs-confirm'));
    await p.click('.rs-tab[data-tab="setup"]');
    assert.ok(await p.isDisabled('#rs-s-save'));
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
