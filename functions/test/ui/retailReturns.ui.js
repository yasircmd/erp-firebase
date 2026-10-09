// Retail Sales, partial returns on screen (owner, 2026-10-09;
// docs/modules/RETAIL_SALES.md, decisions 76-79): the printed invoice
// carries its number as a barcode; the Returns tab finds the sale by the
// number (scanned or typed, Enter), takes the quantities, shows the refund
// the original way (the promotion reversed; a card share paid in cash on
// request), asks the reason and confirms; the return receipt; a sale with
// returns offers "Return items", not "Reverse sale"; the cash-up nets the
// returns; a return reversed with a reason; the Setup's return period;
// without the "return" right, no Returns tab.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/retailReturns.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const TODAY = new Date().toISOString().substring(0, 10);

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-CARD': { AccountCode: '1150', AccountName: 'Card Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-PROMO': { AccountCode: '6200', AccountName: 'Promotional Discounts', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SRET': { AccountCode: '4050', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, { OutputTaxAccountID: 'A-VATOUT' });
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } } } };
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Local Sales', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' } };
  f.customerCounters = { CL: 1 };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active' } };
  f.priceListLines = { P1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 50, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.roles.Cashier = { Name: 'Cashier', Status: 'Active' };
  f.users['u-cash1'] = { status: 'Active', role: 'Cashier', username: 'cash1', fullName: 'Cashier One', AssignedCompanies: ['C1'] };
  f.permissions.RETAILSALES.access.push('Cashier');
  f.permissions.RETAILSALES.post.push('Cashier');
  await reset(f);
  await call('u-admin', 'saveRetailSalesSettings', { companyId: 'C1', salesTypeId: 'ST1', warehouseId: 'WH1', costCenterId: 'CC1', receivablesAccountId: 'A-AR', priceListId: 'PL1', taxPercent: 5 });
  const M = {
    cash: (await call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: { Name: 'Cash', Kind: 'Cash', AccountID: 'A-CASH' } })).methodId,
    card: (await call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: { Name: 'Card', Kind: 'Card', AccountID: 'A-CARD' } })).methodId,
    promo: (await call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: { Name: 'Promotion Code', Kind: 'Promotion', AccountID: 'A-PROMO' } })).methodId
  };
  // 4 × 50 = 200: card 120, promotion 20, cash 60.
  const sale = await call('u-admin', 'confirmRetailSale', { CompanyID: 'C1', SaleDate: TODAY, Lines: [{ ItemID: 'I1', Quantity: 4 }],
    Payments: [{ MethodID: M.card, Amount: 120 }, { MethodID: M.promo, Amount: 20, Reference: 'P-1' }, { MethodID: M.cash, Amount: 60 }] });
  const number = (await val('stock/transactions/' + sale.saleId)).TransactionNumber;
  // The emulator starts each function on its first call: start the slow ones before the browser times them.
  await call('u-admin', 'findRetailSaleForReturn', { companyId: 'C1', number });
  await call('u-admin', 'confirmRetailReturn', { preview: true, saleId: sale.saleId, Lines: [{ SaleLineNo: 1, Quantity: 1 }] });
  await call('u-admin', 'reverseRetailReturn', { returnId: 'none', reason: 'x' }).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8185);
  const browser = await chromium.launch();
  async function open(module, uid, answer) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(answer ? answer(d) : undefined); });
    await page.goto('http://127.0.0.1:8185/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('rs-counter-body').classList.contains('hidden'), null, { timeout: 30000 });
    return page;
  }
  const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const dialogs = async (p, n) => { for (let i = 0; i < 150 && p.__dialogs.length < n; i++) await new Promise(r => setTimeout(r, 100)); };

  await check('the printed invoice carries its number as a barcode', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await p.click('.rs-tab[data-tab="sales"]');
    await until(p, id => !!document.querySelector('#rs-sales-body tr[data-id="' + id + '"]'), sale.saleId);
    await p.click('#rs-sales-body tr[data-id="' + sale.saleId + '"]');
    await until(p, () => !!document.querySelector('#rs-print-document .rs-number-barcode svg'));
    assert.ok((await p.textContent('#rs-print-document .rs-number-barcode svg text')) === number);
    assert.ok(await p.isVisible('#rs-return-items'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  let returnId = '';
  await check('Returns: the number scanned (Enter) finds the sale; 1 of 4 back; the refund the original way, the promotion reversed, the card share paid in cash; reason asked; confirmed; the return receipt', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    assert.ok(await p.isVisible('#rs-returns-tab'));
    await p.click('#rs-returns-tab');
    await p.fill('#rs-ret-number', number.toLowerCase());
    await p.press('#rs-ret-number', 'Enter');
    await until(p, () => !document.getElementById('rs-ret-body').classList.contains('hidden'));
    assert.match(await p.textContent('#rs-ret-sale'), new RegExp(number + '[\\s\\S]*total 200\\.00[\\s\\S]*billed by admin'));
    assert.equal(await p.inputValue('#rs-ret-number'), '', 'cleared for the next scan');
    assert.ok(await p.isDisabled('#rs-ret-confirm'));
    await p.fill('.rs-ret-qty[data-line="1"]', '1');
    await until(p, () => document.querySelectorAll('#rs-ret-refunds .rs-ret-refund').length === 3);
    // 50 of 200: card 30, promotion 5 (reversed), cash 15.
    assert.deepEqual(await p.$$eval('#rs-ret-refunds .rs-ret-amount', x => x.map(e => e.textContent)), ['30.00', '5.00', '15.00']);
    assert.match(await p.textContent('#rs-ret-refunds'), /Promotion Code\s*reversed \(not paid out\)/);
    assert.equal(await p.textContent('#rs-ret-total'), '50.00');
    assert.equal(await p.textContent('#rs-ret-payback'), '45.00');
    // The card terminal is down: pay the card's share in cash.
    await p.selectOption('#rs-ret-refunds select[data-row="0"]', M.cash);
    await until(p, () => !document.getElementById('rs-ret-confirm').disabled);
    await p.click('#rs-ret-confirm');
    await dialogs(p, 1);
    assert.deepEqual(p.__dialogs.splice(0), ['Enter the reason for the return.']);
    await p.fill('#rs-ret-reason', 'Wrong size');
    await p.click('#rs-ret-confirm');
    await dialogs(p, 1);
    assert.match(p.__dialogs[0], /^Return RR-\S+ confirmed: 50\.00 returned\. Pay back Cash 30\.00, Cash 15\.00\.$/);
    const t = Object.entries(await val('stock/transactions')).find(([, x]) => x.TransactionType === 'RetailReturn');
    returnId = t[0];
    assert.deepEqual(t[1].Refunds.map(r => [r.FromName, r.Name, r.Amount]), [['Card', 'Cash', 30], ['Promotion Code', 'Promotion Code', 5], ['Cash', 'Cash', 15]]);
    // The return opens in the Sales tab with its receipt.
    await until(p, () => /return of/.test(document.getElementById('rs-sale-heading').textContent));
    const doc = await p.textContent('#rs-print-document');
    assert.match(doc, /Return Receipt[\s\S]*of invoice/);
    assert.match(doc, new RegExp('of invoice ' + number + '[\\s\\S]*Reason: Wrong size[\\s\\S]*Returned 50\\.00[\\s\\S]*Refunded Cash \\(paid by Card\\): 30\\.00[\\s\\S]*Promotion Code reversed: 5\\.00[\\s\\S]*Refunded Cash: 15\\.00'));
    assert.match(await p.textContent('#rs-reverse'), /Reverse return/);
    assert.ok(await p.isHidden('#rs-return-items'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the sale with a return: "Return items", no "Reverse sale"; the cash-up nets the return; "Return items" opens the Returns tab on it', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await p.click('.rs-tab[data-tab="sales"]');
    await until(p, id => !!document.querySelector('#rs-sales-body tr[data-id="' + id + '"]'), returnId);
    assert.match(await p.textContent('#rs-sales-body tr[data-id="' + returnId + '"]'), new RegExp('−?-?50\\.00[\\s\\S]*Return of ' + number));
    assert.match(await p.textContent('#rs-cashup'), /Card 120\.00 · Cash 15\.00 · Promotion Code 15\.00 · Returns −50\.00 · Net sales 150\.00/);
    await p.click('#rs-sales-body tr[data-id="' + sale.saleId + '"]');
    await until(p, () => /returns: RR-/.test(document.getElementById('rs-sale-heading').textContent));
    assert.ok(await p.isHidden('#rs-reverse'));
    await p.click('#rs-return-items');
    await until(p, () => !document.getElementById('rs-ret-body').classList.contains('hidden') && !!document.querySelector('.rs-ret-qty[data-line="1"]'));
    assert.match(await p.textContent('#rs-ret-lines'), /RM-001[\s\S]*4[\s\S]*1/);
    assert.equal(await p.getAttribute('.rs-ret-qty[data-line="1"]', 'max'), '3');
    assert.match(await p.textContent('#rs-ret-sale'), /Returned before: RR-\S+ \(50\.00\)/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a return reversed with a reason: the stock leaves again; the sale can be reversed whole again', async () => {
    const p = await open('RETAILSALES', 'u-admin', d => (/Reverse return/.test(d.message()) ? 'Keyed by mistake' : undefined));
    await p.click('.rs-tab[data-tab="sales"]');
    await until(p, id => !!document.querySelector('#rs-sales-body tr[data-id="' + id + '"]'), returnId);
    await p.click('#rs-sales-body tr[data-id="' + returnId + '"]');
    await until(p, () => /Reverse return/.test(document.getElementById('rs-reverse').textContent) && !document.getElementById('rs-reverse').classList.contains('hidden'));
    await p.click('#rs-reverse');
    await dialogs(p, 2);
    assert.match(p.__dialogs[0], /^Reverse return RR-\S+ \(50\.00\)\? The goods leave the stock again/);
    assert.match(p.__dialogs[1], /^Return reversed: RR-/);
    assert.equal((await val('stock/transactions/' + returnId)).ReversalReason, 'Keyed by mistake');
    assert.equal((await val('stock/ledger/I1/WH1')).Quantity, 6);
    await until(p, () => /reversed: Keyed by mistake/.test(document.getElementById('rs-sale-heading').textContent));
    await p.click('#rs-sales-body tr[data-id="' + sale.saleId + '"]');
    await until(p, () => !document.getElementById('rs-reverse').classList.contains('hidden') && /Reverse sale/.test(document.getElementById('rs-reverse').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Setup: the return period saved; a cashier without the "return" right has no Returns tab or "Return items"', async () => {
    const p = await open('RETAILSALES', 'u-admin');
    await p.click('.rs-tab[data-tab="setup"]');
    assert.equal(await p.inputValue('#rs-s-returndays'), '0');
    await p.fill('#rs-s-returndays', '14');
    await p.click('#rs-s-save');
    await dialogs(p, 1);
    assert.deepEqual(p.__dialogs, ['Setup saved.']);
    assert.equal((await val('retailSales/settings/C1')).ReturnDays, 14);
    await p.close();
    const c = await open('RETAILSALES', 'u-cash1');
    assert.ok(await c.isHidden('#rs-returns-tab'));
    const own = await call('u-cash1', 'confirmRetailSale', { CompanyID: 'C1', SaleDate: TODAY, Lines: [{ ItemID: 'I1', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 50 }] });
    await c.click('.rs-tab[data-tab="sales"]');
    await until(c, id => !!document.querySelector('#rs-sales-body tr[data-id="' + id + '"]'), own.saleId);
    await c.click('#rs-sales-body tr[data-id="' + own.saleId + '"]');
    await until(c, () => !document.getElementById('rs-sale-view').classList.contains('hidden'));
    assert.ok(await c.isHidden('#rs-return-items'));
    assert.ok(await c.isVisible('#rs-reverse'));
    assert.deepEqual(c.__errors, []);
    await c.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
