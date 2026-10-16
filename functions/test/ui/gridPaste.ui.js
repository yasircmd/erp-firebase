// Copy Table / Paste from Excel on the two requisitions and the Sales Order
// (owner, 2026-10-16; docs/modules/UX_TIER3.md, C, decisions 156-157): Copy
// on an empty grid gives the headings; a paste skips them; a row that isn't
// found refuses the whole paste and names it; a Sales Order line takes the
// price list's price where the item has one, else the pasted price. Seeds its
// own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/gridPaste.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

async function seed() {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' } };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'AED' } };
  // FG-001 is sold (on the Wholesale list) but not on the Retail list the customer uses.
  f.priceLists.PL2 = { Name: 'Wholesale', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Wholesale', CurrencyID: 'AED' };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 12, EffectiveFrom: '2026-01-01', Status: 'Active' },
    L2: { PriceListID: 'PL2', ItemCode: 'FG-001', UnitPrice: 15, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  await reset(f);
}

(async () => {
  await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8163);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  const setClip = text => page.evaluate(t => navigator.clipboard.writeText(t), text);
  const values = field => page.$$eval('#module-container [data-field="' + field + '"]', els => els.map(e => e.value).filter(Boolean));
  async function openNew(mod, p) {
    page.__dialogs.length = 0;
    await page.goto('http://127.0.0.1:8163/?module=' + mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#' + p + '-new-btn:not(.hidden)', { timeout: 30000 });
    await page.click('#' + p + '-new-btn');
    await page.waitForSelector('#' + p + '-copy-btn', { state: 'visible', timeout: 20000 });
    await page.waitForSelector('#' + p + '-paste-btn', { state: 'visible', timeout: 20000 });
  }
  async function paste(p, text) {
    const before = page.__dialogs.length;
    await setClip(text);
    await page.click('#' + p + '-paste-btn');
    await page.waitForTimeout(800);
    return page.__dialogs.slice(before);
  }

  await check('Purchase Requisition: headings copied on an empty grid; a wrong row refuses the paste; a good paste skips the headings', async () => {
    await openNew('PURCHASEREQUISITION', 'pr');
    const company = await page.$('#pr-form-company');
    if (company) { await page.selectOption('#pr-form-company', 'C1'); await page.waitForTimeout(300); }
    await page.click('#pr-copy-btn');
    const H = 'Category\tDescription\tQuantity\tUnit\tCost Ctr';
    assert.equal(await clip(), H);
    const refused = await paste('pr', H + '\nStationery\tPaper\t10\tbox\t\nFurniture\tDesk\t1\tNos\t');
    assert.equal(refused.length, 1, 'one message: ' + refused.join(' | '));
    assert.match(refused[0], /Nothing was pasted/);
    assert.match(refused[0], /Row 2: category "Furniture" not found/);
    assert.deepEqual(await values('description'), [], 'nothing pasted');
    assert.deepEqual(await paste('pr', H + '\nStationery\tPaper\t10\tbox\t\nStationery\tPens\t5\tNos\t'), []);
    assert.deepEqual(await values('description'), ['Paper', 'Pens']);
    await page.click('#pr-copy-btn');
    assert.deepEqual((await clip()).split('\n'), [H, 'Stationery\tPaper\t10\tbox\t', 'Stationery\tPens\t5\tNos\t']);
  });

  await check('Inventory Purchase Requisition: an unknown item code refuses the paste and names the row; a good one is added', async () => {
    await openNew('INVENTORYPURCHASEREQUISITION', 'ipr');
    await page.waitForFunction(() => document.querySelectorAll('#ipr-item-datalist option').length === 2, null, { timeout: 20000 });
    await page.click('#ipr-copy-btn');
    const H = 'Item Code\tWarehouse\tDescription\tUOM\tQuantity\tCost Ctr';
    assert.equal(await clip(), H);
    const refused = await paste('ipr', 'XX-404\t\tUnknown\t\t3\t\nRM-001\t\tSteel\t\t2\t');
    assert.equal(refused.length, 1);
    assert.match(refused[0], /Row 1: item "XX-404" not found/);
    assert.deepEqual(await values('item'), []);
    assert.deepEqual(await paste('ipr', H + '\nRM-001\t\tSteel\t\t2\t'), []);
    assert.deepEqual(await values('item'), ['RM-001']);
    assert.deepEqual(await values('quantity'), ['2']);
  });

  await check('Sales Order: the price list\'s price where the item has one, else the pasted price', async () => {
    await openNew('SALESORDER', 'so');
    await page.click('#so-copy-btn');
    const H = 'Item Code\tWarehouse\tQuantity\tUnit Price';
    assert.equal(await clip(), H);
    await page.selectOption('#so-form-company', 'C1');
    await page.waitForTimeout(300);
    await page.selectOption('#so-form-customer', 'CU1');
    await page.waitForSelector('#so-pricelist-note:not(.hidden)', { timeout: 10000 });
    const refused = await paste('so', H + '\nRM-001\tWH1\t2\t99\nFG-001\tNOPE\t1\t20');
    assert.equal(refused.length, 1);
    assert.match(refused[0], /Row 2: warehouse "NOPE" not found/);
    assert.deepEqual(await values('item'), []);
    assert.deepEqual(await paste('so', H + '\nRM-001\tWH1\t2\t99\nFG-001\t\t1\t20'), []);
    // (The price list's prices are looked up first.)
    await page.waitForFunction(() => document.querySelectorAll('#module-container [data-field="item"]').length >= 3, null, { timeout: 10000 });
    assert.deepEqual(await values('item'), ['RM-001', 'FG-001']);
    assert.deepEqual(await values('price'), ['12', '20'], 'RM-001 from the price list; FG-001 is not on it');
  });

  await check('no page errors', async () => assert.deepEqual(page.__errors, []));
  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
