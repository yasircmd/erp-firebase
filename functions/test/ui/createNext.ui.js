// Create next, on each next screen (owner, 2026-10-24; docs/modules/
// LINKED_FLOWS.md, decisions Q287-Q288): opened with CreateFrom, the screen
// starts a new document with the company, the party and the source chosen,
// as a user would; nothing is saved until the user does.
//   SO → Delivery Note; DN → Customer Invoice; invoice → Receipt (Bank, on
//   Cash and Bank) and PDC Received; PR → Purchase Order; PO → GRN;
//   GRN → Vendor Invoice.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/createNext.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  const posted = extra => Object.assign({ Status: 'Posted', CompanyID: 'C1' }, extra);
  f.customers = { CU1: { CustomerCode: 'CL-1', CustomerName: 'Example Buyer', Status: 'Active', TradeReceivablesAccountID: 'A-AR', Classification: 'Local' } };
  f.priceListLines = { L1: { ItemCode: 'RM-001', UnitPrice: 20 } };
  f.salesInvoiceSettings = { C1: { DirectStock: true } }; // invoices may deliver (decision 167)
  f.salesOrders = { SO1: { SONumber: 'SO-26-01-000001', SODate: '2026-10-01', Status: 'Partially Reserved', CompanyID: 'C1', CustomerID: 'CU1',
    Lines: [{ LineID: 'L1', ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 5, DeliveredQuantity: 2, UnitPrice: 20, LineTotal: 100 }] } };
  f.stock = {
    ledger: { I1: { WH1: { Quantity: 10, AvgCost: 4, TotalValue: 40 } } },
    reservations: { R1: { Status: 'Active', SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'L1', ItemID: 'I1', WarehouseID: 'WH1', Quantity: 3, CompanyID: 'C1' } },
    transactions: {
      DN2: posted({ TransactionType: 'DeliveryNote', TransactionNumber: 'DN-26-01-000002', TransactionDate: '2026-10-04', CustomerID: 'CU1', Description: 'Delivery two',
        Lines: [{ ItemCode: 'RM-001', ItemID: 'I1', WarehouseID: 'WH1', Quantity: 1, UnitPrice: 20 }] }),
      GRN2: posted({ TransactionType: 'GRN', TransactionNumber: 'GRN-26-01-000002', TransactionDate: '2026-10-05', VendorID: 'V1', Description: 'Receipt two',
        Lines: [{ ItemCode: 'RM-001', ItemID: 'I1', WarehouseID: 'WH1', Quantity: 2, UnitCost: 4 }] })
    }
  };
  f.customerInvoices = { CI1: posted({ TransactionNumber: 'CI-26-01-000001', InvoiceDate: '2026-10-06', CustomerID: 'CU1', Description: 'Invoice', Subtotal: 100, Total: 100, DirectLines: [] }) };
  f.purchaseRequisitions = { PR1: { PRNumber: 'PR-26-01-000001', PRDate: '2026-09-28', Status: 'Submitted', CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Steel',
    Lines: [{ Category: 'Raw material', Description: 'Steel sheet', Quantity: 10, Unit: 'PCS' }] } };
  f.purchaseOrders = { PO1: { PONumber: 'PO-26-01-000001', PODate: '2026-09-30', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ LineID: 'P1', ItemCode: 'RM-001', Description: 'Steel sheet', Quantity: 10, ReceivedQuantity: 4, UnitPrice: 4, WarehouseID: 'WH1' }] } };
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8166);
  const browser = await chromium.launch();
  // Opens `target` as Create next does, from the invoice screen.
  async function createNext(target, from) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8166/?module=CUSTOMERINVOICE&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle'); // the harness, unlike the shell, doesn't drop a screen's late answers
    await page.waitForTimeout(500);
    await page.evaluate(([m, cf]) => { window.__moduleReady = false; window.openModule(m, { CreateFrom: cf }); }, [target, from]);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const sales = { companyId: 'C1', customerId: 'CU1' }, buying = { companyId: 'C1', vendorId: 'V1' };

  await check('Sales Order → Delivery Note: its lines still to deliver', async () => {
    const p = await createNext('DELIVERYNOTE', Object.assign({ type: 'SalesOrder', id: 'SO1', number: 'SO-26-01-000001' }, sales));
    await p.waitForFunction(() => document.querySelectorAll('.dn-so-line-checkbox:checked').length === 1, null, { timeout: 30000 });
    assert.equal(await p.inputValue('#dn-form-customer'), 'CU1');
    assert.match(await p.textContent('#dn-grid-body'), /Steel Sheet|RM-001/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Sales Order → Customer Invoice (no delivery): its lines brought in', async () => {
    const p = await createNext('CUSTOMERINVOICE', Object.assign({ type: 'SalesOrder', id: 'SO1', number: 'SO-26-01-000001' }, sales));
    await p.waitForFunction(() => /SO-26-01-000001/.test(document.getElementById('cinv-entry-view').innerText) && document.getElementById('cinv-so-picker').classList.contains('hidden'), null, { timeout: 30000 });
    assert.ok(await p.$$eval('#cinv-entry-view input', ins => ins.some(i => /^RM-001/.test(i.value))), 'an item line for the order\'s item');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Delivery Note → Customer Invoice: the delivery ticked', async () => {
    const p = await createNext('CUSTOMERINVOICE', Object.assign({ type: 'DeliveryNote', id: 'DN2', number: 'DN-26-01-000002' }, sales));
    await p.waitForSelector('.cinv-dn-checkbox[data-id="DN2"]:checked', { timeout: 30000 });
    assert.equal(await p.inputValue('#cinv-form-company'), 'C1');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Invoice → Receipt: a Bank Receipt, the customer\'s line allocated against the invoice\'s open amount', async () => {
    const p = await createNext('CBT', Object.assign({ type: 'CustomerInvoice', id: 'CI1', number: 'CI-26-01-000001', amount: 40, voucherType: 'Bank Receipt' }, sales));
    await p.waitForSelector('.cbt-party-row', { timeout: 30000 });
    assert.match(await p.textContent('.cbt-party-row'), /Example Buyer[\s\S]*Against CI-26-01-000001 40\.00/);
    assert.equal(await p.inputValue('#cbt-form-company'), 'C1');
    assert.equal(await p.getAttribute('.cbt-type-btn[data-type="Bank Receipt"]', 'class').then(c => /border-blue-500/.test(c)), true, 'Bank Receipt chosen, changeable');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Customer Invoice → PDC Received: the cheque for the open amount, allocated against the invoice', async () => {
    const p = await createNext('PDCRECEIVED', Object.assign({ type: 'CustomerInvoice', id: 'CI1', number: 'CI-26-01-000001', amount: 40 }, sales));
    await p.waitForFunction(() => { const i = document.querySelector('.pdc-alloc[data-ref="CustomerInvoice:CI1"]'); return i && i.value === '40'; }, null, { timeout: 30000 });
    assert.equal(await p.inputValue('#pdc-form-party'), 'CU1');
    assert.equal(await p.inputValue('.pdc-chq-amount'), '40');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Purchase Requisition → Purchase Order; PO → GRN; GRN → Vendor Invoice', async () => {
    let p = await createNext('PURCHASEORDER', { type: 'PR', id: 'PR1', number: 'PR-26-01-000001', companyId: 'C1' });
    await p.waitForSelector('.po-req-checkbox[data-key="PR|PR1"]:checked', { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
    p = await createNext('GRN', Object.assign({ type: 'PurchaseOrder', id: 'PO1', number: 'PO-26-01-000001' }, buying));
    await p.waitForSelector('.grn-po-line-checkbox[data-key="PO1|P1"]:checked', { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
    p = await createNext('VENDORINVOICE', Object.assign({ type: 'GRN', id: 'GRN2', number: 'GRN-26-01-000002' }, buying));
    await p.waitForSelector('.vinv-grn-checkbox[data-id="GRN2"]:checked', { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('nothing is saved until the user saves', async () => {
    assert.equal(Object.keys((await val('purchaseOrders')) || {}).length, 1);
    assert.equal((await firestore.collection('journalEntries').get()).size, 0);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
