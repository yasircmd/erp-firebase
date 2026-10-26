// India's e-invoice JSON (docs/modules/TAX_ENGINE.md, part 2, Q321): an
// invoice taxed by line as the IRP's schema 1.1 (supply type, the parties,
// each item's assessable value and GST, the totals), what stops it being
// reported, a B2C sale not e-invoiced, a credit note naming its invoice.
//   node --test functions/test/unit/eInvoiceIndia.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const IN = require('../../src/eInvoiceIndia');

const company = { LegalName: 'Example Industries Pvt Ltd', AddressLine1: '1 Example Road', City: 'Pune', PostalCode: '411001', TaxStateCode: '27',
  TaxNumbers: [{ Type: 'GSTIN', Number: '27ABCDE1234F1Z0' }] };
const customer = { CustomerName: 'Example Traders', AddressLine1: '2 Sample Street', City: 'Bengaluru', PostalCode: '560001', TaxRegistrationType: 'Registered', TaxState: '29',
  TaxRegistrationNumber: '29ABCDE1234F1ZW' };
const invoice = {
  TransactionNumber: 'INV-0001', InvoiceDate: '2026-10-20', TaxRegime: 'IN_GST', PlaceOfSupply: '29', RoundOff: 0, Total: 625.5,
  TaxLines: [
    { Key: 'N1#1', TaxCode: 'GST18', Taxable: 450, Tax: 81, HSNCode: '7208', Components: [{ Component: 'IGST', Percent: 18, Amount: 81 }] },
    { Key: 'direct#1', TaxCode: 'GST5', Taxable: 90, Tax: 4.5, HSNCode: '996511', Components: [{ Component: 'IGST', Percent: 5, Amount: 4.5 }] }
  ]
};
const lines = [
  { Key: 'N1#1', Description: 'Steel Sheet', Quantity: 10, UnitPrice: 50, Amount: 500, Unit: 'PCS' },
  { Key: 'direct#1', Description: 'Freight', Quantity: 1, UnitPrice: 100, Amount: 100 }
];

test('the IRP JSON: B2B, the parties, each item\'s assessable value and IGST, the totals, dates dd/mm/yyyy', () => {
  const d = IN.documentOf('Invoice', invoice, company, customer, lines);
  assert.deepEqual(IN.readiness(d), { status: 'Ready', issues: [] });
  const j = JSON.parse(IN.toJson(d));
  assert.equal(j.Version, '1.1');
  assert.deepEqual(j.TranDtls, { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
  assert.deepEqual(j.DocDtls, { Typ: 'INV', No: 'INV-0001', Dt: '20/10/2026' });
  assert.deepEqual([j.SellerDtls.Gstin, j.SellerDtls.Stcd, j.SellerDtls.Pin], ['27ABCDE1234F1Z0', '27', 411001]);
  assert.deepEqual([j.BuyerDtls.Gstin, j.BuyerDtls.Pos, j.BuyerDtls.Stcd, j.BuyerDtls.Loc], ['29ABCDE1234F1ZW', '29', '29', 'Bengaluru']);
  const [a, b] = j.ItemList;
  assert.deepEqual([a.HsnCd, a.IsServc, a.Unit, a.TotAmt, a.Discount, a.AssAmt, a.GstRt, a.IgstAmt, a.TotItemVal], ['7208', 'N', 'PCS', 500, 50, 450, 18, 81, 531]);
  assert.deepEqual([b.IsServc, b.Unit, b.AssAmt, b.IgstAmt], ['Y', 'OTH', 90, 4.5], 'a SAC code (99…) is a service');
  assert.deepEqual(j.ValDtls, { AssVal: 540, CgstVal: 0, SgstVal: 0, IgstVal: 85.5, CesVal: 0, RndOffAmt: 0, TotInvVal: 625.5 });
});

test('within the state: CGST and SGST (UTGST counted with SGST); an SEZ or export: its supply type', () => {
  const intra = Object.assign({}, invoice, { PlaceOfSupply: '27', TaxLines: [{ Key: 'N1#1', Taxable: 450, Tax: 81, HSNCode: '7208', Components: [{ Component: 'CGST', Percent: 9, Amount: 40.5 }, { Component: 'UTGST', Percent: 9, Amount: 40.5 }] }] });
  const d = IN.documentOf('Invoice', intra, company, Object.assign({}, customer, { TaxState: '27', TaxRegistrationNumber: '27ABCDE1234F1Z0' }), [lines[0]]);
  assert.deepEqual([d.items[0].CgstAmt, d.items[0].SgstAmt, d.items[0].GstRt], [40.5, 40.5, 18]);
  assert.equal(IN.supplyType('SEZ', true), 'SEZWP');
  assert.equal(IN.supplyType('Overseas', false), 'EXPWOP');
  const exp = IN.documentOf('Invoice', invoice, company, { CustomerName: 'Overseas Buyer', AddressLine1: 'x', City: 'Abroad', TaxRegistrationType: 'Overseas' }, lines);
  assert.deepEqual([exp.supply, exp.buyer.gstin, exp.buyer.pos, exp.buyer.pin], ['EXPWP', 'URP', '96', 999999]);
});

test('what stops it: GSTINs, addresses and PIN codes, HSN on every line; a consumer is not e-invoiced', () => {
  const d = IN.documentOf('Invoice', Object.assign({}, invoice, { TaxLines: [Object.assign({}, invoice.TaxLines[0], { HSNCode: '' }), invoice.TaxLines[1]] }),
    Object.assign({}, company, { PostalCode: '011001' }), Object.assign({}, customer, { TaxRegistrationNumber: '29ABCDE1234F1Z1' }), lines);
  const r = IN.readiness(d);
  assert.equal(r.status, 'NotReady');
  assert.deepEqual(r.issues.map(i => i.split(' (')[0].split(':')[0]), [
    'The customer\'s GSTIN is missing or not valid', 'The company\'s address, city and PIN code are needed', 'Line 1'
  ]);
  const b2c = IN.documentOf('Invoice', invoice, company, Object.assign({}, customer, { TaxRegistrationType: 'Consumer' }), lines);
  assert.equal(IN.readiness(b2c).status, 'NotApplicable');
});

test('a credit note: CRN, naming its invoice and its date', () => {
  const d = IN.documentOf('CreditNote', Object.assign({}, invoice, { TransactionNumber: 'CRN-0001', TransactionDate: '2026-10-25', InvoiceDate: '', BillingReference: 'INV-0001', BillingDate: '2026-10-20' }), company, customer, lines);
  const j = JSON.parse(IN.toJson(d));
  assert.deepEqual(j.DocDtls, { Typ: 'CRN', No: 'CRN-0001', Dt: '25/10/2026' });
  assert.deepEqual(j.RefDtls, { PrecDocDtls: [{ InvNo: 'INV-0001', InvDt: '20/10/2026' }] });
  assert.equal(IN.companyGstin({ TaxNumbers: [{ Type: 'PAN', Number: 'ABCDE1234F' }, { Type: 'Other', Number: '27ABCDE1234F1Z0' }] }), '27ABCDE1234F1Z0');
});
