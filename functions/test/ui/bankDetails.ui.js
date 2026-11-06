// Bank account details (owner, 2026-11-06; docs/modules/UX_ROUND3.md item 8,
// Q413): Chart of Accounts → Bank details on a bank account (saved with its
// two switches); Cash & Bank shows them under the bank account and prints
// them; a quotation prints the company's bank details set to print.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/bankDetails.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, call } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/bankDetails.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8217);
  const browser = await chromium.launch();
  const dialogs = [];
  async function open(module) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.goto('http://127.0.0.1:8217/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }

  await check('Chart of Accounts: Bank details on a bank account only; saved with the two switches', async () => {
    const page = await open('COA');
    await page.waitForSelector('.coa-bank', T);
    assert.equal(await page.$$eval('.coa-bank', b => b.length), 1, 'only the postable bank account (1100)');
    await page.click('.coa-bank');
    await page.waitForSelector('#coa-bank-modal:not(.hidden)', T);
    assert.match(await page.textContent('#coa-bank-title'), /1100 Bank/);
    await page.fill('#coa-bank-BankName', 'Example Bank'); await page.fill('#coa-bank-AccountNumber', '1012345678');
    await page.fill('#coa-bank-IBAN', 'AE07 0331 2345 6789 0123 456'); await page.fill('#coa-bank-SWIFT', 'EXMPAEAD');
    await page.check('#coa-bank-print');
    assert.ok(await page.isChecked('#coa-bank-show'), 'shown by default');
    await page.click('#coa-bank-save');
    await page.waitForSelector('#coa-bank-modal.hidden', { state: 'attached', timeout: 30000 });
    assert.ok(dialogs.includes('Bank details saved.'));
    const d = await call('u-admin', 'getBankDetails', { accountId: 'A-BANK' });
    assert.deepEqual([d.BankName, d.IBAN, d.PrintOnInvoices, d.ShowInEntries], ['Example Bank', 'AE070331234567890123456', true, true]);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Cash & Bank: the bank account\'s details under it, and on the print', async () => {
    const page = await open('CBT');
    await page.waitForLoadState('networkidle');
    await page.click('#cbt-new-btn');
    await page.selectOption('#cbt-form-company', 'C1');
    await page.click('.cbt-type-btn[data-type="Bank Receipt"]');
    await page.waitForTimeout(300);
    await page.selectOption('#cbt-form-ledger', '1100');
    await page.waitForFunction(() => /Example Bank · A\/c 1012345678 · IBAN AE070331234567890123456 · SWIFT EXMPAEAD/.test(document.getElementById('cbt-bank-hint').textContent), null, T);
    assert.ok(await page.isVisible('#cbt-bank-hint'));
    await page.selectOption('#cbt-form-company', 'C1'); // unchanged: still shown
    // A new entry has no Print button yet: its own click handler, as Print would run it.
    await page.evaluate(() => { document.getElementById('cbt-print-btn').classList.remove('hidden'); });
    await page.click('#cbt-print-btn');
    await page.waitForFunction(() => /Bank: Example Bank/.test(document.getElementById('cbt-print-document').textContent), null, T);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('a quotation prints the company\'s bank details set to print', async () => {
    const q = await call('u-admin', 'saveQuotation', { quotation: { CompanyID: 'C1', CustomerID: 'CU1', QuoteDate: today, ValidUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), Lines: [{ ItemCode: 'RM-001', Quantity: 1, UnitPrice: 5 }] } });
    assert.equal(q.success, true);
    const page = await open('QUOTATION');
    await page.waitForSelector('#qt-body tr[data-id]', T);
    await page.click('#qt-body tr[data-id]');
    await page.click('#qt-print');
    await page.waitForFunction(() => window.__printed === 1, null, T);
    const text = await page.textContent('#qt-print-document');
    assert.match(text, /Bank details/); assert.match(text, /Example Bank/); assert.match(text, /IBAN: AE070331234567890123456/); assert.match(text, /SWIFT \/ BIC: EXMPAEAD/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
