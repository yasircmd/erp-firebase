// CRM in the rep portal on a phone, step C3 (owner, 2026-11-06; docs/modules/
// CRM.md, Q404-Q406): the Sales tab's CRM chips; a lead added (the duplicate
// warning answered); an opportunity for it and its stage moved; an activity
// done with the next scheduled; a quote for a customer at the list's price
// with a discount, submitted (no approval levels: approved), its PDF, and the
// order sent to the office from it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/crmPortal.ui.js
const http = require('http');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, reset, baseFixture, firestore, val } = require('../emulator/_helpers');
const { portalPage, portalContext } = require('./_essPage');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/crmPortal.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Corner Shop', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', Phone: '0500000001', SalesRepEmployeeID: 'E1' } };
  f.customerClassifications = { CL1: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'AED' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 60, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.salesReps = { E1: { CompanyID: 'C1', Active: true, IsManager: false } };
  await reset(f);
  await firestore.collection('employees').doc('E1').set({ EmployeeNo: 'EMP-0001', FullName: 'Sam Seller', CompanyID: 'C1', Status: 'Active', UserUID: 'u-viewer', CostCenterID: 'CC1' });

  const harness = (require('./buildHarness'), require('fs').readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8213);
  const browser = await chromium.launch();
  const ctx = await portalContext(browser);
  const page = await ctx.newPage();
  page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  const dialogMessage = async () => { await page.waitForSelector('#ess-dialog-ok', { state: 'visible', timeout: 30000 }); return page.textContent('#ess-dialog-message'); };
  const answer = async (ok, text) => {
    await page.waitForSelector('#ess-dialog-ok', { state: 'visible', timeout: 30000 });
    if (text !== undefined) await page.fill('#ess-dialog-input', text);
    const before = await page.textContent('#ess-dialog-message');
    await page.click(ok ? '#ess-dialog-ok' : '#ess-dialog-cancel');
    // Closed, or the next question asked at once.
    await page.waitForFunction(m => document.getElementById('ess-dialog').classList.contains('hidden') || document.getElementById('ess-dialog-message').textContent !== m, before, T);
  };
  await page.goto('http://127.0.0.1:8213/ess.html?uid=u-viewer');
  await page.waitForSelector('#bottom-nav a', T);

  await check('the Sales tab has the CRM chips; a lead saved after the duplicate warning', async () => {
    await page.click('#bottom-nav a[data-nav="sales"]');
    await page.waitForSelector('#crm-nav a[data-crm="leads"]', T);
    await page.click('#crm-nav a[data-crm="leads"]');
    await page.waitForSelector('#crm-lead-new', T);
    await page.click('#crm-lead-new');
    await page.waitForSelector('#crm-l-save', T);
    await page.fill('#crm-l-Organisation', 'Gulf Trading'); await page.fill('#crm-l-Name', 'Sara'); await page.fill('#crm-l-Phone', '050 000 0001');
    await page.click('#crm-l-save');
    assert.match(await dialogMessage(), /Customer: Corner Shop \(C001\) \(the same phone\)/);
    await answer(true);
    await page.waitForSelector('#crm-leads .crm-lead', T);
    assert.match(await page.textContent('#crm-leads'), /Gulf Trading \(Sara\)/);
    const lead = (await firestore.collection('crmLeads').where('OwnerKey', '==', 'E:E1').get()).docs[0].data();
    assert.equal(lead.CompanyID, 'C1', 'the rep\'s company, from the server');
  });

  await check('an opportunity for the lead; its stage moved on the pipeline', async () => {
    await page.click('#crm-leads .crm-lead');
    await page.waitForSelector('#crm-l-opp', T);
    await page.click('#crm-l-opp');
    await page.waitForSelector('#crm-o-save', T);
    assert.match(await page.$eval('#crm-o-party', s => s.options[s.selectedIndex].text), /Lead: Gulf Trading/);
    await page.fill('#crm-o-title', 'Racks'); await page.fill('#crm-o-value', '1000'); await page.fill('#crm-o-cur', 'AED');
    await page.click('#crm-o-save');
    await page.waitForSelector('.crm-stage', T);
    assert.match(await page.textContent('#crm-weighted'), /Total 1,000\.00 · weighted 100\.00/);
    await page.selectOption('.crm-stage', 'Proposal');
    await page.waitForFunction(() => /weighted 500\.00/.test(document.getElementById('crm-weighted') ? document.getElementById('crm-weighted').textContent : ''), null, T);
  });

  await check('an activity: added; Done asks the outcome and schedules the next', async () => {
    await page.click('#crm-nav a[data-crm="activities"]');
    await page.waitForSelector('#crm-act-new', T);
    await page.click('#crm-act-new');
    await page.waitForSelector('#crm-a-save', T);
    await page.selectOption('#crm-a-about', 'Customer:CU1');
    await page.selectOption('#crm-a-type', 'Visit');
    await page.fill('#crm-a-subject', 'Show samples');
    await page.click('#crm-a-save');
    await page.waitForSelector('#crm-acts .crm-act-done', T);
    await page.click('#crm-acts .crm-act-done');
    await answer(true, 'Liked them');
    await answer(true, 'Bring the price list');
    await page.waitForFunction(() => /Bring the price list/.test((document.getElementById('crm-acts') || {}).textContent || ''), null, T);
    assert.doesNotMatch(await page.textContent('#crm-acts'), /Show samples/);
  });

  await check('a quote at the list\'s price with a discount; submitted and approved; the PDF; the order sent to the office', async () => {
    await page.click('#crm-nav a[data-crm="quotes"]');
    await page.waitForSelector('#crm-quote-new', T);
    await page.click('#crm-quote-new');
    await page.waitForSelector('#crm-q-party', T);
    await page.selectOption('#crm-q-party', 'C:CU1');
    await page.waitForFunction(() => /Price list Retail \(AED\)/.test(document.getElementById('crm-q-pl').textContent), null, T);
    await page.selectOption('#crm-q-item', 'RM-001');
    await page.fill('#crm-q-qty', '5'); await page.fill('#crm-q-disc', '10');
    await page.click('#crm-q-add');
    await page.waitForSelector('#crm-q-total', T);
    assert.equal(await page.textContent('#crm-q-total'), '270.00');
    await page.click('#crm-q-save');
    await page.waitForSelector('#crm-q-submit', T);
    await page.click('#crm-q-submit');
    await page.waitForSelector('#crm-qv-order', T);
    assert.match(await page.textContent('#crm-qv-status'), /Approved/);
    assert.equal(await page.textContent('#crm-qv-total'), 'AED 270.00', 'no Tax Configuration here: no tax');
    const [download] = await Promise.all([page.waitForEvent('download', T), page.click('#crm-qv-pdf')]);
    assert.match(download.suggestedFilename(), /^QT-\d\d-01-000001\.pdf$/);
    const pdf = require('fs').readFileSync(await download.path(), 'latin1');
    assert.match(pdf, /QUOTATION QT-/); assert.match(pdf, /Corner Shop/); assert.match(pdf, /270\.00/);
    await page.selectOption('#crm-qv-wh', 'WH1');
    await page.click('#crm-qv-order');
    assert.match(await dialogMessage(), /draft Sales Order at this quote's prices/);
    await answer(true);
    await page.waitForSelector('#crm-quotes .crm-quote', T);
    assert.match(await page.textContent('#crm-quotes'), /Ordered/);
    const q = (await firestore.collection('quotations').where('OwnerKey', '==', 'E:E1').get()).docs[0].data();
    const so = await val('salesOrders/' + q.SalesOrderID);
    assert.deepEqual([so.Status, so.Lines[0].UnitPrice, so.CostCenterID, so.SalesRepEmployeeID], ['Draft', 54, 'CC1', 'E1']);
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
