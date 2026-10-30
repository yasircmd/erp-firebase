// Tax Reports (docs/modules/TAX_ENGINE.md, part 5): getTaxReport over the
// posted documents of a company and period, read by month (the stores'
// Period query). UAE VAT on company C1 (Sharjah): the VAT 201 boxes from
// invoices, a credit note, a reversal of an invoice of the month before,
// vendor invoices (one an import under reverse charge) and an asset sale;
// drafts, other companies, other periods and a reversed asset sale left
// out; a document with one tax % counted apart (Q326). India GST: a real
// counter sale and its return in GSTR-1's B2CS and HSN summary. The right
// and the company are checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, firestore } = require('./_helpers');
const engine = require('../../src/taxEngine');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r.success === false ? r.error : true, true); return r; };
const vat = (Key, Category, Code, Taxable, extra) => Object.assign({ Key, TaxCode: Code, Category, Percent: Category === 'ZERO' ? 0 : 5, Taxable, Tax: Category === 'ZERO' ? 0 : Taxable * 0.05,
  Components: Category === 'ZERO' ? [] : [{ Component: 'VAT', Percent: 5, Amount: Taxable * 0.05 }] }, extra || {});
const posted = (date, lines, extra) => Object.assign({ Status: 'Posted', CompanyID: 'C1', InvoiceDate: date, TransactionDate: date, CustomerID: 'CU1', TaxRegime: 'AE_VAT', PlaceOfSupply: 'DXB',
  TaxLines: lines, Total: lines.reduce((s, l) => s + l.Taxable + l.Tax, 0) }, extra || {});

async function uae() {
  const f = baseFixture();
  f.permissions.TAXREPORTS.access = ['Admin'];
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Example Traders', Status: 'Active', CompanyID: 'C1', TaxRegistrationType: 'Registered', TaxState: 'DXB', TaxRegistrationNumber: '100000000000003' } };
  f.vendors.V2 = { VendorCode: 'V002', VendorName: 'Sample Supplies', Status: 'Active', CompanyID: 'C1', TaxRegistrationType: 'Registered', TaxState: 'SHJ' };
  Object.assign(f.vendors.V1, { TaxRegistrationType: 'Overseas' });
  f.customerInvoices = {
    CI1: posted('2026-10-05', [vat('item#1', 'STANDARD', 'SR', 1000)], { TransactionNumber: 'CI-1' }),
    CI2: posted('2026-10-20', [vat('item#1', 'ZERO', 'ZR', 500)], { TransactionNumber: 'CI-2' }),
    CI3: posted('2026-09-28', [vat('item#1', 'STANDARD', 'SR', 200)], { TransactionNumber: 'CI-3' }),
    // The legacy reversal copies no tax lines: it takes CI3's, on its own date.
    CINVD1: { Status: 'Posted', CompanyID: 'C1', InvoiceDate: '2026-10-02', CustomerID: 'CU1', TransactionNumber: 'CI-3-R', ReversalOfInvoiceID: 'CI3', Total: 210 },
    CI4: Object.assign(posted('2026-10-06', [vat('item#1', 'STANDARD', 'SR', 9000)]), { Status: 'Draft' }),
    CI5: { Status: 'Posted', CompanyID: 'C1', InvoiceDate: '2026-10-03', CustomerID: 'CU1', TransactionNumber: 'CI-5', TaxPercent: 5, TaxAmount: 25, Total: 525 },
    CI6: posted('2026-10-07', [vat('item#1', 'STANDARD', 'SR', 7000)], { CompanyID: 'C2' }),
    CI7: posted('2026-11-01', [vat('item#1', 'STANDARD', 'SR', 8000)])
  };
  f.vendorInvoices = {
    VI1: posted('2026-10-08', [vat('direct#1', 'STANDARD', 'SR', 400, { Kind: 'direct' })], { VendorID: 'V2', CustomerID: undefined, TransactionNumber: 'VI-1' }),
    VI2: posted('2026-10-09', [vat('G1#1', 'REVERSE_CHARGE', 'RC', 1000, { Kind: 'grn', Reverse: true })], { VendorID: 'V1', CustomerID: undefined, TransactionNumber: 'VI-2', Total: 1000 })
  };
  f.stock = { transactions: { SR1: posted('2026-10-10', [vat('item#1', 'STANDARD', 'SR', 100)], { TransactionType: 'SalesReturn', TransactionNumber: 'SRN-1', SourceInvoiceID: 'CI1', SourceInvoiceNumber: 'CI-1', Lines: [] }) } };
  await reset(f);
  const cfg = Object.assign(engine.preset('AE_VAT'), { StateCode: 'SHJ' });
  cfg.Components[0].OutputAccountID = 'A-VATOUT'; cfg.Components[0].InputAccountID = 'A-VATIN';
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
  const asset = (id, status) => firestore.collection('faPostings').doc(id).set({ Type: 'Retirement', ProceedsTo: 'Bank', CompanyID: 'C1', Status: status, Date: '2026-10-15', Period: '2026-10',
    PostingNumber: id, TaxLines: [vat('asset#A1', 'STANDARD', 'SR', 3000)], ReceiptTotal: 3150 });
  await asset('FA1', 'Posted'); await asset('FA2', 'Reversed');
}
const report = (r, uid, extra) => call(uid || 'u-admin', 'getTaxReport', Object.assign({ companyId: 'C1', from: '2026-10-01', to: '2026-10-31', report: r }, extra || {}));

test('UAE VAT 201 from the posted documents of the period', async () => {
  await uae();
  const r = await report('vat201');
  assert.equal(r.configured, true);
  const b = r.data;
  const pick = n => [b[n].Amount, b[n].Vat];
  assert.deepEqual(pick('1b'), [700, 35], 'Dubai: CI-1 less its credit note and the reversal of September\'s CI-3');
  assert.deepEqual(pick('1c'), [3000, 150], 'Sharjah: the asset sold to the bank, the company\'s emirate');
  assert.deepEqual([pick('4'), pick('6'), pick('9'), pick('10')], [[500, 0], [1000, 50], [400, 20], [1000, 50]]);
  assert.deepEqual([pick('8'), b['13'].Vat, b['14'].Vat], [[5200, 235], 70, 165]);
  assert.deepEqual(b['1b'].docs.sort(), ['CustomerInvoice:CI1', 'CustomerInvoice:CINVD1', 'SalesReturn:SR1']);
  assert.deepEqual([r.docs['CustomerInvoice:CINVD1'].Number, r.docs['CustomerInvoice:CINVD1'].Taxable], ['CI-3-R', -200]);
  assert.deepEqual([r.leftOut.count, r.leftOut.tax, r.leftOut.documents[0].Number], [1, 25, 'CI-5'], 'the single-rate invoice left out, and said');
  // September holds CI-3 itself; November only CI-7.
  assert.equal((await report('vat201', null, { from: '2026-09-01', to: '2026-09-30' })).data['1b'].Amount, 200);
  assert.equal((await report('summary', null, { from: '2026-11-01', to: '2026-11-30' })).data.sales.Taxable, 8000);
});

test('the right, the company, the period and the regime checked; no Tax Configuration, no report', async () => {
  await uae();
  const err = p => p.then(() => 'no error', e => e.message);
  assert.match(await err(report('vat201', 'u-viewer')), /do not have access to Tax Reports/);
  assert.match(await err(report('vat201', 'u-other')), /do not have access to that company/);
  assert.match(await err(report('vat201', null, { from: '2026-10-31', to: '2026-10-01' })), /Choose the period/);
  assert.match(await err(report('gstr1')), /This report is for India GST/);
  await firestore.collection('taxConfig').doc('C1').delete();
  assert.deepEqual(await report('summary'), { configured: false });
});

test('India GSTR-1: a real counter sale and its return in B2CS and the HSN summary', async () => {
  const f = baseFixture();
  ['CGST', 'SGST', 'UTGST', 'IGST', 'CESS'].forEach((k, i) => { f.coa['A-' + k] = { AccountCode: '22' + (i + 1) + '0', AccountName: 'Output ' + k, AccountType: 'Liability', Status: 'Active', IsPostable: true }; });
  f.coa['A-DISC'] = { AccountCode: '4100', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISC', OutputTaxAccountID: 'A-VATOUT' });
  Object.assign(f.items.I1, { SalesCogsAccountID: 'A-COGS', TaxCode: 'GST18', HSNCode: '7208' });
  f.stock = { ledger: { I1: { WH1: { Quantity: 10, AvgCost: 20, TotalValue: 200 } } } };
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Local Sales', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.customerCounters = { CL: 1 };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active' } };
  f.priceListLines = { P1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 118, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  await reset(f);
  const cfg = Object.assign(engine.preset('IN_GST'), { StateCode: '27' });
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-' + c.Code; c.InputAccountID = 'A-VATIN'; });
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
  await call('u-admin', 'saveRetailSalesSettings', { companyId: 'C1', salesTypeId: 'ST1', warehouseId: 'WH1', costCenterId: 'CC1', receivablesAccountId: 'A-AR', priceListId: 'PL1', taxPercent: 0 });
  const cash = (await call('u-admin', 'saveRetailPaymentMethod', { companyId: 'C1', method: { Name: 'Cash', Kind: 'Cash', AccountID: 'A-CASH' } })).methodId;
  const day = new Date().toISOString().slice(0, 10);
  const s = ok(await call('u-admin', 'confirmRetailSale', { CompanyID: 'C1', SaleDate: day, Lines: [{ ItemID: 'I1', Quantity: 3 }], Payments: [{ MethodID: cash, Amount: 354 }] }));
  ok(await call('u-admin', 'confirmRetailReturn', { saleId: s.saleId, Lines: [{ SaleLineNo: 1, Quantity: 1 }], reason: 'Wrong size' }));
  const r = await report('gstr1', null, { from: day.slice(0, 8) + '01', to: day });
  // 3 × 118 including 18%: 300 taxable; one returned: 200 left.
  assert.deepEqual(r.data.b2cs.map(x => [x.POS, x.Rate, x.Taxable]), [['27-Maharashtra', 18, 200]]);
  assert.deepEqual(r.data.hsnB2C.map(x => [x.HSN, x.UQC, x.Qty, x.Taxable, x.Cgst, x.Sgst]), [['7208', 'PCS', 2, 200, 18, 18]]);
  assert.deepEqual(r.data.docs.map(x => x.Nature).sort(), ['Credit Note', 'Invoices for outward supply']);
  const b = await report('gstr3b', null, { from: day.slice(0, 8) + '01', to: day });
  assert.deepEqual([b.data.t31.a.Taxable, b.data.t31.a.Cgst, b.data.t61[1].Cash], [200, 18, 18]);
});
