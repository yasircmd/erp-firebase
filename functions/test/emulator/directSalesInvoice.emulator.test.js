// Direct sales invoice (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md,
// decisions 166-172): a company setting, off by default; item lines on a
// Customer Invoice, typed or from a Sales Order; on posting a Delivery Note
// made and posted for them and matched to the invoice (stock out at average
// cost with its COGS, the order's delivered quantity and reservation); not
// enough stock refuses the posting and leaves nothing behind; the invoice
// reversed reverses its delivery; a return against it as against any
// delivery.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success, true, r.error); return r; };
const fail = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal'); return r.error; };
const ledger = async () => { const l = (await val('stock/ledger/I1/WH1')) || {}; return [l.Quantity || 0, l.AvgCost || 0]; };
const jvLines = async jvId => (await call('u-admin', 'getJournalEntryDetail', { jvId })).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

function fixture() {
  const f = baseFixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.orgUnits.WH9 = { Type: 'Warehouse', Code: 'WH9', Name: 'C2 Store', Status: 'Active', CompanyID: 'C2' };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } } };
  return f;
}
const save = (itemLines, extra) => call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: Object.assign({
  InvoiceDate: D, Description: 'Counter sale', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', SourceDeliveryNotes: [], DirectLines: [],
  ItemLines: itemLines, ItemSalesTypeID: 'ST1', Discount: 0, TaxPercent: 0 }, extra || {}) });
const line = o => Object.assign({ ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 4, UnitPrice: 60, Description: 'Steel sheet' }, o);
const setting = (on, uid) => call(uid || 'u-admin', 'saveInvoiceStockSettings', { companyId: 'C1', directStock: on });

test('the setting is off by default; item lines are checked; saved with the subtotal', async () => {
  await reset(fixture());
  assert.deepEqual(await call('u-admin', 'getInvoiceStockSettings', { companyId: 'C1' }), { DirectStock: false });
  assert.match(await fail(save([line()])), /does not invoice stock directly/);
  assert.match(await fail(setting(true, 'u-viewer')), /permission to change Sales Invoice Configuration/);
  ok(await setting(true));
  assert.match(await fail(save([line({ Quantity: 0 })])), /Item line 1: enter a quantity greater than zero/);
  assert.match(await fail(save([line({ WarehouseID: 'WH9' })])), /choose a warehouse of the company/);
  assert.match(await fail(save([line({ ItemCode: 'NOPE' })])), /choose an active item of the company/);
  assert.match(await fail(save([line({ Quantity: 1.5 })])), /counted in whole PCS/);
  assert.match(await fail(save([line()], { ItemSalesTypeID: '' })), /Sales Type/i);
  const s = ok(await save([line()]));
  const inv = await val('customerInvoices/' + s.invoiceId);
  assert.deepEqual([inv.Subtotal, inv.Total, inv.ItemLines.length, inv.ItemLines[0].Amount, inv.ItemSalesTypeID], [240, 240, 1, 240, 'ST1']);
});

test('posting delivers the items: a Delivery Note made, posted at average cost and matched; the invoice\'s revenue', async () => {
  await reset(fixture());
  ok(await setting(true));
  const s = ok(await save([line()]));
  const p = ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  assert.equal(inv.Status, 'Posted');
  assert.ok(inv.AutoDeliveryNoteID, 'the delivery is recorded on the invoice');
  const dn = await val('stock/transactions/' + inv.AutoDeliveryNoteID);
  assert.deepEqual([dn.TransactionType, dn.Status, dn.MatchedToInvoiceID, dn.AutoFromInvoiceID, dn.CustomerID], ['DeliveryNote', 'Posted', s.invoiceId, s.invoiceId, 'CU1']);
  assert.deepEqual([dn.Lines[0].Quantity, dn.Lines[0].UnitCost, dn.Lines[0].UnitPrice], [4, 35, 60]);
  assert.equal(inv.AutoDeliveryNoteNumber, dn.TransactionNumber);
  assert.deepEqual(await ledger(), [26, 35]);
  assert.deepEqual(await jvLines(dn.LinkedJVID), [['1300', 0, 140], ['5000', 140, 0]].sort(), 'COGS at average cost');
  assert.deepEqual(await jvLines(inv.LinkedJVID), [['1200', 240, 0], ['4000', 0, 240]].sort(), 'receivable and revenue');
  assert.ok(p.invoiceNumber);
  // It can no longer change; the month-end check doesn't list it as not invoiced.
  assert.match(await fail(call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { CustomerInvoiceID: s.invoiceId, InvoiceDate: D, Description: 'x', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', DirectLines: [{ AccountCode: '4000', Amount: 5, Description: 'x', SalesTypeID: 'ST1' }] } })), /draft or rejected/);
  const c = await call('u-admin', 'getPeriodClosingChecklist', { companyId: 'C1', month: '2026-09' });
  assert.equal(c.Items.find(i => i.Key === 'deliveries').Count, 0);
});

test('not enough stock: the posting is refused and nothing is left behind', async () => {
  await reset(fixture());
  ok(await setting(true));
  const s = ok(await save([line({ Quantity: 100 })]));
  const e = await fail(call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  assert.match(e, /stock|insufficient|available/i);
  const inv = await val('customerInvoices/' + s.invoiceId);
  assert.deepEqual([inv.Status, inv.AutoDeliveryNoteID || ''], ['Draft', '']);
  const dns = Object.values((await val('stock/transactions')) || {}).filter(t => t.AutoFromInvoiceID === s.invoiceId);
  assert.deepEqual(dns, [], 'no draft delivery left');
  assert.deepEqual(await ledger(), [30, 35]);
});

test('reversing the invoice reverses its delivery: the stock back at its cost; a return against it as against any delivery', async () => {
  await reset(fixture());
  ok(await setting(true));
  let s = ok(await save([line()]));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  let inv = await val('customerInvoices/' + s.invoiceId);
  ok(await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: s.invoiceId, reversalDate: D }));
  inv = await val('customerInvoices/' + s.invoiceId);
  assert.ok(inv.ReversedByInvoiceID);
  const dn = await val('stock/transactions/' + inv.AutoDeliveryNoteID);
  assert.ok(dn.ReversedByDeliveryNoteID, 'the delivery reversed with it');
  assert.equal(dn.MatchedToInvoiceID, '');
  assert.deepEqual(await ledger(), [30, 35]);
  // A return of one unit of a second invoice's items.
  s = ok(await save([line({ Quantity: 2 })]));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  inv = await val('customerInvoices/' + s.invoiceId);
  const r = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: D, Description: 'One back', CompanyID: 'C1', CustomerID: 'CU1', SourceInvoiceID: s.invoiceId,
    Lines: [{ SourceDNID: inv.AutoDeliveryNoteID, SourceDNLineNo: 1, Quantity: 1, WarehouseID: 'WH1' }] }));
  ok(await call('u-admin', 'postSalesReturn', { returnId: r.returnId }));
  assert.deepEqual(await ledger(), [29, 35]);
});

test('from a Sales Order: the order\'s lines still to deliver; invoiced directly, the order counts them delivered and uses up the reservation', async () => {
  await reset(fixture());
  ok(await setting(true));
  const so = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 10, UnitPrice: 20 }] } }));
  ok(await call('u-admin', 'confirmSalesOrder', { soId: so.soId }));
  const lines = await call('u-admin', 'getInvoiceableOrderLines', { companyId: 'C1', customerId: 'CU1' });
  assert.deepEqual(lines.map(l => [l.ItemCode, l.MaxQuantity, l.UnitPrice]), [['RM-001', 10, 20]]);
  const ol = lines[0];
  const fromSo = q => ({ SourceSOID: ol.SOID, SourceSOLineID: ol.LineID, Quantity: q, UnitPrice: 999, WarehouseID: 'WH9', Description: 'From the order' });
  assert.match(await fail(save([fromSo(11)])), /at most 10 can be invoiced now/);
  const s = ok(await save([fromSo(6)]));
  const saved = (await val('customerInvoices/' + s.invoiceId)).ItemLines[0];
  assert.deepEqual([saved.UnitPrice, saved.WarehouseID, saved.SourceSONumber], [20, 'WH1', ol.SONumber], 'the order\'s price and warehouse, not the typed ones');
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const order = await val('salesOrders/' + so.soId);
  assert.equal(order.Lines[0].DeliveredQuantity, 6);
  const reserved = Object.values((await val('stock/reservations')) || {}).filter(r => r.SourceID === so.soId && r.Status === 'Active').reduce((t, r) => t + r.Quantity, 0);
  assert.equal(reserved, 4);
  assert.deepEqual((await call('u-admin', 'getInvoiceableOrderLines', { companyId: 'C1', customerId: 'CU1' })).map(l => l.MaxQuantity), [4], 'the rest stays open on the order');
  assert.match(await fail(call('u-other', 'getInvoiceableOrderLines', { companyId: 'C1', customerId: 'CU1' })), /access to that company/);
});
