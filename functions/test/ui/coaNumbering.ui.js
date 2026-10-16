// Chart of Accounts on screen (owner, 2026-10-16; docs/modules/COA_NUMBERING.md):
// the accounts to fix listed; a group under a class with the Cash / Bank
// mark (shown only for an Assets heading with a parent); Renumber an
// account within its group through the in-app prompts.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/coaNumbering.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const chart = await call('u-admin', 'getChartOfAccounts', {}); // the seed
  const idOf = code => chart.find(a => a.AccountCode === code).AccountID;
  const petty = (await call('u-admin', 'saveAccount', { accountData: { AccountName: 'Petty cash', AccountType: 'Asset', IsPostable: true, Status: 'Active', ParentAccountID: idOf('110000') } })).accountId;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8194);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  const page = await browser.newPage();
  page.__errors = []; page.__dialogs = []; page.__answers = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(page.__answers.shift()); });
  await page.goto('http://127.0.0.1:8194/?module=COA&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, T);
  await page.waitForFunction(() => document.querySelectorAll('#coa-table-body tr').length > 5, null, T);

  await check('the accounts to fix: the test chart\'s accounts outside a group', async () => {
    await page.waitForSelector('#coa-fix:not(.hidden)', T);
    assert.match(await page.textContent('#coa-fix-list'), /1000 Cash: has no group above it/);
    assert.doesNotMatch(await page.textContent('#coa-fix-list'), /110001/);
  });

  await check('a group under the Assets class, marked Bank: the field only for an Assets heading with a parent', async () => {
    await page.click('#coa-add-btn');
    await page.selectOption('#coa-form-type', 'Asset');
    assert.ok(await page.isHidden('#coa-cashbank-field'), 'no parent: the class');
    await page.selectOption('#coa-form-parent', idOf('100000'));
    assert.ok(await page.isVisible('#coa-cashbank-field'));
    await page.check('#coa-form-postable');
    assert.ok(await page.isHidden('#coa-cashbank-field'), 'an account takes its group\'s');
    await page.uncheck('#coa-form-postable');
    assert.match(await page.textContent('#coa-form-parent'), /100000 — Assets[\s\S]*— 110000 — Cash/);
    await page.fill('#coa-form-name', 'Wallets');
    await page.selectOption('#coa-form-cashbank', 'Bank');
    await page.click('#coa-save-btn');
    await page.waitForFunction(() => /Wallets\s*Bank/.test(document.getElementById('coa-table-body').textContent), null, T);
    const g = Object.values(await val('coa')).find(a => a.AccountName === 'Wallets');
    assert.deepEqual([g.AccountCode, g.OwnCashBank, g.CashBank], ['150000', 'Bank', 'Bank']);
  });

  await check('Renumber: the free codes of its group, a reason; the row shows "formerly"', async () => {
    page.__answers.push('110009', 'Match the old ledger');
    const row = page.locator('#coa-table-body tr', { hasText: 'Petty cash' });
    await row.locator('.coa-renumber').click();
    await page.waitForFunction(() => /formerly 110001/.test(document.getElementById('coa-table-body').textContent), null, T);
    assert.match(page.__dialogs[0], /^Renumber 110001 Petty cash within 110000 Cash \/ Petty Cash\.[\s\S]*Free codes: 110002 to 110999/);
    assert.match(page.__dialogs[1], /reason for renumbering 110001 to 110009/);
    assert.match(page.__dialogs[2], /Renumbered: 110001 is now 110009\./);
    assert.equal((await val('coa/' + petty)).AccountCode, '110009');
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
