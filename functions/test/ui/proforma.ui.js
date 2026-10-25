// Proforma Invoice from a Sales Order (owner, 2026-10-24; docs/modules/
// UX_ROUND2.md item 22, decision Q275): the button on a saved order prints
// it with its own PI number, the same on a reprint; a draft is marked
// DRAFT; a cancelled order has no button; the print hides the screen.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/proforma.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Example Buyer LLC', Status: 'Active', AddressLine1: '1 Sample Street' } };
  const so = extra => Object.assign({ CompanyID: 'C1', CustomerID: 'CU1', SODate: '2026-10-20', CreatedAt: '2026-10-20T08:00:00Z',
    Lines: [{ LineID: 'L1', ItemCode: 'RM-001', OrderedQuantity: 2, UnitPrice: 50, LineTotal: 100 }, { LineID: 'L2', ItemCode: 'RM-001', OrderedQuantity: 1, UnitPrice: 25.5, LineTotal: 25.5 }] }, extra);
  f.salesOrders = { SO1: so({ Status: 'Draft', SONumber: '' }), SO2: so({ Status: 'Reserved', SONumber: 'SO-26-01-000007' }), SO3: so({ Status: 'Cancelled', SONumber: 'SO-26-01-000008' }) };
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8159);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const open = async id => {
    await page.goto('http://127.0.0.1:8159/?module=SALESORDER&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#so-table-body tr', { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.click('#so-table-body tr:has-text("' + id + '")');
    await page.waitForSelector('#so-entry-view:not(.hidden)');
  };

  await check('a confirmed order: printed with a PI number; the same on a reprint; no DRAFT', async () => {
    await open('SO-26-01-000007');
    await page.click('#so-proforma-btn');
    await page.waitForFunction(() => window.__printed === 1);
    const pi = await page.textContent('#so-print-pi');
    assert.match(pi, /^PI-26-\d+-000001$/);
    assert.match(await page.textContent('#so-print-document'), /PROFORMA INVOICE[\s\S]*Example Buyer LLC[\s\S]*SO-26-01-000007/);
    assert.equal((await page.textContent('#so-print-total')).trim(), '125.50');
    assert.equal(await page.$('#so-print-draft'), null);
    await page.click('#so-proforma-btn');
    await page.waitForFunction(() => window.__printed === 2);
    assert.equal(await page.textContent('#so-print-pi'), pi, 'the same number');
    // Printed, only the document shows: the form is not printed.
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.isVisible('#so-print-document'), true);
    assert.equal(await page.isVisible('#so-form-company'), false);
    assert.equal(await page.isVisible('#so-proforma-btn'), false);
    await page.emulateMedia({ media: 'screen' });
    assert.deepEqual(page.__errors, []);
  });

  await check('a draft: printed marked DRAFT, with its own next number', async () => {
    await open('Draft');
    await page.click('#so-proforma-btn');
    await page.waitForFunction(() => window.__printed === 1); // a new page: counted from none
    assert.match(await page.textContent('#so-print-pi'), /^PI-26-\d+-000002$/);
    assert.equal((await page.textContent('#so-print-draft')).trim(), 'DRAFT');
    assert.deepEqual(page.__errors, []);
  });

  await check('a cancelled order: no Proforma Invoice', async () => {
    await open('SO-26-01-000008');
    assert.equal(await page.isVisible('#so-proforma-btn'), false);
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
