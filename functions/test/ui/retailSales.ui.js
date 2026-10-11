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
  // Counter staff: sell, but no "report" right (owner, 2026-10-09).
  f.roles.Cashier = { Name: 'Cashier', Status: 'Active' };
  f.users['u-cash1'] = { status: 'Active', role: 'Cashier', username: 'cash1', fullName: 'Cashier One', AssignedCompanies: ['C1'] };
  f.permissions.RETAILSALES.access.push('Cashier');
  f.permissions.RETAILSALES.post.push('Cashier');
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
    // A new setup: discounts on, an 80 mm roll, not printed on Confirm (decisions 114-116); A4 here for the invoice checks below.
    assert.deepEqual([await p.isChecked('#rs-s-discount'), await p.inputValue('#rs-s-paper'), await p.isChecked('#rs-s-printconfirm')], [true, '80', false]);
    await p.selectOption('#rs-s-paper', 'A4');
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
  await check('the counter: items by code, cash over-tendered with a card, the change shown; confirmed; the invoice prints with no customer block and no Discount column', async () => {
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
    // No line has a discount: no Discount column (owner, 2026-10-09).
    assert.equal(await p.locator('#rs-print-document .rs-col-discount').count(), 0);
    assert.deepEqual(await p.locator('#rs-print-document thead th').allTextContents(), ['Item', 'Qty', 'Price', 'Amount']);
    assert.equal(await p.locator('#rs-print-document tbody tr:first-child td').count(), 4);
    assert.match(await p.textContent('#rs-print-document'), /Tax Invoice/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('an existing customer: their details on the invoice; a line discount, so the Discount column prints; a balance left on account', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    await p.selectOption('#rs-customer', 'CU1');
    assert.equal(await p.inputValue('#rs-billto-name'), 'Beta Trading');
    await p.fill('#rs-item', 'RM-001');
    await p.press('#rs-item', 'Enter');
    await p.fill('#rs-lines [data-f="Discount"]', '2.5');
    await until(p, () => document.getElementById('rs-total').textContent === '50.00');
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '40');
    await until(p, () => document.getElementById('rs-due') && document.getElementById('rs-due').textContent === '10.00');
    await p.click('#rs-confirm');
    await until(p, () => !document.getElementById('rs-sale-view').classList.contains('hidden'));
    assert.match(p.__dialogs[0], /Left on account 10\.00/);
    // A line with a discount: the Discount column is printed.
    assert.deepEqual(await p.locator('#rs-print-document thead th').allTextContents(), ['Item', 'Qty', 'Price', 'Discount', 'Amount']);
    assert.equal(await p.textContent('#rs-print-document tbody tr:first-child td:nth-child(4)'), '2.50');
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

  await check('Clear asks first once something is entered: Cancel keeps the sale, OK clears it; an empty sale clears without asking', async () => {
    const p = await browser.newPage();
    p.__errors = []; p.__dialogs = []; p.__answer = false;
    p.on('pageerror', e => p.__errors.push(e.message));
    await onAppDialog(p, d => { p.__dialogs.push(d.message()); return p.__answer ? d.accept() : d.dismiss(); });
    await p.goto('http://127.0.0.1:8178/?module=RETAILSALES&uid=u-admin');
    await p.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    await p.fill('#rs-item', 'RM-001');
    await p.press('#rs-item', 'Enter');
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '60');
    await p.click('#rs-clear');
    for (let i = 0; i < 150 && !p.__dialogs.length; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 500)); // the Cancel answered
    assert.equal(await p.locator('#rs-lines tr[data-i]').count(), 1, 'Cancel: the sale is kept');
    assert.equal(await p.inputValue('#rs-payments [data-i="0"] [data-f="Amount"]'), '60');
    p.__answer = true;
    await p.click('#rs-clear');
    await until(p, () => !document.querySelector('#rs-lines tr[data-i]'));
    assert.equal(await p.inputValue('#rs-payments [data-i="0"] [data-f="Amount"]'), '');
    await p.click('#rs-clear');
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(p.__dialogs, ['Clear this sale? 1 line and the payments entered will be removed.', 'Clear this sale? 1 line and the payments entered will be removed.'], 'nothing asked for an empty sale');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('scanning the product\'s own barcode adds the item; a carton\'s adds its units; an unknown barcode is named', async () => {
    const item = (await call('u-admin', 'getRetailCounter', { companyId: 'C1' })).items[0];
    await call('u-admin', 'saveItemBarcodes', { itemId: item.ItemID, barcodes: [{ Barcode: '6291041500213' }, { Barcode: '16291041500210', PackQty: 12 }] });
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    const scan = async code => { await p.fill('#rs-item', code); await p.press('#rs-item', 'Enter'); };
    await scan('6291041500213');
    assert.equal(await p.inputValue('#rs-lines tr[data-i="0"] [data-f="Quantity"]'), '1');
    assert.match(await p.textContent('#rs-lines tr[data-i="0"]'), new RegExp(item.ItemCode));
    await scan('16291041500210');
    assert.equal(await p.inputValue('#rs-lines tr[data-i="0"] [data-f="Quantity"]'), '13', 'the carton adds 12');
    await scan('4006381333931');
    for (let i = 0; i < 50 && p.__dialogs.length < 1; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(p.__dialogs, ['No item with barcode 4006381333931 for this company.']);
    assert.equal(await p.locator('#rs-lines tr[data-i]').count(), 1);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('counter staff: only the sales they billed, no "Billed by" filter; the manager: everyone\'s, filtered; payment-wise report and Copy to Excel', async () => {
    // A sale by the cashier, so there are two people's sales.
    const methods = await val('retailSales/paymentMethods');
    const cashId = Object.keys(methods).find(id => methods[id].Name === 'Cash');
    const today = new Date().toISOString().substring(0, 10);
    const own = await call('u-cash1', 'confirmRetailSale', { CompanyID: 'C1', SaleDate: today, Lines: [{ ItemID: 'I1', Quantity: 1 }], Payments: [{ MethodID: cashId, Amount: 60 }] });
    const c = await open('RETAILSALES', 'u-cash1');
    await until(c, () => document.getElementById('rs-items').options.length === 1);
    await c.click('.rs-tab[data-tab="sales"]');
    await c.fill('#rs-from', today); await c.fill('#rs-to', today); await c.click('#rs-run');
    await until(c, () => document.querySelectorAll('#rs-sales-body tr[data-id]').length === 1);
    assert.equal(await c.getAttribute('#rs-sales-body tr[data-id]', 'data-id'), own.saleId);
    assert.ok(await c.isVisible('#rs-own-note'));
    assert.ok(!(await c.isVisible('#rs-billedby')));
    assert.deepEqual([c.__errors, c.__dialogs], [[], []]);
    await c.close();

    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await context.newPage();
    p.__errors = []; p.__dialogs = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    await onAppDialog(p, d => { p.__dialogs.push(d.message()); d.accept(); });
    await p.goto('http://127.0.0.1:8178/?module=RETAILSALES&uid=u-admin');
    await until(p, () => window.__moduleReady === true);
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    await p.click('.rs-tab[data-tab="sales"]');
    await p.fill('#rs-from', today); await p.fill('#rs-to', today); await p.click('#rs-run');
    await until(p, () => document.querySelectorAll('#rs-sales-body tr[data-id]').length === 4);
    assert.ok(!(await p.isVisible('#rs-own-note')));
    assert.deepEqual(await p.locator('#rs-billedby option').allTextContents(), ['Everyone', 'admin', 'cash1']);
    await p.selectOption('#rs-billedby', 'cash1');
    await p.click('#rs-run');
    await until(p, () => document.querySelectorAll('#rs-sales-body tr[data-id]').length === 1);
    await p.selectOption('#rs-billedby', '');
    await p.click('#rs-run');
    await until(p, () => document.querySelectorAll('#rs-sales-body tr[data-id]').length === 4);
    // Payment-wise: the live sales' payments by method, a subtotal each, the total taken.
    await p.selectOption('#rs-view', 'payments');
    assert.ok(await p.isVisible('#rs-payments-wrap'));
    assert.ok(!(await p.isVisible('#rs-sales-wrap')));
    const subtotals = await p.locator('#rs-payments-body tr.rs-pay-subtotal').allTextContents();
    // The first sale was reversed above: its card and cash are out.
    assert.deepEqual(subtotals, ['Cash — 2 payments92.50']);
    await p.click('#rs-copy');
    await until(p, () => /Copied!/.test(document.getElementById('rs-copy').textContent));
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    const lines = clip.split('\n');
    assert.equal(lines[0], 'Method\tDate\tNumber\tCustomer\tReference\tBilled by\tAmount');
    assert.match(lines[1], /^Cash\t\d{2}\/\d{2}\/\d{4}\tRS-\d{2}-01-\d{6}\tBeta Trading\t\tadmin\t40\.00$/);
    assert.equal(lines[2].split('\t').slice(-2).join('|'), 'cash1|52.50');
    assert.equal(lines[3], 'Cash total\t\t\t\t\t\t92.50');
    // The sales view copies its own columns.
    await p.selectOption('#rs-view', 'sales');
    await p.click('#rs-copy');
    // Wait for the new copy itself: the first copy's "Copied!" may still show.
    await until(p, () => navigator.clipboard.readText().then(t => t.startsWith('Date\t')));
    const sales = (await p.evaluate(() => navigator.clipboard.readText())).split('\n');
    assert.equal(sales[0], 'Date\tNumber\tCustomer\tPayments\tTotal\tOn account\tBilled by\tStatus');
    assert.equal(sales.length, 5);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await context.close();
  });

  await check('the sales list: an older request answering late never puts back its rows or resets "Billed by"', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    const today = new Date().toISOString().substring(0, 10);
    await p.click('.rs-tab[data-tab="sales"]');
    await p.fill('#rs-from', today); await p.fill('#rs-to', today); await p.click('#rs-run');
    await until(p, () => document.querySelectorAll('#rs-billedby option').length === 3);
    // Everyone's list is slow to answer; cash1's, asked for after it, comes first.
    let slow = true;
    await p.route('**/getRetailSales', async route => {
      if (slow) { slow = false; await new Promise(r => setTimeout(r, 2500)); }
      await route.continue();
    });
    await p.click('#rs-run');
    await p.selectOption('#rs-billedby', 'cash1');
    // The slow answer comes while cash1 is chosen: the choice stays.
    await p.waitForTimeout(3500);
    assert.equal(await p.inputValue('#rs-billedby'), 'cash1');
    // Everyone's again, slow; then cash1's, which answers first.
    await p.selectOption('#rs-billedby', '');
    slow = true;
    await p.click('#rs-run');
    await p.selectOption('#rs-billedby', 'cash1');
    await p.click('#rs-run');
    await until(p, () => document.querySelectorAll('#rs-sales-body tr[data-id]').length === 1);
    await p.waitForTimeout(3500); // the slow, older answer has come by now
    assert.equal(await p.locator('#rs-sales-body tr[data-id]').count(), 1);
    assert.equal(await p.inputValue('#rs-billedby'), 'cash1');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Setup: discounts off, an 80 mm roll with a footer, printed on Confirm: no Discount column at the counter; the receipt prints by itself, on the roll; 58 mm narrower (owner, 2026-10-10)', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await until(p, () => document.getElementById('rs-items').options.length === 1);
    await p.click('.rs-tab[data-tab="setup"]');
    await p.uncheck('#rs-s-discount');
    await p.selectOption('#rs-s-paper', '80');
    await p.fill('#rs-s-footer', 'Thank you for shopping');
    await p.check('#rs-s-printconfirm');
    await p.click('#rs-s-save');
    await until(p, () => document.querySelectorAll('#rs-col-discount.hidden').length === 1);
    const st = await val('retailSales/settings/C1');
    assert.deepEqual([st.AllowDiscount, st.ReceiptPaper, st.ReceiptFooter, st.PrintOnConfirm], [false, '80', 'Thank you for shopping', true]);
    await p.click('.rs-tab[data-tab="counter"]');
    await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await p.fill('#rs-item', 'RM-001');
    await p.press('#rs-item', 'Enter');
    await until(p, () => document.getElementById('rs-total') && document.getElementById('rs-total').textContent === '52.50');
    assert.equal(await p.locator('#rs-lines [data-f="Discount"]').count(), 0, 'no Discount field at the counter');
    await p.fill('#rs-payments [data-i="0"] [data-f="Amount"]', '60');
    await p.click('#rs-confirm');
    await until(p, () => window.__printed === 1);
    assert.equal(await p.locator('#rs-print-document .rs-roll-80').count(), 1);
    assert.equal(await p.locator('#rs-print-document table').count(), 0, 'no bordered table on the roll');
    const roll = await p.textContent('#rs-print-document .rs-roll');
    assert.match(roll, /Tax Invoice[\s\S]*Invoice RS-[\s\S]*RM-001[\s\S]*1 × 52\.50\s*52\.50[\s\S]*Total\s*52\.50[\s\S]*Cash\s*60\.00[\s\S]*Change\s*7\.50[\s\S]*Thank you for shopping/);
    assert.match(await p.innerHTML('#rs-print-document'), /\.rs-roll \{ width: 72mm;/);
    // 58 mm: the narrower width.
    await call('u-admin', 'saveRetailSalesSettings', Object.assign({ companyId: 'C1', salesTypeId: 'ST1', warehouseId: 'WH1', costCenterId: 'CC1', receivablesAccountId: 'A-AR', priceListId: 'PL1', taxPercent: 5 }, { receiptPaper: '58', allowDiscount: false, printOnConfirm: true }));
    const sid = await p.evaluate(() => { const v = document.getElementById('rs-sale-view'); return v && document.querySelector('#rs-sales-body tr[data-id]') ? document.querySelector('#rs-sales-body tr[data-id]').dataset.id : ''; });
    await p.click('#rs-sales-body tr[data-id="' + sid + '"]');
    await until(p, () => !!document.querySelector('#rs-print-document .rs-roll-58'));
    assert.equal(await p.evaluate(() => window.__printed), 1, 'opening a sale never prints by itself');
    await p.click('#rs-print');
    await until(p, () => window.__printed === 2);
    assert.match(await p.innerHTML('#rs-print-document'), /\.rs-roll \{ width: 48mm;/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
