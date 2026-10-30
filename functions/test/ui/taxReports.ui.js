// Tax Reports (docs/modules/TAX_ENGINE.md, part 5): the reports the
// company's regime has; UAE VAT 201 run for a period, a box opening the
// documents behind it, the single-rate document said; India's GSTR-1 copied
// for the GST offline tool (its dates dd-mmm-yyyy, its units).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/taxReports.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');
const engine = require('../../src/taxEngine');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /taxReports.ui/.test(l))]); }); }
const ok = r => { if (r.success === false) throw new Error(r.error); return r; };
const line = (Key, Category, Code, Taxable, comps) => ({ Key, TaxCode: Code, Category, Percent: comps.reduce((s, c) => s + c[1], 0), Taxable, Tax: comps.reduce((s, c) => s + c[2], 0),
  Components: comps.map(([Component, Percent, Amount]) => ({ Component, Percent, Amount })), HSNCode: '7208' });
const posted = (n, date, lines, extra) => Object.assign({ Status: 'Posted', CompanyID: 'C1', InvoiceDate: date, CustomerID: 'CU1', TransactionNumber: n, PlaceOfSupply: 'DXB',
  TaxLines: lines, Total: lines.reduce((s, l) => s + l.Taxable + l.Tax, 0) }, extra || {});

// One seeding (a reset wipes the screens' release too): UAE VAT on C1, India GST on C2.
async function seed() {
  const f = baseFixture();
  f.users['u-admin'].AssignedCompanies = ['C1', 'C2'];
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Example Traders', Status: 'Active', CompanyID: 'C1', TaxRegistrationType: 'Registered', TaxState: 'DXB', TaxRegistrationNumber: '100000000000003' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Sample Stores', Status: 'Active', CompanyID: 'C2', TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: '27ABCDE1234F1Z0' }
  };
  f.customerInvoices = {
    CI1: posted('CI-1', '2026-10-05', [line('item#1', 'STANDARD', 'SR', 1000, [['VAT', 5, 50]])]), CI2: posted('CI-2', '2026-10-06', [line('item#1', 'STANDARD', 'SR', 400, [['VAT', 5, 20]])]),
    CI5: { Status: 'Posted', CompanyID: 'C1', InvoiceDate: '2026-10-03', CustomerID: 'CU1', TransactionNumber: 'CI-5', TaxPercent: 5, TaxAmount: 25, Total: 525 },
    IN1: posted('INV-1', '2026-10-05', [line('item#1', 'STANDARD', 'GST18', 1000, [['CGST', 9, 90], ['SGST', 9, 90]])], { CompanyID: 'C2', CustomerID: 'CU2', PlaceOfSupply: '27' })
  };
  await reset(f);
  for (const [companyId, regime, state] of [['C1', 'AE_VAT', 'SHJ'], ['C2', 'IN_GST', '27']]) {
    const cfg = Object.assign(engine.preset(regime), { StateCode: state });
    cfg.Components.forEach(c => { c.OutputAccountID = 'A-VATOUT'; c.InputAccountID = 'A-VATIN'; });
    ok(await call('u-admin', 'saveTaxConfig', { companyId, config: cfg }));
  }
}

(async () => {
  await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8174);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const T = { timeout: 30000 };
  async function open(companyId) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8174/?module=TAXREPORTS&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => document.querySelectorAll('#txr-company option').length > 1, null, T);
    if (companyId !== 'C1') await page.selectOption('#txr-company', companyId);
    await page.waitForFunction(r => document.querySelectorAll('#txr-report option').length === r, companyId === 'C1' ? 2 : 3, T);
    await page.fill('#txr-from', '2026-10-01'); await page.fill('#txr-to', '2026-10-31');
    return page;
  }

  await check('UAE: VAT 201 for October, box 1b\'s documents, the single-rate invoice said', async () => {
    const p = await open('C1');
    assert.deepEqual(await p.$$eval('#txr-report option', o => o.map(x => x.value)), ['summary', 'vat201']);
    assert.equal(await p.inputValue('#txr-report'), 'vat201');
    await p.click('#txr-run');
    await p.waitForSelector('.txr-table', T);
    const row = p.locator('.txr-table tr', { hasText: 'Standard rated supplies in Dubai' });
    assert.deepEqual(await row.locator('td').allTextContents(), ['1b', 'Standard rated supplies in Dubai', '1,400.00', '70.00']);
    await row.click();
    await p.waitForSelector('#txr-docs:not(.hidden)', T);
    assert.deepEqual(await p.$$eval('#txr-docs-body tr td:nth-child(2)', t => t.map(x => x.textContent)), ['CI-1', 'CI-2']);
    assert.match(await p.textContent('#txr-leftout'), /1 document in this period was posted with one tax % before line tax, and is not in this report \(tax: 25\.00\): CI-5/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('India: GSTR-1\'s b2b copied for the offline tool, dates dd-mmm-yyyy', async () => {
    const p = await open('C2');
    assert.deepEqual(await p.$$eval('#txr-report option', o => o.map(x => x.value)), ['summary', 'gstr1', 'gstr3b']);
    await p.click('#txr-run');
    await p.waitForSelector('.txr-copy', T);
    await p.click('.txr-copy[data-t="0"]');
    const clip = (await p.evaluate(() => navigator.clipboard.readText())).split('\n');
    assert.equal(clip[0].split('\t')[0], 'GSTIN/UIN of Recipient');
    assert.deepEqual(clip[1].split('\t'), ['27ABCDE1234F1Z0', 'Sample Stores', 'INV-1', '05-Oct-2026', '1180', '27-Maharashtra', 'N', '', 'Regular B2B', '', '18', '1000', '0']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
