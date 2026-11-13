// UX batch 4, item 4 (owner, 2026-11-13; docs/modules/UX4.md, Q502): a
// warehouse's default cost center, set in Organizational Units (only for a
// warehouse; its company's active cost centers and shared ones), and taken
// by an inventory line when its warehouse is chosen (shell
// warehouseCostCenter), shown at once in the line's cost center list.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/warehouseCostCenter.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/warehouseCostCenter.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  Object.assign(f.orgUnits, {
    CC2: { Type: 'CostCenter', Code: 'CC2', Name: 'Stores', Status: 'Active', CompanyID: 'C1' },
    CCX: { Type: 'CostCenter', Code: 'CCX', Name: 'Other company', Status: 'Active', CompanyID: 'C2' }
  });
  f.orgUnits.WH1.DefaultCostCenterID = 'CC2';
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8233);
  const browser = await chromium.launch();
  async function open(module) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8233/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }

  await check('Organizational Units: a warehouse shows its default cost center (its company\'s, not another\'s); saving keeps it', async () => {
    const p = await open('ORGUNITS');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#module-container button')].find(x => x.closest('tr') && x.closest('tr').textContent.includes('WH1') && /edit/i.test(x.textContent + x.title)); b.click(); });
    await p.waitForSelector('#ou-modal:not(.hidden)', T);
    assert.equal(await p.isVisible('#ou-warehouse-fields'), true);
    assert.equal(await p.inputValue('#ou-form-defcc'), 'CC2');
    const offered = await p.$$eval('#ou-form-defcc option', os => os.map(o => o.value));
    assert.ok(offered.includes('CC1') && !offered.includes('CCX'), offered.join(','));
    await p.selectOption('#ou-form-defcc', 'CC1');
    await p.click('#ou-save-btn');
    for (let i = 0; i < 50 && (await val('orgUnits/WH1')).DefaultCostCenterID !== 'CC1'; i++) await p.waitForTimeout(100);
    assert.equal((await val('orgUnits/WH1')).DefaultCostCenterID, 'CC1');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#module-container button')].find(x => x.closest('tr') && x.closest('tr').textContent.includes('CC1') && /edit/i.test(x.textContent + x.title)); b.click(); });
    await p.waitForSelector('#ou-modal:not(.hidden)', T);
    assert.equal(await p.isVisible('#ou-warehouse-fields'), false, 'not for a cost center');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('GRN: choosing a line\'s warehouse sets the line\'s cost center to the warehouse\'s default, shown at once', async () => {
    const p = await open('GRN');
    await p.click('#grn-new-btn');
    await p.waitForSelector('#grn-entry-view:not(.hidden)', T);
    await p.selectOption('#grn-form-company', 'C1').catch(() => {});
    await p.waitForSelector('select.grn-line-wh[data-row="0"]', T);
    await p.selectOption('select.grn-line-wh[data-row="0"]', 'WH1');
    assert.equal(await p.inputValue('select.grn-line-cc[data-row="0"]'), 'CC1');
    await p.selectOption('select.grn-line-wh[data-row="0"]', 'WH2');
    assert.equal(await p.inputValue('select.grn-line-cc[data-row="0"]'), 'CC1', 'a warehouse with none leaves it');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : results.length + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
