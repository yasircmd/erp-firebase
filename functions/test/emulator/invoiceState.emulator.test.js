// Invoicing state on the GRN and Delivery Note lists (owner, 2026-09-28):
// a posted, unreversed document is Pending invoice until an unposted
// invoice lists it (On draft invoice), then Invoiced with the invoice
// number once that invoice posts; reversing the invoice makes it Pending
// again. Drafts, reversed documents and reversal entries show nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  const dn = (n, extra) => Object.assign({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1',
    TransactionNumber: 'DN-' + n, TransactionDate: D, Description: 'Delivery ' + n, CreatedAt: '2026-09-10T00:00:0' + n,
    Lines: [{ ItemCode: 'RM-001', Quantity: 2, UnitPrice: 50, CostCenterID: 'CC1' }] }, extra || {});
  const grn = (n, extra) => Object.assign({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V1', TransactionNumber: 'GRN-' + n,
    TransactionDate: D, Description: 'Receipt ' + n, CreatedAt: '2026-09-10T00:00:0' + n,
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', Direction: 'In', Quantity: 2, UnitCost: 10 }] }, extra || {});
  f.stock = { transactions: {
    G1: grn(1), GD: grn(2, { Status: 'Draft', TransactionNumber: '' }), GX: grn(3, { ReversedByGRN: 'GREV' }), GREV: grn(4, { ReversalOfGRN: 'GX' }),
    N1: dn(1), ND: dn(2, { Status: 'Draft', TransactionNumber: '' }), NX: dn(3, { ReversedByDeliveryNoteID: 'NREV' }), NREV: dn(4, { ReversalOfDeliveryNoteID: 'NX' })
  } };
  return f;
}
test.after(async () => { await app.delete(); });

const grnStates = async () => Object.fromEntries((await call('u-admin', 'getGrnEntries', { limit: 'all' })).entries
  .map(e => [e.GRNID, [e.InvoiceStatus, e.InvoiceNumber || '']]));
const dnStates = async () => Object.fromEntries((await call('u-admin', 'getDeliveryNoteEntries', { limit: 'all' })).entries
  .map(e => [e.DeliveryNoteID, [e.InvoiceStatus, e.InvoiceNumber || '']]));

test('GRN list: Pending → On draft invoice → Invoiced (number) → Pending after the invoice is reversed', async () => {
  await reset(fixture());
  assert.deepEqual(await grnStates(), { G1: ['Pending', ''], GD: ['', ''], GX: ['', ''], GREV: ['', ''] });

  const s = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Bill', VendorRefNumber: 'A-1', CompanyID: 'C1', VendorID: 'V1',
    CostCenterID: 'CC1', SourceGRNs: [{ GRNID: 'G1' }], DirectLines: [] } });
  assert.equal(s.success, true, s.error);
  let e = (await call('u-admin', 'getGrnEntries', {})).entries.find(x => x.GRNID === 'G1');
  assert.deepEqual([e.InvoiceStatus, e.InvoiceID, e.InvoiceDocStatus], ['OnDraftInvoice', s.invoiceId, 'Draft']);

  const p = await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });
  assert.equal(p.success, true, p.error);
  e = (await call('u-admin', 'getGrnEntries', {})).entries.find(x => x.GRNID === 'G1');
  assert.equal(e.InvoiceStatus, 'Invoiced');
  assert.equal(e.InvoiceID, s.invoiceId);
  assert.match(e.InvoiceNumber, /^VINV-/);

  const r = await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.deepEqual((await grnStates()).G1, ['Pending', ''], 'invoice reversed: pending again');
});

test('Delivery Note list: Pending → On draft invoice → Invoiced (number) → Pending after the invoice is reversed', async () => {
  await reset(fixture());
  assert.deepEqual(await dnStates(), { N1: ['Pending', ''], ND: ['', ''], NX: ['', ''], NREV: ['', ''] });

  const s = await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Invoice', CompanyID: 'C1', CustomerID: 'CU1',
    CostCenterID: 'CC1', SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }], DirectLines: [] } });
  assert.equal(s.success, true, s.error);
  let e = (await call('u-admin', 'getDeliveryNoteEntries', {})).entries.find(x => x.DeliveryNoteID === 'N1');
  assert.deepEqual([e.InvoiceStatus, e.InvoiceID, e.InvoiceDocStatus], ['OnDraftInvoice', s.invoiceId, 'Draft']);

  const p = await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId });
  assert.equal(p.success, true, p.error);
  e = (await call('u-admin', 'getDeliveryNoteEntries', {})).entries.find(x => x.DeliveryNoteID === 'N1');
  assert.equal(e.InvoiceStatus, 'Invoiced');
  assert.match(e.InvoiceNumber, /^CINV-/);

  const r = await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: s.invoiceId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.deepEqual((await dnStates()).N1, ['Pending', '']);
});
