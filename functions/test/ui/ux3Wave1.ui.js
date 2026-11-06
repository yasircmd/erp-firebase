// UX round 3, wave 1 (owner, 2026-11-06; docs/modules/UX_ROUND3.md): Item
// Sub-Category's Find (item 4); Item Master offering a new item its
// sub-categories at once, a company's too, choosing one giving the item that
// company (item 5); Roles & Permissions asking before leaving with unsaved
// ticks (item 7).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/ux3Wave1.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/ux3Wave1.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  f.itemSubCategories = {
    S1: { Name: 'Metals', ParentCategory: 'RawMaterial', CompanyID: 'C1', Status: 'Active' },
    S2: { Name: 'Plastics', ParentCategory: 'RawMaterial', CompanyID: '', Status: 'Active' },
    S3: { Name: 'Boxes', ParentCategory: 'Consumable', CompanyID: '', Status: 'Active' }
  };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8216);
  const browser = await chromium.launch();
  const dialogs = [];
  async function open(module) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto('http://127.0.0.1:8216/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }

  await check('Item Sub-Category: Find narrows the list by name, parent category or company', async () => {
    const page = await open('ITEMSUBCAT');
    await page.waitForFunction(() => document.querySelectorAll('#isc-table-body tr').length === 3, null, T);
    const names = () => page.$$eval('#isc-table-body tr td:first-child', t => t.map(x => x.textContent));
    await page.fill('#isc-search', 'plast');
    assert.deepEqual(await names(), ['Plastics']);
    await page.fill('#isc-search', 'consumable');
    assert.deepEqual(await names(), ['Boxes'], 'by parent category');
    await page.fill('#isc-search', 'test co one');
    assert.deepEqual(await names(), ['Metals'], 'by company');
    await page.fill('#isc-search', 'zzz');
    assert.match(await page.textContent('#isc-table-body'), /No sub-category matches/);
    await page.fill('#isc-search', '');
    assert.equal((await names()).length, 3);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Item Master: a new item lists its sub-categories, a company\'s too; choosing one gives the item that company', async () => {
    const page = await open('ITEMMASTER');
    await page.waitForSelector('#im-add-btn:not(.hidden)', T);
    await page.click('#im-add-btn'); // straight away: before the lists may have loaded
    await page.selectOption('#im-form-category', 'RawMaterial');
    await page.waitForFunction(() => document.querySelectorAll('#im-form-subcategory option').length === 3, null, T);
    assert.equal(await page.inputValue('#im-form-company'), '', 'no company yet');
    assert.deepEqual(await page.$$eval('#im-form-subcategory option', o => o.map(x => x.textContent)), ['None', 'Metals — Test Co One', 'Plastics']);
    await page.selectOption('#im-form-subcategory', 'S1');
    assert.equal(await page.inputValue('#im-form-company'), 'C1', 'the sub-category\'s company');
    assert.equal(await page.inputValue('#im-form-subcategory'), 'S1', 'kept');
    assert.deepEqual(await page.$$eval('#im-form-subcategory option', o => o.map(x => x.textContent)), ['None', 'Metals', 'Plastics'], 'the company\'s and the shared, by name');
    await page.selectOption('#im-form-company', 'C2');
    assert.deepEqual(await page.$$eval('#im-form-subcategory option', o => o.map(x => x.textContent)), ['None', 'Plastics'], 'another company: not C1\'s');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Roles & Permissions: a tick changed and not saved asks before leaving; saved, it does not', async () => {
    const page = await open('ROLES');
    await page.waitForSelector('#perm-table-body input[type="checkbox"]', T);
    assert.equal(await page.evaluate(() => window.hasUnsavedChanges()), false, 'nothing changed yet');
    await page.click('#perm-table-body input[type="checkbox"] >> nth=3');
    assert.equal(await page.evaluate(() => window.hasUnsavedChanges()), true, 'the shell asks before going back');
    await page.click('#perm-save-btn');
    await page.waitForFunction(() => !document.getElementById('perm-save-btn').disabled && window.hasUnsavedChanges() === false, null, T);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
