// Chart of Accounts: moving an unused account to another head gives it a new
// code, and the screen says so in-app (owner, 2026-10-02;
// docs/modules/COA_RECODE.md). A used one shows the refusal in the form.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/coaRecode.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val, rtdb } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  const acc = (code, name, parent, postable) => ({ AccountCode: code, AccountName: name, AccountType: 'Asset', Status: 'Active', IsPostable: postable !== false, ParentAccountID: parent || '', NormalBalance: 'Debit' });
  Object.assign(f.coa, {
    H1: acc('110000', 'Bank Accounts', '', false), H2: acc('120000', 'Cash in Hand', '', false),
    L1: acc('110001', 'Petty Cash', 'H1'), L2: acc('110002', 'Bank Main', 'H1')
  });
  await reset(f);
  await rtdb.ref('recurringJournals/RJ1').set({ Name: 'Monthly bank charge', Lines: [{ AccountCode: '110002', Debit: 10 }] });
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8160);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8160/?module=COA&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  // These accounts are shared; a one-company user's list opens on their company.
  await page.waitForFunction(() => document.querySelectorAll('#coa-company-filter option').length > 2, null, { timeout: 30000 });
  await page.selectOption('#coa-company-filter', '__shared__');
  const row = name => page.locator('#coa-table-body tr', { hasText: name });
  await row('110001').waitFor({ timeout: 30000 });

  await check('an unused account moved to another head: new code, and the user is told', async () => {
    await row('110001').locator('.coa-edit').click();
    await page.waitForSelector('#coa-modal:not(.hidden)');
    await page.selectOption('#coa-form-parent', 'H2');
    await page.click('#coa-save-btn');
    await page.waitForFunction(() => document.getElementById('coa-modal').classList.contains('hidden'), null, { timeout: 20000 });
    await page.waitForFunction(() => /120001/.test(document.getElementById('coa-table-body').textContent), null, { timeout: 20000 });
    assert.deepEqual(page.__dialogs, ['Moved to the new head: code 110001 is now 120001.']);
    assert.equal((await val('coa/L1')).AccountCode, '120001');
  });

  await check('a used account: the form shows why it can\'t move, and nothing changes', async () => {
    await row('110002').locator('.coa-edit').click();
    await page.waitForSelector('#coa-modal:not(.hidden)');
    await page.selectOption('#coa-form-parent', 'H2');
    await page.click('#coa-save-btn');
    await page.waitForSelector('#coa-form-error:not(.hidden)', { timeout: 20000 });
    assert.match(await page.textContent('#coa-form-error'), /^Account 110002 has already been used \(Recurring Journal Monthly bank charge\), so it can't move to another head with a new code\./);
    assert.equal((await val('coa/L2')).AccountCode, '110002');
    assert.equal(page.__dialogs.length, 1, 'no second message');
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
