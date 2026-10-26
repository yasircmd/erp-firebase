// India's e-invoice (TAX_ENGINE.md, part 2, Q321): a posted Customer Invoice
// (or a Sales Return, as a credit note) of a company under India GST as the
// IRP's JSON (e-invoice schema 1.1), and whether it is ready to report. Pure:
// no I/O. New development, hand-written.
//
// Ready, not connected (Q321): the JSON is built and kept; the IRN, the
// acknowledgement and the signed QR come from the IRP through a GSP once one
// is chosen (eInvoiceConnector.js). The fields follow the NIC schema 1.1 as
// published; the GSP validates against its current version, and any field
// it needs beyond these is added then. Dates are dd/mm/yyyy because the
// schema says so (this is a file for the IRP, not a screen).
'use strict';
const engine = require('./taxEngine');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const irpDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const pin = v => { const s = String(v || '').replace(/\s+/g, ''); return /^[1-9]\d{5}$/.test(s) ? Number(s) : null; };
// The IRP's units (UQC) for the common units; others as OTH.
const UQC = { PCS: 'PCS', NOS: 'NOS', KG: 'KGS', KGS: 'KGS', LTR: 'LTR', MTR: 'MTR', BOX: 'BOX', SET: 'SET', TON: 'TON', GMS: 'GMS', DOZ: 'DOZ', PAC: 'PAC', ROL: 'ROL', SQM: 'SQM' };

// The company's GSTIN: its tax number of type GSTIN (else one that reads as one).
function companyGstin(company) {
  const list = (company && company.TaxNumbers) || [];
  const hit = list.find(t => /gst/i.test(t.Type || '')) || list.find(t => !engine.gstinProblem(String(t.Number || '').toUpperCase()));
  return hit ? String(hit.Number || '').replace(/\s+/g, '').toUpperCase() : '';
}

// The supply type: B2B, to an SEZ or an export, with or without IGST paid.
function supplyType(buyerType, igst) {
  if (buyerType === 'SEZ') return igst ? 'SEZWP' : 'SEZWOP';
  if (buyerType === 'Overseas') return igst ? 'EXPWP' : 'EXPWOP';
  return 'B2B';
}

// The document's facts, from the posted record.
//   kind: 'Invoice' | 'CreditNote'; lines: [{ Key, Description, Quantity, UnitPrice, Amount, Unit }]
function documentOf(kind, doc, company, customer, lines) {
  const byKey = new Map((doc.TaxLines || []).map(t => [t.Key, t]));
  const buyerType = customer.TaxRegistrationType || '';
  const overseas = buyerType === 'Overseas';
  const items = (lines || []).map((l, i) => {
    const t = byKey.get(l.Key) || { Taxable: l.Amount, Percent: 0, Components: [], Tax: 0 };
    const comp = id => round2((t.Components || []).filter(x => x.Component === id).reduce((s, x) => s + x.Amount, 0));
    const cess = (t.Components || []).find(x => x.Component === 'CESS');
    const gross = round2(l.Amount);
    const ass = round2(t.Taxable);
    const hsn = t.HSNCode || '';
    return {
      SlNo: String(i + 1), PrdDesc: String(l.Description || '').slice(0, 300), IsServc: /^99/.test(hsn) ? 'Y' : 'N', HsnCd: hsn,
      Qty: round3(l.Quantity || 1), Unit: UQC[String(l.Unit || '').toUpperCase()] || 'OTH', UnitPrice: round3(l.UnitPrice),
      // An inclusive price's tax is in its amount: the assessable value is net of the tax and the discount.
      TotAmt: gross, Discount: round2(Math.max(0, gross - ass - (t.Inclusive ? t.Tax : 0))), AssAmt: ass,
      GstRt: round2((t.Components || []).filter(x => x.Component !== 'CESS').reduce((s, x) => s + x.Percent, 0)),
      IgstAmt: comp('IGST'), CgstAmt: comp('CGST'), SgstAmt: round2(comp('SGST') + comp('UTGST')),
      CesRt: cess ? cess.Percent : 0, CesAmt: comp('CESS'),
      TotItemVal: round2(ass + t.Tax)
    };
  });
  const sum = k => round2(items.reduce((s, x) => s + x[k], 0));
  const igst = sum('IgstAmt') > 0;
  return {
    kind, number: doc.TransactionNumber || '', date: doc.InvoiceDate || doc.TransactionDate || '', regime: doc.TaxRegime || '',
    supply: supplyType(buyerType, igst), billingReference: doc.BillingReference || '', billingDate: doc.BillingDate || '',
    seller: { gstin: companyGstin(company), name: company.LegalName || '', addr1: company.AddressLine1 || '', addr2: company.AddressLine2 || '', loc: company.City || '', pin: pin(company.PostalCode), state: (company.TaxStateCode || '') },
    buyer: {
      gstin: overseas ? 'URP' : String(customer.TaxRegistrationNumber || '').replace(/\s+/g, '').toUpperCase(), name: customer.CustomerName || '',
      addr1: customer.AddressLine1 || '', addr2: customer.AddressLine2 || '', loc: customer.City || '', pin: overseas ? 999999 : pin(customer.PostalCode),
      state: overseas ? '96' : (customer.TaxState || ''), pos: overseas ? '96' : (doc.PlaceOfSupply || customer.TaxState || ''), type: buyerType
    },
    items,
    values: { AssVal: sum('AssAmt'), CgstVal: sum('CgstAmt'), SgstVal: sum('SgstAmt'), IgstVal: sum('IgstAmt'), CesVal: sum('CesAmt'),
      RndOffAmt: round2(doc.RoundOff), TotInvVal: round2(doc.Total) }
  };
}

// What stops it being reported: [] when ready. Only supplies to a
// registered business, an SEZ or abroad are e-invoiced (a consumer or an
// unregistered buyer is not): status NotApplicable.
function readiness(d) {
  const b2b = ['Registered', 'Composition', 'SEZ', 'Overseas'].includes(d.buyer.type);
  if (!b2b) return { status: 'NotApplicable', issues: ['The customer is not a registered business, an SEZ or abroad (Customer Master → Tax registration type): not e-invoiced.'] };
  const issues = [];
  if (d.regime !== 'IN_GST') issues.push('The document was not taxed under India GST.');
  if (engine.gstinProblem(d.seller.gstin)) issues.push('The company\'s GSTIN is missing or not valid (Company Master → Tax numbers, type GSTIN).');
  if (d.buyer.gstin !== 'URP' && engine.gstinProblem(d.buyer.gstin)) issues.push('The customer\'s GSTIN is missing or not valid (Customer Master).');
  if (!d.seller.addr1 || String(d.seller.loc).length < 3 || !d.seller.pin) issues.push('The company\'s address, city and PIN code are needed (Company Master).');
  if (!d.buyer.addr1 || String(d.buyer.loc).length < 3 || !d.buyer.pin) issues.push('The customer\'s address, city and PIN code are needed (Customer Master).');
  if (!d.buyer.pos) issues.push('The document has no place of supply.');
  if (!d.number) issues.push('The document has no number yet.');
  if (!d.items.length) issues.push('The document has no lines.');
  d.items.forEach(x => { if (engine.hsnProblem(x.HsnCd) || !x.HsnCd) issues.push('Line ' + x.SlNo + ' (' + x.PrdDesc + '): its item needs an HSN or SAC code (Item Master).'); });
  if (d.kind === 'CreditNote' && !d.billingReference) issues.push('The credit note names no invoice.');
  return { status: issues.length ? 'NotReady' : 'Ready', issues };
}

// The IRP's JSON (schema 1.1), as a string.
function toJson(d) {
  const party = (p, buyer) => Object.assign({ Gstin: p.gstin, LglNm: p.name, Addr1: p.addr1 }, p.addr2 ? { Addr2: p.addr2 } : {},
    { Loc: p.loc, Pin: p.pin, Stcd: p.state || (p.gstin || '').slice(0, 2) }, buyer ? { Pos: p.pos } : {});
  const out = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: d.supply, RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: d.kind === 'CreditNote' ? 'CRN' : 'INV', No: d.number, Dt: irpDate(d.date) },
    SellerDtls: party(d.seller, false),
    BuyerDtls: party(d.buyer, true),
    ItemList: d.items,
    ValDtls: d.values
  };
  if (d.kind === 'CreditNote' && d.billingReference) out.RefDtls = { PrecDocDtls: [Object.assign({ InvNo: d.billingReference }, d.billingDate ? { InvDt: irpDate(d.billingDate) } : {})] };
  return JSON.stringify(out, null, 2);
}

module.exports = { companyGstin, supplyType, documentOf, readiness, toJson, irpDate };
