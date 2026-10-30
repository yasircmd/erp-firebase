// Retail Sales taxed line by line (docs/modules/TAX_ENGINE.md, part 4), India
// GST on company C1 (27): each item's code, the price including the tax, the
// counter's state; each component posted to its own account; the counter's
// rates; a return's share by quantity, the last of a line taking what is
// left; the item without a code refused. A company without a Tax
// Configuration keeps the settings' single rate (retailSales suites).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore } = require('./_helpers');
const engine = require('../../src/taxEngine');

test.after(async () => { await app.delete(); });
const DAY = new Date().toISOString().slice(0, 10);
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const sums = e => {
  const out = {};
  e.Lines.forEach(l => { out[l.AccountCode] = Math.round(((out[l.AccountCode] || 0) + (l.Debit || 0) - (l.Credit || 0)) * 100) / 100; });
  return out;
};

function fixture() {
  const f = baseFixture();
  ['CGST', 'SGST', 'UTGST', 'IGST', 'CESS'].forEach((k, i) => { f.coa['A-' + k] = { AccountCode: '22' + (i + 1) + '0', AccountName: 'Output ' + k, AccountType: 'Liability', Status: 'Active', IsPostable: true }; });
  f.coa['A-DISC'] = { AccountCode: '4100', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISC', OutputTaxAccountID: 'A-VATOUT' });
  Object.assign(f.items.I1, { SalesCogsAccountID: 'A-COGS', TaxCode: 'GST18', HSNCode: '7208' });
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', SalesCogsAccountID: 'A-COGS', TaxCode: 'GST5' };
  f.items.I3 = { ItemCode: 'FG-003', ItemName: 'Hinge', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', SalesCogsAccountID: 'A-COGS' };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } }, I2: { WH1: { Quantity: 4, AvgCost: 7.5, TotalValue: 30 } }, I3: { WH1: { Quantity: 4, AvgCost: 5, TotalValue: 20 } } } };
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Local Sales', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.customerCounters = { CL: 1 };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active' } };
  f.priceListLines = {
    P1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 52.5, EffectiveFrom: '2026-01-01', Status: 'Active' },
    P2: { PriceListID: 'PL1', ItemCode: 'FG-002', UnitPrice: 21, EffectiveFrom: '2026-01-01', Status: 'Active' },
    P3: { PriceListID: 'PL1', ItemCode: 'FG-003', UnitPrice: 10, EffectiveFrom: '2026-01-01', Status: 'Active' }
  };
  return f;
}
let cash = '';
async function ready() {
  await reset(fixture());
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-' + c.Code; c.InputAccountID = 'A-VATIN'; });
  const r = await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg });
  assert.equal(r.success, true, r.error);
  await call('u-admin', 'saveRetailSalesSettings', { companyId: 'C1', salesTypeId: 'ST1', warehouseId: 'WH1', costCenterId: 'CC1', receivablesAccountId: 'A-AR', priceListId: 'PL1', taxPercent: 0 });
  cash = (await call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: { Name: 'Cash', Kind: 'Cash', AccountID: 'A-CASH' } })).methodId;
}
const sell = lines => call('u-admin', 'confirmRetailSale', { CompanyID: 'C1', SaleDate: DAY, Lines: lines, Payments: [{ MethodID: cash, Amount: 500 }] });

test('a counter sale taxed by item: the tax out of each price, CGST + SGST to their accounts; the counter\'s rates', async () => {
  await ready();
  const counter = await call('u-admin', 'getRetailCounter', { companyId: 'C1' });
  assert.equal(counter.lineTax, true);
  assert.deepEqual(['RM-001', 'FG-002'].map(c => counter.items.find(i => i.ItemCode === c).TaxPercent), [18, 5]);
  // 3 × 52.50 less 3.00 = 154.50 at 18%; 2 × 21.00 = 42.00 at 5%.
  const s = await sell([{ ItemID: 'I1', Quantity: 3, Discount: 3 }, { ItemID: 'I2', Quantity: 2 }]);
  assert.equal(s.success, true, s.error);
  const rec = await val('stock/transactions/' + s.saleId);
  assert.deepEqual(rec.TaxLines.map(t => [t.Key, t.TaxCode, t.Taxable, t.Tax]), [['line#1', 'GST18', 130.94, 23.56], ['line#2', 'GST5', 40, 2]]);
  assert.deepEqual([rec.Total, rec.TaxAmount, rec.DiscountNet, rec.Revenue], [196.5, 25.56, 2.54, 173.48]);
  const e = sums(await jv(rec.LinkedJVID));
  assert.deepEqual([e['2210'], e['2220'], e['4000'], e['4100'], e['1000']], [-12.78, -12.78, -173.48, 2.54, 196.5]);
  assert.ok((await firestore.collection('taxCodeUse').doc('C1').get()).data().GST18);
});

test('a return takes its share by quantity; the last of a line takes what is left, to the cent', async () => {
  await ready();
  const s = await sell([{ ItemID: 'I1', Quantity: 3, Discount: 3 }]);
  const sale = await val('stock/transactions/' + s.saleId);
  const back = (q) => call('u-admin', 'confirmRetailReturn', { saleId: s.saleId, Lines: [{ SaleLineNo: 1, Quantity: q }], reason: 'Wrong size' });
  const r1 = await back(1);
  assert.equal(r1.success, true, r1.error);
  const a = await val('stock/transactions/' + r1.returnId);
  assert.deepEqual([a.Total, a.TaxAmount, a.TaxComponents.map(c => c.Amount).join()], [51.5, 7.86, '3.93,3.93']);
  const r2 = await back(2);
  const b = await val('stock/transactions/' + r2.returnId);
  assert.equal(Math.round((a.TaxAmount + b.TaxAmount) * 100) / 100, sale.TaxAmount, 'the returns give back exactly the sale\'s tax');
  assert.equal(Math.round((a.DiscountNet + b.DiscountNet) * 100) / 100, sale.DiscountNet);
  const e = sums(await jv(b.LinkedJVID));
  assert.equal(e['2210'], b.TaxComponents.find(c => c.Component === 'CGST').Amount, 'CGST debited back');
});

test('an item without a tax code is refused', async () => {
  await ready();
  const r = await sell([{ ItemID: 'I3', Quantity: 1 }]).catch(e => ({ success: false, error: e.message }));
  assert.match(r.error, /FG-003 has no tax code: give it one in Item Master/);
});
