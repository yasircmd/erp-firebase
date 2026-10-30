// Line tax on purchases (docs/modules/TAX_ENGINE.md, part 3; Q313-Q318,
// Q323-Q324), India GST on company C1 (Maharashtra, 27): a Vendor Invoice's
// GRN line taxed by its item's code and a direct line by its account's;
// CGST + SGST from a vendor in the state, IGST from another; posted to each
// component's input account; input tax that can't be reclaimed added to the
// goods' cost (a value-only stock line) or, with no stock left, to the
// item's consumption account, and on a direct line to its own account;
// reverse charge (output and input both, the vendor's total without tax);
// the reversal mirroring all of it; the right to change a code; the
// account's default code. A company without a Tax Configuration keeps its
// single Tax % (vendorInvoice suite).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');
const engine = require('../../src/taxEngine');

const D = '2026-10-20';
test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const fail = async p => { const r = await p.then(x => x, e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const jvLines = async jvId => (await call('u-admin', 'getJournalEntryDetail', { jvId })).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();
const ledger = async () => { const l = (await val('stock/ledger/I1/WH1')) || {}; return [l.Quantity, l.AvgCost, l.TotalValue]; };

const COMPS = { CGST: '22', SGST: '23', UTGST: '24', IGST: '25', CESS: '26' };
function fixture(stockQty) {
  const f = baseFixture();
  Object.keys(COMPS).forEach(k => {
    f.coa['A-' + k + 'OUT'] = { AccountCode: COMPS[k] + '01', AccountName: 'Output ' + k, AccountType: 'Liability', Status: 'Active', IsPostable: true };
    f.coa['A-' + k + 'IN'] = { AccountCode: COMPS[k] + '51', AccountName: 'Input ' + k, AccountType: 'Asset', Status: 'Active', IsPostable: true };
  });
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true, TaxCode: 'GST5' };
  Object.assign(f.companies.C1, { InputTaxAccountID: 'A-VATIN' });
  Object.assign(f.items.I1, { TaxCode: 'GST18', HSNCode: '7208' });
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Clerk', AssignedCompanies: ['C1'] };
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  ['access', 'draft', 'post'].forEach(c => f.permissions.VENDORINVOICE[c].push('Clerk'));
  Object.assign(f.vendors.V1, { TaxRegistrationType: 'Registered', TaxState: '27', TaxRegistrationNumber: '27ABCDE1234F1Z0' });
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Sample Supplies', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP', TaxRegistrationType: 'Registered', TaxState: '29' };
  const grn = (n, vendor) => ({ TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: vendor, TransactionNumber: 'GRN-' + n, TransactionDate: D, Description: 'Receipt ' + n,
    PostedAt: '2026-10-20T08:00:00Z', Lines: [{ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Direction: 'In', Quantity: 10, UnitCost: 20, TotalValue: 200 }] });
  f.stock = { transactions: { G1: grn(1, 'V1'), G2: grn(2, 'V2') }, ledger: { I1: { WH1: { Quantity: stockQty == null ? 20 : stockQty, AvgCost: 20, TotalValue: (stockQty == null ? 20 : stockQty) * 20 } } } };
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-' + c.Code + 'OUT'; c.InputAccountID = 'A-' + c.Code + 'IN'; });
  // A code whose input tax can't be reclaimed (a blocked credit).
  cfg.Codes.push({ Code: 'GST18B', Name: 'GST 18% (no credit)', Category: 'STANDARD', RecoverablePercent: 0, Active: true, Rates: [{ From: '2025-09-22', Percent: 18 }] });
  return { f, cfg };
}
async function setUp(stockQty) {
  const { f, cfg } = fixture(stockQty);
  await reset(f);
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
}
const draft = (extra, uid) => call(uid || 'u-admin', 'saveVendorInvoiceDraft', { invoiceData: Object.assign({
  InvoiceDate: D, Description: 'Invoice 77', VendorRefNumber: 'ACME-77', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
  SourceGRNs: [{ GRNID: 'G1' }], DirectLines: [{ AccountCode: '6100', Description: 'Freight', Amount: 100 }], Discount: 0, TaxPercent: 0, RoundOff: 0 }, extra || {}) });
const inv = id => val('vendorInvoices/' + id);

test('a GRN line by its item\'s code, a direct line by its account\'s; CGST + SGST from a vendor in the state; posted to the input accounts', async () => {
  await setUp();
  const s = ok(await draft());
  const d = await inv(s.invoiceId);
  assert.deepEqual(d.TaxLines.map(t => [t.Key, t.TaxCode, t.Taxable, t.Tax, t.Recoverable]), [['G1#1', 'GST18', 200, 36, 36], ['direct#1', 'GST5', 100, 5, 5]]);
  assert.deepEqual([d.TaxAmount, d.Total], [41, 341]);
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const p = await inv(s.invoiceId);
  assert.deepEqual(await jvLines(p.LinkedJVID), [['2000', 0, 341], ['2100', 200, 0], ['2251', 20.5, 0], ['2351', 20.5, 0], ['6100', 100, 0]].sort());
  assert.deepEqual(await ledger(), [20, 20, 400], 'all reclaimed: the stock\'s cost unchanged');
  assert.ok((await firestore.collection('taxCodeUse').doc('C1').get()).data().GST18);
  // From another state: IGST.
  const t = ok(await draft({ VendorID: 'V2', SourceGRNs: [{ GRNID: 'G2' }] }));
  assert.deepEqual((await inv(t.invoiceId)).TaxComponents.map(c => [c.Component, c.Amount]), [['IGST', 41]]);
});

test('input tax that can\'t be reclaimed: into the goods\' cost (Q323), the reversal takes it back off', async () => {
  await setUp();
  const s = ok(await draft({ DirectLines: [], LineTaxCodes: [{ Key: 'G1#1', TaxCode: 'GST18B' }] }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const p = await inv(s.invoiceId);
  assert.deepEqual([p.Total, p.TaxComponents.map(c => c.Recoverable).join()], [236, '0,0']);
  assert.deepEqual(await jvLines(p.LinkedJVID), [['1300', 36, 0], ['2000', 0, 236], ['2100', 200, 0]].sort());
  assert.deepEqual(await ledger(), [20, 21.8, 436], 'the 36 of tax is in the stock: 20 at 21.80');
  const tx = Object.values(await val('stock/transactions')).find(t => t.TransactionType === 'InputTaxCost');
  assert.deepEqual([tx.Status, tx.SourceInvoiceID, tx.Lines[0].ValueOnly, tx.Lines[0].TotalValue, tx.LinkedJVID], ['Posted', s.invoiceId, true, 36, p.LinkedJVID]);
  // The stock ledger rebuilt from the transactions still holds it.
  ok(await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' }));
  assert.deepEqual(await ledger(), [20, 21.8, 436]);
  const r = ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D }));
  const rev = await inv(r.invoiceId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1300', 0, 36], ['2000', 236, 0], ['2100', 0, 200]].sort());
  assert.deepEqual(await ledger(), [20, 20, 400]);
});

test('no stock left to carry it: the item\'s consumption account; on a direct line: its own account', async () => {
  await setUp(0);
  const s = ok(await draft({ LineTaxCodes: [{ Key: 'G1#1', TaxCode: 'GST18B' }, { Key: 'direct#1', TaxCode: 'GST18B' }] }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const p = await inv(s.invoiceId);
  // 36 on the goods (none in stock) to consumption 5100; 18 on the freight to 6100.
  assert.deepEqual(await jvLines(p.LinkedJVID), [['2000', 0, 354], ['2100', 200, 0], ['5100', 36, 0], ['6100', 100, 0], ['6100', 18, 0]].sort());
});

test('reverse charge: the vendor charges no tax; output and input both, netting nil where reclaimed', async () => {
  await setUp();
  const s = ok(await draft({ SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Description: 'Legal services', Amount: 1000 }], LineTaxCodes: [{ Key: 'direct#1', TaxCode: 'RCM18' }] }));
  const d = await inv(s.invoiceId);
  assert.deepEqual([d.TaxAmount, d.TaxReverse, d.Total], [180, 180, 1000]);
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  assert.deepEqual(await jvLines((await inv(s.invoiceId)).LinkedJVID),
    [['2000', 0, 1000], ['2201', 0, 90], ['2251', 90, 0], ['2301', 0, 90], ['2351', 90, 0], ['6100', 1000, 0]].sort());
});

test('the right to change a code; a line without a code; an account\'s default code saved in the Chart of Accounts', async () => {
  await setUp();
  assert.match(await fail(draft({ LineTaxCodes: [{ Key: 'direct#1', TaxCode: 'GST18' }] }, 'u-clerk')), /Direct line 1 Freight: changing a line's tax code needs the Vendor Invoice "change tax code" right/);
  assert.match(await fail(draft({ SourceGRNs: [], DirectLines: [{ AccountCode: '5000', Description: 'Other', Amount: 10 }] })), /Direct line 1 Other: no tax code\. Give its account a default tax code in the Chart of Accounts/);
  const coa = await val('coa/A-COGS');
  ok(await call('u-admin', 'saveAccount', { accountData: Object.assign({}, coa, { AccountID: 'A-COGS', TaxCode: 'gst5' }) }));
  assert.equal((await val('coa/A-COGS')).TaxCode, 'GST5');
  ok(await draft({ SourceGRNs: [], DirectLines: [{ AccountCode: '5000', Description: 'Other', Amount: 10 }] }));
  const r = await call('u-clerk', 'previewVendorInvoiceTax', { invoiceData: { CompanyID: 'C1', VendorID: 'V2', InvoiceDate: D, SourceGRNs: [{ GRNID: 'G2' }], DirectLines: [] } });
  assert.deepEqual([r.configured, r.canChangeTaxCode, r.vendorState, r.tax.TaxComponents.map(c => c.Component).join()], [true, false, '29', 'IGST']);
});

test('a Purchase Return takes back its share: the input tax reclaimed, the refund of what couldn\'t be with the variance', async () => {
  await setUp();
  await require('./_helpers').put('companies/C1/PurchaseReturnVarianceAccountID', 'A-COGS');
  const s = ok(await draft({ DirectLines: [] }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const r = ok(await call('u-admin', 'savePurchaseReturnDraft', { TransactionDate: D, Description: 'Damaged', CompanyID: 'C1', VendorID: 'V1', SourceInvoiceID: s.invoiceId,
    Lines: [{ SourceGRNID: 'G1', SourceGRNLineNo: 1, Quantity: 5 }] }));
  const ret = await val('stock/transactions/' + r.returnId);
  // 5 of 10 at 20 = 100, its GST18 share 18 (CGST 9 + SGST 9), refunded by the vendor.
  assert.deepEqual([ret.ReturnValue, ret.TaxAmount, ret.Total, ret.TaxComponents.map(c => [c.Component, c.Recoverable])], [100, 18, 118, [['CGST', 9], ['SGST', 9]]]);
  ok(await call('u-admin', 'postPurchaseReturn', { returnId: r.returnId }));
  const lines = await jvLines((await val('stock/transactions/' + r.returnId)).LinkedJVID);
  assert.ok(lines.some(l => l[0] === '2251' && l[2] === 9) && lines.some(l => l[0] === '2351' && l[2] === 9) && lines.some(l => l[0] === '2000' && l[1] === 118), JSON.stringify(lines));
});
