// UAE e-invoice documents (owner, 2026-10-16; docs/modules/E_INVOICING.md,
// decisions 225-229): a posted Customer Invoice (or a Sales Return, as a
// credit note) as a PINT AE invoice in UBL 2.1 XML, and whether it is ready
// to send. Pure: no I/O. New development, hand-written.
//
// PINT AE is the UAE profile of Peppol's PINT (a UBL 2.1 invoice). The
// identifiers below follow the published PINT AE specification as checked
// 2026-10-16; the ASP chosen later validates against its current version,
// and any field it needs beyond these is added then.
'use strict';

const CUSTOMIZATION_ID = 'urn:peppol:pint:billing-1@ae-1';
const PROFILE_ID = 'urn:peppol:bis:billing';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amt = (tag, v, cur) => '<cbc:' + tag + ' currencyID="' + esc(cur) + '">' + round2(v).toFixed(2) + '</cbc:' + tag + '>';
const isTrn = v => /^\d{15}$/.test(String(v || '').replace(/\s+/g, ''));

// The company's TRN: its tax number of type TRN or VAT (else the first).
function companyTrn(company) {
  const list = (company && company.TaxNumbers) || [];
  const hit = list.find(t => /trn|vat/i.test(t.Type || '')) || list[0];
  return hit ? String(hit.Number || '').replace(/\s+/g, '') : '';
}

// A tax category per the UAE VAT rates: S (standard, 5%), Z (zero-rated).
const taxCategory = percent => (Number(percent) > 0 ? 'S' : 'Z');
const TAX_CATEGORIES = require('./taxEngine').CATEGORIES;

// The document's facts, from the posted record (amounts in its own currency).
//   kind: 'Invoice' | 'CreditNote'
function documentOf(kind, doc, company, customer, base) {
  const currency = doc.CurrencyCode || (base || 'AED');
  let lines = (doc.EInvoiceLines || []).map((l, i) => ({ id: i + 1, name: l.Description || '', quantity: Number(l.Quantity) || 1, unitPrice: round2(l.UnitPrice != null ? l.UnitPrice : l.Amount), amount: round2(l.Amount) }));
  // Taxed line by line (TAX_ENGINE.md, part 2): each line its category and
  // rate, at its taxable value (the discount, and the tax of a price that
  // included it, already out of it); a subtotal per category and rate.
  let subtotals = null;
  if (doc.TaxLines) {
    const byKey = new Map(doc.TaxLines.map(t => [t.Key, t]));
    const groups = new Map();
    lines = lines.map((l, i) => {
      const t = byKey.get((doc.EInvoiceLines[i] || {}).Key) || { Category: 'OUT_OF_SCOPE', Percent: 0, Taxable: l.amount, Tax: 0 };
      const cat = (TAX_CATEGORIES[t.Category] || {}).einvoice || 'O';
      const percent = Number(t.Percent) || 0;
      const g = groups.get(cat + '|' + percent) || { category: cat, percent, taxable: 0, tax: 0 };
      g.taxable = round2(g.taxable + t.Taxable); g.tax = round2(g.tax + t.Tax);
      groups.set(cat + '|' + percent, g);
      return Object.assign(l, { amount: round2(t.Taxable), unitPrice: Math.round(t.Taxable / l.quantity * 10000) / 10000, category: cat, percent });
    });
    subtotals = [...groups.values()];
  }
  return {
    byLine: Boolean(subtotals), subtotals,
    kind, number: doc.TransactionNumber || '', date: doc.InvoiceDate || doc.TransactionDate || '', dueDate: doc.DueDate || '',
    currency, taxCurrency: base || 'AED', rate: Number(doc.ExchangeRate) || 1,
    seller: { name: company.LegalName || '', trn: companyTrn(company), street: company.AddressLine1 || '', city: company.City || '', emirate: company.StateOrEmirate || '', country: company.Country || 'AE' },
    buyer: { name: customer.CustomerName || '', trn: String(customer.TaxRegistrationNumber || '').replace(/\s+/g, ''), street: customer.AddressLine1 || '', city: customer.City || '', country: customer.Country || 'AE' },
    lines, discount: round2(doc.Discount), taxPercent: Number(doc.TaxPercent) || 0, taxAmount: round2(doc.TaxAmount), roundOff: round2(doc.RoundOff),
    subtotal: round2(doc.Subtotal), total: round2(doc.Total), billingReference: doc.BillingReference || ''
  };
}

// What stops the document being sent: [] when ready. A customer with no TRN
// is not e-invoiced at all (decision 229): status NotApplicable.
function readiness(d) {
  if (!d.buyer.trn) return { status: 'NotApplicable', issues: ['The customer has no TRN: not e-invoiced (B2C or not registered).'] };
  const issues = [];
  if (!isTrn(d.seller.trn)) issues.push('The company\'s TRN is missing or not 15 digits (Company Master → Tax numbers).');
  if (!isTrn(d.buyer.trn)) issues.push('The customer\'s TRN is not 15 digits (Customer Master).');
  if (!d.seller.street || !d.seller.city) issues.push('The company\'s address (street and city) is missing (Company Master).');
  if (!d.buyer.street) issues.push('The customer\'s address is missing (Customer Master).');
  if (!d.number) issues.push('The document has no number yet.');
  if (!d.lines.length) issues.push('The document has no lines.');
  if (d.kind === 'CreditNote' && !d.billingReference) issues.push('The credit note names no invoice.');
  return { status: issues.length ? 'NotReady' : 'Ready', issues };
}

// The UBL 2.1 XML of the document (PINT AE).
function toXml(d) {
  const root = d.kind === 'CreditNote' ? 'CreditNote' : 'Invoice';
  const lineTag = d.kind === 'CreditNote' ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = d.kind === 'CreditNote' ? 'CreditedQuantity' : 'InvoicedQuantity';
  const cat = taxCategory(d.taxPercent);
  const party = (p, role) => [
    '  <cac:' + role + '><cac:Party>',
    '    <cac:PartyName><cbc:Name>' + esc(p.name) + '</cbc:Name></cac:PartyName>',
    '    <cac:PostalAddress><cbc:StreetName>' + esc(p.street) + '</cbc:StreetName><cbc:CityName>' + esc(p.city) + '</cbc:CityName>' +
      (p.emirate ? '<cbc:CountrySubentity>' + esc(p.emirate) + '</cbc:CountrySubentity>' : '') + '<cac:Country><cbc:IdentificationCode>' + esc(countryCode(p.country)) + '</cbc:IdentificationCode></cac:Country></cac:PostalAddress>',
    '    <cac:PartyTaxScheme><cbc:CompanyID>' + esc(p.trn) + '</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>',
    '    <cac:PartyLegalEntity><cbc:RegistrationName>' + esc(p.name) + '</cbc:RegistrationName></cac:PartyLegalEntity>',
    '  </cac:Party></cac:' + role + '>'].join('\n');
  // Taxed by line: the lines at their taxable values, the discount already in them.
  const lineTotal = d.byLine ? round2(d.lines.reduce((t, l) => t + l.amount, 0)) : d.subtotal;
  const discount = d.byLine ? 0 : d.discount;
  const net = round2(lineTotal - discount);
  const taxCat = (c, p) => '<cac:TaxCategory><cbc:ID>' + c + '</cbc:ID><cbc:Percent>' + p + '</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>';
  const subtotals = d.byLine ? d.subtotals : [{ category: cat, percent: d.taxPercent, taxable: net, tax: d.taxAmount }];
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<' + root + ' xmlns="urn:oasis:names:specification:ubl:schema:xsd:' + root + '-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">',
    '  <cbc:CustomizationID>' + CUSTOMIZATION_ID + '</cbc:CustomizationID>',
    '  <cbc:ProfileID>' + PROFILE_ID + '</cbc:ProfileID>',
    '  <cbc:ID>' + esc(d.number) + '</cbc:ID>',
    '  <cbc:IssueDate>' + esc(d.date) + '</cbc:IssueDate>',
    d.kind === 'Invoice' && d.dueDate ? '  <cbc:DueDate>' + esc(d.dueDate) + '</cbc:DueDate>' : '',
    d.kind === 'Invoice' ? '  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>' : '  <cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>',
    '  <cbc:DocumentCurrencyCode>' + esc(d.currency) + '</cbc:DocumentCurrencyCode>',
    d.currency !== d.taxCurrency ? '  <cbc:TaxCurrencyCode>' + esc(d.taxCurrency) + '</cbc:TaxCurrencyCode>' : '',
    d.billingReference ? '  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>' + esc(d.billingReference) + '</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>' : '',
    party(d.seller, 'AccountingSupplierParty'),
    party(d.buyer, 'AccountingCustomerParty'),
    discount ? '  <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>' + amt('Amount', discount, d.currency) +
      taxCat(cat, d.taxPercent) + '</cac:AllowanceCharge>' : '',
    '  <cac:TaxTotal>' + amt('TaxAmount', d.taxAmount, d.currency),
    ...subtotals.map(g => '    <cac:TaxSubtotal>' + amt('TaxableAmount', g.taxable, d.currency) + amt('TaxAmount', g.tax, d.currency) + taxCat(g.category, g.percent) + '</cac:TaxSubtotal>'),
    '  </cac:TaxTotal>',
    // The VAT in the base currency too (decision 218).
    d.currency !== d.taxCurrency ? '  <cac:TaxTotal>' + amt('TaxAmount', d.taxAmount * d.rate, d.taxCurrency) + '</cac:TaxTotal>' : '',
    '  <cac:LegalMonetaryTotal>' + amt('LineExtensionAmount', lineTotal, d.currency) + amt('TaxExclusiveAmount', net, d.currency) +
      amt('TaxInclusiveAmount', round2(net + d.taxAmount), d.currency) + (discount ? amt('AllowanceTotalAmount', discount, d.currency) : '') +
      (d.roundOff ? amt('PayableRoundingAmount', d.roundOff, d.currency) : '') + amt('PayableAmount', d.total, d.currency) + '</cac:LegalMonetaryTotal>'
  ];
  d.lines.forEach(l => out.push(
    '  <cac:' + lineTag + '><cbc:ID>' + l.id + '</cbc:ID><cbc:' + qtyTag + ' unitCode="C62">' + l.quantity + '</cbc:' + qtyTag + '>' + amt('LineExtensionAmount', l.amount, d.currency) +
    '<cac:Item><cbc:Name>' + esc(l.name) + '</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>' + (l.category || cat) + '</cbc:ID><cbc:Percent>' + (l.category ? l.percent : d.taxPercent) + '</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>' +
    '<cac:Price>' + (l.category ? '<cbc:PriceAmount currencyID="' + esc(d.currency) + '">' + l.unitPrice + '</cbc:PriceAmount>' : amt('PriceAmount', l.unitPrice, d.currency)) + '</cac:Price></cac:' + lineTag + '>'));
  out.push('</' + root + '>');
  return out.filter(Boolean).join('\n');
}

// ISO 3166 alpha-2 from a country as typed ('UAE', 'United Arab Emirates', 'AE').
function countryCode(c) {
  const v = String(c || '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  const known = { 'UAE': 'AE', 'UNITED ARAB EMIRATES': 'AE', 'SAUDI ARABIA': 'SA', 'KSA': 'SA', 'OMAN': 'OM', 'QATAR': 'QA', 'BAHRAIN': 'BH', 'KUWAIT': 'KW', 'INDIA': 'IN', 'UNITED KINGDOM': 'GB', 'UK': 'GB', 'UNITED STATES': 'US', 'USA': 'US' };
  return known[v.toUpperCase()] || 'AE';
}

module.exports = { CUSTOMIZATION_ID, companyTrn, taxCategory, documentOf, readiness, toXml, countryCode, isTrn };
