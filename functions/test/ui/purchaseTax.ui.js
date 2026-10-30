// Line tax on the Vendor Invoice screen (docs/modules/TAX_ENGINE.md, part
// 3), India GST: no Tax % field; a GRN's goods taxed by their item's code,
// the part reclaimed shown; a line given a blocked code (with the right) and
// the total; saved and posted, the goods' cost carrying the tax that can't
// be reclaimed; the Chart of Accounts' default tax code saved.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/purchaseTax.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');
const engine = require('../../src/taxEngine');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };
const D = '2026-10-20';

(async () => {
  const f = baseFixture();
  ['CGST', 'SGST', 'UTGST', 'IGST', 'CESS'].forEach((k, i) => {
    f.coa['A-' + k + 'IN'] = { AccountCode: '14' + (i + 1) + '0', AccountName: 'Input ' + k, AccountType: 'Asset', Status: 'Active', IsPostable: true };
    f.coa['A-' + k + 'OUT'] = { AccountCode: '22' + (i + 1) + '0', AccountName: 'Output ' + k, AccountType: 'Liability', Status: 'Active', IsPostable: true };
  });
  Object.assign(f.items.I1, { TaxCode: 'GST18', HSNCode: '7208' });
  Object.assign(f.vendors.V1, { TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: '27ABCDE1234F1Z0' });
  f.stock = {
    transactions: { G1: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionNumber: 'GRN-1', TransactionDate: D, Description: 'Receipt 1', PostedAt: '2026-10-20T08:00:00Z',
      Lines: [{ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Direction: 'In', Quantity: 10, UnitCost: 20, TotalValue: 200 }] } },
    ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } } }
  };
  await reset(f);
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-' + c.Code + 'OUT'; c.InputAccountID = 'A-' + c.Code + 'IN'; });
  cfg.Codes.push({ Code: 'GST18B', Name: 'GST 18% (no credit)', Category: 'STANDARD', RecoverablePercent: 0, Active: true, Rates: [{ From: '2025-09-22', Percent: 18 }] });
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8172/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  const taxRows = p => p.$$eval('#vinv-tax-lines tr', rows => rows.map(r => [...r.children].map(td => (td.querySelector('select') ? td.querySelector('select').value : td.textContent).trim())));

  await check('the GRN\'s goods taxed by their item\'s code, CGST + SGST, reclaimed; a blocked code given on the line; saved and posted into the goods\' cost', async () => {
    const p = await open('VENDORINVOICE');
    await p.click('#vinv-new-btn');
    await p.selectOption('#vinv-form-company', 'C1');
    await p.selectOption('#vinv-form-vendor', 'V1');
    await p.selectOption('#vinv-form-costcenter', 'CC1');
    await p.fill('#vinv-form-date', D);
    await p.fill('#vinv-form-vendorref', 'ACME-77');
    await p.fill('#vinv-form-description', 'Steel');
    await p.waitForSelector('.vinv-grn-checkbox[data-id="G1"]', T);
    await p.check('.vinv-grn-checkbox[data-id="G1"]');
    await p.waitForSelector('#vinv-tax-box:not(.hidden) #vinv-tax-lines tr', T);
    assert.ok(await p.isHidden('#vinv-taxpercent-field'), 'no single Tax %');
    assert.match((await taxRows(p))[0].join(' | '), /GRN-1 RM-001 \| 200\.00 \| GST18 \| 18 \| CGST 9%: 18\.00, SGST 9%: 18\.00 \| 36\.00 \| 36\.00/);
    await p.waitForFunction(() => document.getElementById('vinv-total-display').textContent.trim() === '236.00', null, T);
    await p.selectOption('#vinv-tax-lines tr[data-key="G1#1"] .vinv-tax-code', 'GST18B');
    await p.waitForFunction(() => /not reclaimed \(to cost\) 36\.00/.test(document.getElementById('vinv-tax-summary').textContent), null, T);
    await p.click('#vinv-save-draft-btn');
    let inv = null;
    for (let i = 0; i < 40 && !inv; i++) { inv = Object.values((await val('vendorInvoices')) || {})[0]; if (!inv) await p.waitForTimeout(250); }
    assert.deepEqual([inv.TaxLines[0].TaxCode, inv.TaxLines[0].Recoverable, inv.Total], ['GST18B', 0, 236]);
    const id = Object.keys(await val('vendorInvoices'))[0];
    ok(await call('u-admin', 'postVendorInvoice', { invoiceId: id }));
    const l = await val('stock/ledger/I1/WH1');
    assert.deepEqual([l.Quantity, l.AvgCost, l.TotalValue], [10, 23.6, 236]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Chart of Accounts: an account\'s default tax code saved', async () => {
    const p = await open('COA');
    await p.waitForSelector('#coa-table-body tr', T);
    await p.locator('#coa-table-body tr', { hasText: 'Material Consumption' }).first().locator('.coa-edit').click();
    await p.waitForSelector('#coa-modal:not(.hidden)', T);
    await p.fill('#coa-form-taxcode', 'gst5');
    await p.click('#coa-save-btn');
    await p.waitForSelector('#coa-modal', { state: 'hidden', ...T });
    assert.equal((await val('coa/A-CONS')).TaxCode, 'GST5');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
