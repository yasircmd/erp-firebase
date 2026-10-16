// Company Master: the list is in company code order (owner, 2026-10-14),
// numbers compared as numbers. (A company saved without a code is given the
// next one by the server, here 04.)
// Also: shareholders (docs/modules/UX_TIER3.md, F).
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
  page.__dialogs = [];
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8162/?module=COMPANYMASTER&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });

  await check('the list is in code order, not by name', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#co-table-body tr[data-party-id]').length === 5, null, { timeout: 30000 });
    const order = await page.$$eval('#co-table-body tr[data-party-id]', trs => trs.map(tr => tr.cells[1].textContent.trim() + ' ' + tr.cells[0].textContent.trim()));
    assert.deepEqual(order, ['01 Test Co One', '02 Test Co Two', '03 Zeta Trading', '04 Beta Trading', '10 Alpha Holdings']);
    assert.deepEqual(page.__errors, []);
  });

  await check('Shareholders (UX_TIER3.md F): added, the % of the issued shares, a total short of 100% warned; printed on the company profile', async () => {
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.waitForSelector('#co-table-body tr[data-party-id="C1"] .co-shareholders', { timeout: 20000 });
    await page.click('#co-table-body tr[data-party-id="C1"] .co-shareholders');
    await page.waitForFunction(() => /No shareholders entered yet/.test(document.getElementById('co-sh-body').textContent), null, { timeout: 20000 });
    const add = async (name, shares) => {
      await page.click('#co-sh-add');
      await page.fill('#co-sh-name', name);
      await page.fill('#co-sh-nationality', 'Exampleland');
      await page.fill('#co-sh-idnumber', 'P-' + shares);
      await page.fill('#co-sh-shares', String(shares));
      await page.fill('#co-sh-from', '2020-01-01');
      await page.click('#co-sh-save');
      await page.waitForFunction(n => [...document.querySelectorAll('#co-sh-body tr[data-id]')].some(tr => tr.cells[0].textContent === n), name, { timeout: 20000 });
    };
    await add('Alex Example', 600);
    await page.waitForFunction(() => /Enter the issued shares/.test(document.getElementById('co-sh-warning').textContent));
    await page.fill('#co-sh-issued', '1000');
    await page.click('#co-sh-issued-save');
    await page.waitForFunction(() => /60%/.test(document.getElementById('co-sh-body').textContent));
    assert.match(await page.textContent('#co-sh-warning'), /hold 600 of the 1000 issued shares \(60%\), not 100%/);
    await add('Bee Sample', 400);
    await page.waitForFunction(() => document.getElementById('co-sh-warning').classList.contains('hidden'));
    assert.match(await page.textContent('#co-sh-summary'), /2 current shareholder\(s\), 1,000 shares \(100%\)/);
    assert.ok(page.__dialogs.some(m => /^Saved\. Enter the issued shares/.test(m)), page.__dialogs.join(' | '));
    await page.click('#co-sh-print');
    assert.equal(await page.evaluate(() => window.__printed), 1);
    const printed = await page.textContent('#co-print-document');
    assert.match(printed, /Test Co One[\s\S]*Company profile[\s\S]*Issued shares: 1,000[\s\S]*Alex Example[\s\S]*60%[\s\S]*Bee Sample[\s\S]*40%/);
    assert.match(await page.textContent('#co-sh-log'), /Add[\s\S]*Bee Sample/);
    assert.deepEqual(page.__errors, []);
  });

  await check('a Viewer (no shareholders right) has no Shareholders button', async () => {
    const v = await browser.newPage();
    await v.goto('http://127.0.0.1:8162/?module=COMPANYMASTER&uid=u-viewer');
    await v.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await v.waitForFunction(() => document.querySelectorAll('#co-table-body tr[data-party-id]').length === 5, null, { timeout: 30000 });
    await v.waitForLoadState('networkidle');
    assert.equal(await v.$$eval('.co-shareholders', b => b.length), 0);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
