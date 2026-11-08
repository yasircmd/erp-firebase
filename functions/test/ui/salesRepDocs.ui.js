// The sales rep on the documents' screens (owner, 2026-11-08; docs/modules/
// MIS.md, phase 1c, Q435-Q438), in the browser on the emulators: a new Sales
// Order takes the customer's rep when the customer is chosen, offers only the
// company's active reps, and saves the rep chosen instead; a confirmed order
// shows its rep and can't change it; a direct Customer Invoice takes the
// customer's rep too. Seeds its own data (it WIPES the emulator database):
//   node functions/test/ui/salesRepDocs.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /salesRepDocs.ui/.test(l))]); }); }
const T = { timeout: 30000 };

(async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0, SalesRepEmployeeID: 'E1' } };
  f.salesReps = { E1: { CompanyID: 'C1', Active: true, RepCode: 'AA' }, E2: { CompanyID: 'C1', Active: true, RepCode: 'BB' },
    E3: { CompanyID: 'C1', Active: false, RepCode: 'CC' }, E9: { CompanyID: 'C2', Active: true, RepCode: 'ZZ' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 30, TotalValue: 1500 } } } };
  await reset(f);
  for (const [id, name, co] of [['E1', 'Asha Khan', 'C1'], ['E2', 'Ben Cole', 'C1'], ['E3', 'Cy Dean', 'C1'], ['E9', 'Zed Ray', 'C2']]) {
    await firestore.collection('employees').doc(id).set({ EmployeeNo: id, FullName: name, CompanyID: co, Status: 'Active' });
  }

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8221);
  const browser = await chromium.launch();
  async function open(mod, ready) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8221/?module=' + mod + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForSelector(ready, T);
    await page.waitForTimeout(500);
    return page;
  }
  const options = (p, sel) => p.$$eval(sel + ' option', o => o.map(x => x.textContent));

  await check('Sales Order: the customer\'s rep by default; the company\'s active reps only; another chosen and saved; fixed once confirmed', async () => {
    const p = await open('SALESORDER', '#so-new-btn:not(.hidden)');
    await p.click('#so-new-btn');
    await p.selectOption('#so-form-company', 'C1');
    await p.selectOption('#so-form-customer', 'CU1');
    await p.waitForFunction(() => document.getElementById('so-form-rep').value === 'E1', null, T);
    assert.deepEqual(await options(p, '#so-form-rep'), ['— No rep —', 'Asha Khan (AA)', 'Ben Cole (BB)'], 'not the inactive rep, not another company\'s');
    await p.selectOption('#so-form-rep', 'E2');
    await p.click('#so-add-line-btn');
    await p.fill('#so-grid-body input[data-field="item"] >> nth=0', 'RM-001');
    await p.press('#so-grid-body input[data-field="item"] >> nth=0', 'Tab');
    await p.waitForTimeout(300);
    await p.selectOption('#so-grid-body .so-line-wh >> nth=0', 'WH1').catch(() => {});
    await p.fill('#so-grid-body input[data-field="quantity"] >> nth=0', '2');
    await p.dispatchEvent('#so-grid-body input[data-field="quantity"] >> nth=0', 'change');
    await p.fill('#so-grid-body input[data-field="price"] >> nth=0', '50');
    await p.dispatchEvent('#so-grid-body input[data-field="price"] >> nth=0', 'change');
    await p.selectOption('#so-form-costcenter', 'CC1');
    await p.click('#so-save-draft-btn');
    let so = null;
    for (let i = 0; i < 100 && !so; i++) { const all = (await val('salesOrders')) || {}; so = Object.values(all)[0] || null; if (!so) await p.waitForTimeout(100); }
    assert.ok(so, 'saved: ' + p.__dialogs.join(' | '));
    assert.equal(so.SalesRepEmployeeID, 'E2');
    const soId = Object.keys(await val('salesOrders'))[0];
    const c = await call('u-admin', 'confirmSalesOrder', { soId });
    assert.equal(c.success, true, c.error);
    await p.close();
    const q = await open('SALESORDER', '#so-table-body tr');
    await q.click('#so-table-body tr >> nth=0');
    await q.waitForSelector('#so-entry-view:not(.hidden)', T);
    await q.waitForFunction(() => document.getElementById('so-form-rep').value === 'E2', null, T);
    assert.equal(await q.isDisabled('#so-form-rep'), true);
    assert.deepEqual(q.__errors, []);
    await q.close();
  });

  await check('Customer Invoice: a direct invoice takes the customer\'s rep', async () => {
    const p = await open('CUSTOMERINVOICE', '#cinv-new-btn:not(.hidden)');
    await p.click('#cinv-new-btn');
    await p.selectOption('#cinv-form-company', 'C1');
    await p.selectOption('#cinv-form-customer', 'CU1');
    await p.waitForFunction(() => document.getElementById('cinv-form-rep').value === 'E1', null, T);
    await p.selectOption('#cinv-form-rep', '');
    assert.equal(await p.inputValue('#cinv-form-rep'), '', 'none may be chosen');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
