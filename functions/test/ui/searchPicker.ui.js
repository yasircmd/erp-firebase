// The shell's searchable picker (owner, 2026-10-16; docs/modules/
// SEARCH_PICKER.md, decisions 191-196): on JV, typing in an account cell
// opens it under the cell (any part of the code or name, code first);
// arrows and Enter choose, the screen sees the code as if typed; Esc
// closes; a value set at once (a paste) does not open it. A long drop-down
// (the invoice's customers) opens it with its own search box; recent
// picks first; on a phone it fills the screen. Short drop-downs stay the
// browser's own.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/searchPicker.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const NAMES = ['Alpha Foods', 'Beta Trading', 'Gamma Builders', 'Delta Marine', 'Epsilon Retail', 'Zeta Motors', 'Eta Textiles', 'Theta Supplies', 'Iota Hardware',
  'Kappa Logistics', 'Lambda Printing', 'Mu Electricals', 'Nu Furniture', 'Xi Catering', 'Omicron Trading Post'];

(async () => {
  const f = baseFixture();
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.customers = Object.fromEntries(NAMES.map((n, i) => ['CU' + i, { CustomerCode: 'C' + String(i + 1).padStart(3, '0'), CustomerName: n, Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' }]));
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8192);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module, opts) {
    const ctx = await browser.newContext(opts || {});
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8192/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  const rows = p => p.$$eval('#erp-picker:not(.hidden) .erp-picker-row', r => r.map(x => x.textContent));
  const shown = p => p.isVisible('#erp-picker');

  let jv;
  await check('JV: typing in an account cell opens the picker under it, any part of the code or name, the code first', async () => {
    jv = await open('JV');
    await jv.click('#jv-new-btn');
    await jv.selectOption('#jv-form-company', 'C1');
    const cell = '#jv-grid-body tr:first-child input[data-col="0"]';
    await jv.waitForSelector(cell, T);
    await jv.click(cell);
    await jv.keyboard.type('trad');
    await jv.waitForSelector('#erp-picker:not(.hidden) .erp-picker-row', T);
    assert.deepEqual(await rows(jv), ['1200Trade Receivables', '2000Trade Payables'], 'a word starting so, in the list\'s order');
    assert.ok(await jv.isHidden('#erp-picker .erp-picker-search'), 'the typing stays in the cell');
    await jv.keyboard.press('Backspace'); await jv.keyboard.press('Backspace'); await jv.keyboard.press('Backspace'); await jv.keyboard.press('Backspace');
    await jv.keyboard.type('1');
    assert.deepEqual((await rows(jv)).slice(0, 3), ['1000Cash', '1100Bank', '1200Trade Receivables'], 'code first');
    await jv.keyboard.type('1');
    await jv.keyboard.press('ArrowDown');
    await jv.keyboard.press('Enter');
    assert.equal(await jv.inputValue(cell), '1100');
    assert.equal((await jv.textContent('#jv-grid-body tr:first-child .jv-account-name')).trim(), 'Bank', 'the screen saw the choice');
    assert.equal(await shown(jv), false);
    assert.equal(await jv.getAttribute(cell, 'list'), null, 'the browser list is off while in the cell');
    await jv.keyboard.press('Tab');
    assert.equal(await jv.getAttribute(cell, 'list'), 'jv-account-datalist', 'and back once left');
    assert.deepEqual(jv.__errors, []);
  });

  await check('Esc closes; a value set at once (a paste) does not open it; arrowing then Tab chooses', async () => {
    await jv.click('#jv-add-line-btn');
    const cell = '#jv-grid-body tr:nth-child(2) input[data-col="0"]';
    await jv.waitForSelector(cell, T);
    await jv.click(cell);
    await jv.keyboard.type('ca');
    await jv.waitForSelector('#erp-picker:not(.hidden)', T);
    await jv.keyboard.press('Escape');
    assert.equal(await shown(jv), false);
    assert.equal(await jv.inputValue(cell), 'ca', 'Esc keeps what was typed');
    await jv.fill(cell, '4000');
    assert.equal(await shown(jv), false, 'a fill / paste is not typing');
    await jv.fill(cell, '');
    await jv.keyboard.type('sal');
    await jv.waitForSelector('#erp-picker:not(.hidden) .erp-picker-row', T);
    assert.deepEqual(await rows(jv), ['4000Sales', '5000Cost of Sales'], 'the name\'s start first, then a word in it');
    await jv.keyboard.press('ArrowDown');
    await jv.keyboard.press('Tab');
    assert.equal(await jv.inputValue(cell), '4000');
    assert.deepEqual(jv.__errors, []);
    await jv.context().close();
  });

  await check('a long drop-down (the invoice\'s customer): its own search box, any part of the name; recent picks first next time', async () => {
    const p = await open('CUSTOMERINVOICE');
    await p.click('#cinv-new-btn');
    await p.selectOption('#cinv-form-company', 'C1');
    await p.waitForFunction(() => document.getElementById('cinv-form-customer').options.length >= 15, null, T);
    await p.click('#cinv-form-customer');
    await p.waitForSelector('#erp-picker:not(.hidden) .erp-picker-search', T);
    assert.equal(await p.evaluate(() => document.activeElement.className), 'erp-picker-search');
    await p.keyboard.type('trad');
    assert.deepEqual((await rows(p)).map(t => t.replace(/^C\d+\s*[—-]?\s*/, '')), ['Beta Trading', 'Omicron Trading Post']);
    await p.click('#erp-picker .erp-picker-row >> nth=1');
    assert.equal(await p.inputValue('#cinv-form-customer'), 'CU14');
    assert.equal(await shown(p), false);
    // Typing a letter on the focused drop-down opens it too.
    await p.focus('#cinv-form-customer');
    await p.keyboard.press('k');
    await p.waitForSelector('#erp-picker:not(.hidden)', T);
    assert.equal(await p.inputValue('#erp-picker .erp-picker-search'), 'k');
    await p.keyboard.press('Escape');
    await p.click('#cinv-form-customer');
    await p.waitForSelector('#erp-picker:not(.hidden) .erp-picker-group', T);
    assert.equal(await p.textContent('#erp-picker .erp-picker-group'), 'Recent');
    assert.match((await rows(p))[0], /Omicron Trading Post/);
    await p.keyboard.press('Escape');
    // A short drop-down stays the browser's own.
    await p.click('#cinv-form-company');
    assert.equal(await shown(p), false);
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('on a phone: the whole screen, with a box to type in', async () => {
    const p = await open('CUSTOMERINVOICE', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await p.click('#cinv-new-btn');
    await p.selectOption('#cinv-form-company', 'C1');
    await p.waitForFunction(() => document.getElementById('cinv-form-customer').options.length >= 15, null, T);
    await p.tap('#cinv-form-customer');
    await p.waitForSelector('#erp-picker.erp-picker-full:not(.hidden)', T);
    const box = await p.$eval('#erp-picker', el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    const vw = await p.evaluate(() => [window.innerWidth, window.innerHeight]);
    assert.deepEqual(box, [0, 0, vw[0], vw[1]], 'the whole screen (the ERP lays a phone out wider, so the text is scaled up)');
    assert.ok(parseFloat(await p.$eval('#erp-picker', el => el.style.fontSize)) >= 32);
    await p.keyboard.type('marine');
    await p.keyboard.press('Enter');
    assert.equal(await p.inputValue('#cinv-form-customer'), 'CU3');
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
