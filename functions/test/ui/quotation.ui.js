// The Quotation screen, CRM step C2 (owner, 2026-11-05; docs/modules/CRM.md,
// Q398-Q400): a quotation for a customer, the item's price from its price
// list, a discount, saved with its number and VAT; Submit (no approval
// levels: Approved); the print; Revise (Rev 2); Create Sales Order (the
// order opened, the quotation Accepted); a lead's asks to convert first; from
// a CRM opportunity, New Quotation; a Viewer sees no New button.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/quotation.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, call } = require('../emulator/_helpers');
const engine = require('../../src/taxEngine');

// The shell's light theme (public/index.html, LIGHT THEME), applied to a harness page.
function lightThemeCss() {
  const html = fs.readFileSync(__dirname + '/../../../public/index.html', 'utf8');
  const a = html.indexOf('LIGHT THEME'), b = html.indexOf('/* =====', html.indexOf('=====', a + 20) + 70);
  return html.slice(html.lastIndexOf('/*', a), b);
}
async function inLight(page) {
  await page.addStyleTag({ content: lightThemeCss() });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}
const DARK = ['rgb(15, 23, 42)', 'rgba(30, 41, 59, 0.5)'];

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/quotation.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const f = baseFixture();
  Object.assign(f.items.I1, { TaxCode: 'SR', IsSellable: true });
  f.customerClassifications = { CLS1: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', AddressLine1: '1 Example Road' } };
  f.priceLists = { PL1: { Name: 'Local', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Local', CurrencyID: 'AED' } };
  f.priceListLines = { PLL1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 200, EffectiveFrom: '2020-01-01', Status: 'Active' } };
  await reset(f);
  const cfg = engine.preset('AE_VAT');
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-VATOUT'; c.InputAccountID = 'A-VATIN'; });
  await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg });
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8212);
  const browser = await chromium.launch();
  const dialogs = [];
  async function open(uid, module) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.goto('http://127.0.0.1:8212/?module=' + (module || 'QUOTATION') + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }
  const page = await open('u-admin');
  await page.waitForSelector('#qt-body tr', T);

  await check('a quotation: the price list\'s price, a discount; saved with its number, the VAT and the total', async () => {
    await page.click('#qt-new');
    await page.selectOption('#qt-party', 'C:CU1');
    await page.waitForFunction(() => /Price list: Local \(AED\)/.test(document.getElementById('qt-pricelist').textContent), null, T);
    await page.fill('#qt-lines tr:first-child input[data-k="ItemCode"]', 'RM-001');
    await page.dispatchEvent('#qt-lines tr:first-child input[data-k="ItemCode"]', 'change');
    await page.waitForFunction(() => document.querySelector('#qt-lines tr:first-child input[data-k="UnitPrice"]').value === '200', null, T);
    assert.equal(await page.inputValue('#qt-lines tr:first-child input[data-k="Description"]'), 'Steel Sheet');
    await page.fill('#qt-lines tr:first-child input[data-k="Quantity"]', '5');
    await page.fill('#qt-lines tr:first-child input[data-k="DiscountPct"]', '10');
    assert.equal(await page.textContent('#qt-lines tr:first-child .qt-amount'), '900.00');
    assert.match(await page.textContent('#qt-tax-hint'), /worked out when you save/);
    await page.fill('#qt-terms', 'Delivery in 2 weeks');
    await page.click('#qt-save');
    await page.waitForFunction(() => /^Quotation QT-\d\d-01-000001$/.test(document.getElementById('qt-title').textContent), null, T);
    assert.equal(await page.textContent('#qt-total'), '945.00');
    assert.match(await page.textContent('#qt-tax-rows'), /SR 5%\s*45\.00/);
    assert.ok(await page.isVisible('#qt-submit') && await page.isHidden('#qt-order'));
  });

  await check('the light theme: a new line\'s fields are light, not the dark theme\'s (owner, 2026-11-06)', async () => {
    await page.click('#qt-back');
    await page.click('#qt-new');
    await inLight(page);
    const bg = await page.$eval('#qt-lines tr:first-child input[data-k="ItemCode"]', el => getComputedStyle(el).backgroundColor);
    assert.ok(!DARK.includes(bg), 'the line field is ' + bg);
    assert.equal(bg, 'rgb(248, 250, 252)');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    assert.equal(await page.$eval('#qt-lines tr:first-child input[data-k="ItemCode"]', el => getComputedStyle(el).backgroundColor), 'rgb(15, 23, 42)', 'the dark theme as before');
    await page.click('#qt-back');
    await page.click('#qt-body tr:has-text("000001")');
    await page.waitForSelector('#qt-submit:not(.hidden)', T);
  });

  await check('Submit (no approval levels): Approved; read-only; the print shows the quotation', async () => {
    await page.click('#qt-submit');
    await page.waitForFunction(() => /Approved/.test(document.getElementById('qt-badge').textContent), null, T);
    assert.ok(dialogs.some(m => /no approval is needed/.test(m)), dialogs.join(' | '));
    assert.ok(await page.isHidden('#qt-save'));
    assert.ok(await page.isDisabled('#qt-lines tr:first-child input[data-k="Quantity"]'));
    await page.click('#qt-print');
    await page.waitForFunction(() => window.__printed === 1, null, T);
    const doc = await page.textContent('#qt-print-document');
    assert.match(doc, /QUOTATION/); assert.doesNotMatch(doc, /DRAFT/);
    assert.match(doc, /To: Retail Co/); assert.match(doc, /Address: 1 Example Road/);
    assert.match(doc, /Steel Sheet.*10%.*900\.00/); assert.match(doc, /Total945\.00/); assert.match(doc, /Delivery in 2 weeks/);
    assert.equal(await page.textContent('#qt-print-company-name'), 'Test Co One');
  });

  await check('Revise: Rev 2, a draft; the list shows the first Revised', async () => {
    await page.click('#qt-revise');
    await page.waitForFunction(() => /Rev 2$/.test(document.getElementById('qt-title').textContent), null, T);
    assert.ok(await page.isVisible('#qt-save'));
    await page.click('#qt-submit');
    await page.waitForFunction(() => /Approved/.test(document.getElementById('qt-badge').textContent), null, T);
    await page.click('#qt-back');
    await page.selectOption('#qt-status', '');
    const rows = await page.$$eval('#qt-body tr', t => t.map(x => x.textContent));
    assert.equal(rows.length, 2);
    assert.ok(rows.some(r => /000001 Rev 2.*Approved/.test(r)) && rows.some(r => /000001(?! Rev).*Revised/.test(r)), rows.join(' | '));
  });

  await check('Create Sales Order: the order saved and opened; the quotation Accepted and linked', async () => {
    await page.click('#qt-body tr:has-text("Rev 2")');
    await page.click('#qt-order');
    await page.waitForSelector('#qt-order-modal:not(.hidden)', T);
    await page.selectOption('#qt-so-cc', 'CC1');
    await page.selectOption('#qt-so-wh', 'WH1');
    await page.click('#qt-so-ok');
    await page.waitForFunction(() => window.__moduleReady === true && Boolean(document.getElementById('so-entry-view')) && !document.getElementById('so-entry-view').classList.contains('hidden'), null, T);
    const r = await call('u-admin', 'getQuotations', { companyId: 'C1' });
    const q = r.quotations.find(x => x.Revision === 2);
    assert.equal(q.Status, 'Accepted');
    const so = await require('../../src/salesStore').salesOrders.get(q.SalesOrderID);
    assert.deepEqual([so.CustomerID, so.CostCenterID, so.Lines.map(l => [l.ItemCode, Number(l.OrderedQuantity), Number(l.UnitPrice), l.WarehouseID])],
      ['CU1', 'CC1', [['RM-001', 5, 180, 'WH1']]], 'the lines at their net prices');
    assert.deepEqual(page.__errors, []);
  });

  await check('from a CRM opportunity for a lead: New Quotation opens it chosen; Create Sales Order asks to convert first', async () => {
    const lead = await call('u-admin', 'saveLead', { lead: { CompanyID: 'C1', Name: 'Sara', Organisation: 'Gulf Trading', Phone: '050 999 8888', Email: 'sara@gulf.example', Source: 'Website' } });
    const opp = await call('u-admin', 'saveOpportunity', { opportunity: { CompanyID: 'C1', LeadID: lead.leadId, Title: 'Racks', ExpectedValue: 1000, Currency: 'AED' } });
    const crm = await open('u-admin', 'CRM');
    await crm.waitForSelector('#crm-leads-body tr', T);
    await crm.click('.crm-tab[data-tab="opps"]');
    await crm.click('#crm-board .crm-card');
    await crm.click('#crm-opp-newquote');
    await crm.waitForFunction(() => window.__moduleReady === true && document.getElementById('qt-entry') && !document.getElementById('qt-entry').classList.contains('hidden'), null, T);
    assert.equal(await crm.inputValue('#qt-party'), 'L:' + lead.leadId);
    assert.equal(await crm.inputValue('#qt-opp'), opp.opportunityId);
    assert.ok(await crm.isVisible('#qt-class'), 'a lead chooses the classification');
    await crm.fill('#qt-lines tr:first-child input[data-k="ItemCode"]', 'RM-001');
    await crm.dispatchEvent('#qt-lines tr:first-child input[data-k="ItemCode"]', 'change');
    await crm.waitForFunction(() => document.querySelector('#qt-lines tr:first-child input[data-k="UnitPrice"]').value === '200', null, T);
    await crm.click('#qt-save');
    await crm.waitForFunction(() => /QT-\d\d-01-000002/.test(document.getElementById('qt-title').textContent), null, T);
    await crm.click('#qt-submit');
    await crm.waitForSelector('#qt-order:not(.hidden)', T);
    await crm.click('#qt-order');
    // The confirm is accepted: CRM opens on the lead, to convert it.
    await crm.waitForFunction(() => window.__moduleReady === true && document.getElementById('crm-lead-title') && document.getElementById('crm-lead-title').textContent === 'Gulf Trading (Sara)', null, T);
    assert.ok(dialogs.some(m => /This quotation is for a lead/.test(m)));
    assert.ok(await crm.isVisible('#crm-lead-convert'));
    assert.deepEqual(crm.__errors, []);
    await crm.close();
  });

  await check('a Viewer: no New button; a quotation opens read-only', async () => {
    const v = await open('u-viewer');
    await v.waitForSelector('#qt-body tr', T);
    assert.ok(await v.isHidden('#qt-new'));
    await v.selectOption('#qt-status', '');
    await v.click('#qt-body tr');
    assert.ok(await v.isHidden('#qt-save') && await v.isHidden('#qt-submit') && await v.isHidden('#qt-revise'));
    assert.ok(await v.isVisible('#qt-print'));
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
