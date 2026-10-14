// Company Master: the list is in company code order (owner, 2026-10-14),
// numbers compared as numbers. (A company saved without a code is given the
// next one by the server, here 04.)
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/companyMaster.ui.js
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
  Object.assign(f.companies, {
    C3: { Status: 'Active', LegalName: 'Alpha Holdings', CompanyRefCode: '10', CreatedAt: '2025-01-03' },
    C4: { Status: 'Active', LegalName: 'Zeta Trading', CompanyRefCode: '03', CreatedAt: '2025-01-04' },
    C5: { Status: 'Active', LegalName: 'Beta Trading', CreatedAt: '2025-01-05' }
  });
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8162);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());
  await page.goto('http://127.0.0.1:8162/?module=COMPANYMASTER&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });

  await check('the list is in code order, not by name', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#co-table-body tr[data-party-id]').length === 5, null, { timeout: 30000 });
    const order = await page.$$eval('#co-table-body tr[data-party-id]', trs => trs.map(tr => tr.cells[1].textContent.trim() + ' ' + tr.cells[0].textContent.trim()));
    assert.deepEqual(order, ['01 Test Co One', '02 Test Co Two', '03 Zeta Trading', '04 Beta Trading', '10 Alpha Holdings']);
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
