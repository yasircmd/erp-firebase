// Line tax on sales (docs/modules/TAX_ENGINE.md, part 2; Q313-Q318), India
// GST on company C1 (Maharashtra, 27): a Customer Invoice's lines taxed by
// their item's or Sales Type's code, the discount spread before tax, CGST +
// SGST within the state and IGST to another (the customer's state, changed
// on the invoice), a code changed on a line only with the right, a price
// list inclusive of tax; posted per component, the codes recorded as used;
// a Sales Return's share; the reversal; the preview the screen shows; the
// e-invoice per line under UAE VAT. A company without a Tax Configuration
// keeps its single Tax % (the other invoice suites).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');
const engine = require('../../src/taxEngine');

const D = '2026-10-20';
test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const fail = async p => { const r = await p.then(x => x, e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const jvLines = async jvId => (await call('u-admin', 'getJournalEntryDetail', { jvId })).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

const GST_ACCOUNTS = { CGST: ['A-CGST', '2201'], SGST: ['A-SGST', '2202'], UTGST: ['A-UTGST', '2203'], IGST: ['A-IGST', '2204'], CESS: ['A-CESS', '2205'] };
function fixture(regime) {
  const f = baseFixture();
  Object.keys(GST_ACCOUNTS).forEach(k => { f.coa[GST_ACCOUNTS[k][0]] = { AccountCode: GST_ACCOUNTS[k][1], AccountName: 'Output ' + k, AccountType: 'Liability', Status: 'Active', IsPostable: true }; });
  f.coa['A-DISCG'] = { AccountCode: '5300', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-SRET'] = { AccountCode: '4100', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISCG', OutputTaxAccountID: 'A-VATOUT', AddressLine1: '1 Example Street', City: 'Dubai', TaxNumbers: [{ Type: 'TRN', Number: '100000000000003' }] });
  Object.assign(f.items.I1, { SalesCogsAccountID: 'A-COGS', TaxCode: regime === 'AE_VAT' ? 'SR' : 'GST18', HSNCode: '7208' });
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Clerk', AssignedCompanies: ['C1'] };
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  ['access', 'draft', 'post'].forEach(c => f.permissions.CUSTOMERINVOICE[c].push('Clerk'));
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Example Traders', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR',
      TaxRegistrationType: 'Registered', TaxState: regime === 'AE_VAT' ? 'DXB' : '27', TaxRegistrationNumber: regime === 'AE_VAT' ? '100000000000011' : '27ABCDE1234F1Z0', AddressLine1: '2 Sample Road' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Sample Stores', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', TaxRegistrationType: 'Unregistered', TaxState: '29' }
  };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1', TaxCode: regime === 'AE_VAT' ? 'ZR' : 'GST5' } };
  f.priceLists = { PL1: { Name: 'Retail (incl. tax)', CompanyID: 'C1', Status: 'Active', PricesIncludeTax: true } };
  f.salesOrders = { SO1: { SONumber: 'SO-1', CompanyID: 'C1', CustomerID: 'CU1', PriceListID: 'PL1', Status: 'Delivered', Lines: [] } };
  const line = (qty, price, extra) => Object.assign({ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', ItemName: 'Steel Sheet', WarehouseID: 'WH1', Direction: 'Out', Quantity: qty, UnitPrice: price, UnitCost: 30, TotalValue: qty * 30, CostCenterID: 'CC1', Description: 'Line' }, extra || {});
  const dn = (n, lines) => ({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'DN-' + n, TransactionDate: D, Description: 'DN ' + n, Lines: lines });
  f.stock = {
    transactions: { N1: dn(1, [line(10, 50)]), N2: dn(2, [line(2, 118, { SourceSOID: 'SO1', SourceSOLineID: 'L1' })]) },
    ledger: { I1: { WH1: { Quantity: 30, AvgCost: 30, TotalValue: 900 } } }
  };
  const cfg = engine.preset(regime || 'IN_GST');
  if (regime === 'AE_VAT') { cfg.StateCode = 'DXB'; cfg.Components[0].OutputAccountID = 'A-VATOUT'; cfg.Components[0].InputAccountID = 'A-VATIN'; }
  else { cfg.StateCode = '27'; cfg.Components.forEach(c => { c.OutputAccountID = GST_ACCOUNTS[c.Code][0]; c.InputAccountID = 'A-VATIN'; }); }
  return { f, cfg };
}
async function setUp(regime) {
  const { f, cfg } = fixture(regime);
  await reset(f);
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
}
const invoice = (extra, uid) => call(uid || 'u-admin', 'saveCustomerInvoiceDraft', { invoiceData: Object.assign({
  InvoiceDate: D, Description: 'Steel and freight', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
  SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }],
  DirectLines: [{ AccountCode: '4000', Description: 'Freight', Amount: 100, SalesTypeID: 'ST1' }],
  Discount: 60, TaxPercent: 0, RoundOff: 0 }, extra || {}) });

test('an invoice taxed by line: item and Sales Type codes, the discount before tax, CGST + SGST within the state', async () => {
  await setUp();
  const s = ok(await invoice());
  const inv = await val('customerInvoices/' + s.invoiceId);
  // 500 (GST18) and 100 (GST5), 60 off in proportion: 450 and 90 taxable.
  assert.deepEqual(inv.TaxLines.map(t => [t.Key, t.TaxCode, t.Taxable, t.Tax, t.HSNCode || '']), [['N1#1', 'GST18', 450, 81, '7208'], ['direct#1', 'GST5', 90, 4.5, '']]);
  assert.deepEqual(inv.TaxComponents.map(c => [c.Component, c.Amount, c.OutputAccountID]), [['CGST', 42.75, 'A-CGST'], ['SGST', 42.75, 'A-SGST']]);
  assert.deepEqual([inv.PlaceOfSupply, inv.TaxAmount, inv.Subtotal, inv.Total], ['27', 85.5, 600, 625.5]);
  // The place of supply changed on the invoice (a ship-to state): IGST.
  ok(await invoice({ CustomerInvoiceID: s.invoiceId, PlaceOfSupply: '29' }));
  const inter = await val('customerInvoices/' + s.invoiceId);
  assert.deepEqual(inter.TaxComponents.map(c => [c.Component, c.Amount]), [['IGST', 85.5]]);
  ok(await invoice({ CustomerInvoiceID: s.invoiceId, PlaceOfSupply: '' }));
  assert.equal((await val('customerInvoices/' + s.invoiceId)).PlaceOfSupply, '27', 'back to the customer\'s state');
});

test('posted per component, each to its own account; the codes recorded as used; the reversal mirrors it', async () => {
  await setUp();
  const s = ok(await invoice());
  const p = ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  assert.equal(inv.Status, 'Posted');
  assert.deepEqual(await jvLines(inv.LinkedJVID), [['1200', 625.5, 0], ['2201', 0, 42.75], ['2202', 0, 42.75], ['4000', 0, 600], ['5300', 60, 0]].sort());
  const used = (await firestore.collection('taxCodeUse').doc('C1').get()).data();
  assert.deepEqual([used.GST18, used.GST5], [true, true]);
  assert.ok(p);
  const r = ok(await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: s.invoiceId, reversalDate: D }));
  const rev = await val('customerInvoices/' + r.invoiceId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1200', 0, 625.5], ['2201', 42.75, 0], ['2202', 42.75, 0], ['4000', 600, 0], ['5300', 0, 60]].sort());
});

test('a line\'s tax code changed only with the "change tax code" right; codes missing or unknown refused', async () => {
  await setUp();
  const asked = { LineTaxCodes: [{ Key: 'direct#1', TaxCode: 'GST18' }] };
  assert.match(await fail(invoice(asked, 'u-clerk')), /Direct line 1 Freight: changing a line's tax code needs the Customer Invoice "change tax code" right/);
  const s = ok(await invoice(asked));
  assert.deepEqual((await val('customerInvoices/' + s.invoiceId)).TaxLines.map(t => t.TaxCode), ['GST18', 'GST18']);
  // Re-saved by the clerk with the code as it was saved: kept.
  ok(await invoice(Object.assign({ CustomerInvoiceID: s.invoiceId }, asked), 'u-clerk'));
  assert.match(await fail(invoice({ LineTaxCodes: [{ Key: 'N1#1', TaxCode: 'GST28' }] })), /tax code GST28 is inactive/);
  assert.match(await fail(invoice({ LineTaxCodes: [{ Key: 'N1#1', TaxCode: 'NOPE' }] })), /tax code NOPE is not set up/);
  const { f } = fixture();
  delete f.salesTypes.ST1.TaxCode;
  await reset(f);
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: fixture().cfg }));
  assert.match(await fail(invoice()), /Direct line 1 Freight: no tax code\. Give its Sales Type a default tax code/);
  // An unregistered customer of another state still needs no GSTIN: IGST from its state.
  ok(await invoice({ CustomerID: 'CU2', SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Description: 'Freight', Amount: 100, SalesTypeID: 'ST1', }], LineTaxCodes: [{ Key: 'direct#1', TaxCode: 'GST5' }] }));
});

test('a price list inclusive of tax: the tax taken out of the price, revenue net of it', async () => {
  await setUp();
  const s = ok(await invoice({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N2', SalesTypeID: 'ST1' }], DirectLines: [], Discount: 0 }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  assert.deepEqual(inv.TaxLines.map(t => [t.Inclusive, t.Taxable, t.Tax]), [[true, 200, 36]]);
  assert.deepEqual([inv.Subtotal, inv.TaxAmount, inv.Total], [236, 36, 236], 'nothing added: the price held it');
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const posted = await val('customerInvoices/' + s.invoiceId);
  assert.deepEqual(await jvLines(posted.LinkedJVID), [['1200', 236, 0], ['2201', 0, 18], ['2202', 0, 18], ['4000', 0, 200]].sort());
});

test('a Sales Return takes its invoice line\'s share of the tax, per component, at the invoice\'s accounts', async () => {
  await setUp();
  const s = ok(await invoice({ DirectLines: [], Discount: 0 }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const r = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: D, Description: 'Damaged', CompanyID: 'C1', CustomerID: 'CU1', SourceInvoiceID: s.invoiceId,
    Lines: [{ SourceDNID: 'N1', SourceDNLineNo: 1, Quantity: 4, WarehouseID: 'WH1' }] }));
  const ret = await val('stock/transactions/' + r.returnId);
  // 4 of 10 × 50 = 200 at 18%: 18 CGST + 18 SGST.
  assert.deepEqual([ret.ReturnValue, ret.TaxAmount, ret.Total, ret.TaxComponents.map(c => [c.Component, c.Amount])], [200, 36, 236, [['CGST', 18], ['SGST', 18]]]);
  const p = ok(await call('u-admin', 'postSalesReturn', { returnId: r.returnId }));
  const posted = await val('stock/transactions/' + r.returnId);
  const lines = await jvLines(posted.LinkedJVID);
  assert.ok(lines.some(l => l[0] === '2201' && l[1] === 18) && lines.some(l => l[0] === '2202' && l[1] === 18), JSON.stringify(lines));
  assert.ok(lines.some(l => l[0] === '1200' && l[2] === 236) && lines.some(l => l[0] === '4100' && l[1] === 200));
  assert.ok(p);
});

test('the screen\'s preview: the same figures as the save; the codes, the places; a problem shown, not thrown', async () => {
  await setUp();
  const data = { InvoiceDate: D, CompanyID: 'C1', CustomerID: 'CU1', SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }], DirectLines: [{ AccountCode: '4000', Description: 'Freight', Amount: 100, SalesTypeID: 'ST1' }], Discount: 60 };
  const r = await call('u-admin', 'previewInvoiceTax', { invoiceData: data });
  assert.deepEqual([r.configured, r.regime, r.customerState, r.canChangeTaxCode, r.tax.TaxAmount, r.tax.TaxAdded], [true, 'IN_GST', '27', true, 85.5, 85.5]);
  assert.ok(r.codes.some(c => c.Code === 'GST18') && r.places['29']);
  assert.equal((await call('u-clerk', 'previewInvoiceTax', { invoiceData: data })).canChangeTaxCode, false);
  const bad = await call('u-admin', 'previewInvoiceTax', { invoiceData: Object.assign({}, data, { LineTaxCodes: [{ Key: 'N1#1', TaxCode: 'NOPE' }] }) });
  assert.match(bad.problem, /NOPE is not set up/);
  assert.deepEqual(await call('u-other', 'previewInvoiceTax', { invoiceData: { CompanyID: 'C2' } }), { configured: false });
});

test('UAE VAT: the e-invoice carries each line\'s category and rate, a subtotal per category', async () => {
  await setUp('AE_VAT');
  ok(await call('u-admin', 'saveEInvoiceSettings', { companyId: 'C1', enabled: true, startDate: '2026-01-01' }));
  const s = ok(await invoice({ Discount: 0 }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  assert.deepEqual([inv.TaxAmount, inv.Total], [25, 625]);
  const e = await val('eInvoices/Invoice_' + s.invoiceId);
  assert.match(e.Xml, /<cac:TaxSubtotal><cbc:TaxableAmount currencyID="AED">500\.00<\/cbc:TaxableAmount><cbc:TaxAmount currencyID="AED">25\.00<\/cbc:TaxAmount><cac:TaxCategory><cbc:ID>S<\/cbc:ID><cbc:Percent>5<\/cbc:Percent>/);
  assert.match(e.Xml, /<cbc:TaxableAmount currencyID="AED">100\.00<\/cbc:TaxableAmount><cbc:TaxAmount currencyID="AED">0\.00<\/cbc:TaxAmount><cac:TaxCategory><cbc:ID>Z<\/cbc:ID>/);
  assert.equal((e.Xml.match(/<cac:InvoiceLine>/g) || []).length, 2);
});

test('India GST: the IRP\'s JSON built and kept on posting (ready, not connected); a consumer not e-invoiced', async () => {
  const { f, cfg } = fixture();
  Object.assign(f.companies.C1, { City: 'Pune', PostalCode: '411001', TaxNumbers: [{ Type: 'GSTIN', Number: '27ABCDE1234F1Z0' }] });
  Object.assign(f.customers.CU1, { City: 'Mumbai', PostalCode: '400001' });
  await reset(f);
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
  ok(await call('u-admin', 'saveEInvoiceSettings', { companyId: 'C1', enabled: true, startDate: '2026-01-01' }));
  const s = ok(await invoice({ DirectLines: [], Discount: 0 }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const e = await val('eInvoices/Invoice_' + s.invoiceId);
  assert.deepEqual([e.Format, e.Status, e.Xml, e.SendStatus], ['IRP', 'Ready', '', 'NotSent'], JSON.stringify(e.Issues));
  assert.match(e.SendNote, /no GSP is connected yet/);
  const j = JSON.parse(e.Json);
  assert.deepEqual([j.TranDtls.SupTyp, j.BuyerDtls.Pos, j.ItemList[0].PrdDesc, j.ItemList[0].HsnCd, j.ItemList[0].Unit, j.ItemList[0].CgstAmt, j.ValDtls.TotInvVal],
    ['B2B', '27', 'Steel Sheet', '7208', 'PCS', 45, 590]);
  const got = await call('u-admin', 'getEInvoice', { kind: 'Invoice', id: s.invoiceId });
  assert.equal(got.record.Format, 'IRP');
  // A sale to a consumer: not e-invoiced.
  const c = ok(await invoice({ CustomerID: 'CU2', SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Description: 'Freight', Amount: 100, SalesTypeID: 'ST1' }], Discount: 0 }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: c.invoiceId }));
  assert.equal((await val('eInvoices/Invoice_' + c.invoiceId)).Status, 'NotApplicable');
});
