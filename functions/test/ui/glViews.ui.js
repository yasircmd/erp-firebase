// GL views on screen (owner, 2026-10-10; docs/modules/GL_VIEWS.md, decisions
// 84-87): GL Report's Cost Center column (screen and Copy Table); a Txn Ref
// opens the entry's GL impact with each line's cost center, Copy to Excel
// and Open source document; the Listing view picks several accounts (Add,
// Enter, remove), lists their lines by date with account and cost center,
// no balances, totals, Copy Table.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/glViews.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = new Date().toISOString().slice(0, 8) + '05';

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-EXPH': { AccountCode: '6000', AccountName: 'Operating Expenses', AccountType: 'Expense', Status: 'Active', IsPostable: false },
    'A-RENT': { AccountCode: '6001', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true, ParentAccountID: 'A-EXPH' },
    'A-FUEL': { AccountCode: '6100', AccountName: 'Fuel', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  await reset(f);
  const jv = async (code, cc, amount) => {
    const d = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'JV ' + code, CompanyID: 'C1', Lines: [
      { AccountCode: code, Debit: amount, Description: 'Expense ' + code, CostCenterID: cc }, { AccountCode: '1100', Credit: amount, Description: 'Bank' }] } });
    const p = await call('u-admin', 'postJournalEntry', { jvId: d.jvId });
    return Object.assign(d, p);
  };
  const rent = await jv('6001', 'CC2', 60);
  await jv('6100', 'CC1', 7);
  // The emulator starts each function on its first call: start them before the browser times them.
  await call('u-admin', 'getGlListing', { params: { AccountIDs: ['A-FUEL'], FromDate: D, ToDate: D } });
  await call('u-admin', 'getJournalEntryDetail', { jvId: rent.jvId });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8187);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  async function open() {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8187/?module=GLREPORT&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#gl-account-datalist option').length > 3 && document.querySelectorAll('#gl-costcenter option').length > 1, null, { timeout: 30000 });
    await page.fill('#gl-from-date', D); await page.fill('#gl-to-date', D);
    return page;
  }
  const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const clip = async (p, re) => { await until(p, s => navigator.clipboard.readText().then(t => new RegExp(s).test(t)), re); return (await p.evaluate(() => navigator.clipboard.readText())).split('\n'); };

  await check('Ledger: the Cost Center column, on screen and in Copy Table; the Txn Ref opens the GL impact with cost centers, copied, and the source document', async () => {
    const p = await open();
    await p.fill('#gl-account-input', '6000 — Operating Expenses');
    await p.click('#gl-run-btn');
    await until(p, () => !document.getElementById('gl-results').classList.contains('hidden') && document.querySelectorAll('#gl-table-body tr').length === 2);
    assert.equal(await p.textContent('#gl-table-body tr:nth-child(2) .gl-cc'), 'CC2 — Office');
    await p.click('#gl-copy-btn');
    const lines = await clip(p, '^Date\\tVoucher No\\.\\tTxn Ref\\tAccount\\tCost Center');
    assert.equal(lines[2].split('\t')[4], 'CC2 — Office');
    await p.click('#gl-table-body .gl-impact-link');
    await p.waitForSelector('#gl-impact:not(.hidden) #gl-impact-table', { timeout: 30000 });
    assert.match(await p.textContent('#gl-impact-subtitle'), new RegExp(rent.jvNumber + ' · TXN-'));
    const cells = await p.$$eval('#gl-impact-table tbody tr', t => t.map(r => [r.cells[0].textContent, r.cells[2].textContent]));
    assert.deepEqual(cells, [['6001', 'CC2 — Office'], ['1100', '']]);
    await p.click('#gl-impact-copy');
    const imp = await clip(p, '^Voucher No\\.\\tTxn Ref\\tDate\\tAccount\\tAccount Name\\tCost Center');
    assert.deepEqual(imp.slice(1).map(l => l.split('\t').slice(3, 6)), [['6001', 'Rent', 'CC2 — Office'], ['1100', 'Bank', ''], ['', '', '']]);
    await p.click('#gl-impact-open');
    await until(p, () => /JV|Journal/i.test(document.getElementById('app-title').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Listing: accounts added (button and Enter) and removed; lines by date with account and cost center, no balances; totals; Copy Table', async () => {
    const p = await open();
    await p.click('#gl-mode-listing');
    await p.fill('#gl-account-input', '6000 — Operating Expenses');
    await p.click('#gl-add-account');
    await p.fill('#gl-account-input', '6100 — Fuel');
    await p.press('#gl-account-input', 'Enter');
    await p.fill('#gl-account-input', '1100 — Bank');
    await p.press('#gl-account-input', 'Enter');
    assert.equal(await p.locator('#gl-picked .gl-chip').count(), 3);
    assert.match(await p.textContent('#gl-picked'), /6000 — Operating Expenses \(all beneath\)/);
    await p.click('#gl-picked .gl-chip:has-text("1100") .gl-chip-del');
    assert.equal(await p.locator('#gl-picked .gl-chip').count(), 2);
    await p.click('#gl-run-btn');
    await until(p, () => !document.getElementById('gl-list-results').classList.contains('hidden'));
    const rows = await p.$$eval('#gl-list-body tr', t => t.map(r => [r.cells[3].textContent.trim(), r.cells[4].textContent, r.cells[6].textContent]));
    assert.deepEqual(rows.map(r => r[0]).sort(), ['6001 Rent', '6100 Fuel']);
    assert.ok(rows.some(r => r[1] === 'CC1 — Workshop') && rows.some(r => r[1] === 'CC2 — Office'));
    assert.equal(await p.locator('#gl-list-results th:has-text("Balance")').count(), 0, 'no balance column');
    assert.deepEqual([await p.textContent('#gl-list-debit'), await p.textContent('#gl-list-credit'), await p.textContent('#gl-list-count')], ['67.00', '0.00', '(2 lines)']);
    assert.ok(await p.isHidden('#gl-results'));
    await p.click('#gl-copy-btn');
    const lines = await clip(p, '^Date\\tVoucher No\\.\\tTxn Ref\\tAccount\\tAccount Name\\tCost Center\\tDescription\\tDebit\\tCredit');
    assert.deepEqual(lines[lines.length - 1].split('\t').slice(-3), ['Total', '67.00', '0.00']);
    // Back to Ledger: one account again.
    await p.click('#gl-mode-ledger');
    assert.ok(await p.isHidden('#gl-picked'));
    assert.ok(await p.isHidden('#gl-add-account'));
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
