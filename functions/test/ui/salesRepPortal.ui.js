// Sales reps in the Employee Portal on a phone (owner, 2026-10-16;
// docs/modules/SALES_REP_PORTAL.md): the Sales tab only for a rep; their
// customers with balance and a call link; a new order at the price list
// sent to the office; a cash collection recorded. And the office's Sales
// reps panel in Sales Invoice Configuration.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   ESS_TAILWIND_CSS=... node functions/test/ui/salesRepPortal.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, val } = require('../emulator/_helpers');
const { portalPage, portalContext } = require('./_essPage');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Corner Shop', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0, Phone: '0500000001' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Market Stall', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 }
  };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: '' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 60, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } } };
  await reset(f);
  await firestore.collection('employees').doc('E1').set({ EmployeeNo: 'EMP-0001', FullName: 'Sam Seller', CompanyID: 'C1', Status: 'Active', UserUID: 'u-viewer', CostCenterID: 'CC1' });
  await firestore.collection('employees').doc('E2').set({ EmployeeNo: 'EMP-0002', FullName: 'Nora Clerk', CompanyID: 'C1', Status: 'Active', UserUID: 'u-approver', CostCenterID: 'CC1' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8102);
  const browser = await chromium.launch();

  await check('Sales Invoice Configuration: a sales rep added with a cash account and a customer', async () => {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8102/?module=SALESINVOICESETUP&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => [...document.querySelectorAll('#sis-sr-company option')].some(o => o.value === 'C1'), null, T);
    await page.selectOption('#sis-sr-company', 'C1');
    await page.waitForSelector('#sis-sr-add:not(.hidden)', T);
    await page.click('#sis-sr-add');
    await page.waitForSelector('#sis-sr-form:not(.hidden)', T);
    await page.selectOption('#sis-sr-employee', 'E1');
    await page.selectOption('#sis-sr-cash', 'A-CASH');
    await page.fill('#sis-sr-search', 'corner');
    await page.check('.sis-sr-cust[value="CU1"]');
    await page.click('#sis-sr-save');
    await page.waitForFunction(() => /Sam Seller/.test(document.getElementById('sis-sr-body').textContent), null, T);
    assert.equal((await val('customers/CU1')).SalesRepEmployeeID, 'E1');
    assert.deepEqual(errors, []);
    await page.close();
  });

  async function portal(uid) {
    const ctx = await portalContext(browser);
    const page = await ctx.newPage();
    page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
    await page.goto('http://127.0.0.1:8102/ess.html?uid=' + uid);
    await page.waitForSelector('#bottom-nav a', T);
    return page;
  }

  await check('not a rep: no Sales tab', async () => {
    const page = await portal('u-approver');
    assert.equal(await page.locator('#bottom-nav a[data-nav="sales"]').count(), 0);
    await page.close();
  });

  await check('the rep\'s Sales tab: their customers with balance and a call link; a new order at the price list sent to the office', async () => {
    const page = await portal('u-viewer');
    await page.click('#bottom-nav a[data-nav="sales"]');
    await page.waitForSelector('#sales-customers', T);
    const list = await page.textContent('#sales-customers');
    assert.match(list, /Corner Shop/);
    assert.doesNotMatch(list, /Market Stall/, 'only their own');
    assert.equal(await page.getAttribute('#sales-customers a[href^="tel:"]', 'href'), 'tel:0500000001');
    await page.click('.sales-order');
    await page.waitForSelector('#so-item', T);
    await page.selectOption('#so-item', 'RM-001');
    await page.waitForFunction(() => /Free to sell: 30/.test(document.getElementById('so-stock').textContent), null, T);
    await page.fill('#so-qty', '3');
    await page.click('#so-add');
    await page.waitForFunction(() => (document.getElementById('so-total') || {}).textContent === '180.00', null, T);
    await page.click('#so-send');
    await page.waitForSelector('#sales-customers', T);
    const orders = Object.values(await val('salesOrders') || {});
    assert.deepEqual(orders.map(o => [o.Status, o.CustomerID, o.Total]), [['Draft', 'CU1', 180]]);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('a cash collection recorded for the office; listed under My orders and collections', async () => {
    const page = await portal('u-viewer');
    await page.goto('http://127.0.0.1:8102/ess.html?uid=u-viewer#sales/collect/CU1');
    await page.waitForSelector('#col-amount', T);
    await page.fill('#col-amount', '75');
    await page.click('#col-send');
    await page.waitForSelector('#sales-customers', T);
    const drafts = (await firestore.collection('journalEntries').get()).docs.map(d => d.data()).filter(e => e.VoucherType === 'Cash Receipt');
    assert.deepEqual(drafts.map(e => [e.Status, e.TotalDebit]), [['Draft', 75]]);
    await page.waitForFunction(() => /Cash receipt · Corner Shop[\s\S]*75\.00[\s\S]*With the office/.test(document.getElementById('page').textContent), null, T);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
