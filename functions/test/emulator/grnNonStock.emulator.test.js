// Non-stock lines in GRN (owner, 2026-09-28; docs/modules/GRN_NON_STOCK.md):
// a category line posts Dr the category's account · Cr GRN Clearing, from a
// PO's category line (price locked, received quantity tracked) or entered
// directly; no stock. Approval amount, rejection, reversal, the Vendor
// Invoice amount, Recalculate Stock Ledger, Purchase Return and Fixed
// Assets (the GRN's vendor as supplier) all account for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val, today } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  // Recalculate Stock Ledger needs the literal role 'ADMIN' (see dataReset's suite).
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  const acc = (code, name, type) => ({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true });
  Object.assign(f.coa, {
    'A-OFFICE': acc('5200', 'Office Expenses', 'Expense'),
    'A-FACLRA': acc('1590', 'Fixed Asset Clearing', 'Asset'),
    'A-OLD': Object.assign(acc('5300', 'Closed Expense', 'Expense'), { Status: 'Inactive' })
  });
  f.requisitionCategories = {
    RC1: { Name: 'Stationery', Type: 'DirectExpense', GLAccountID: 'A-OFFICE', Status: 'Active', CompanyID: 'C1' },
    RC2: { Name: 'Laptops', Type: 'FixedAsset', GLAccountID: 'A-FACLRA', Status: 'Active', CompanyID: 'C1' },
    RC3: { Name: 'Other company', Type: 'DirectExpense', GLAccountID: 'A-OFFICE', Status: 'Active', CompanyID: 'C2' },
    RC4: { Name: 'Retired', Type: 'DirectExpense', GLAccountID: 'A-OFFICE', Status: 'Inactive', CompanyID: 'C1' },
    RC5: { Name: 'Bad account', Type: 'DirectExpense', GLAccountID: 'A-OLD', Status: 'Active', CompanyID: 'C1' }
  };
  f.purchaseOrders = {
    PO1: { PONumber: 'PO-1', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1', Lines: [
      { LineID: 'L1', ItemCode: 'RM-001', Description: 'Steel', Quantity: 10, UnitPrice: 6, WarehouseID: 'WH1' },
      { LineID: 'L2', ItemCode: '', CategoryID: 'RC1', Description: 'Paper', Quantity: 4, UnitPrice: 25 }
    ] }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const base = extra => Object.assign({ TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', Lines: [], NonStockLines: [] }, extra);
const stockLine = { ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, UnitCost: 6, Description: 'Steel', SourcePOID: 'PO1', SourcePOLineID: 'L1' };
const poPaper = q => ({ CategoryID: 'RC1', Description: 'Paper', Quantity: q, UnitCost: 999, SourcePOID: 'PO1', SourcePOLineID: 'L2' });
const glOf = async grnId => {
  const jv = (await firestore.collection('journalEntries').doc((await val('stock/transactions/' + grnId)).LinkedJVID).get()).data();
  return jv.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.CostCenterID || '']).sort();
};
const poLine = async id => (await val('purchaseOrders/PO1')).Lines.find(l => l.LineID === id);
const err = async p => { const r = await p.catch(e => e); return r instanceof Error ? r.message : 'no error: ' + JSON.stringify(r); };
async function posted(data) {
  const s = await call('u-admin', 'saveGrnDraft', base(data));
  const p = await call('u-admin', 'postGrn', { grnId: s.grnId });
  assert.equal(p.status, 'Posted');
  return s.grnId;
}

test('a mixed GRN: stock line to Inventory, PO non-stock line to its category account, one GRN Clearing credit', async () => {
  await reset(fixture());
  const g = await posted({ Lines: [stockLine], NonStockLines: [poPaper(3)] });
  assert.deepEqual(await glOf(g), [
    ['1300', 12, 0, ''], ['2100', 0, 87, 'CC1'], ['5200', 75, 0, 'CC1']
  ].sort(), 'the PO price (25) wins over what the client sent (999)');
  const grn = await val('stock/transactions/' + g);
  assert.deepEqual(grn.NonStockLines.map(l => [l.CategoryID, l.AccountCode, l.Quantity, l.UnitCost]), [['RC1', '5200', 3, 25]]);
  assert.equal((await poLine('L2')).ReceivedQuantity, 3, 'PO non-stock line received');
  assert.equal((await poLine('L1')).ReceivedQuantity, 2);
  assert.equal((await val('stock/ledger/I1/WH1')).Quantity, 2, 'only the stock line moved stock');
});

test('a non-stock-only GRN, entered directly: no stock, cost center from the header', async () => {
  await reset(fixture());
  const g = await posted({ NonStockLines: [{ CategoryID: 'RC1', Description: 'Toner', Quantity: 2, UnitCost: 40 }] });
  assert.deepEqual(await glOf(g), [['2100', 0, 80, 'CC1'], ['5200', 80, 0, 'CC1']].sort());
  assert.equal(await val('stock/ledger'), null, 'no stock ledger written');
  const eligible = await call('u-admin', 'getEligibleGRNsForInvoice', { companyId: 'C1', vendorId: 'V1' });
  assert.deepEqual(eligible.map(e => [e.GRNID, e.Amount]), [[g, 80]], 'Vendor Invoice sees the non-stock amount');
});

test('Vendor Invoice bills the whole GRN, stock and non-stock, through GRN Clearing', async () => {
  await reset(fixture());
  const g = await posted({ Lines: [stockLine], NonStockLines: [poPaper(1)] });
  const s = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: today, Description: 'Bill', VendorRefNumber: 'A-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [{ GRNID: g }], DirectLines: [] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await val('vendorInvoices/' + s.invoiceId)).SourceGRNs[0].Amount, 37);
  const p = await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });
  assert.equal(p.success, true, p.error);
  const jv = (await firestore.collection('journalEntries').doc((await val('vendorInvoices/' + s.invoiceId)).LinkedJVID).get()).data();
  assert.deepEqual(jv.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort(), [['2000', 0, 37], ['2100', 37, 0]].sort());
  // Purchase Return offers the stock line only.
  const ret = await call('u-admin', 'getReturnableVendorInvoices', { companyId: 'C1', vendorId: 'V1' });
  assert.deepEqual(ret[0].Lines.map(l => [l.ItemCode, l.Quantity]), [['RM-001', 2]]);
});

test('approval amount includes non-stock; rejected GRNs are corrected and posted; reversal mirrors it', async () => {
  const f = fixture();
  f.approvalConfigurations = { GRN: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { GRN: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 50 }] } } };
  await reset(f);
  // 2 x 25 = 50 reaches the 50 threshold only because non-stock counts.
  const s = await call('u-admin', 'saveGrnDraft', base({ NonStockLines: [poPaper(2)] }));
  assert.equal((await call('u-admin', 'postGrn', { grnId: s.grnId })).status, 'PendingApproval');
  assert.equal((await val('approvalInstances/' + (await val('stock/transactions/' + s.grnId)).ApprovalInstanceID)).Amount, 50);
  assert.equal((await poLine('L2')).ReceivedQuantity || 0, 0, 'not received until posted');
  await call('u-approver', 'decideGrnApproval', { grnId: s.grnId, levelNumber: 1, decision: 'Rejected', reason: 'Only 1' });
  const rejectedTasks = async () => (await call('u-admin', 'getMyRejectedSubmissions', {})).map(t => t.DocumentID);
  assert.deepEqual(await rejectedTasks(), [s.grnId], 'the rejection is the submitter\'s task');
  assert.equal((await call('u-admin', 'saveGrnDraft', base({ GRNID: s.grnId, NonStockLines: [poPaper(1)] }))).success, true);
  assert.equal((await call('u-admin', 'postGrn', { grnId: s.grnId })).status, 'Posted', '25 is under the threshold');
  // Posted with no approval needed: the old rejection leaves Tasks (owner, 2026-10-24).
  assert.deepEqual(await rejectedTasks(), []);
  assert.equal((await poLine('L2')).ReceivedQuantity, 1);

  const r = await call('u-admin', 'reverseGrn', { grnId: s.grnId, reversalDate: today });
  assert.equal(r.success, true);
  assert.deepEqual(await glOf(r.grnId), [['2100', 25, 0, 'CC1'], ['5200', 0, 25, 'CC1']].sort());
  assert.equal((await poLine('L2')).ReceivedQuantity, 0, 'PO line rolled back');
});

test('Recalculate Stock Ledger ignores non-stock lines', async () => {
  await reset(fixture());
  await posted({ Lines: [stockLine], NonStockLines: [poPaper(1)] });
  await posted({ NonStockLines: [{ CategoryID: 'RC1', Description: 'Toner', Quantity: 1, UnitCost: 5 }] });
  const r = await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' });
  assert.equal(r.success, true, r.error);
  assert.equal((await val('stock/ledger/I1/WH1')).Quantity, 2);
});

test('Fixed Asset category: the GRN debit is a clearing item with the GRN vendor as supplier', async () => {
  await reset(fixture());
  const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
  ok(await call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLRA' }));
  const g = await posted({ NonStockLines: [{ CategoryID: 'RC2', Description: 'Laptop', Quantity: 1, UnitCost: 3000 }] });
  const items = (await call('u-admin', 'getFaClearingItems', { companyId: 'C1' })).items;
  assert.deepEqual(items.map(i => [i.VoucherType, i.Amount, i.VendorID, i.VendorName, i.SourceTransactionID]), [['GRN', 3000, 'V1', 'Acme Metals', g]]);
});

test('refusals: other company, inactive or invalid category, PO category mismatch, missing cost center', async () => {
  await reset(fixture());
  const save = ns => err(call('u-admin', 'saveGrnDraft', base({ NonStockLines: [ns] })));
  assert.match(await save({ CategoryID: 'RC3', Description: 'x', Quantity: 1, UnitCost: 1 }), /Non-stock line 1: the category belongs to a different Company/);
  assert.match(await save({ CategoryID: 'RC4', Description: 'x', Quantity: 1, UnitCost: 1 }), /category not found or inactive/);
  assert.match(await save({ CategoryID: 'RC5', Description: 'x', Quantity: 1, UnitCost: 1 }), /has no valid GL account/);
  assert.match(await save({ CategoryID: 'RC2', Description: 'x', Quantity: 1, SourcePOID: 'PO1', SourcePOLineID: 'L2' }), /category does not match the referenced Purchase Order line/);
  assert.match(await save({ CategoryID: 'RC1', Description: 'x', Quantity: 0, UnitCost: 1 }), /quantity greater than zero/);
  assert.match(await save({ CategoryID: 'RC1', Description: '', Quantity: 1, UnitCost: 1 }), /description is required/);
  assert.match(await err(call('u-admin', 'saveGrnDraft', base({ CostCenterID: '', NonStockLines: [{ CategoryID: 'RC1', Description: 'x', Quantity: 1, UnitCost: 1 }] }))),
    /select a Cost Center/);
  assert.match(await err(call('u-admin', 'saveGrnDraft', base({}))), /Enter at least one line/);
  // A category deactivated after saving can't be posted.
  const s = await call('u-admin', 'saveGrnDraft', base({ NonStockLines: [{ CategoryID: 'RC1', Description: 'x', Quantity: 1, UnitCost: 1 }] }));
  await rtdb.ref('requisitionCategories/RC1/GLAccountID').set('A-OLD');
  assert.match(await err(call('u-admin', 'postGrn', { grnId: s.grnId })), /has no valid GL account/);
  assert.equal((await val('stock/transactions/' + s.grnId)).Status, 'Draft', 'nothing posted');
});
