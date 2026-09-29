// CBT Fund Transfer (docs/modules/APPROVAL_ROUTING.md, addendum): the fifth
// type button; From lists cash and bank accounts, To offers only the
// company's other cash / bank accounts, one line with no Add Line / Paste;
// saving makes a From-credit / To-debit draft. Other types keep their grid.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/cbtFundTransfer.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-PETTY'] = { AccountCode: '1001', AccountName: 'Petty Cash', AccountType: 'Asset', SubCategory: 'Cash', Status: 'Active', IsPostable: true };
  f.coa['A-BANK2'] = { AccountCode: '1101', AccountName: 'C2 Bank', AccountType: 'Asset', SubCategory: 'Bank', Status: 'Active', IsPostable: true, CompanyID: 'C2' };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8147);
  const browser = await chromium.launch();

  await check('Fund Transfer: From / To limited to cash and bank, one line, saved as From credit / To debit', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8147/?module=CBT&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.click('#cbt-new-btn');
    await page.selectOption('#cbt-form-company', 'C1');
    await page.click('.cbt-type-btn[data-type="Fund Transfer"]');
    await page.waitForTimeout(300);
    assert.equal(await page.textContent('#cbt-ledger-label'), 'Transfer From (Cash / Bank)');
    const froms = await page.$$eval('#cbt-form-ledger option', os => os.map(o => o.value).filter(Boolean));
    assert.deepEqual(froms, ['1000', '1001', '1100'], 'cash and bank of this company');
    await page.selectOption('#cbt-form-ledger', '1100');
    await page.waitForTimeout(200);
    const tos = await page.$$eval('#cbt-opposite-datalist option', os => os.map(o => o.value));
    assert.deepEqual(tos.sort(), ['1000', '1001'], 'other cash / bank accounts only');
    assert.ok(await page.isHidden('#cbt-add-line-btn'));
    assert.ok(await page.isHidden('#cbt-paste-btn'));

    await page.fill('#cbt-form-description', 'Cash withdrawal');
    await page.fill('#cbt-grid-body input[data-row="0"][data-col="0"]', '1000');
    await page.fill('#cbt-grid-body input[data-row="0"][data-col="1"]', 'Withdrawal');
    await page.fill('#cbt-grid-body input[data-row="0"][data-col="2"]', '250');
    await page.press('#cbt-grid-body input[data-row="0"][data-col="2"]', 'Tab');
    await page.waitForTimeout(200);
    assert.equal(await page.$$eval('#cbt-grid-body input[data-col="0"]', is => is.length), 1, 'no second row');
    await page.click('#cbt-save-draft-btn');
    await page.waitForSelector('#cbt-list-view:not(.hidden)', { timeout: 15000 });
    const snap = await firestore.collection('journalEntries').where('VoucherType', '==', 'Fund Transfer').get();
    assert.equal(snap.size, 1);
    assert.deepEqual(snap.docs[0].data().Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), [['1100', 0, 250], ['1000', 250, 0]]);

    // Back to a payment: its multi-line grid returns.
    await page.click('#cbt-new-btn');
    await page.selectOption('#cbt-form-company', 'C1');
    await page.click('.cbt-type-btn[data-type="Fund Transfer"]');
    await page.click('.cbt-type-btn[data-type="Bank Payment"]');
    await page.waitForTimeout(200);
    assert.ok(await page.isVisible('#cbt-add-line-btn'));
    assert.deepEqual(await page.$$eval('#cbt-form-ledger option', os => os.map(o => o.value).filter(Boolean)), ['1100']);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
