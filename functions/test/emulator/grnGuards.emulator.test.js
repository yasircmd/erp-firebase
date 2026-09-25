// Hand-ported GRN reversal guards added during the migration (not in
// Code.gs): a GRN reversal entry can't itself be reversed, and an
// invoiced GRN can't be reversed until its Vendor Invoice is.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  // Extra stock elsewhere in the same warehouse, so a wrong second "Out"
  // wouldn't be stopped by the negative-stock guard on its own.
  f.stock = { ledger: { I1: { WH1: { Quantity: 20, AvgCost: 5, TotalValue: 100 } } } };
  return f;
}
test.after(async () => { await app.delete(); });

const qty = async () => ((await val('stock/ledger/I1/WH1')) || {}).Quantity;
async function postedGrn(n) {
  const g = await call('u-admin', 'saveGrnDraft', {
    TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: n, UnitCost: 5, Description: 'x' }]
  });
  assert.equal((await call('u-admin', 'postGrn', { grnId: g.grnId })).success, true);
  return g.grnId;
}

test('a GRN reversal entry cannot itself be reversed (it would remove the stock a second time)', async () => {
  await reset(fixture());
  const g = await postedGrn(10);
  assert.equal(await qty(), 30);
  const r = await call('u-admin', 'reverseGrn', { grnId: g, reversalDate: today });
  assert.equal(r.success, true);
  assert.equal(await qty(), 20);
  await assert.rejects(call('u-admin', 'reverseGrn', { grnId: r.grnId, reversalDate: today }),
    e => e.message === 'A reversal entry cannot itself be reversed.' && e.status === 'FAILED_PRECONDITION');
  assert.equal(await qty(), 20, 'stock untouched');
});

test('an invoiced GRN cannot be reversed until its Vendor Invoice is', async () => {
  const f = fixture();
  await reset(f);
  const g = await postedGrn(4);
  const inv = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: today, Description: 'Inv', VendorRefNumber: 'R1', CompanyID: 'C1', VendorID: 'V1', SourceGRNs: [{ GRNID: g }] } });
  assert.equal(inv.success, true, inv.error);
  assert.equal((await call('u-admin', 'postVendorInvoice', { invoiceId: inv.invoiceId })).success, true);
  await assert.rejects(call('u-admin', 'reverseGrn', { grnId: g, reversalDate: today }), /matched to a Vendor Invoice and cannot be reversed/);
  assert.equal(await qty(), 24);

  assert.equal((await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv.invoiceId, reversalDate: today })).success, true);
  assert.equal((await call('u-admin', 'reverseGrn', { grnId: g, reversalDate: today })).success, true);
  assert.equal(await qty(), 20);
});
