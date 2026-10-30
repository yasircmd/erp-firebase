// Exchange rates from the firm's Google Sheet (docs/modules/FX_SHEET.md):
// the Developer screen saves the sheet's link; Currency Configuration reads
// it on a click, a move over 5% marked and left unticked, and applies only
// the ticked rates.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/fxSheet.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const SHEET = 'http://127.0.0.1:8177/rates.csv';

(async () => {
  const sheet = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end('Currency,Base,Rate\nUSD,AED,3.6730\nEUR,AED,4.2\n'); }).listen(8177, '127.0.0.1');
  const f = baseFixture();
  f.currencies = { CUR1: { Code: 'AED', Name: 'UAE Dirham', IsDefault: true, Status: 'Active' }, CUR2: { Code: 'USD', Name: 'US Dollar', Status: 'Active' }, CUR3: { Code: 'EUR', Name: 'Euro', Status: 'Active' } };
  f.exchangeRates = { USD: { r1: { EffectiveDate: '2026-10-01', Rate: 3.6725, Note: '', By: 'admin', ByName: 'Admin', At: '2026-10-01T08:00:00Z' } },
    EUR: { r1: { EffectiveDate: '2026-10-01', Rate: 3.9, Note: '', By: 'admin', ByName: 'Admin', At: '2026-10-01T08:00:00Z' } } };
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8176);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8176/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }

  await check('Developer: the firm\'s sheet link saved on the Groups page', async () => {
    const p = await open('DEVELOPER');
    await p.click('#dv-pages [data-page="groups"]');
    await p.fill('#dv-fx-url', 'https://example.com/rates.csv');
    await p.click('#dv-fx-save');
    for (let i = 0; i < 40 && !p.__dialogs.length; i++) await p.waitForTimeout(250);
    assert.match(p.__dialogs.shift() || '', /published CSV link/);
    await p.fill('#dv-fx-url', SHEET);
    await p.click('#dv-fx-save');
    for (let i = 0; i < 40 && !p.__dialogs.length; i++) await p.waitForTimeout(250);
    assert.equal(p.__dialogs.shift(), 'Saved.');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Currency Configuration: the sheet read on a click, EUR\'s 7.69% marked and unticked; only USD applied', async () => {
    const p = await open('CURRENCYCONFIG');
    await p.waitForSelector('#cc-sheet:not(.hidden)', T);
    await p.click('#cc-sheet-get');
    await p.waitForSelector('#cc-sheet-result:not(.hidden) .cc-sheet-tick', T);
    const rows = await p.$$eval('#cc-sheet-body tr', trs => trs.map(tr => [tr.children[1].textContent.trim(), tr.querySelector('input').checked, tr.className.includes('amber'), tr.children[5].textContent.trim()]));
    assert.deepEqual(rows, [['EUR Euro', false, true, '+7.69%'], ['USD US Dollar', true, false, '+0.01%']]);
    await p.fill('#cc-sheet-date', '2026-10-30');
    await p.click('#cc-sheet-apply');
    await p.waitForFunction(() => /1 rate applied/.test(document.getElementById('cc-sheet-note').textContent), null, T);
    const usd = Object.values(await val('exchangeRates/USD')).find(x => x.EffectiveDate === '2026-10-30');
    assert.deepEqual([usd.Rate, usd.Note], [3.673, 'From the sheet']);
    assert.equal(Object.keys(await val('exchangeRates/EUR')).length, 1, 'EUR not applied');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); sheet.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
