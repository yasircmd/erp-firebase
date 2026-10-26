// Tax Configuration (docs/modules/TAX_ENGINE.md, part 1) in headless Chromium
// against the emulators: a company started from the UAE VAT preset with its
// emirate and accounts, a rate added by date; India GST needing its state; a
// customer's registration type, state and GSTIN (refused for another state);
// an item's tax code and HSN.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/taxConfig.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Example Traders', Category: 'Retailer', Classification: 'Local', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 30 } };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8134);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', x => page.__errors.push(x.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8134/?module=' + module + '&uid=' + (uid || 'u-admin'));
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  const saved = async (page, n) => { for (let i = 0; i < 60 && page.__dialogs.length < n; i++) await page.waitForTimeout(250); return page.__dialogs.slice(-1)[0] || ''; };

  await check('UAE VAT from the preset: the emirate, the VAT accounts, saved; a rate added from a later date', async () => {
    const page = await open('TAXCONFIG');
    await page.waitForSelector('.tax-preset[data-regime="AE_VAT"]', T);
    await page.click('.tax-preset[data-regime="AE_VAT"]');
    await page.waitForSelector('#tax-form:not(.hidden)', T);
    assert.equal(await page.textContent('#tax-regime'), 'UAE VAT');
    assert.deepEqual(await page.$$eval('.tax-code-code', x => x.map(i => i.value)), ['SR', 'ZR', 'EX', 'OS', 'RC']);
    await page.selectOption('#tax-state', 'DXB');
    await page.selectOption('.tax-comp[data-i="0"] .tax-comp-out', 'A-VATOUT');
    await page.selectOption('.tax-comp[data-i="0"] .tax-comp-in', 'A-VATIN');
    assert.equal(await page.locator('.tax-code[data-i="1"] .tax-rate-pct').count(), 0, 'zero rated: no rate to type');
    await page.click('#tax-save');
    assert.match(await saved(page, 1), /Saved/);
    let cfg = (await firestore.collection('taxConfig').doc('C1').get()).data();
    assert.deepEqual([cfg.Regime, cfg.StateCode, cfg.Components[0].OutputAccountID, cfg.Components[0].InputAccountID], ['AE_VAT', 'DXB', 'A-VATOUT', 'A-VATIN']);
    // A new rate for SR from 2030: the old one stays for earlier documents.
    await page.waitForSelector('#tax-form:not(.hidden) .tax-code[data-i="0"] .tax-rate-add', T);
    await page.click('.tax-code[data-i="0"] .tax-rate-add');
    await page.fill('.tax-code[data-i="0"] .tax-rate[data-j="1"] .tax-rate-from', '2030-01-01');
    await page.fill('.tax-code[data-i="0"] .tax-rate[data-j="1"] .tax-rate-pct', '7.5');
    await page.click('#tax-save');
    assert.match(await saved(page, 2), /Saved/);
    cfg = (await firestore.collection('taxConfig').doc('C1').get()).data();
    assert.deepEqual(cfg.Codes[0].Rates.map(r => [r.From, r.Percent]), [['2018-01-01', 5], ['2030-01-01', 7.5]]);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('India GST: the company\'s GST state is asked for; the CGST / SGST note; the old slabs inactive', async () => {
    const page = await open('TAXCONFIG', 'u-other');
    await page.waitForSelector('.tax-preset[data-regime="IN_GST"]', T);
    await page.click('.tax-preset[data-regime="IN_GST"]');
    await page.waitForSelector('#tax-form:not(.hidden)', T);
    assert.ok(await page.isVisible('#tax-gst-note'));
    assert.equal(await page.inputValue('#tax-rounding'), 'line', 'GST rounds per line (Q315)');
    const inactive = await page.$$eval('.tax-code', boxes => boxes.filter(b => !b.querySelector('.tax-code-active').checked).map(b => b.querySelector('.tax-code-code').value));
    assert.deepEqual(inactive, ['GST12', 'GST28']);
    await page.click('#tax-save');
    assert.match(await saved(page, 1), /company's GST state/);
    await page.selectOption('#tax-state', '27');
    await page.click('#tax-save');
    assert.match(await saved(page, 2), /Saved/);
    assert.equal((await firestore.collection('taxConfig').doc('C2').get()).data().StateCode, '27');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Customer Master: registration type, state and GSTIN; another state\'s GSTIN refused; shown again on edit', async () => {
    const page = await open('CUSTOMERMASTER');
    await page.waitForSelector('#cus-table-body .cus-edit-btn', T);
    await page.click('#cus-table-body .cus-edit-btn');
    await page.waitForSelector('#cus-form-taxtype', { state: 'visible', ...T });
    await page.selectOption('#cus-form-taxtype', 'Registered');
    await page.selectOption('#cus-form-taxstate', '29');
    await page.fill('#cus-form-taxreg', '27ABCDE1234F1Z0');
    await page.click('#cus-save-btn');
    await page.waitForFunction(() => !document.getElementById('cus-form-error').classList.contains('hidden'), null, T);
    assert.match(await page.textContent('#cus-form-error'), /of state 27 \(Maharashtra\), not the state chosen/);
    await page.selectOption('#cus-form-taxstate', '27');
    await page.click('#cus-save-btn');
    await page.waitForFunction(() => document.getElementById('cus-modal').classList.contains('hidden'), null, T);
    const c = await val('customers/CU1');
    assert.deepEqual([c.TaxRegistrationType, c.TaxState, c.TaxRegistrationNumber], ['Registered', '27', '27ABCDE1234F1Z0']);
    await page.waitForSelector('#cus-table-body .cus-edit-btn', T);
    await page.click('#cus-table-body .cus-edit-btn');
    await page.waitForSelector('#cus-form-taxtype', { state: 'visible', ...T });
    assert.deepEqual([await page.inputValue('#cus-form-taxtype'), await page.inputValue('#cus-form-taxstate')], ['Registered', '27']);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Item Master: the item\'s tax code and HSN saved', async () => {
    const page = await open('ITEMMASTER');
    await page.waitForSelector('#im-table-body tr .im-edit', T);
    await page.click('#im-table-body tr:has-text("Steel Sheet") .im-edit');
    await page.waitForSelector('#im-form-taxcode', { state: 'visible', ...T });
    await page.fill('#im-form-taxcode', 'sr');
    await page.fill('#im-form-hsn', '7208');
    await page.click('#im-save-btn');
    await page.waitForFunction(() => document.getElementById('im-modal').classList.contains('hidden'), null, T);
    const it = await val('items/I1');
    assert.deepEqual([it.TaxCode, it.HSNCode], ['SR', '7208']);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
