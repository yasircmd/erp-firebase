// Sales reps in the Employee Portal on a phone (owner, 2026-10-16;
// docs/modules/SALES_REP_PORTAL.md): the Sales tab only for a rep; their
// customers with balance and a call link; a new order at the price list
// sent to the office. Their collections (REP_COLLECTIONS.md, items 30-31):
// cash against an invoice, the receipt at once and its PDF; what the rep
// holds; a cheque with the rep, taken in PDC Received; the office's Sales
// reps panel with the Rep Cash Clearing account, the code, the receipts
// and a cancellation.
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
  Object.assign(f.companies.C1, { PdcReceivedClearingAccountID: 'A-PDCR' });
  f.coa['A-PDCR'] = { AccountCode: '1250', AccountName: 'PDC Received Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  f.coa['A-RCC'] = { AccountCode: '1260', AccountName: 'Rep Cash Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  await reset(f);
  await firestore.collection('customerInvoices').doc('CI1').set({ CustomerID: 'CU1', CompanyID: 'C1', Status: 'Posted', InvoiceDate: '2026-09-01', Total: 300, TransactionNumber: 'CINV-26-01-000001' });
  await firestore.collection('employees').doc('E1').set({ EmployeeNo: 'EMP-0001', FullName: 'Sam Seller', CompanyID: 'C1', Status: 'Active', UserUID: 'u-viewer', CostCenterID: 'CC1' });
  await firestore.collection('employees').doc('E2').set({ EmployeeNo: 'EMP-0002', FullName: 'Nora Clerk', CompanyID: 'C1', Status: 'Active', UserUID: 'u-approver', CostCenterID: 'CC1' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8102);
  const browser = await chromium.launch();

  await check('Sales Invoice Configuration: the Rep Cash Clearing account; a sales rep added with their code and a customer', async () => {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8102/?module=SALESINVOICESETUP&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => [...document.querySelectorAll('#sis-sr-company option')].some(o => o.value === 'C1'), null, T);
    await page.selectOption('#sis-sr-company', 'C1');
    await page.waitForSelector('#sis-sr-add:not(.hidden)', T);
    assert.ok(!(await page.$$eval('#sis-sr-clearing option', o => o.map(x => x.value))).includes('A-CASH'), 'not the cashier\'s cash');
    await page.selectOption('#sis-sr-clearing', 'A-RCC');
    await page.click('#sis-sr-clearing-save');
    await page.waitForFunction(() => /waits here/.test(document.getElementById('sis-sr-clearing-note').textContent), null, T);
    await page.click('#sis-sr-add');
    await page.waitForSelector('#sis-sr-form:not(.hidden)', T);
    await page.selectOption('#sis-sr-employee', 'E1');
    await page.fill('#sis-sr-code', 'ss');
    await page.fill('#sis-sr-search', 'corner');
    await page.check('.sis-sr-cust[value="CU1"]');
    await page.click('#sis-sr-save');
    await page.waitForFunction(() => /Sam Seller/.test(document.getElementById('sis-sr-body').textContent), null, T);
    assert.equal((await val('customers/CU1')).SalesRepEmployeeID, 'E1');
    assert.match(await page.innerText('#sis-sr-body'), /Sam Seller\s+SS\s+Sales rep\s+1\s+0\.00\s+0\.00/);
    assert.equal((await val('salesRepSettings/C1')).ClearingAccountID, 'A-RCC');
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

  let CASH = '';
  await check('cash against the oldest invoice: final at once, the receipt shown and its PDF downloaded', async () => {
    const ctx = await portalContext(browser, { acceptDownloads: true });
    const page = await ctx.newPage();
    page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
    await page.goto('http://127.0.0.1:8102/ess.html?uid=u-viewer#sales/collect/CU1');
    await page.waitForSelector('.col-inv', T);
    await page.fill('#col-amount', '350');
    await page.check('.col-inv input[type=checkbox]');
    assert.equal(await page.inputValue('.col-inv-amt'), '300', 'what the invoice owes');
    assert.match(await page.textContent('#col-rest'), /On account: 50\.00/);
    await page.click('#col-send');
    await page.waitForSelector('#rc-number', T);
    assert.match(await page.textContent('#rc-number'), /Receipt RC-SS-000001/);
    const text = await page.innerText('#page');
    assert.match(text, /Received from\s+Corner Shop[\s\S]*Amount\s+\S*\s*350\.00[\s\S]*Invoice CINV-26-01-000001\s+300\.00[\s\S]*On account\s+50\.00/);
    CASH = 'RC-SS-000001';
    const [dl] = await Promise.all([page.waitForEvent('download', T), page.click('#rc-download')]);
    assert.equal(dl.suggestedFilename(), CASH + '.pdf');
    const pdf = fs.readFileSync(await dl.path(), 'latin1');
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /\(RECEIPT RC-SS-000001\) Tj/);
    assert.match(pdf, /\(Received from: Corner Shop \\\(C001\\\)\) Tj/, 'the parentheses escaped, as PDF strings need');
    assert.match(pdf, /\(Invoice CINV-26-01-000001: 300\.00\) Tj/);
    assert.match(pdf, /startxref\n\d+\n%%EOF$/);
    assert.equal((await firestore.collection('repReceipts').doc(CASH).get()).data().Status, 'Issued');
    assert.deepEqual(page.__errors, []);
    await ctx.close();
  });

  await check('a cheque with the rep; what the rep holds, and their receipts with their state', async () => {
    const page = await portal('u-viewer');
    await page.goto('http://127.0.0.1:8102/ess.html?uid=u-viewer#sales/collect/CU1');
    await page.waitForSelector('#col-invoices', T);
    await page.check('input[name="col-m"][value="Cheque"]');
    await page.fill('#col-amount', '120');
    await page.fill('#col-no', '900001');
    await page.fill('#col-date', '2026-12-01');
    await page.fill('#col-bank', 'Sample Bank');
    await page.click('#col-send');
    await page.waitForSelector('#rc-number', T);
    assert.match(await page.textContent('#rc-number'), /RC-SS-000002/);
    await page.goto('http://127.0.0.1:8102/ess.html?uid=u-viewer#sales');
    await page.waitForSelector('#sales-holding', T);
    assert.deepEqual([await page.textContent('#sales-cash'), await page.textContent('#sales-cheques')], ['350.00', '1']);
    await page.click('#sales-holding');
    await page.waitForSelector('#col-receipts', T);
    assert.equal(await page.textContent('#col-cash'), '350.00');
    assert.match(await page.innerText('#col-cheques'), /Corner Shop[\s\S]*Cheque 900001 · Sample Bank · dated 01\/12\/2026[\s\S]*120\.00/);
    assert.match(await page.innerText('#col-receipts'), /RC-SS-000002 · Corner Shop[\s\S]*Cheque[\s\S]*With the rep[\s\S]*RC-SS-000001 · Corner Shop[\s\S]*Cash[\s\S]*With the rep/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('PDC Received: the rep\'s cheque marked with the rep, Clear hidden; Received from the rep', async () => {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8102/?module=PDCRECEIVED&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForSelector('#pdc-table-body tr .pdc-with-rep', T);
    assert.match(await page.textContent('#pdc-table-body .pdc-with-rep'), /with Sam Seller/);
    await page.click('#pdc-table-body tr');
    await page.waitForSelector('#pdc-fromrep-btn:not(.hidden)', T);
    assert.ok(!(await page.isVisible('#pdc-clear-btn')) && !(await page.isVisible('#pdc-bounce-btn')), 'not deposited yet');
    await page.click('#pdc-fromrep-btn');
    await page.waitForFunction(() => !document.querySelector('#pdc-table-body .pdc-with-rep'), null, T);
    const pdcId = (await firestore.collection('repReceipts').doc('RC-SS-000002').get()).data().PdcID;
    assert.equal((await val('pdcCheques/' + pdcId)).WithRep, false);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await check('the office: the rep\'s receipts and balance; a receipt cancelled with its reason', async () => {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await onAppDialog(page, d => d.accept(d.type() === 'prompt' ? 'Wrong amount' : undefined));
    await page.goto('http://127.0.0.1:8102/?module=SALESINVOICESETUP&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => /Sam Seller/.test((document.getElementById('sis-sr-body') || {}).textContent || ''), null, T);
    assert.match(await page.innerText('#sis-sr-body'), /Sam Seller\s+SS\s+Sales rep\s+1\s+350\.00\s+0\.00/, 'the cheque is with the office now');
    await page.click('.sis-sr-rc');
    await page.waitForSelector('#sis-sr-receipts:not(.hidden)', T);
    assert.match(await page.textContent('#sis-sr-rc-balance'), /Holds 350\.00 in cash, and 0 cheques/);
    assert.match(await page.innerText('#sis-sr-rc-body'), /RC-SS-000002[\s\S]*Cheque 900001[\s\S]*120\.00\s+Handed over[\s\S]*RC-SS-000001[\s\S]*Cash\s+350\.00\s+With the rep/);
    await page.click('#sis-sr-rc-body tr[data-number="' + CASH + '"] .sis-sr-rc-cancel');
    await page.waitForFunction(n => /Cancelled/.test((document.querySelector('#sis-sr-rc-body tr[data-number="' + n + '"] .sis-sr-rc-status') || {}).textContent || ''), CASH, T);
    assert.match(await page.textContent('#sis-sr-rc-body tr[data-number="' + CASH + '"] .sis-sr-rc-status'), /Cancelled\s*\(Wrong amount\)/);
    assert.deepEqual([(await firestore.collection('repReceipts').doc(CASH).get()).data().Status], ['Cancelled']);
    await page.waitForFunction(() => /0\.00/.test((document.querySelector('#sis-sr-body .sis-sr-cash-held') || {}).textContent || ''), null, T);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await check('the cashier: a Cash Receipt in Cash & Bank, choosing the rep and matching their receipt', async () => {
    const r = await call('u-viewer', 'essPortal', { action: 'salesCollect', customerId: 'CU1', method: 'Cash', amount: '80' });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8102/?module=CBT&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.click('#cbt-new-btn');
    await page.click('.cbt-type-btn[data-type="Cash Receipt"]');
    await page.selectOption('#cbt-form-company', 'C1');
    await page.waitForFunction(() => [...document.querySelectorAll('#cbt-form-ledger option')].some(o => o.value === '1000'), null, T);
    await page.selectOption('#cbt-form-ledger', '1000');
    await page.fill('#cbt-form-description', 'Cash from Sam');
    const acct = page.locator('#cbt-grid-body input[data-row="0"][data-col="0"]');
    await acct.fill('1260'); await acct.blur();
    const amt = page.locator('#cbt-grid-body input[data-row="0"][data-col="2"]');
    await amt.fill('80'); await amt.blur();
    await page.waitForFunction(() => [...document.querySelectorAll('.cbt-party-select option')].some(o => o.value === 'SalesRep:E1'), null, T);
    assert.equal((await page.textContent('.cbt-party-select option[value="SalesRep:E1"]')).trim(), 'Sales rep — SS Sam Seller');
    await page.selectOption('.cbt-party-select', 'SalesRep:E1');
    await page.click('.cbt-allocate-btn');
    await page.waitForSelector('#cbt-alloc-modal input[data-ref]', T);
    assert.match(await page.textContent('#cbt-alloc-modal'), new RegExp(r.number));
    await page.fill('#cbt-alloc-modal input[data-num="' + r.number + '"]', '80');
    await page.click('.cbt-alloc-ok');
    assert.match(await page.textContent('.cbt-party-row'), new RegExp('Against ' + r.number + ' 80\\.00'));
    await page.click('#cbt-post-btn');
    await page.click('#cbt-confirm-ok');
    await page.waitForSelector('#cbt-list-view', { state: 'visible', ...T });
    // The posted entry names the party as a Sales rep.
    await page.locator('.cbt-open').first().click();
    await page.waitForSelector('.cbt-party-row', T);
    await page.waitForFunction(() => /Sales rep: Sam Seller/.test(document.querySelector('.cbt-party-row').textContent), null, T);
    const office = await call('u-admin', 'getRepReceipts', { employeeId: 'E1' });
    assert.equal(office.receipts.find(x => x.Number === r.number).StatusText, 'Handed over');
    assert.deepEqual(errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
