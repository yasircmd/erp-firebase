// Item Sub-Categories by company (owner, 2026-10-14; docs/modules/
// ITEM_SUBCATEGORIES.md): Item Master offers a category's shared
// sub-categories and the item's company's; "New…" opens Item Sub-Category
// on its Add form (category and company filled in), with Back to Item
// Master. Seeds its own data (it WIPES the emulator database):
//   node functions/test/ui/itemSubCategories.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.itemSubCategories = {
    S1: { Name: 'Metals', ParentCategory: 'RawMaterial', Status: 'Active' },
    S2: { Name: 'Cables', ParentCategory: 'RawMaterial', Status: 'Active', CompanyID: 'C1' },
    S3: { Name: 'Pipes', ParentCategory: 'RawMaterial', Status: 'Active', CompanyID: 'C2' }
  };
  f.users['u-admin'].AssignedCompanies = ['C1', 'C2'];
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8164);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());
  const loaded = page.waitForResponse(r => /getActiveItemSubCategories/.test(r.url()), { timeout: 30000 });
  await page.goto('http://127.0.0.1:8164/?module=ITEMMASTER&uid=u-admin');
  await loaded;
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  const subs = () => page.$$eval('#im-form-subcategory option', os => os.map(o => o.textContent));

  await check('Item Master: a category\'s shared sub-categories and the item\'s company\'s', async () => {
    await page.click('#im-add-btn');
    await page.waitForSelector('#im-modal:not(.hidden)');
    await page.selectOption('#im-form-category', 'RawMaterial');
    assert.deepEqual(await subs(), ['None', 'Metals'], 'a shared item: shared ones only');
    await page.selectOption('#im-form-company', 'C1');
    assert.deepEqual(await subs(), ['None', 'Cables', 'Metals']);
    await page.selectOption('#im-form-company', 'C2');
    assert.deepEqual(await subs(), ['None', 'Metals', 'Pipes']);
  });

  await check('"New…": Item Sub-Category\'s Add form with the category and company; saved; Back to Item Master', async () => {
    await page.click('#im-subcat-new');
    await page.waitForSelector('#isc-modal:not(.hidden)', { timeout: 30000 });
    assert.equal(await page.inputValue('#isc-form-category'), 'RawMaterial');
    assert.equal(await page.inputValue('#isc-form-company'), 'C2');
    await page.fill('#isc-form-name', 'Valves');
    await page.click('#isc-save-btn');
    await page.waitForFunction(() => /Valves/.test(document.getElementById('isc-table-body').textContent), null, { timeout: 15000 });
    assert.ok(Object.values(await val('itemSubCategories')).some(s => s.Name === 'Valves' && s.CompanyID === 'C2'));
    assert.match(await page.textContent('#isc-back-label'), /Back to Item Master/);
    await page.click('#isc-back-btn');
    await page.waitForSelector('#im-add-btn', { timeout: 30000 });
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
