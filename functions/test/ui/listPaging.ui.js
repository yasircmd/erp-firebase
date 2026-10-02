// Gmail-style list paging in the screens (owner, 2026-10-02;
// docs/modules/LIST_PAGING.md): the newest 100, "Load next N" adds the
// next ones below, a search finds entries beyond the first 100, and a
// report's drill-down opens an old entry directly. JV (hand screen),
// Production (generated) and Purchase Order (vendor-name search).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/listPaging.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

const pad = n => String(n).padStart(3, '0');
const at = i => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();

(async () => {
  const f = baseFixture();
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Bolt Supplies', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP' };
  f.purchaseOrders = {};
  for (let i = 0; i < 120; i++) f.purchaseOrders['po' + pad(i)] = { CompanyID: 'C1', CostCenterID: 'CC1', PONumber: 'PO-' + pad(i), VendorID: i < 4 ? 'V2' : 'V1', Status: 'Approved', Total: 10, CreatedAt: at(i) };
  f.stock = { transactions: {} };
  for (let i = 0; i < 105; i++) {
    f.stock.transactions['prd' + pad(i)] = { TransactionType: 'Production', CompanyID: 'C1', TransactionNumber: 'PRD-' + pad(i),
      TransactionDate: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), Description: 'Batch ' + i, Status: 'Posted', CreatedAt: at(i), Lines: [] };
  }
  await reset(f);
  const batch = firestore.batch();
  for (let i = 0; i < 150; i++) {
    batch.set(firestore.collection('journalEntries').doc('jv' + pad(i)), {
      VoucherType: 'JV', CompanyID: 'C1', JVNumber: 'JV-' + pad(i), JVDate: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'),
      Description: i < 5 ? 'Insurance premium' : 'Rent', Status: 'Posted', TotalDebit: 10, TotalCredit: 10, CreatedAt: at(i),
      Lines: [{ AccountCode: '1000', Debit: 10, Credit: 0, Description: 'a' }, { AccountCode: '1100', Debit: 0, Credit: 10, Description: 'b' }]
    });
  }
  await batch.commit();

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8155);
  const browser = await chromium.launch();
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8155/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const rows = (page, tbody, n) => page.waitForFunction(([t, n]) => document.querySelectorAll('#' + t + ' tr').length === n, [tbody, n], { timeout: 20000 });
  const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const done = async page => { assert.deepEqual(page.__dialogs, []); assert.deepEqual(page.__errors, []); await page.close(); };

  await check('JV: the newest 100, then "Load next 50" adds the rest below', async () => {
    const page = await open('JV');
    await rows(page, 'jv-table-body', 100);
    assert.equal(await text(page, '#jv-list-notice'), 'Showing 1–100 of 150 entries. Load next 50');
    assert.equal(await page.$('text=Load all'), null, 'no "Load all"');
    await page.click('#jv-list-notice .list-load-more');
    await rows(page, 'jv-table-body', 150);
    assert.ok(await page.$eval('#jv-list-notice', el => el.classList.contains('hidden')));
    await done(page);
  });

  await check('JV: a search finds entries beyond the first 100, and clearing it returns to the list', async () => {
    const page = await open('JV');
    await rows(page, 'jv-table-body', 100);
    await page.fill('#jv-search-input', 'insurance');
    await rows(page, 'jv-table-body', 5);
    assert.equal(await text(page, '#jv-list-notice'), '5 matches');
    assert.deepEqual((await page.$$eval('#jv-table-body tr td:first-child', tds => tds.map(td => td.textContent.trim()))).sort(),
      ['JV-000', 'JV-001', 'JV-002', 'JV-003', 'JV-004']);
    await page.fill('#jv-search-input', '');
    await rows(page, 'jv-table-body', 100);
    assert.match(await text(page, '#jv-list-notice'), /^Showing 1–100 of 150 entries/);
    await done(page);
  });

  await check('JV: a drill-down opens the oldest entry directly', async () => {
    const page = await open('JV');
    await rows(page, 'jv-table-body', 100);
    await page.evaluate(() => openModule('JV', { OpenEntryId: 'jv000' }));
    await page.waitForSelector('#jv-entry-view:not(.hidden)', { timeout: 20000 });
    assert.ok(await page.$eval('#jv-list-view', el => el.classList.contains('hidden')));
    await done(page);
  });

  await check('Production (a generated screen): 100, then "Load next 5"', async () => {
    const page = await open('PRODUCTION');
    await rows(page, 'prd-table-body', 100);
    assert.equal(await text(page, '#prd-list-notice'), 'Showing 1–100 of 105 Production Entries. Load next 5');
    await page.click('#prd-list-notice .list-load-more');
    await rows(page, 'prd-table-body', 105);
    await page.fill('#prd-search-input', 'PRD-002');
    await rows(page, 'prd-table-body', 1);
    await done(page);
  });

  await check('Purchase Order: a vendor-name search finds the four oldest POs', async () => {
    const page = await open('PURCHASEORDER');
    await rows(page, 'po-table-body', 100);
    await page.fill('#po-search-input', 'bolt');
    await rows(page, 'po-table-body', 4);
    assert.equal(await text(page, '#po-list-notice'), '4 matches');
    await done(page);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
