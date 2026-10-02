// One GL line / Stock Ledger row per identical posting (owner, 2026-10-02;
// docs/modules/LINE_CLUBBING.md): lines with the same account, side, cost
// center, profit center and description are clubbed into one GL line; in
// the Stock Ledger report, a document's lines of one item at one warehouse
// with the same direction, cost center, profit center and description are
// one row. Anything different stays separate.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore, today } = require('./_helpers');
const { clubGlLines, clubStockLines } = require('../../src/lineClubbing');

test.after(async () => { await app.delete(); });

function fixture() {
  const f = baseFixture();
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Bolt', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Paint Shop', Status: 'Active', CompanyID: 'C1' };
  return f;
}
const glOf = async jvId => (await firestore.collection('journalEntries').doc(jvId).get()).data().Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.Description, l.CostCenterID || '']);
const line = (item, qty, cost, description, extra) => Object.assign({ ItemID: item, WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: qty, UnitCost: cost, Description: description }, extra);

test.beforeEach(async () => { await reset(fixture()); });

test('GRN: identical lines are one GL line; a different description or cost center stays separate', async () => {
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1', Lines: [
    line('I1', 10, 5, 'Steel'), line('I1', 4, 5, 'Steel'), line('I2', 3, 2, 'Steel'),
    line('I1', 2, 5, 'Steel offcut'), line('I1', 1, 5, 'Steel', { CostCenterID: 'CC2' })] });
  const p = await call('u-admin', 'postGrn', { grnId: g.grnId });
  assert.equal(p.success, true, p.error);
  const grn = await call('u-admin', 'getGrnEntries', {});
  const jvId = (grn.entries || grn).find(e => e.GRNID === g.grnId || e.TransactionNumber === p.grnNumber).LinkedJVID;
  assert.deepEqual(await glOf(jvId), [
    ['1300', 76, 0, 'Steel', ''],          // 50 + 20 + 6: two items, same account, same description
    ['1300', 10, 0, 'Steel offcut', ''],   // another description
    ['1300', 5, 0, 'Steel', 'CC2'],        // another cost center
    ['2100', 0, 91, 'Receipt', '']         // the GRN clearing side, one line
  ].map(r => r), 'GL lines');
});

test('Stock Ledger report: a document\'s identical lines of an item are one row; a different description is its own row', async () => {
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1', Lines: [
    line('I1', 10, 5, 'Steel'), line('I1', 6, 8, 'Steel'), line('I1', 2, 5, 'Steel offcut')] });
  assert.equal((await call('u-admin', 'postGrn', { grnId: g.grnId })).success, true);
  const r = await call('u-admin', 'getStockLedgerReport', { params: { ItemID: 'I1', WarehouseID: 'WH1', FromDate: '2000-01-01', ToDate: '2099-12-31' } });
  assert.deepEqual(r.Rows.map(x => [x.Description, x.Direction, x.Quantity, x.UnitCost, x.RunningQuantity, x.RunningValue]), [
    ['Steel', 'In', 16, 6.125, 16, 98],
    ['Steel offcut', 'In', 2, 5, 18, 108]
  ]);
  assert.equal(r.ClosingQuantity, 18);
  assert.equal(r.ClosingValue, 108);
});

test('the rules themselves: debits and credits never net; party lines never club; order kept', () => {
  const gl = clubGlLines([
    { AccountCode: '1300', Debit: 10, Credit: 0, Description: 'x' },
    { AccountCode: '1300', Debit: 0, Credit: 4, Description: 'x' },
    { AccountCode: '2000', Debit: 0, Credit: 3, Description: 'x', PartyType: 'Vendor', PartyID: 'V1' },
    { AccountCode: '2000', Debit: 0, Credit: 3, Description: 'x', PartyType: 'Vendor', PartyID: 'V1' },
    { AccountCode: '1300', Debit: 2.255, Credit: 0, Description: 'x' },
    { AccountCode: '1300', Debit: 1, Credit: 0, Description: 'x', ProfitCenterID: 'PC1' }
  ]);
  assert.deepEqual(gl.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '', l.ProfitCenterID || '']), [
    ['1300', 12.26, 0, '', ''], ['1300', 0, 4, '', ''], ['2000', 0, 3, 'V1', ''], ['2000', 0, 3, 'V1', ''], ['1300', 1, 0, '', 'PC1']]);
  const st = clubStockLines([
    { Direction: 'Out', Quantity: 2, TotalValue: 10, Description: 'a' }, { Direction: 'In', Quantity: 1, TotalValue: 6, Description: 'a' },
    { Direction: 'Out', Quantity: 3, TotalValue: 15, Description: 'a' }]);
  assert.deepEqual(st.map(l => [l.Direction, l.Quantity, l.TotalValue]), [['Out', 5, 25], ['In', 1, 6]]);
});
