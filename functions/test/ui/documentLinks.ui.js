// Linked documents on screen (owner, 2026-10-24; docs/modules/
// LINKED_FLOWS.md, decisions Q287-Q289): a posted invoice shows Create
// next (Receipt, PDC Received) with what is still open, and its chain:
// where it comes from, what followed; a linked document opens from its
// number; Create next opens the next screen with CreateFrom. Seeds its own
// data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/documentLinks.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  const posted = extra => Object.assign({ Status: 'Posted', CompanyID: 'C1' }, extra);
  f.customers = { CU1: { CustomerCode: 'CL-1', CustomerName: 'Example Buyer', Status: 'Active', Classification: 'Local' } };
  f.salesOrders = { SO1: { SONumber: 'SO-26-01-000001', SODate: '2026-10-01', Status: 'Partially Reserved', CompanyID: 'C1', CustomerID: 'CU1',
    Lines: [{ LineID: 'L1', ItemCode: 'RM-001', OrderedQuantity: 5, DeliveredQuantity: 2, UnitPrice: 20, LineTotal: 100 }] } };
  f.stock = { transactions: { DN1: posted({ TransactionType: 'DeliveryNote', TransactionNumber: 'DN-26-01-000001', TransactionDate: '2026-10-03', CustomerID: 'CU1', MatchedToInvoiceID: 'CI1',
    Description: 'Delivery', Lines: [{ SourceSOID: 'SO1', SourceSOLineID: 'L1', SourceSONumber: 'SO-26-01-000001', ItemCode: 'RM-001', ItemID: 'I1', WarehouseID: 'WH1', Quantity: 2, UnitPrice: 20 }] }) } };
  f.customerInvoices = { CI1: posted({ TransactionNumber: 'CI-26-01-000001', InvoiceDate: '2026-10-06', CustomerID: 'CU1', Description: 'Invoice', Subtotal: 100, Total: 100,
    SourceDeliveryNotes: [{ DeliveryNoteID: 'DN1', DeliveryNoteNumber: 'DN-26-01-000001', Lines: [{ ItemCode: 'RM-001', Quantity: 2, UnitPrice: 20 }] }], DirectLines: [] }) };
  await reset(f);
  await firestore.doc('journalEntries/JE1').set({ JVNumber: 'BR-26-01-000001', JVDate: '2026-10-09', Status: 'Posted', CompanyID: 'C1', VoucherType: 'Bank Receipt',
    AllocatedRefs: ['CustomerInvoice:CI1'], AllocatedRefTypes: ['CustomerInvoice'],
    Lines: [{ LineNo: 1, Credit: 60, PartyType: 'Customer', PartyID: 'CU1', Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:CI1', Amount: 60 }] }] });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8165);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
  async function openInvoice() {
    await page.goto('http://127.0.0.1:8165/?module=CUSTOMERINVOICE&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.click('#cinv-table-body tr:has-text("CI-26-01-000001")', { timeout: 30000 });
    await page.waitForSelector('.doclinks:not(.hidden)', { timeout: 30000 });
  }

  await check('a posted invoice: Create next with what is open; where it comes from and what followed', async () => {
    await openInvoice();
    const text = (await page.innerText('.doclinks')).replace(/\s+/g, ' ');
    assert.deepEqual(await page.$$eval('.doclinks-next', bs => bs.map(b => b.textContent.trim())), ['Receipt', 'PDC Received']);
    assert.match(text, /Open: 40\.00/);
    assert.match(text, /Comes from.*Sales Order SO-26-01-000001.*Delivery Note DN-26-01-000001.*Followed by.*Cash and Bank BR-26-01-000001/i);
    // Above the supporting documents, not printed.
    assert.equal(await page.evaluate(() => document.querySelector('.doclinks').nextElementSibling.classList.contains('supdocs')), true);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.isVisible('.doclinks'), false);
    await page.emulateMedia({ media: 'screen' });
    assert.deepEqual(page.__errors, []);
  });

  await check('Create next opens the next screen with CreateFrom; a linked document opens from its number', async () => {
    await page.evaluate(() => { const o = window.openModule; window.__opened = []; window.openModule = (m, p, c) => { window.__opened.push([m, p]); return o(m, p, c); }; });
    await page.click('.doclinks-next:has-text("Receipt")');
    const [m, p] = await page.evaluate(() => window.__opened[0]);
    assert.equal(m, 'CBT');
    assert.deepEqual(p.CreateFrom, { type: 'CustomerInvoice', id: 'CI1', companyId: 'C1', customerId: 'CU1', amount: 40, voucherType: 'Bank Receipt' });
    await openInvoice();
    await page.evaluate(() => { const o = window.openModule; window.__opened = []; window.openModule = (m, p, c) => { window.__opened.push([m, p]); return o(m, p, c); }; });
    await page.click('.doclinks-open:has-text("DN-26-01-000001")');
    assert.deepEqual(await page.evaluate(() => window.__opened[0]), ['DELIVERYNOTE', { OpenEntryId: 'DN1' }]);
    await page.waitForSelector('#dn-entry-view:not(.hidden)', { timeout: 30000 });
    assert.match(await page.textContent('#dn-entry-view'), /DN-26-01-000001/);
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
