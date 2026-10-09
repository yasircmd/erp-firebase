// Retail Sales, partial returns (owner, 2026-10-09; docs/modules/RETAIL_SALES.md,
// decisions 76-79): the sale found by its invoice number; part of it back
// at what the customer paid for it (the discount and tax shares, the last
// unit taking the remainder); the refund the original way pro rata, a
// promotion reversed, card or QR paid out as cash on request; an open
// on-account balance reduced first; a "return" right and a return period;
// a return reversed whole; the register and cash-up net of returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });

const TODAY = new Date().toISOString().substring(0, 10);
const daysAgo = n => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().substring(0, 10); };
const stockAt = async (i, w) => { const l = await val('stock/ledger/' + i + '/' + w); return [l.Quantity, l.TotalValue]; };
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
    'A-SRET': { AccountCode: '4050', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISC', OutputTaxAccountID: 'A-VATOUT' });
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', SalesCogsAccountID: 'A-COGS' };
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } }, I2: { WH1: { Quantity: 4, AvgCost: 7.5, TotalValue: 30 } } } };
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Local Sales', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' } };
  f.customers = { CU1: { CustomerCode: 'CL-000001', CustomerName: 'Beta Trading', Classification: 'Local', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  f.customerCounters = { CL: 1 };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active' } };
  f.priceListLines = {
    P1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 52.5, EffectiveFrom: '2026-01-01', Status: 'Active' },
    P2: { PriceListID: 'PL1', ItemCode: 'FG-002', UnitPrice: 21, EffectiveFrom: '2026-01-01', Status: 'Active' }
  };
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
const sell = (sale, uid) => call(uid || 'u-admin', 'confirmRetailSale', Object.assign({ CompanyID: 'C1', SaleDate: TODAY }, sale));
const numberOf = async saleId => (await val('stock/transactions/' + saleId)).TransactionNumber;
const ret = (saleId, lines, extra, uid) => call(uid || 'u-admin', 'confirmRetailReturn', Object.assign({ saleId, Lines: lines, reason: 'Wrong size' }, extra || {}));

// 3 × 52.50 less 3.00 + 2 × 21.00 = 196.50 (tax 5% inside: 9.36); paid card
// 100, promotion 10, cash 100 (change 13.50, so cash posts 86.50).
const bigSale = (uid) => sell({
  Lines: [{ ItemID: 'I1', Quantity: 3, Discount: 3 }, { ItemID: 'I2', Quantity: 2 }],
  Payments: [{ MethodID: M.card, Amount: 100, Reference: 'C-1' }, { MethodID: M.promo, Amount: 10, Reference: 'P-1' }, { MethodID: M.cash, Amount: 100 }]
}, uid);

test('finding the sale by its invoice number (decision 76): the "return" right; typed or scanned, any cashier\'s sale; not a reversed one', async () => {
  await ready();
  const a = await bigSale('u-cash1');
  const number = await numberOf(a.saleId);
  const t = await val('stock/transactions/' + a.saleId);
  // Without the right (decision 78: Admin and Finance Manager by default).
  await assert.rejects(call('u-cash2', 'findRetailSaleForReturn', { companyId: 'C1', number }), /right to take returns/);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { preview: true }, 'u-cash2'), /right to take returns/);
  assert.equal((await call('u-cash2', 'getRetailSalesSetup', { companyId: 'C1' })).canReturn, false);
  await rtdb.ref('permissions/RETAILSALES/return').set(['Admin', 'Cashier']);
  // Another cashier finds it by its exact number, lower case and padded too; or by its TXN reference.
  const found = await call('u-cash2', 'findRetailSaleForReturn', { companyId: 'C1', number: '  ' + number.toLowerCase() + ' ' });
  assert.equal(found.sale.SaleID, a.saleId);
  assert.equal((await call('u-cash2', 'findRetailSaleForReturn', { companyId: 'C1', number: t.TransactionRef })).sale.SaleID, a.saleId);
  assert.deepEqual(found.sale.Lines.map(l => [l.ItemCode, l.Quantity, l.Returned, l.Left]), [['RM-001', 3, 0, 3], ['FG-002', 2, 0, 2]]);
  assert.deepEqual(found.sale.Payments.map(p => [p.Name, p.Posted]), [['Card', 100], ['Promotion Code', 10], ['Cash', 86.5]]);
  assert.deepEqual([found.sale.CreatedBy, found.sale.ReturnBy, found.returns], ['cash1', '', []]);
  // Browsing it still needs the "report" right.
  await assert.rejects(call('u-cash2', 'getRetailSale', { saleId: a.saleId }), /only the sales you billed yourself/);
  await assert.rejects(call('u-cash2', 'findRetailSaleForReturn', { companyId: 'C1', number: 'RS-NOPE' }), /No retail sale RS-NOPE in this company/);
  await assert.rejects(call('u-other', 'findRetailSaleForReturn', { companyId: 'C1', number }), /right to take returns|access to that company/);
  // A reversed sale, or the reversal itself, has nothing to return.
  const b = await sell({ Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  const rev = await call('u-admin', 'reverseRetailSale', { saleId: b.saleId, reason: 'x', reversalDate: TODAY });
  await assert.rejects(call('u-admin', 'findRetailSaleForReturn', { companyId: 'C1', number: await numberOf(b.saleId) }), /has been reversed; there is nothing to return/);
  await assert.rejects(call('u-admin', 'findRetailSaleForReturn', { companyId: 'C1', number: rev.saleNumber }), /is the reversal of a sale/);
  // The receipt carries the number as a barcode for the scan.
  const opened = await call('u-admin', 'getRetailSale', { saleId: a.saleId });
  assert.match(opened.numberBarcode, /^<svg /);
  assert.ok(opened.numberBarcode.includes('>' + number + '</text>'));
});

test('a partial return (decision 77): what was paid for the units, tax and discount shares; refund pro rata, the promotion reversed, card paid as cash; one entry with the stock', async () => {
  await ready();
  const a = await bigSale();
  // A preview writes nothing.
  const pv = await ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { preview: true });
  assert.deepEqual([pv.preview, pv.total, pv.tax, pv.onAccountReduced, pv.creditOnAccount], [true, 51.5, 2.45, 0, 0]);
  // 51.50 of 196.50: card 100 → 26.21, promotion 10 → 2.62, cash 86.50 → 22.67.
  assert.deepEqual(pv.refunds.map(f => [f.FromName, f.Name, f.Amount]), [['Card', 'Card', 26.21], ['Promotion Code', 'Promotion Code', 2.62], ['Cash', 'Cash', 22.67]]);
  assert.equal(Object.values((await val('stock/transactions')) || {}).filter(t => t.TransactionType === 'RetailReturn').length, 0);
  assert.deepEqual(await stockAt('I1', 'WH1'), [7, 140]);

  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { reason: '' }), /reason for the return/);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 4 }]), /RM-001: only 3 left to return/);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 0 }]), /quantity to return on at least one line/);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }, { SaleLineNo: 1, Quantity: 1 }]), /given once/);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 0.5 }]), /does not allow decimal/);
  // The promotion can't be paid out; card only the same way or as cash.
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { PayAs: { 1: M.cash } }), /a promotion is reversed, not paid out/);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { PayAs: { 0: M.promo } }), /the same way or in cash only/);

  // The card terminal is down: the card's share goes back in cash.
  const r1 = await ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { PayAs: { 0: M.cash }, References: { 2: 'drawer 1' } });
  assert.match(r1.returnNumber, /^RR-/);
  assert.deepEqual(r1.refunds.map(f => [f.FromName, f.Name, f.Amount]), [['Card', 'Cash', 26.21], ['Promotion Code', 'Promotion Code', 2.62], ['Cash', 'Cash', 22.67]]);
  const t1 = await val('stock/transactions/' + r1.returnId);
  assert.deepEqual([t1.TransactionType, t1.Status, t1.ReturnOfSaleID, t1.Reason, t1.Total, t1.TaxAmount, t1.DiscountNet, t1.Revenue, t1.CostValue],
    ['RetailReturn', 'Posted', a.saleId, 'Wrong size', 51.5, 2.45, 0.95, 50, 20]);
  assert.deepEqual(t1.Lines.map(l => [l.SaleLineNo, l.Direction, l.Quantity, l.ListAmount, l.Discount, l.Amount, l.UnitCost]), [[1, 'In', 1, 52.5, 1, 51.5, 20]]);
  assert.equal(t1.Refunds[2].Reference, 'drawer 1');
  // Stock back at the cost it left at.
  assert.deepEqual(await stockAt('I1', 'WH1'), [8, 160]);
  const e1 = await jv(t1.LinkedJVID);
  assert.deepEqual([e1.VoucherType, e1.JVNumber.slice(0, 3), e1.Reference, /^TXN-/.test(e1.TransactionRef)], ['RetailReturn', 'RR-', await numberOf(a.saleId), true]);
  // Dr Sales Returns 50.00, Cr Discount 0.95, Dr VAT 2.45; Cr cash 26.21 + 22.67, Cr promotion 2.62; Dr inventory / Cr COGS 20.
  assert.deepEqual(sums(e1), { 4050: 50, 4100: -0.95, 2200: 2.45, 1000: -48.88, 6200: -2.62, 1300: 20, 5000: -20 });
  assert.equal(e1.Lines.filter(l => l.AccountCode === '1000').length, 2, 'each refund row its own line');

  // A whole reversal is refused once part has come back.
  await assert.rejects(call('u-admin', 'reverseRetailSale', { saleId: a.saleId, reason: 'x', reversalDate: TODAY }), /Part of this sale has been returned \(RR-[^)]+\); return the rest/);
  const again = await call('u-admin', 'findRetailSaleForReturn', { companyId: 'C1', number: await numberOf(a.saleId) });
  assert.deepEqual(again.sale.Lines.map(l => [l.Returned, l.Left]), [[1, 2], [0, 2]]);
  assert.deepEqual(again.sale.Payments.map(p => p.Refunded), [26.21, 2.62, 22.67]);
  assert.deepEqual(again.returns.map(r => [r.TransactionNumber, r.Total]), [[r1.returnNumber, 51.5]]);

  // The rest: the last units take the exact remainder, so the returns add up to the sale.
  const r2 = await ret(a.saleId, [{ SaleLineNo: 1, Quantity: 2 }, { SaleLineNo: 2, Quantity: 2 }]);
  const t2 = await val('stock/transactions/' + r2.returnId);
  assert.deepEqual([t2.Total, t2.TaxAmount, t2.DiscountNet, t2.Revenue], [145, 6.91, 1.91, 140]);
  assert.deepEqual(r2.refunds.map(f => [f.Name, f.Amount]), [['Card', 73.79], ['Promotion Code', 7.38], ['Cash', 63.83]]);
  const sale = await val('stock/transactions/' + a.saleId);
  assert.deepEqual([t1.Total + t2.Total, Math.round((t1.TaxAmount + t2.TaxAmount) * 100) / 100, t1.Revenue + t2.Revenue], [sale.Total, sale.TaxAmount, sale.Revenue]);
  assert.deepEqual(await stockAt('I1', 'WH1'), [10, 200]);
  assert.deepEqual(await stockAt('I2', 'WH1'), [4, 30]);
  await assert.rejects(ret(a.saleId, [{ SaleLineNo: 2, Quantity: 1 }]), /FG-002: everything sold has been returned/);
});

test('an existing customer\'s open balance is reduced first; one settled meanwhile becomes a credit on account', async () => {
  await ready();
  // 52.50, 20 in cash, 32.50 left on account: the return takes the 32.50 off and gives 20 back.
  const a = await sell({ CustomerID: 'CU1', Lines: [{ ItemID: 'I1', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 20 }] });
  const r = await ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }]);
  assert.deepEqual([r.onAccountReduced, r.creditOnAccount, r.refunds.map(f => [f.Name, f.Amount])], [32.5, 0, [['Cash', 20]]]);
  const t = await val('stock/transactions/' + r.returnId);
  const e = await jv(t.LinkedJVID);
  const saleJv = (await val('stock/transactions/' + a.saleId)).LinkedJVID;
  const saleE = await jv(saleJv);
  const ar = e.Lines.find(l => l.AccountCode === '1200');
  const saleAr = saleE.Lines.find(l => l.AccountCode === '1200');
  assert.deepEqual([ar.Credit, ar.PartyID, ar.Allocations], [32.5, 'CU1', [{ RefType: 'Against', RefID: 'NewRef:' + saleJv + ':' + saleAr.LineNo, Amount: 32.5, RefNumber: await numberOf(a.saleId) }]]);
  assert.deepEqual([e.PartyKeys, e.AllocatedRefTypes], [['Customer:CU1'], ['NewRef']]);
  assert.deepEqual(sums(e), { 4050: 50, 2200: 2.5, 1200: -32.5, 1000: -20, 1300: 20, 5000: -20 });
  const soa = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', companyId: 'C1', partyId: 'CU1', fromDate: TODAY, toDate: TODAY });
  assert.deepEqual([soa.Closing, soa.Rows.map(x => x.Type)], [0, ['Retail Sale', 'Retail Return']]);

  // 2 × 52.50 = 105, 5 in cash, 100 on account. Half back: all 52.50 off the account, nothing paid out.
  const b = await sell({ CustomerID: 'CU1', Lines: [{ ItemID: 'I1', Quantity: 2 }], Payments: [{ MethodID: M.cash, Amount: 5 }] });
  const half = await ret(b.saleId, [{ SaleLineNo: 1, Quantity: 1 }]);
  assert.deepEqual([half.onAccountReduced, half.creditOnAccount, half.refunds], [52.5, 0, []]);
  // The customer pays the 47.50 left; then returns the other unit: 5 back in cash, 47.50 as a credit on account.
  const bJv = (await val('stock/transactions/' + b.saleId)).LinkedJVID;
  const bAr = (await jv(bJv)).Lines.find(l => l.AccountCode === '1200');
  const rc = await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Receipt', SelectedAccountCode: '1100', JVDate: TODAY, Description: 'Receipt', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '1200', Amount: 47.5, Description: 'Receipt', PartyType: 'Customer', PartyID: 'CU1', Allocations: [{ RefType: 'Against', RefID: 'NewRef:' + bJv + ':' + bAr.LineNo, Amount: 47.5 }] }] } });
  assert.equal(rc.success, true, rc.error);
  const rcPost = await call('u-admin', 'postJournalEntry', { jvId: rc.jvId });
  assert.equal(rcPost.success, true, rcPost.error);
  const rest = await ret(b.saleId, [{ SaleLineNo: 1, Quantity: 1 }]);
  assert.deepEqual([rest.onAccountReduced, rest.creditOnAccount, rest.refunds.map(f => [f.Name, f.Amount])], [0, 47.5, [['Cash', 5]]]);
  const re = await jv((await val('stock/transactions/' + rest.returnId)).LinkedJVID);
  assert.deepEqual(re.Lines.find(l => l.AccountCode === '1200').Allocations, [{ RefType: 'New', RefID: '', Amount: 47.5 }]);
  const soa2 = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', companyId: 'C1', partyId: 'CU1', fromDate: TODAY, toDate: TODAY });
  assert.equal(soa2.Closing, -47.5);
});

test('the return period (decision 78); a return reversed whole; the register and cash-up net of returns', async () => {
  await ready({ returnDays: 3 });
  await assert.rejects(settings({ returnDays: -1 }), /return period in whole days/);
  await assert.rejects(settings({ returnDays: 1.5 }), /return period in whole days/);
  assert.equal((await call('u-admin', 'getRetailSalesSetup', { companyId: 'C1' })).settings.ReturnDays, 3);
  const old = await sell({ SaleDate: daysAgo(4), Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  const found = await call('u-admin', 'findRetailSaleForReturn', { companyId: 'C1', number: await numberOf(old.saleId) });
  assert.equal(found.sale.ReturnBy, daysAgo(1));
  await assert.rejects(ret(old.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { preview: true }), /past the return period of 3 days/);
  const inTime = await sell({ SaleDate: daysAgo(3), Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  assert.equal((await ret(inTime.saleId, [{ SaleLineNo: 1, Quantity: 1 }], { preview: true })).total, 21);

  const a = await sell({ Lines: [{ ItemID: 'I1', Quantity: 2 }], Payments: [{ MethodID: M.card, Amount: 105, Reference: 'C-9' }] });
  const r = await ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }]);
  assert.deepEqual(r.refunds.map(f => [f.Name, f.Amount]), [['Card', 52.5]]);
  // The register: the return shows negative under the method it was paid back by.
  let reg = await call('u-admin', 'getRetailSales', { companyId: 'C1', from: TODAY, to: TODAY });
  const row = reg.sales.find(x => x.SaleID === r.returnId);
  assert.deepEqual([row.Return, row.ReturnOf, row.Total, row.Payments.map(p => [p.Name, p.Posted])], [true, await numberOf(a.saleId), -52.5, [['Card', -52.5]]]);
  assert.deepEqual(reg.byMethod.find(m => m.Name === 'Card'), { Name: 'Card', Count: 2, Amount: 52.5 });
  assert.deepEqual([reg.total, reg.returns], [52.5, 52.5]);
  // The return opens from the register and from its journal.
  const opened = await call('u-admin', 'getRetailSale', { saleId: r.returnId });
  assert.deepEqual([opened.sale.TransactionType, opened.numberBarcode], ['RetailReturn', '']);
  assert.equal((await call('u-admin', 'getRetailSale', { jvId: opened.sale.LinkedJVID })).sale.SaleID, r.returnId);

  await assert.rejects(call('u-admin', 'reverseRetailReturn', { returnId: r.returnId }), /reason for reversing the return/);
  await assert.rejects(call('u-admin', 'reverseRetailSale', { saleId: r.returnId, reason: 'x' }), /reversed from the return itself/);
  const rev = await call('u-admin', 'reverseRetailReturn', { returnId: r.returnId, reason: 'Keyed by mistake' });
  assert.match(rev.returnNumber, /^RR-/);
  const t = await val('stock/transactions/' + r.returnId), back = await val('stock/transactions/' + rev.returnId);
  assert.deepEqual([t.ReversedByReturnID, back.ReversalOfReturnID, back.Lines[0].Direction, back.Status], [rev.returnId, r.returnId, 'Out', 'Posted']);
  const e = await jv(t.LinkedJVID), re = await jv(back.LinkedJVID);
  assert.equal(e.ReversedByJV, back.LinkedJVID);
  Object.entries(sums(e)).forEach(([k, v]) => assert.equal(sums(re)[k], -v, k));
  assert.deepEqual(await stockAt('I1', 'WH1'), [8, 160]);
  await assert.rejects(call('u-admin', 'reverseRetailReturn', { returnId: r.returnId, reason: 'again' }), /already been reversed/);
  await assert.rejects(call('u-admin', 'reverseRetailReturn', { returnId: rev.returnId, reason: 'x' }), /cannot itself be reversed/);
  // Both drop out of the takings; the unit can be returned again.
  reg = await call('u-admin', 'getRetailSales', { companyId: 'C1', from: TODAY, to: TODAY });
  assert.deepEqual([reg.total, reg.returns, reg.byMethod.find(m => m.Name === 'Card')], [105, 0, { Name: 'Card', Count: 1, Amount: 105 }]);
  const after = await call('u-admin', 'findRetailSaleForReturn', { companyId: 'C1', number: await numberOf(a.saleId) });
  assert.deepEqual([after.sale.Lines[0].Left, after.returns], [2, []]);
  // Once nothing is returned, the whole sale can be reversed again.
  assert.equal((await call('u-admin', 'reverseRetailSale', { saleId: a.saleId, reason: 'x', reversalDate: TODAY })).success, true);
});

test('a return reversed is refused when the stock it took back has been sold again', async () => {
  await ready();
  const a = await sell({ Lines: [{ ItemID: 'I2', Quantity: 4 }], Payments: [{ MethodID: M.cash, Amount: 84 }] });
  const r = await ret(a.saleId, [{ SaleLineNo: 1, Quantity: 1 }]);
  assert.deepEqual(await stockAt('I2', 'WH1'), [1, 7.5]);
  await sell({ Lines: [{ ItemID: 'I2', Quantity: 1 }], Payments: [{ MethodID: M.cash, Amount: 21 }] });
  await assert.rejects(call('u-admin', 'reverseRetailReturn', { returnId: r.returnId, reason: 'x' }), /insufficient stock for FG-002/);
  assert.equal((await val('stock/transactions/' + r.returnId)).ReversedByReturnID, undefined);
});
