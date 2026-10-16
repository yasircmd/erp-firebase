// Item categories of your own on Item Master (owner, 2026-10-16; docs/modules/
// ITEM_CATEGORIES_CUSTOM.md): New category… in the item form (name, prefix,
// behaves like, company); it appears after the five, chosen; an item saved
// in it gets its own code; the list shows and filters by it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/itemCategories.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8195);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  const page = await browser.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());
  await page.goto('http://127.0.0.1:8195/?module=ITEMMASTER&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, T);
  await page.waitForLoadState('networkidle');

  await check('New category… in the item form: refused without a prefix, then added and chosen', async () => {
    await page.click('#im-add-btn');
    await page.click('#im-cat-new');
    await page.fill('#im-cat-name', 'Spare Parts');
    await page.selectOption('#im-cat-base', 'Consumable');
    await page.click('#im-cat-save');
    await page.waitForSelector('#im-cat-error:not(.hidden)', T);
    assert.match(await page.textContent('#im-cat-error'), /code prefix/);
    await page.fill('#im-cat-prefix', 'sp');
    await page.click('#im-cat-save');
    await page.waitForSelector('#im-cat-panel.hidden', { state: 'attached', timeout: 30000 });
    await page.waitForFunction(() => /Spare Parts \(SP, like Consumable\)/.test(document.getElementById('im-form-category').selectedOptions[0].textContent), null, T);
  });

  await check('an item in it: its own code; the list shows the category and filters by it', async () => {
    await page.fill('#im-form-name', 'Bearing 6204');
    await page.selectOption('#im-form-uom', 'UOM-PCS');
    await page.selectOption('#im-form-company', 'C1');
    await page.selectOption('#im-form-inventory-account', 'A-INV');
    await page.selectOption('#im-form-consumption-account', 'A-CONS');
    await page.click('#im-save-btn');
    await page.waitForFunction(() => /SP-000001[\s\S]*Bearing 6204[\s\S]*Spare Parts/.test(document.getElementById('im-table-body').textContent), null, T);
    const it = Object.values(await val('items')).find(i => i.ItemName === 'Bearing 6204');
    assert.deepEqual([it.ItemCode, it.Category], ['SP-000001', 'Consumable']);
    const key = await page.$eval('#im-category-filter option[data-custom]', o => o.value);
    await page.selectOption('#im-category-filter', key);
    assert.deepEqual(await page.$$eval('#im-table-body tr', r => r.map(x => x.cells[0].textContent.trim())), ['SP-000001']);
    await page.selectOption('#im-category-filter', 'Consumable');
    assert.doesNotMatch(await page.textContent('#im-table-body'), /SP-000001/, 'its own category, not the base');
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
