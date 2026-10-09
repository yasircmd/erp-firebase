// Direct Retail Sales (owner, 2026-10-09; docs/modules/RETAIL_SALES.md,
// decisions 52-55): setup per company (the Retail Customer, default Sales
// Type, store, cost center, price list, tax %), payment methods mapped to
// ledgers; a counter sale with tax-inclusive prices and split payments,
// posted as one entry with the stock; a balance on account for an existing
// customer only; a whole sale reversed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });

const DAY = '2026-10-09';
const stockAt = async (i, w) => { const l = await val('stock/ledger/' + i + '/' + w); return { Quantity: l.Quantity, AvgCost: l.AvgCost, TotalValue: l.TotalValue }; };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const sums = e => {
  const out = {};
  e.Lines.forEach(l => { out[l.AccountCode] = Math.round(((out[l.AccountCode] || 0) + (l.Debit || 0) - (l.Credit || 0)) * 100) / 100; });
  return out;
};

function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-CARD': { AccountCode: '1150', AccountName: 'Card Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-PROMO': { AccountCode: '6200', AccountName: 'Promotional Discounts', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-DISC': { AccountCode: '4100', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-REVX': { AccountCode: '4010', AccountName: 'Export Sales', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISC', OutputTaxAccountID: 'A-VATOUT' });
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', SalesCogsAccountID: 'A-COGS' };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } }, I2: { WH1: { Quantity: 4, AvgCost: 7.5, TotalValue: 30 } } } };
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' }, CX: { Name: 'Export', IsExport: true, Status: 'Active', CompanyID: '' } };
  f.salesTypes = {
    ST1: { Name: 'Local Sales', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' },
    STX: { Name: 'Export Sales', GLAccountID: 'A-REVX', SalesReturnsAccountID: 'A-REVX', Status: 'Active', CompanyID: 'C1', RestrictedToClassificationID: 'CX' }
  };
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Beta Trading', Classification: 'Local', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', AddressLine1: 'Dubai', TaxRegistrationNumber: '100200300' } };
  f.customerCounters = { CL: 1 };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active' } };
  f.priceListLines = {
    P1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 50, EffectiveFrom: '2026-01-01', Status: 'Active' },
    P2: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 52.5, EffectiveFrom: '2026-10-01', Status: 'Active' },
    P3: { PriceListID: 'PL1', ItemCode: 'FG-002', UnitPrice: 21, EffectiveFrom: '2026-01-01', Status: 'Active' }
  };
  return f;
}
const settings = (extra) => call('u-admin', 'saveRetailSalesSettings', Object.assign({
  companyId: 'C1', salesTypeId: 'ST1', warehouseId: 'WH1', costCenterId: 'CC1', receivablesAccountId: 'A-AR', priceListId: 'PL1', taxPercent: 5
}, extra || {}));
const method = (Name, Kind, AccountID, extra) => call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: Object.assign({ Name, Kind, AccountID }, extra || {}) });
let M = {};
async function ready(extra) {
  await reset(fixture());
  await settings(extra);
  M = {
    cash: (await method('Cash', 'Cash', 'A-CASH')).methodId,
    card: (await method('Card', 'Card', 'A-CARD', { NeedsReference: true })).methodId,
    promo: (await method('Promotion Code', 'Promotion', 'A-PROMO')).methodId
  };
}
const sell = (sale, uid) => call(uid || 'u-admin', 'confirmRetailSale', Object.assign({ CompanyID: 'C1', SaleDate: DAY }, sale));

test('setup: rights; the Retail Customer made once in Customer Master; payment methods mapped to suitable ledgers', async () => {
  await reset(fixture());
  await assert.rejects(call('u-viewer', 'saveRetailSalesSettings', { companyId: 'C1' }), /permission to change the Retail Sales setup/);
  assert.equal((await call('u-admin', 'getRetailSalesSetup', { companyId: 'C1' })).settings, null);
  await assert.rejects(settings({ costCenterId: '' }), /cost center/);
  await assert.rejects(settings({ salesTypeId: 'STX' }), /must fit the Retail Customer \(Local\)/);
  await assert.rejects(settings({ taxPercent: -1 }), /tax %/);
  await assert.rejects(call('u-other', 'saveRetailSalesSettings', { companyId: 'C1' }), /do not have access to that company/);
  const first = await settings();
  const again = await settings({ taxPercent: 0 });
  assert.equal(first.retailCustomerId, again.retailCustomerId);
  const c = await val('customers/' + first.retailCustomerId);
  assert.deepEqual([c.CustomerName, c.CustomerCode, c.Classification, c.CompanyID, c.TradeReceivablesAccountID, c.Status], ['Retail Customer', 'CL-000002', 'Local', 'C1', 'A-AR', 'Active']);
  await assert.rejects(method('Promo', 'Promotion', 'A-CASH'), /a promotion posts to an expense account/);
  await assert.rejects(method('Cash', 'Cash', 'A-PROMO'), /cash posts to an asset account/);
  await assert.rejects(method('Cash', 'Bitcoin', 'A-CASH'), /what kind of payment/);
  await method('Cash', 'Cash', 'A-CASH');
  await assert.rejects(method('cash', 'Cash', 'A-BANK'), /already a payment method "cash"/);
  const p = (await method('Promotion Code', 'Promotion', 'A-PROMO')).methodId;
  assert.equal((await val('retailSales/paymentMethods/' + p)).NeedsReference, true);
  const s = await call('u-viewer', 'getRetailSalesSetup', { companyId: 'C1' });
  assert.deepEqual([s.methods.map(m => m.Name), s.retailCustomer.CustomerName, s.canSell, s.canSetup], [['Cash', 'Promotion Code'], 'Retail Customer', false, false]);
});

test('a Retail Customer sale: tax-inclusive prices, split across cash (over-tendered), card and a promotion; one entry with the stock', async () => {
  await ready();
  const counter = await call('u-admin', 'getRetailCounter', { companyId: 'C1', date: DAY });
  assert.deepEqual(counter.items.map(i => [i.ItemCode, i.Price, i.InStock]), [['FG-002', 21, 4], ['RM-001', 52.5, 10]]);
  assert.equal(counter.customers[0].CustomerName, 'Retail Customer');
  // 2 × 52.5 + 1 × 21 − 5 discount = 121 (tax 5% inside: 5.76).
  const r = await sell({
    Lines: [{ ItemID: 'I1', Quantity: 2, UnitPrice: 999, Discount: 5 }, { ItemID: 'I2', Quantity: 1 }],
    Payments: [{ MethodID: M.card, Amount: 60, Reference: 'SLIP-1' }, { MethodID: M.promo, Amount: 10, Reference: 'WELCOME10' }, { MethodID: M.cash, Amount: 100 }]
  });
  assert.deepEqual([r.total, r.change, r.onAccount], [121, 49, 0]);
  assert.match(r.saleNumber, /^RS-26-01-\d{6}$/);
  const t = await val('stock/transactions/' + r.saleId);
  assert.deepEqual([t.Status, t.Total, t.TaxAmount, t.Discount, t.DiscountNet, t.Revenue, t.Paid, t.Change, t.CostValue],
    ['Posted', 121, 5.76, 5, 4.76, 120, 170, 49, 47.5]);
  assert.deepEqual(t.Lines.map(l => [l.ItemCode, l.UnitPrice, l.Amount, l.UnitCost, l.Direction]), [['RM-001', 52.5, 100, 20, 'Out'], ['FG-002', 21, 21, 7.5, 'Out']]);
  assert.deepEqual(t.Payments.map(p => [p.Name, p.Amount, p.Posted]), [['Card', 60, 60], ['Promotion Code', 10, 10], ['Cash', 100, 51]]);
  const e = await jv(t.LinkedJVID);
  assert.deepEqual([e.VoucherType, e.Status], ['RetailSale', 'Posted']);
  assert.match(e.TransactionRef, /^TXN-\d{8}$/);
  assert.deepEqual(sums(e), { 1000: 51, 1150: 60, 6200: 10, 4100: 4.76, 4000: -120, 2200: -5.76, 5000: 47.5, 1300: -47.5 });
  assert.ok(e.Lines.filter(l => ['4000', '5000', '6200', '4100'].includes(l.AccountCode)).every(l => l.CostCenterID === 'CC1'));
  assert.deepEqual(await stockAt('I1', 'WH1'), { Quantity: 8, AvgCost: 20, TotalValue: 160 });
  assert.deepEqual(await stockAt('I2', 'WH1'), { Quantity: 3, AvgCost: 7.5, TotalValue: 22.5 });
  // The GL report opens it in Retail Sales, which finds it from the journal.
  const report = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-CASH', FromDate: DAY, ToDate: DAY } });
  assert.equal(report.rows.find(x => x.JVID === t.LinkedJVID).SourceModule, 'RETAILSALES');
  assert.equal((await call('u-admin', 'getRetailSale', { jvId: t.LinkedJVID })).sale.SaleID, r.saleId);
  const jr = await call('u-admin', 'reverseJournalEntry', { jvId: t.LinkedJVID, reversalDate: DAY });
  assert.match(jr.error, /posted by RetailSale — reverse it from that module/);
});

test('the counter refuses: short payment by the Retail Customer, over-tendering without cash, a missing reference, no stock, no price, a restricted Sales Type, prices changed when not allowed', async () => {
  await ready();
  const line = [{ ItemID: 'I2', Quantity: 1 }];
  await assert.rejects(sell({ Lines: line, Payments: [{ MethodID: M.cash, Amount: 20 }] }), /short of the total 21\.00: the Retail Customer pays in full/);
  await assert.rejects(sell({ Lines: line, Payments: [{ MethodID: M.card, Amount: 30, Reference: 'X' }] }), /only cash can be over-tendered/);
  await assert.rejects(sell({ Lines: line, Payments: [{ MethodID: M.card, Amount: 21 }] }), /Card: enter its reference/);
  await assert.rejects(sell({ Lines: line, Payments: [{ MethodID: M.promo, Amount: 21 }] }), /the promotion code/);
  await assert.rejects(sell({ Lines: [{ ItemID: 'I2', Quantity: 5 }], Payments: [{ MethodID: M.cash, Amount: 105 }] }), /insufficient stock for FG-002 at this warehouse — available 4, requested 5/);
  await assert.rejects(sell({ Lines: [{ ItemID: 'I2', Quantity: 1.5 }], Payments: [{ MethodID: M.cash, Amount: 50 }] }), /PCS does not allow decimal quantities/);
  await assert.rejects(sell({ SaleDate: '2025-12-31', Lines: line, Payments: [{ MethodID: M.cash, Amount: 50 }] }), /FG-002 has no price on the retail price list for 2025-12-31/);
  await assert.rejects(sell({ SalesTypeID: 'STX', Lines: line, Payments: [{ MethodID: M.cash, Amount: 50 }] }), /"Export Sales" is restricted to Export customers/);
  await assert.rejects(sell({ Lines: line, Payments: [{ MethodID: M.cash, Amount: 50 }] }, 'u-viewer'), /permission to sell or reverse/);
  assert.equal(Object.values((await val('stock/transactions')) || {}).length, 0);
  // With price changes allowed, the counter's price stands.
  await settings({ allowPriceChange: true });
  const r = await sell({ Lines: [{ ItemID: 'I2', Quantity: 1, UnitPrice: 18 }], Payments: [{ MethodID: M.cash, Amount: 18 }] });
  assert.equal(r.total, 18);
});

test('an existing customer may leave a balance on account (decision 52); the customer details print only when entered', async () => {
  await ready();
  const r = await sell({
    CustomerID: 'CU1', BillToName: 'Beta Trading', BillToTaxNumber: '100200300',
    Lines: [{ ItemID: 'I1', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 20 }]
  });
  assert.deepEqual([r.total, r.onAccount], [52.5, 32.5]);
  const t = await val('stock/transactions/' + r.saleId);
  assert.deepEqual([t.BillToName, t.BillToAddress, t.BillToTaxNumber, t.RetailCustomer], ['Beta Trading', '', '100200300', false]);
  const e = await jv(t.LinkedJVID);
  const ar = e.Lines.find(l => l.AccountCode === '1200');
  assert.deepEqual([ar.Debit, ar.PartyType, ar.PartyID, ar.Allocations], [32.5, 'Customer', 'CU1', [{ RefType: 'New', RefID: '', Amount: 32.5 }]]);
  assert.deepEqual(e.PartyKeys, ['Customer:CU1']);
  const soa = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', companyId: 'C1', partyId: 'CU1', fromDate: DAY, toDate: DAY });
  assert.equal(soa.Closing, 32.5);
  assert.deepEqual(soa.Rows.map(x => x.Type), ['Retail Sale']);
  // The Retail Customer's sale: no customer block stored.
  const rr = await sell({ Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  const rt = await val('stock/transactions/' + rr.saleId);
  assert.deepEqual([rt.BillToName, rt.BillToAddress, rt.BillToTaxNumber, rt.RetailCustomer], ['', '', '', true]);
});

test('a whole sale reversed (decision 55): stock back at its cost, every line mirrored; once only; the cash-up leaves it out', async () => {
  await ready();
  const keep = await sell({ Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  const r = await sell({ Lines: [{ ItemID: 'I1', Quantity: 3 }], Payments: [{ MethodID: M.card, Amount: 157.5, Reference: 'S2' }] });
  await assert.rejects(call('u-admin', 'reverseRetailSale', { saleId: r.saleId }), /reason/);
  await assert.rejects(call('u-admin', 'reverseRetailSale', { saleId: r.saleId, reason: 'x', reversalDate: '2026-10-01' }), /can't be before the sale/);
  const rev = await call('u-admin', 'reverseRetailSale', { saleId: r.saleId, reason: 'Customer changed mind', reversalDate: DAY });
  assert.match(rev.saleNumber, /^RS-/);
  const t = await val('stock/transactions/' + r.saleId);
  const back = await val('stock/transactions/' + rev.saleId);
  assert.deepEqual([t.ReversedBySaleID, back.ReversalOfSaleID, back.Status, back.Lines[0].Direction], [rev.saleId, r.saleId, 'Posted', 'In']);
  const e = await jv(t.LinkedJVID), re = await jv(back.LinkedJVID);
  assert.equal(e.ReversedByJV, back.LinkedJVID);
  assert.equal(re.ReversalOfJV, t.LinkedJVID);
  const neg = Object.fromEntries(Object.entries(sums(e)).map(([k, v]) => [k, -v]));
  assert.deepEqual(sums(re), neg);
  assert.deepEqual(await stockAt('I1', 'WH1'), { Quantity: 10, AvgCost: 20, TotalValue: 200 });
  await assert.rejects(call('u-admin', 'reverseRetailSale', { saleId: r.saleId, reason: 'again' }), /already been reversed/);
  await assert.rejects(call('u-admin', 'reverseRetailSale', { saleId: rev.saleId, reason: 'again' }), /cannot itself be reversed/);
  const reg = await call('u-admin', 'getRetailSales', { companyId: 'C1', from: DAY, to: DAY });
  assert.equal(reg.sales.length, 3);
  assert.deepEqual(reg.byMethod, [{ Name: 'Cash', Amount: 21 }]);
  assert.ok(reg.sales.some(x => x.SaleID === keep.saleId));
  await assert.rejects(call('u-other', 'getRetailSale', { saleId: r.saleId }), /do not have access to that company/);
});
