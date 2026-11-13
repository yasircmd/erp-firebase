// Descriptions optional on the inventory transactions (owner, 2026-11-13;
// docs/modules/UX4.md item 13, Q503): a blank header saves a default naming
// the document (and what it came from); a blank line takes the item's name
// (a GRN's direct line, its category's); a typed one is kept. Journals and
// invoices keep theirs required. Purchase Return, Sales Return, Delivery
// Note and Production are checked in the suites that build their sources
// (partyStatement, directSalesInvoice, correctionJv, prodConsumption).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  f.coa['A-OFFICE'] = { AccountCode: '5200', AccountName: 'Office Expenses', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'DirectExpense', GLAccountID: 'A-OFFICE', Status: 'Active', CompanyID: 'C1' } };
  f.purchaseOrders = {
    PO1: { PONumber: 'PO-26-000123', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1', Lines: [
      { LineID: 'L1', ItemCode: 'RM-001', Description: 'Steel', Quantity: 10, UnitPrice: 6, WarehouseID: 'WH1' }] }
  };
  return f;
}
test.after(async () => { await app.delete(); });
const tx = id => val('stock/transactions/' + id);
const item = o => Object.assign({ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 2, CostCenterID: 'CC1' }, o);

test('GRN: blank header from its PO, blank lines take the item\'s or the category\'s name; typed ones kept', async () => {
  await reset(fixture());
  const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: '  ', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    Lines: [item({ UnitCost: 6, Description: '', SourcePOID: 'PO1', SourcePOLineID: 'L1' })],
    NonStockLines: [{ CategoryID: 'RC1', Description: '', Quantity: 1, UnitCost: 20 }] });
  const g = await tx(s.grnId);
  assert.equal(g.Description, 'Goods receipt from PO-26-000123');
  assert.equal(g.Lines[0].Description, 'Steel Sheet');
  assert.equal(g.NonStockLines[0].Description, 'Stationery');
  const t = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'March delivery', CompanyID: 'C1', VendorID: 'V1',
    Lines: [item({ UnitCost: 6, Description: 'Cut to size' })] });
  const h = await tx(t.grnId);
  assert.deepEqual([h.Description, h.Lines[0].Description], ['March delivery', 'Cut to size']);
  // Posting works on a defaulted one.
  assert.equal((await call('u-admin', 'postGrn', { grnId: s.grnId })).status, 'Posted');
});

test('Material Issue, Stock Adjustment, Warehouse Movement and Physical Count: blank header and lines default', async () => {
  await reset(fixture());
  const mi = await call('u-admin', 'saveMaterialIssueDraft', { TransactionDate: today, CompanyID: 'C1', EntryType: 'Issue', CostCenterID: 'CC1', Lines: [item({})] });
  const sa = await call('u-admin', 'saveStockAdjustmentDraft', { TransactionDate: today, Description: '', CompanyID: 'C1',
    Lines: [item({ AdjustmentDirection: 'Increase', UnitCost: 3, Description: '' })] });
  const wm = await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: today, Description: '', CompanyID: 'C1',
    Lines: [item({ WarehouseID: undefined, FromWarehouseID: 'WH1', ToWarehouseID: 'WH2' })] });
  const pc = await call('u-admin', 'savePhysicalCountDraft', { pcData: { TransactionDate: today, Description: '', CompanyID: 'C1',
    Lines: [item({ EnteredQuantity: undefined, CountedQuantity: 7, SystemQuantity: 10, Description: '' })] } });
  const got = [];
  for (const id of [mi.miId, sa.adjId, wm.moveId, pc.pcId]) { const r = await tx(id); got.push([r.Description, r.Lines[0].Description]); }
  assert.deepEqual(got, [
    ['Material issue', 'Steel Sheet'], ['Stock adjustment', 'Steel Sheet'],
    ['Warehouse movement', 'Steel Sheet'], ['Physical count', 'Steel Sheet']]);
});

test('a journal keeps its description required', async () => {
  await reset(fixture());
  const r = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: today, Description: '', CompanyID: 'C1',
    Lines: [{ AccountCode: '1300', Debit: 5, Description: 'a' }, { AccountCode: '5000', Credit: 5, Description: 'b' }] } }).catch(e => ({ error: e.message }));
  assert.match(JSON.stringify(r), /[Dd]escription/);
});
