// Line tax on the Customer Invoice screen (docs/modules/TAX_ENGINE.md, part
// 2), India GST: no Tax % field; each line's code, rate, components and tax
// shown as the save works them out; the place of supply from the customer,
// changed to another state (IGST); a line's code changed with the right
// (and shown, not changeable, without it); saved and posted; the posted
// invoice shows its tax as saved and prints each line's rate and a summary.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/salesTax.ui.js
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
  ['CGST', 'SGST', 'UTGST', 'IGST', 'CESS'].forEach((k, i) => { f.coa['A-' + k] = { AccountCode: '220' + (i + 1), AccountName: 'Output ' + k, AccountType: 'Liability', Status: 'Active', IsPostable: true }; });
  Object.assign(f.items.I1, { SalesCogsAccountID: 'A-COGS', TaxCode: 'GST18', HSNCode: '7208' });
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Example Traders', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', TaxRegistrationType: 'Registered', TaxState: '27' } };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1', TaxCode: 'GST5' } };
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Clerk', AssignedCompanies: ['C1'] };
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  ['access', 'draft', 'post'].forEach(c => f.permissions.CUSTOMERINVOICE[c].push('Clerk'));
  f.stock = {
    transactions: { N1: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'DN-1', TransactionDate: D, Description: 'DN 1',
      Lines: [{ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', ItemName: 'Steel Sheet', WarehouseID: 'WH1', Direction: 'Out', Quantity: 10, UnitPrice: 50, UnitCost: 30, TotalValue: 300, CostCenterID: 'CC1' }] } },
    ledger: { I1: { WH1: { Quantity: 30, AvgCost: 30, TotalValue: 900 } } }
  };
  await reset(f);
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-' + c.Code; c.InputAccountID = 'A-VATIN'; });
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8171);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8171/?module=' + module + '&uid=' + (uid || 'u-admin'));
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForLoadState('networkidle');
    return page;
  }
  async function newInvoice(p) {
    await p.click('#cinv-new-btn');
    await p.selectOption('#cinv-form-company', 'C1');
    await p.selectOption('#cinv-form-customer', 'CU1');
    await p.selectOption('#cinv-form-costcenter', 'CC1');
    await p.fill('#cinv-form-date', D);
    await p.fill('#cinv-form-description', 'Steel');
    await p.waitForSelector('.cinv-dn-checkbox[data-id="N1"]', T);
    await p.check('.cinv-dn-checkbox[data-id="N1"]');
    await p.selectOption('.cinv-dn-salestype[data-dn-salestype="N1"]', 'ST1');
  }
  const taxRows = p => p.$$eval('#cinv-tax-lines tr', rows => rows.map(r => [...r.children].map(td => td.textContent.trim())));

  await check('the line taxed by its item\'s code: CGST + SGST within the state; no Tax %; another state gives IGST', async () => {
    const p = await open('CUSTOMERINVOICE');
    await newInvoice(p);
    await p.waitForSelector('#cinv-tax-box:not(.hidden) #cinv-tax-lines tr', T);
    assert.ok(await p.isHidden('#cinv-taxpercent-field'), 'no single Tax %');
    assert.equal(await p.inputValue('#cinv-tax-place'), '27', 'the customer\'s state');
    let rows = await taxRows(p);
    assert.match(rows[0].join(' | '), /DN-1 RM-001 HSN 7208 \| 500\.00 \| GST18 .*\| 18 \| CGST 9%: 45\.00, SGST 9%: 45\.00 \| 90\.00/);
    await p.waitForFunction(() => document.getElementById('cinv-total-display').textContent.trim() === '590.00', null, T);
    await p.selectOption('#cinv-tax-place', '29');
    await p.waitForFunction(() => /IGST 18%: 90\.00/.test(document.getElementById('cinv-tax-lines').textContent), null, T);
    // The code changed on the line (Admin has the right): 5%.
    await p.selectOption('#cinv-tax-lines tr[data-key="N1#1"] .cinv-tax-code', 'GST5');
    await p.waitForFunction(() => document.getElementById('cinv-total-display').textContent.trim() === '525.00', null, T);
    await p.click('#cinv-save-draft-btn');
    await p.waitForFunction(() => document.getElementById('cinv-post-btn') && !document.getElementById('cinv-save-draft-btn').disabled, null, T);
    let inv = null;
    for (let i = 0; i < 40 && !inv; i++) { inv = Object.values((await val('customerInvoices')) || {})[0]; if (!inv) await p.waitForTimeout(250); }
    assert.deepEqual([inv.PlaceOfSupply, inv.TaxLines[0].TaxCode, inv.TaxComponents.map(c => c.Component).join(), inv.Total], ['29', 'GST5', 'IGST', 525]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('without the "change tax code" right: the codes shown, not changeable', async () => {
    const p = await open('CUSTOMERINVOICE', 'u-clerk');
    await newInvoice(p);
    await p.waitForSelector('#cinv-tax-lines tr .cinv-tax-code-text', T);
    assert.equal(await p.locator('#cinv-tax-lines select.cinv-tax-code').count(), 0);
    assert.equal(await p.textContent('#cinv-tax-lines .cinv-tax-code-text'), 'GST18');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('posted: its tax as saved, read-only; the print shows each line\'s rate and the summary by code', async () => {
    const id = Object.keys(await val('customerInvoices'))[0];
    ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: id }));
    const p = await open('CUSTOMERINVOICE');
    await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await p.waitForSelector('#cinv-table-body tr', T);
    await p.click('#cinv-table-body tr >> nth=0');
    await p.waitForSelector('#cinv-tax-box:not(.hidden) #cinv-tax-lines tr', T);
    assert.equal(await p.locator('#cinv-tax-lines select').count(), 0, 'nothing to change on a posted invoice');
    assert.match((await taxRows(p))[0].join(' | '), /GST5 \| 5 \| IGST 5%: 25\.00 \| 25\.00/);
    await p.waitForSelector('#cinv-print-btn:not(.hidden)', T);
    await p.click('#cinv-print-btn');
    const doc = (await p.textContent('#cinv-print-document')).replace(/\s+/g, ' ');
    assert.match(doc, /TAX INVOICE/);
    assert.match(doc, /Place of supply: 29/);
    assert.match(doc, /7208/, 'the HSN code');
    assert.match(doc, /GST5 5%/);
    assert.match(doc, /IGST 25\.00/);
    assert.ok(await p.isVisible('#cinv-print-tax-summary') || (await p.locator('#cinv-print-tax-summary').count()) === 1);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
