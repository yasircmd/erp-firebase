// UAE e-invoice documents (docs/modules/E_INVOICING.md, decisions 225-229):
// a posted invoice as PINT AE UBL XML, a credit note naming its invoice,
// the VAT in AED for a foreign-currency invoice, and the readiness checks
// (a customer without a TRN is not e-invoiced).
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/eInvoiceDocument');

const company = { LegalName: 'Example Trading LLC', TaxNumbers: [{ Type: 'TRN', Number: '100000000000003' }], AddressLine1: '1 Sample Street', City: 'Dubai', StateOrEmirate: 'Dubai', Country: 'UAE' };
const customer = { CustomerName: 'Sample Buyer & Co', TaxRegistrationNumber: '100000000000010', AddressLine1: '2 Test Road', City: 'Abu Dhabi', Country: 'United Arab Emirates' };
const invoice = { TransactionNumber: 'CINV-26-01-000001', InvoiceDate: '2026-09-10', DueDate: '2026-10-10', Subtotal: 1000, Discount: 0, TaxPercent: 5, TaxAmount: 50, RoundOff: 0, Total: 1050,
  EInvoiceLines: [{ Description: 'Consulting', Quantity: 2, UnitPrice: 500, Amount: 1000 }] };

test('an invoice: ready, and its XML carries the PINT AE profile, both TRNs, the VAT and the totals', () => {
  const d = E.documentOf('Invoice', invoice, company, customer, 'AED');
  assert.deepEqual(E.readiness(d), { status: 'Ready', issues: [] });
  const x = E.toXml(d);
  assert.match(x, /<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1<\/cbc:CustomizationID>/);
  assert.match(x, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/);
  assert.match(x, /<cbc:CompanyID>100000000000003<\/cbc:CompanyID>[\s\S]*<cbc:CompanyID>100000000000010<\/cbc:CompanyID>/);
  assert.match(x, /Sample Buyer &amp; Co/, 'escaped');
  assert.match(x, /<cbc:IdentificationCode>AE<\/cbc:IdentificationCode>/);
  assert.match(x, /<cbc:TaxAmount currencyID="AED">50.00<\/cbc:TaxAmount>/);
  assert.match(x, /<cbc:ID>S<\/cbc:ID><cbc:Percent>5<\/cbc:Percent>/);
  assert.match(x, /<cbc:PayableAmount currencyID="AED">1050.00<\/cbc:PayableAmount>/);
  assert.match(x, /<cbc:InvoicedQuantity unitCode="C62">2<\/cbc:InvoicedQuantity>/);
  assert.doesNotMatch(x, /TaxCurrencyCode/);
});

test('a credit note names its invoice; a USD invoice gives the VAT in AED too', () => {
  const cn = E.documentOf('CreditNote', Object.assign({}, invoice, { TransactionNumber: 'SR-1', BillingReference: 'CINV-26-01-000001' }), company, customer, 'AED');
  const x = E.toXml(cn);
  assert.match(x, /^<\?xml[\s\S]*<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/);
  assert.match(x, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.match(x, /<cac:InvoiceDocumentReference><cbc:ID>CINV-26-01-000001<\/cbc:ID>/);
  assert.match(x, /<cac:CreditNoteLine>/);
  const usd = E.toXml(E.documentOf('Invoice', Object.assign({}, invoice, { CurrencyCode: 'USD', ExchangeRate: 3.6725 }), company, customer, 'AED'));
  assert.match(usd, /<cbc:DocumentCurrencyCode>USD<\/cbc:DocumentCurrencyCode>/);
  assert.match(usd, /<cbc:TaxCurrencyCode>AED<\/cbc:TaxCurrencyCode>/);
  assert.match(usd, /<cbc:TaxAmount currencyID="AED">183.63<\/cbc:TaxAmount>/, '50 USD at 3.6725');
});

test('readiness: no TRN is not e-invoiced; the missing data is listed', () => {
  assert.equal(E.readiness(E.documentOf('Invoice', invoice, company, Object.assign({}, customer, { TaxRegistrationNumber: '' }), 'AED')).status, 'NotApplicable');
  const r = E.readiness(E.documentOf('Invoice', invoice, Object.assign({}, company, { TaxNumbers: [], City: '' }), Object.assign({}, customer, { TaxRegistrationNumber: '12345' }), 'AED'));
  assert.equal(r.status, 'NotReady');
  assert.deepEqual(r.issues, [
    'The company\'s TRN is missing or not 15 digits (Company Master → Tax numbers).',
    'The customer\'s TRN is not 15 digits (Customer Master).',
    'The company\'s address (street and city) is missing (Company Master).']);
  assert.match(E.readiness(E.documentOf('CreditNote', invoice, company, customer, 'AED')).issues.join(' '), /names no invoice/);
  assert.equal(E.taxCategory(0), 'Z');
});
