// Data Reset for every module (owner, 2026-10-24; docs/modules/DATA_RESET.md):
// the screen lists every category in its group (Transactional, Master, and
// the new Setup); Browse only for one whose records may go one by one; a
// master still in use is refused with what uses it, and nothing is deleted.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/dataReset.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.roles.ADMIN = { Name: 'ADMIN', Status: 'Active' };
  f.permissions.DATARESET.access.push('ADMIN'); // the screen; its functions check the literal role
  await reset(f);
  await firestore.doc('employees/E1').set({ FullName: 'Ali Hassan', CompanyID: 'C1' });
  await firestore.doc('payrollRuns/RUN1').set({ RunNumber: 'PR-1', Month: '2026-09', Status: 'Draft' });
  await firestore.doc('hrGrades/G1').set({ Code: 'G1' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8158);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8158/?module=DATARESET&uid=u-root');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.waitForSelector('#dr-content:not(.hidden)', { timeout: 30000 });
  const row = (list, key) => page.locator('#' + list + ' > div', { has: page.locator('input[data-key="' + key + '"]') });

  await check('every category in its group, with its count; Browse only where records may go one by one', async () => {
    assert.equal(await page.locator('.dr-cat-checkbox').count(), 18 + 31); // Clearances (item 28) and Sales Rep Receipts (items 30-31) since
    assert.match(await row('dr-master-list', 'employees').textContent(), /Employees\s*1 record/);
    assert.equal(await row('dr-master-list', 'employees').locator('.dr-browse-btn').count(), 0, 'a master others use is cleared whole');
    assert.equal(await row('dr-transactional-list', 'payrollRuns').locator('.dr-browse-btn').count(), 1);
    assert.match(await row('dr-setup-list', 'hrSetup').textContent(), /HR Setup\s*1 record/);
    assert.equal(await page.locator('#dr-setup-list .dr-cat-checkbox:checked').count(), 0, 'nothing pre-selected');
    assert.deepEqual(page.__errors, []);
  });

  await check('a master still in use: refused, with what uses it; nothing deleted (decision 284)', async () => {
    await row('dr-master-list', 'employees').locator('input').check();
    await page.fill('#dr-confirm-input', 'DELETE');
    await page.dispatchEvent('#dr-confirm-input', 'input');
    await page.click('#dr-clear-btn');
    await page.waitForSelector('#dr-result:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#dr-result'), /Employees is still used by Payroll Runs & Payslips \(1\)\. Select those too, or clear them first\. Nothing was deleted\./);
    assert.equal((await firestore.collection('employees').get()).size, 1);
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
