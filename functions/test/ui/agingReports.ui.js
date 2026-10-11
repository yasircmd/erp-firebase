// Aging Reports on screen (docs/modules/AGING_REPORTS.md, decisions
// 118-121): Customer / Vendor Aging (the buckets, the switch to invoice age,
// a party's open items, unapplied credits, the GL check, the search, "SOA"
// opening the statement, Copy to Excel), Vendor Aging built from the
// Customer template, and Inventory Aging (values or quantities, one
// warehouse, the totals). Seeds its own data (it WIPES the emulator
// database, like the suites):
//   node functions/test/ui/agingReports.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };

(async () => {
  const f = baseFixture();
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.vendors.V1.PaymentTermsDays = 30;
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Beta Supplies', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP', PaymentTermsDays: 60 };
  const ln = (item, wh, dir, qty, cost) => ({ ItemID: item, WarehouseID: wh, Direction: dir, Quantity: qty, UnitCost: cost, TotalValue: qty * cost });
  f.stock = {
    transactions: {
      G1: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', TransactionDate: '2025-09-01', Lines: [ln('I1', 'WH1', 'In', 10, 10)] },
      G2: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', TransactionDate: '2026-03-01', Lines: [ln('I1', 'WH1', 'In', 10, 12)] },
      M1: { TransactionType: 'MaterialIssue', Status: 'Posted', CompanyID: 'C1', TransactionDate: '2026-04-10', Lines: [ln('I1', 'WH1', 'Out', 12, 11)] },
      W1: { TransactionType: 'WarehouseMovement', Status: 'Posted', CompanyID: 'C1', TransactionDate: '2026-04-15', Lines: [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', Quantity: 3, UnitCost: 11, TotalValue: 33 }] }
    },
    ledger: { I1: { WH1: { Quantity: 5, AvgCost: 11, TotalValue: 55 }, WH2: { Quantity: 3, AvgCost: 11, TotalValue: 33 } } }
  };
  await reset(f);
  const bill = async (vendor, date, amount) => {
    const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: date, Description: 'Bill', VendorRefNumber: 'B-' + amount, CompanyID: 'C1', VendorID: vendor, CostCenterID: 'CC1',
      SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: amount, Description: 'Freight', CostCenterID: 'CC1' }] } }));
    ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
    return 'VendorInvoice:' + s.invoiceId;
  };
  const pay = async (date, amount, allocations) => {
    const s = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: date, Description: 'Payment', CompanyID: 'C1', CostCenterID: 'CC1',
      OppositeLines: [{ AccountCode: '2000', Amount: amount, Description: 'Payment', PartyType: 'Vendor', PartyID: 'V1', Allocations: allocations }] } }));
    ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  };
  const a = await bill('V1', '2026-01-10', 1000);
  await pay('2026-02-01', 600, [{ RefType: 'Against', RefID: a, Amount: 600 }]);
  await bill('V1', '2026-03-05', 400);
  await pay('2026-03-20', 150, []);
  await bill('V2', '2026-04-20', 300);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8179);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  async function open(module, uid) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8179/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });

  await check('VENDORAGING.html is built from CUSTOMERAGING.html', async () => {
    execFileSync('node', [__dirname + '/../../../tools/build-aging-screens.js', '--check']);
  });

  await check('Vendor Aging: buckets by days overdue, unapplied credits, the GL check; a vendor\'s open items; by invoice age; search; Copy', async () => {
    const p = await open('VENDORAGING', 'u-admin');
    await until(p, () => document.getElementById('ag-company').options.length > 1);
    assert.equal(await p.textContent('#ag-heading'), 'Vendor Aging');
    await p.selectOption('#ag-company', 'C1');
    await p.fill('#ag-asof', '2026-04-30');
    await p.click('#ag-run');
    await until(p, () => /2026-04-30|30\/04\/2026/.test(document.getElementById('ag-title').textContent));
    assert.deepEqual(await p.$$eval('#ag-head th', t => t.map(x => x.textContent.trim()).filter(Boolean)),
      ['Vendor', 'Terms', 'Not yet due', '1–30', '31–60', '61–90', '90+', 'Owed', 'Unapplied credits', 'Net balance', 'Pending PDCs']);
    const v1 = await p.textContent('#ag-body tr[data-id="V1"]');
    assert.match(v1, /Acme Metals\s*V001\s*30[\s\S]*400\.00[\s\S]*400\.00[\s\S]*800\.00\s*150\.00\s*650\.00/);
    assert.equal(await p.textContent('#ag-body tr[data-id="V1"] .ag-b-d61_90'), '400.00');
    assert.equal(await p.textContent('#ag-total-net'), '950.00');
    assert.match(await p.textContent('#ag-control'), /2000[\s\S]*950\.00[\s\S]*agrees with the report/);
    // A vendor's open items.
    await p.click('#ag-body tr[data-id="V1"] td:first-child');
    await until(p, () => document.querySelectorAll('.ag-items tbody tr').length === 3);
    // Oldest due first: the January bill (80 days overdue), the March advance, the March bill (26 days).
    const items = await p.$$eval('.ag-items tbody tr', r => r.map(x => [...x.children].map(c => c.textContent.trim())));
    assert.deepEqual(items.map(i => [i[1], i[4], i[5]]), [['Invoice', '80', '400.00'], ['Open credit', '', '-150.00'], ['Invoice', '26', '400.00']]);
    // By invoice age.
    await p.selectOption('#ag-basis', 'invoice');
    await until(p, () => /Days since the invoice date|days since the invoice date/.test(document.getElementById('ag-basis-line').textContent));
    assert.equal(await p.textContent('#ag-body tr[data-id="V1"] .ag-b-d91_120'), '400.00');
    // Search and Copy.
    await p.fill('#ag-search', 'beta');
    await until(p, () => document.querySelectorAll('#ag-body tr.ag-row').length === 1);
    await p.click('#ag-copy');
    await until(p, () => /Copied/.test(document.getElementById('ag-copy').textContent));
    const clip = (await p.evaluate(() => navigator.clipboard.readText())).split('\n');
    assert.equal(clip[0], 'Vendor\tCode\tTerms\t0–30\t31–60\t61–90\t91–120\t120+\tOwed\tUnapplied credits\tNet balance\tPending PDCs');
    assert.equal(clip[1], 'Beta Supplies\tV002\t60\t300.00\t0.00\t0.00\t0.00\t0.00\t300.00\t0.00\t300.00\t0.00');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Aging: its own heading; nothing outstanding says so', async () => {
    const p = await open('CUSTOMERAGING', 'u-viewer');
    await until(p, () => document.getElementById('ag-company').options.length > 1);
    assert.equal(await p.textContent('#ag-heading'), 'Customer Aging');
    await p.selectOption('#ag-company', 'C1');
    await p.click('#ag-run');
    await until(p, () => /Nothing outstanding/.test(document.getElementById('ag-body').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Inventory Aging: values by age, quantities, one warehouse, totals', async () => {
    const p = await open('INVENTORYAGING', 'u-admin');
    await until(p, () => document.getElementById('ia-company').options.length > 1);
    await p.selectOption('#ia-company', 'C1');
    await p.fill('#ia-asof', '2026-04-30');
    await p.click('#ia-run');
    await until(p, () => /2026-04-30|30\/04\/2026/.test(document.getElementById('ia-title').textContent));
    assert.deepEqual(await p.$$eval('#ia-head th', t => t.map(x => x.textContent.trim())),
      ['Item', 'Category', 'On hand', 'Value', '0–30', '31–60', '61–90', '91–180', '181–365', 'Over 365', 'Last receipt', 'Last issue']);
    assert.match(await p.textContent('#ia-body tr[data-id="I1"]'), /RM-001[\s\S]*8 PCS\s*88\.00/);
    assert.equal(await p.textContent('#ia-body tr[data-id="I1"] .ia-b-d31_60'), '88.00');
    assert.equal(await p.textContent('#ia-total'), '88.00');
    await p.check('#ia-qty');
    assert.equal(await p.textContent('#ia-body tr[data-id="I1"] .ia-b-d31_60'), '8');
    await p.selectOption('#ia-warehouse', 'WH2');
    await p.click('#ia-run');
    await until(p, () => /3 PCS/.test(document.getElementById('ia-body').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
