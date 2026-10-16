// Direct Retail Sales (owner, 2026-10-09; docs/modules/RETAIL_SALES.md,
// decisions 52-55): setup per company (the Retail Customer, default Sales
// Type, store, cost center, price list, tax %), payment methods mapped to
// ledgers; a counter sale with tax-inclusive prices and split payments,
// posted as one entry with the stock; a balance on account for an existing
// customer only; a whole sale reversed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore, rtdb } = require('./_helpers');

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
  // Counter staff: sell, but no "report" right (owner, 2026-10-09).
  f.roles.Cashier = { Name: 'Cashier', Status: 'Active' };
  f.users['u-cash1'] = { status: 'Active', role: 'Cashier', username: 'cash1', fullName: 'Cashier One', AssignedCompanies: ['C1'] };
  f.users['u-cash2'] = { status: 'Active', role: 'Cashier', username: 'cash2', fullName: 'Cashier Two', AssignedCompanies: ['C1'] };
  f.permissions.RETAILSALES.access.push('Cashier');
  f.permissions.RETAILSALES.post.push('Cashier');
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
  assert.deepEqual(reg.byMethod, [{ Name: 'Cash', Count: 1, Amount: 21 }]);
  assert.ok(reg.sales.some(x => x.SaleID === keep.saleId));
  await assert.rejects(call('u-other', 'getRetailSale', { saleId: r.saleId }), /do not have access to that company/);
});

test('counter staff see only the sales they billed; the "report" right sees everyone\'s, filtered by who billed; the payment-wise report', async () => {
  await ready();
  const a = await sell({ Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] }, 'u-cash1');
  const b = await sell({ Lines: [{ ItemID: 'I1', Quantity: 1 }], Payments: [{ MethodID: M.card, Amount: 30, Reference: 'C-7' }, { MethodID: M.cash, Amount: 30 }] }, 'u-cash2');
  const c = await sell({ CustomerID: 'CU1', Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.promo, Amount: 5, Reference: 'P5' }] }, 'u-cash2');
  const reg = (uid, extra) => call(uid, 'getRetailSales', Object.assign({ companyId: 'C1', from: DAY, to: DAY }, extra || {}));
  const mine = await reg('u-cash1');
  assert.deepEqual([mine.all, mine.billers, mine.sales.map(x => x.SaleID)], [false, [], [a.saleId]]);
  assert.deepEqual(mine.byMethod, [{ Name: 'Cash', Count: 1, Amount: 21 }]);
  // A filter by someone else is ignored without the right.
  assert.deepEqual((await reg('u-cash1', { billedBy: 'cash2' })).sales.map(x => x.SaleID), [a.saleId]);
  const everyone = await reg('u-admin');
  assert.deepEqual([everyone.all, everyone.billers, everyone.sales.length], [true, ['cash1', 'cash2'], 3]);
  const two = await reg('u-admin', { billedBy: 'cash2' });
  assert.deepEqual(two.sales.map(x => x.SaleID).sort(), [b.saleId, c.saleId].sort());
  // Payment-wise: each payment by method; the change comes off the cash.
  assert.deepEqual(two.payments.map(p => [p.Method, p.Reference, p.Amount, p.CreatedBy]),
    [['Card', 'C-7', 30, 'cash2'], ['Cash', '', 22.5, 'cash2'], ['Promotion Code', 'P5', 5, 'cash2']]);
  assert.deepEqual(two.byMethod, [{ Name: 'Card', Count: 1, Amount: 30 }, { Name: 'Cash', Count: 1, Amount: 22.5 }, { Name: 'Promotion Code', Count: 1, Amount: 5 }]);
  assert.deepEqual([two.total, two.onAccount], [73.5, 16]);
  // Another's sale can't be opened or reversed without the right.
  await assert.rejects(call('u-cash1', 'getRetailSale', { saleId: b.saleId }), /only the sales you billed yourself/);
  await assert.rejects(call('u-cash1', 'reverseRetailSale', { saleId: b.saleId, reason: 'x' }), /only the sales you billed yourself/);
  assert.equal((await call('u-cash1', 'getRetailSale', { saleId: a.saleId })).sale.SaleID, a.saleId);
  const setup = await call('u-cash1', 'getRetailSalesSetup', { companyId: 'C1' });
  assert.deepEqual([setup.canSell, setup.canSetup, setup.canReport], [true, false, false]);
  // A reversal by the manager drops the sale from the cashier's takings.
  await call('u-admin', 'reverseRetailSale', { saleId: a.saleId, reason: 'Wrong item', reversalDate: DAY });
  const after = await reg('u-cash1');
  assert.deepEqual([after.sales.map(x => x.SaleID), after.byMethod, after.payments], [[a.saleId], [], []]);
});

test('the counter gets each item\'s own barcodes, with a pack\'s units (docs/modules/ITEM_BARCODES.md)', async () => {
  await call('u-admin', 'saveItemBarcodes', { itemId: 'I1', barcodes: [{ Barcode: '6291041500213' }, { Barcode: '16291041500210', PackQty: 12 }] });
  const counter = await call('u-admin', 'getRetailCounter', { companyId: 'C1', date: DAY });
  assert.deepEqual(counter.items.map(i => [i.ItemCode, i.Barcodes]), [['FG-002', []], ['RM-001', [{ Barcode: '16291041500210', PackQty: 12 }, { Barcode: '6291041500213', PackQty: 1 }]]]);
});

test('discounts switched off in Setup are refused at the counter; on by default for a company already selling; the receipt settings come with the sale (owner, 2026-10-10, decisions 114-117)', async () => {
  await ready();
  // A company set up before the switch existed: discounts stay on.
  const raw = await val('retailSales/settings/C1');
  delete raw.AllowDiscount; delete raw.ReceiptPaper; delete raw.PrintOnConfirm; delete raw.ReceiptFooter;
  await require('./_helpers').rtdb.ref('retailSales/settings/C1').set(raw);
  const line = { ItemID: 'I2', Quantity: 1, Discount: 1 };
  const a = await sell({ Lines: [line], Payments: [{ MethodID: M.cash, Amount: 20 }] });
  assert.equal(a.total, 20);
  const old = await call('u-admin', 'getRetailSale', { saleId: a.saleId });
  assert.deepEqual(old.receipt, { Paper: 'A4', Footer: '', PrintOnConfirm: false }, 'the original layout until Setup says otherwise');
  // Saved again without the new fields (an older screen): still on.
  await settings();
  assert.equal((await val('retailSales/settings/C1')).AllowDiscount, true);
  // Switched off: a discount is refused, the sale without one goes through.
  await settings({ allowDiscount: false, receiptPaper: '80', receiptFooter: 'Thank you', printOnConfirm: true });
  await assert.rejects(sell({ Lines: [line], Payments: [{ MethodID: M.cash, Amount: 20 }] }), /discounts are switched off at the counter/);
  const b = await sell({ Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  const r = await call('u-admin', 'getRetailSale', { saleId: b.saleId });
  assert.deepEqual(r.receipt, { Paper: '80', Footer: 'Thank you', PrintOnConfirm: true });
  // The receipt paper is one of 80 mm, 58 mm or A4; the footer at most 200 characters.
  await assert.rejects(settings({ receiptPaper: '110' }), /receipt paper/);
  await assert.rejects(settings({ receiptFooter: 'x'.repeat(201) }), /at most 200/);
  // On again: discounts accepted.
  await settings({ allowDiscount: true });
  assert.equal((await sell({ Lines: [line], Payments: [{ MethodID: M.cash, Amount: 20 }] })).total, 20);
});

test('E: the counter finds customers by mobile; a new customer from the counter with Customer Master\'s write right; one mobile per customer of a company (decisions 160-161)', async () => {
  await ready();
  let c = await call('u-admin', 'getRetailCounter', { companyId: 'C1', date: DAY });
  assert.equal(c.canAddCustomer, true);
  assert.equal(c.customers.find(x => x.CustomerID === 'CU1').Phone, '');
  assert.equal((await call('u-cash1', 'getRetailCounter', { companyId: 'C1', date: DAY })).canAddCustomer, false);
  await assert.rejects(call('u-cash1', 'createRetailCustomer', { companyId: 'C1', name: 'Walk-in', mobile: '050 123 4567' }), /permission to add customers/);
  await assert.rejects(call('u-admin', 'createRetailCustomer', { companyId: 'C1', name: '', mobile: '050 123 4567' }), /customer's name/);
  await assert.rejects(call('u-admin', 'createRetailCustomer', { companyId: 'C1', name: 'Sam', mobile: '12' }), /at least 7 digits/);
  const r = await call('u-admin', 'createRetailCustomer', { companyId: 'C1', name: 'Sam Walker', mobile: '050 123 4567' });
  assert.deepEqual([r.customer.CustomerName, r.customer.CustomerCode, r.customer.Phone, r.customer.Retail], ['Sam Walker', 'CL-000003', '050 123 4567', false]);
  const rec = await val('customers/' + r.customer.CustomerID);
  assert.deepEqual([rec.Classification, rec.CompanyID, rec.TradeReceivablesAccountID, rec.Status, rec.CreatedBy], ['Local', 'C1', 'A-AR', 'Active', 'admin']);
  // The same number written another way: refused, naming its customer.
  await assert.rejects(call('u-admin', 'createRetailCustomer', { companyId: 'C1', name: 'Sam W', mobile: '+971 50 123 4567' }), /already Sam Walker's \(CL-000003\)/);
  c = await call('u-admin', 'getRetailCounter', { companyId: 'C1', date: DAY });
  assert.ok(c.customers.some(x => x.CustomerName === 'Sam Walker' && x.Phone === '050 123 4567'));
  // A sale to them.
  const sale = await sell({ CustomerID: r.customer.CustomerID, Lines: [{ ItemID: 'I1', Quantity: 1, UnitPrice: 52.5 }], Payments: [{ MethodID: M.cash, Amount: 52.5 }] });
  assert.equal(sale.success, true, sale.error);

  // Customer Master: the same rule (a changed or new number); another company may have it.
  const base = { CustomerName: 'Gamma LLC', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0, CompanyID: 'C1' };
  let s = await call('u-admin', 'saveCustomer', { customerData: Object.assign({}, base, { Phone: '00971501234567' }) });
  assert.equal(s.success, false);
  assert.match(s.error, /already Sam Walker's/);
  s = await call('u-other', 'saveCustomer', { customerData: Object.assign({}, base, { Phone: '050 123 4567', CompanyID: 'C2' }) });
  assert.equal(s.success, true, s.error);
  s = await call('u-admin', 'saveCustomer', { customerData: Object.assign({}, base, { CustomerID: 'CU1', CustomerName: 'Beta Trading', Phone: '0501234567' }) });
  assert.match(s.error || '', /already Sam Walker's/, 'an existing customer changed to the number');
  // Saved before the rule: two with one number keep saving while the number doesn't change.
  await rtdb.ref('customers/CU1/Phone').set('050 123 4567');
  s = await call('u-admin', 'saveCustomer', { customerData: Object.assign({}, base, { CustomerID: 'CU1', CustomerName: 'Beta Trading LLC', Phone: '050 123 4567' }) });
  assert.equal(s.success, true, s.error);
});
