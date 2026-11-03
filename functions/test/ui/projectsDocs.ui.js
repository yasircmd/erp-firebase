// Projects on the pilot entry screens, and the date width (owner, 2026-11-03;
// docs/modules/PROJECTS_DIMENSIONS.md Q387-Q392, docs/modules/ENTRY_LAYOUT.md):
// a date takes only a date's width, the other key fields share the rest; the
// Project field comes after Profit Center, in the same row, once the company
// has a project (hidden otherwise); new lines take the header project; what
// is entered is saved.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/projectsDocs.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, val, rtdb, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  Object.assign(f.orgUnits, {
    'PRJ-A': { Type: 'Project', Code: 'P-100', Name: 'Tower A', CompanyID: 'C1', Status: 'Active' },
    'PRJ-X': { Type: 'Project', Code: 'P-900', Name: 'Elsewhere', CompanyID: 'C2', Status: 'Active' },
    'PRJ-C': { Type: 'Project', Code: 'P-050', Name: 'Done', CompanyID: 'C1', Status: 'Closed' }
  });
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail' } };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8206);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(mod, p) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8206/?module=' + mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.click('#' + p + '-new-btn');
    await page.waitForSelector('#' + p + '-entry-view:not(.hidden)', T);
    await page.selectOption('#' + p + '-form-company', 'C1');
    await page.dispatchEvent('#' + p + '-form-company', 'change');
    return page;
  }
  // The Project field shows once the company's org units are in (they load after the company is set).
  const projectShown = (page, p) => page.waitForSelector('#' + p + '-project-field:not(.hidden)', T);
  // The field's cell (a party select is shown as the shell's type-in box beside it).
  const box = (page, id) => page.evaluate(id => { const el = document.getElementById(id); const b = (el.closest('.entry-fields > *') || el).getBoundingClientRect(); return { top: Math.round(b.top), width: Math.round(b.width), left: Math.round(b.left) }; }, id);
  const options = (page, id) => page.$$eval('#' + id + ' option', o => o.map(x => x.textContent.trim()));

  await check('Vendor Invoice: the date as wide as a date, the vendor wider; Project after Profit Center in its row; a new line takes the header project', async () => {
    const page = await open('VENDORINVOICE', 'vinv');
    await projectShown(page, 'vinv');
    const [date, vendor, ref] = [await box(page, 'vinv-form-date'), await box(page, 'vinv-form-vendor'), await box(page, 'vinv-form-vendorref')];
    assert.ok(date.width <= 165 && vendor.width > 2 * date.width && ref.width > date.width, JSON.stringify({ date, vendor, ref }));
    const [pc, proj] = [await box(page, 'vinv-form-profitcenter'), await box(page, 'vinv-form-project')];
    assert.ok(proj.top === pc.top && proj.left > pc.left, 'after Profit Center, same row: ' + JSON.stringify({ pc, proj }));
    assert.deepEqual(await options(page, 'vinv-form-project'), ['—', 'P-100 — Tower A'], 'the company\'s Active projects only');
    await page.selectOption('#vinv-form-project', 'PRJ-A');
    await page.click('#vinv-add-line-btn');
    assert.ok(await page.isVisible('#vinv-project-head'));
    assert.equal(await page.inputValue('#vinv-grid-body tr:last-child .vinv-line-project'), 'PRJ-A', 'a new line takes the header project');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Sales Order and JV: the dates narrow; Project after Profit Center; JV new lines take the header project, and lines without one get it', async () => {
    const so = await open('SALESORDER', 'so');
    await projectShown(so, 'so');
    const [d1, d2, cust] = [await box(so, 'so-form-date'), await box(so, 'so-form-deliverydate'), await box(so, 'so-form-customer')];
    assert.ok(d1.width <= 165 && d2.width <= 165 && cust.width > 2 * d1.width, JSON.stringify({ d1, d2, cust }));
    const [pc, proj] = [await box(so, 'so-form-profitcenter'), await box(so, 'so-form-project')];
    assert.ok(proj.top === pc.top && proj.left > pc.left, JSON.stringify({ pc, proj }));
    assert.deepEqual(so.__errors, []);
    await so.close();

    const jv = await open('JV', 'jv');
    await projectShown(jv, 'jv');
    assert.ok((await box(jv, 'jv-form-date')).width <= 165);
    const [jpc, jproj] = [await box(jv, 'jv-form-profitcenter'), await box(jv, 'jv-form-project')];
    assert.ok(jproj.top === jpc.top && jproj.left > jpc.left, JSON.stringify({ jpc, jproj }));
    await jv.selectOption('#jv-form-project', 'PRJ-A');
    await jv.dispatchEvent('#jv-form-project', 'change');
    assert.equal(await jv.inputValue('#jv-grid-body tr:first-child .jv-line-project'), 'PRJ-A', 'the empty line took it');
    await jv.click('#jv-add-line-btn');
    const projs = await jv.$$eval('#jv-grid-body .jv-line-project', s => s.map(x => x.value));
    assert.ok(projs.length >= 2 && projs.every(v => v === 'PRJ-A'), projs.join(','));
    assert.deepEqual(jv.__errors, []);
    await jv.close();
  });

  await check('a company without projects: no Project field anywhere', async () => {
    await Promise.all(['PRJ-A', 'PRJ-X', 'PRJ-C'].map(id => rtdb.ref('orgUnits/' + id).remove()));
    for (const [mod, p] of [['VENDORINVOICE', 'vinv'], ['SALESORDER', 'so'], ['JV', 'jv']]) {
      const page = await open(mod, p);
      assert.equal(await page.isVisible('#' + p + '-project-field'), false, mod);
      await page.close();
    }
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
