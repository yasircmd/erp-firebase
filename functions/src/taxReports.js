// Tax reports (owner, 2026-10-30; docs/modules/TAX_ENGINE.md, part 5,
// Q325-Q328). New development, hand-written.
//
// One company and a period (From, To): the posted documents taxed line by
// line, never the GL. Each document's tax lines become rows, signed (a
// credit note, a purchase return, a retail return and a reversal count
// minus) and in the base currency. A reversal counts on its own date, with
// the figures of the document it reverses, so a document reversed in a
// later period stays in its own. A document posted with one tax % (before
// line tax) is left out (Q326) and counted in `leftOut`.
//
// From the rows, pure builders (no reads) make the reports:
//   summary  any regime: sales and purchases by tax code and component
//   vat201   UAE VAT: the boxes of the FTA's VAT 201 return (Q327: the
//            figures only, adjustments are made on the portal)
//   gstr1    India GST: the GST offline tool's sheets (Q328)
//   gstr3b   India GST: GSTR-3B's tables
// The figures are prepared for the person who files; filing stays outside.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const stockStore = require('./stockStore');
const { customerInvoices } = require('./salesStore');
const { vendorInvoices } = require('./purchaseStore');
const movedPaths = require('./movedPaths');
const taxConfig = require('./taxConfig');
const engine = require('./taxEngine');
const { linesOf } = require('./eInvoicing');
const { UQC } = require('./eInvoiceIndia');

const onCallOptions = { region: 'us-central1' };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
// B2CL: an inter-state invoice to an unregistered buyer above this (₹, Tax Configuration's B2CLLimit).
const B2CL_LIMIT = 100000;

// The months a period touches (yyyy-mm), for the stores' Period query.
function monthsOf(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    if (++m > 12) { m = 1; y++; }
    if (out.length > 36) throw new Error('Choose a period of three years at most.');
  }
  return out;
}

// The kinds of document, where they are and how they count.
//   side: sale | purchase; sign: +1, or -1 for a note; date: its date field;
//   reversalOf: the field naming the document a reversal reverses, and where that is.
const KINDS = {
  CustomerInvoice: { side: 'sale', sign: 1, date: 'InvoiceDate', reversalOf: 'ReversalOfInvoiceID', path: 'customerInvoices/', party: 'CustomerID' },
  SalesReturn: { side: 'sale', sign: -1, date: 'TransactionDate', reversalOf: 'ReversalOfReturnID', path: 'stock/transactions/', party: 'CustomerID' },
  RetailSale: { side: 'sale', sign: 1, date: 'TransactionDate', reversalOf: 'ReversalOfSaleID', path: 'stock/transactions/', party: 'CustomerID' },
  RetailReturn: { side: 'sale', sign: -1, date: 'TransactionDate', reversalOf: 'ReversalOfReturnID', path: 'stock/transactions/', party: 'CustomerID' },
  AssetSale: { side: 'sale', sign: 1, date: 'Date', party: 'CustomerID' },
  VendorInvoice: { side: 'purchase', sign: 1, date: 'InvoiceDate', reversalOf: 'ReversalOfInvoiceID', path: 'vendorInvoices/', party: 'VendorID' },
  PurchaseReturn: { side: 'purchase', sign: -1, date: 'TransactionDate', reversalOf: 'ReversalOfReturnID', path: 'stock/transactions/', party: 'VendorID' }
};

// The posted documents of a company dated in the period, by kind.
async function postedDocuments(companyId, from, to) {
  const months = monthsOf(from, to);
  const inPeriod = (d, field) => d && d.Status === 'Posted' && d[field] >= from && d[field] <= to;
  const out = Object.keys(KINDS).reduce((o, k) => (o[k] = [], o), {});
  const add = (kind, map) => Object.entries(map || {}).forEach(([id, d]) => { if (inPeriod(d, KINDS[kind].date)) out[kind].push(Object.assign({ _id: id }, d)); });
  await Promise.all(months.map(async period => {
    const [ci, vi, sr, rs, rr, pr, fa] = await Promise.all([
      customerInvoices.query({ CompanyID: companyId, Period: period }),
      vendorInvoices.query({ CompanyID: companyId, Period: period }),
      stockStore.queryTx({ CompanyID: companyId, Period: period, TransactionType: 'SalesReturn' }),
      stockStore.queryTx({ CompanyID: companyId, Period: period, TransactionType: 'RetailSale' }),
      stockStore.queryTx({ CompanyID: companyId, Period: period, TransactionType: 'RetailReturn' }),
      stockStore.queryTx({ CompanyID: companyId, Period: period, TransactionType: 'PurchaseReturn' }),
      firestore.collection('faPostings').where('CompanyID', '==', companyId).where('Period', '==', period).get()
    ]);
    add('CustomerInvoice', ci); add('VendorInvoice', vi); add('SalesReturn', sr); add('RetailSale', rs); add('RetailReturn', rr); add('PurchaseReturn', pr);
    const sales = {};
    fa.forEach(s => { const d = s.data(); if (d.Type === 'Retirement' && d.ProceedsTo) sales[s.id] = d; });
    add('AssetSale', sales);
  }));
  return out;
}

// A line's quantity and unit (GSTR-1's HSN summary), by its tax line's key.
function quantitiesOf(kind, doc, items, uoms) {
  const byCode = {};
  Object.values(items || {}).forEach(it => { byCode[it.ItemCode] = it; });
  const unitOf = it => (it ? UQC[String(((uoms || {})[it.UOMID] || {}).Code || '').toUpperCase()] || 'OTH' : 'OTH');
  const out = {};
  if (kind === 'CustomerInvoice' || kind === 'SalesReturn') {
    linesOf(kind === 'SalesReturn' ? 'CreditNote' : 'Invoice', doc).forEach(l => { out[l.Key] = { Qty: Number(l.Quantity) || 0, UQC: l.ItemCode ? unitOf(byCode[l.ItemCode]) : 'OTH' }; });
  } else if (kind === 'RetailSale' || kind === 'RetailReturn') {
    (doc.Lines || []).forEach(l => { out['line#' + (kind === 'RetailReturn' ? l.SaleLineNo : l.LineNo)] = { Qty: Number(l.Quantity) || 0, UQC: unitOf((items || {})[l.ItemID]) }; });
  } else if (kind === 'AssetSale') {
    (doc.TaxLines || []).forEach(t => { out[t.Key] = { Qty: 1, UQC: 'NOS' }; });
  }
  return out;
}

// The rows of one document: each tax line, signed and in the base currency.
function rowsOf(kind, doc, source, party, extra) {
  const k = KINDS[kind];
  const reversal = Boolean(k.reversalOf && doc[k.reversalOf]);
  const figures = reversal ? source : doc; // a reversal carries the figures of what it reverses
  const sign = k.sign * (reversal ? -1 : 1);
  const rate = figures.CurrencyCode && Number(figures.ExchangeRate) > 0 ? Number(figures.ExchangeRate) : (extra.rate || 1);
  const v = n => round2((Number(n) || 0) * rate * sign);
  const qty = extra.quantities || {};
  const docValue = v(kind === 'AssetSale' ? figures.ReceiptTotal : figures.Total);
  return (figures.TaxLines || []).map(t => {
    const comps = (t.Components || []).map(x => ({ Component: x.Component, Percent: Number(x.Percent) || 0, Amount: v(x.Amount),
      Recoverable: v(x.Recoverable != null ? x.Recoverable : x.Amount), NonRecoverable: v(x.NonRecoverable || 0) }));
    const q = qty[t.Key] || { Qty: 0, UQC: 'OTH' };
    return {
      Side: k.side, Kind: kind, DocID: doc._id, Number: doc.TransactionNumber || doc.PostingNumber || '', Date: doc[k.date],
      Note: sign < 0, Reversal: reversal, OrigNumber: reversal ? (source.TransactionNumber || '') : (doc.SourceInvoiceNumber || ''),
      OrigDate: reversal ? (source[k.date] || '') : (extra.origDate || ''),
      PartyID: party.id || '', PartyName: party.name || '', PartyType: party.type || '', PartyGSTIN: party.gstin || '', PartyState: party.state || '',
      PlaceOfSupply: figures.PlaceOfSupply || '', DocValue: docValue,
      Key: t.Key, TaxCode: t.TaxCode || '', Category: t.Category || '', Percent: Number(t.Percent) || 0,
      Taxable: v(t.Taxable), Tax: v(t.Tax), Components: comps,
      Recoverable: round2(comps.reduce((s, x) => s + x.Recoverable, 0)), NonRecoverable: round2(comps.reduce((s, x) => s + x.NonRecoverable, 0)),
      Reverse: Boolean(t.Reverse || (engine.CATEGORIES[t.Category] || {}).reverse),
      Goods: k.side === 'sale' ? !/^99/.test(t.HSNCode || '') && !/^direct#/.test(t.Key) : t.Kind === 'grn',
      HSN: t.HSNCode || '', Qty: round3(q.Qty * sign), UQC: q.UQC
    };
  });
}

// Every row of the period, and what was left out (documents with one tax %).
async function gather(companyId, from, to) {
  const docs = await postedDocuments(companyId, from, to);
  const [items, uoms] = await Promise.all([rtdb.ref('items').get().then(s => s.val() || {}), rtdb.ref('uoms').get().then(s => s.val() || {})]);
  const parties = {};
  const partyOf = async (kind, id) => {
    if (!id) return {};
    const path = (KINDS[kind].side === 'sale' ? 'customers/' : 'vendors/') + id;
    if (!(path in parties)) {
      const p = (await rtdb.ref(path).get()).val() || {};
      parties[path] = { id, name: p.CustomerName || p.VendorName || '', type: p.TaxRegistrationType || '', gstin: String(p.TaxRegistrationNumber || '').replace(/\s+/g, '').toUpperCase(), state: p.TaxState || '' };
    }
    return parties[path];
  };
  const rows = [];
  const leftOut = { count: 0, tax: 0, documents: [] };
  for (const kind of Object.keys(KINDS)) {
    const k = KINDS[kind];
    for (const doc of docs[kind]) {
      const reversal = k.reversalOf && doc[k.reversalOf];
      const source = reversal ? ((await movedPaths.val(k.path + reversal)) || {}) : null;
      const figures = source || doc;
      if (!figures.TaxLines) {
        const tax = round2(Number(figures.TaxAmount || figures.VatAmount) || 0);
        leftOut.count++; leftOut.tax = round2(leftOut.tax + tax * k.sign * (reversal ? -1 : 1));
        leftOut.documents.push({ Kind: kind, DocID: doc._id, Number: doc.TransactionNumber || doc.PostingNumber || '', Date: doc[k.date], Tax: tax });
        continue;
      }
      // A return's exchange rate and date are its invoice's.
      let rate = 1, origDate = '';
      if ((kind === 'SalesReturn' || kind === 'PurchaseReturn') && figures.SourceInvoiceID) {
        const inv = (await movedPaths.val((kind === 'SalesReturn' ? 'customerInvoices/' : 'vendorInvoices/') + figures.SourceInvoiceID)) || {};
        if (inv.CurrencyCode && Number(inv.ExchangeRate) > 0) rate = Number(inv.ExchangeRate);
        origDate = inv.InvoiceDate || '';
      }
      const party = await partyOf(kind, doc[k.party] || figures[k.party]);
      rows.push(...rowsOf(kind, doc, source, party, { rate, origDate, quantities: quantitiesOf(kind, figures, items, uoms) }));
    }
  }
  rows.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : a.Number < b.Number ? -1 : a.Number > b.Number ? 1 : 0));
  return { rows, leftOut };
}

// ---------- the builders (pure) ----------

const sum = (rows, f) => round2(rows.reduce((s, r) => s + (typeof f === 'function' ? f(r) : r[f]), 0));
const comp = (r, ids) => round2(r.Components.filter(x => ids.includes(x.Component)).reduce((s, x) => s + x.Amount, 0));
const docRef = r => r.Kind + ':' + r.DocID;
const refsOf = rows => [...new Set(rows.map(docRef))];

// Sales and purchases by tax code and rate, and by component.
function summary(rows) {
  const side = s => {
    const list = rows.filter(r => r.Side === s);
    const byCode = {};
    list.forEach(r => {
      const g = byCode[r.TaxCode + '|' + r.Percent] = byCode[r.TaxCode + '|' + r.Percent] || { TaxCode: r.TaxCode, Category: r.Category, Percent: r.Percent, Taxable: 0, Tax: 0, Recoverable: 0, NonRecoverable: 0, Reverse: r.Reverse, rows: [] };
      g.Taxable = round2(g.Taxable + r.Taxable); g.Tax = round2(g.Tax + r.Tax);
      g.Recoverable = round2(g.Recoverable + r.Recoverable); g.NonRecoverable = round2(g.NonRecoverable + r.NonRecoverable);
      g.rows.push(r);
    });
    const byComp = {};
    list.forEach(r => r.Components.forEach(x => {
      const c = byComp[x.Component] = byComp[x.Component] || { Component: x.Component, Amount: 0, Recoverable: 0, NonRecoverable: 0, Reverse: 0 };
      c.Amount = round2(c.Amount + x.Amount); c.Recoverable = round2(c.Recoverable + x.Recoverable); c.NonRecoverable = round2(c.NonRecoverable + x.NonRecoverable);
      if (r.Reverse) c.Reverse = round2(c.Reverse + x.Amount);
    }));
    return {
      codes: Object.values(byCode).sort((a, b) => (a.TaxCode < b.TaxCode ? -1 : a.TaxCode > b.TaxCode ? 1 : a.Percent - b.Percent))
        .map(g => Object.assign({}, g, { rows: undefined, docs: refsOf(g.rows) })),
      components: Object.values(byComp),
      Taxable: sum(list, 'Taxable'), Tax: sum(list, 'Tax'), Recoverable: sum(list, 'Recoverable'), NonRecoverable: sum(list, 'NonRecoverable'),
      Reverse: sum(list.filter(r => r.Reverse), 'Tax')
    };
  };
  const sales = side('sale'), purchases = side('purchase');
  // What is due: the output tax, and reverse charge's own; what is reclaimed: the recoverable input tax.
  const due = round2(sales.Tax + purchases.Reverse);
  return { sales, purchases, due, reclaimed: purchases.Recoverable, net: round2(due - purchases.Recoverable) };
}

// The UAE's VAT 201 (the FTA's return), boxes 1a-14 (Q327: no adjustments).
function vat201(rows, config) {
  const home = config.StateCode || '';
  const box = (list, vat) => ({ Amount: sum(list, 'Taxable'), Vat: sum(list, vat || 'Tax'), docs: refsOf(list) });
  const sales = rows.filter(r => r.Side === 'sale');
  const buys = rows.filter(r => r.Side === 'purchase');
  const standard = sales.filter(r => r.Category === 'STANDARD');
  const emirate = r => (engine.EMIRATES[r.PlaceOfSupply] ? r.PlaceOfSupply : home);
  const b = {};
  [['1a', 'AUH'], ['1b', 'DXB'], ['1c', 'SHJ'], ['1d', 'AJM'], ['1e', 'UAQ'], ['1f', 'RAK'], ['1g', 'FUJ']].forEach(([n, e]) => { b[n] = Object.assign(box(standard.filter(r => emirate(r) === e)), { Label: 'Standard rated supplies in ' + engine.EMIRATES[e] }); });
  b['2'] = { Label: 'Tax refunds provided to tourists', Amount: 0, Vat: 0, docs: [] };
  const imported = r => r.Reverse && r.Goods && r.PartyType === 'Overseas';
  b['3'] = Object.assign(box(buys.filter(r => r.Reverse && !imported(r))), { Label: 'Supplies subject to the reverse charge provisions' });
  b['4'] = Object.assign(box(sales.filter(r => r.Category === 'ZERO'), () => 0), { Label: 'Zero rated supplies', Vat: 0 });
  b['5'] = Object.assign(box(sales.filter(r => r.Category === 'EXEMPT'), () => 0), { Label: 'Exempt supplies', Vat: 0 });
  b['6'] = Object.assign(box(buys.filter(imported)), { Label: 'Goods imported into the UAE' });
  b['7'] = { Label: 'Adjustments to goods imported into the UAE', Amount: 0, Vat: 0, docs: [] };
  const out = ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '2', '3', '4', '5', '6', '7'];
  b['8'] = { Label: 'Totals', Amount: round2(out.reduce((s, n) => s + b[n].Amount, 0)), Vat: round2(out.reduce((s, n) => s + b[n].Vat, 0)), docs: [] };
  b['9'] = Object.assign(box(buys.filter(r => r.Category === 'STANDARD' && !r.Reverse), 'Recoverable'), { Label: 'Standard rated expenses' });
  b['10'] = Object.assign(box(buys.filter(r => r.Reverse), 'Recoverable'), { Label: 'Supplies subject to the reverse charge provisions' });
  b['11'] = { Label: 'Totals', Amount: round2(b['9'].Amount + b['10'].Amount), Vat: round2(b['9'].Vat + b['10'].Vat), docs: [] };
  b['12'] = { Label: 'Total value of due tax for the period', Vat: b['8'].Vat };
  b['13'] = { Label: 'Total value of recoverable tax for the period', Vat: b['11'].Vat };
  b['14'] = { Label: 'Payable tax for the period', Vat: round2(b['12'].Vat - b['13'].Vat) };
  return b;
}

// India: the state as the GST tool writes it, "27-Maharashtra".
const stateName = code => (code ? code + '-' + (engine.GST_STATES[code] || '') : '');
const rateOf = r => round2(r.Components.filter(x => x.Component !== 'CESS').reduce((s, x) => s + x.Percent, 0));
const cessOf = r => comp(r, ['CESS']);
const registered = r => ['Registered', 'Composition'].includes(r.PartyType) && r.PartyGSTIN;
const igstOf = r => comp(r, ['IGST']);
const nilKind = r => (r.Category === 'NIL' ? 'Nil' : r.Category === 'EXEMPT' ? 'Exempted' : r.Category === 'NON_GST' ? 'NonGST' : '');

// GSTR-1 as the GST offline tool's sheets (Q328).
function gstr1(rows, config) {
  const home = config.StateCode || '';
  const limit = Number(config.B2CLLimit) > 0 ? Number(config.B2CLLimit) : B2CL_LIMIT;
  const sales = rows.filter(r => r.Side === 'sale');
  const taxed = sales.filter(r => !nilKind(r));
  // One row per document and rate.
  const byDocRate = list => {
    const g = {};
    list.forEach(r => {
      const k = docRef(r) + '|' + rateOf(r);
      const x = g[k] = g[k] || { r, Rate: rateOf(r), Taxable: 0, Cess: 0, Igst: 0, docs: [docRef(r)] };
      x.Taxable = round2(x.Taxable + r.Taxable); x.Cess = round2(x.Cess + cessOf(r)); x.Igst = round2(x.Igst + igstOf(r));
    });
    return Object.values(g);
  };
  const pos = r => (r.PartyType === 'Overseas' ? '96-Other Countries' : stateName(r.PlaceOfSupply || r.PartyState || home));
  const inter = r => r.PartyType === 'Overseas' || r.PartyType === 'SEZ' || (r.PlaceOfSupply || home) !== home;
  const sezType = x => (x.Igst ? 'SEZ supplies with payment' : 'SEZ supplies without payment');
  const abs = n => round2(Math.abs(n));
  const docOf = r => ({ Number: r.Number, Date: r.Date, Value: abs(r.DocValue) });

  const b2b = [], b2cl = [], exp = [], cdnr = [], cdnur = [], b2csMap = {};
  byDocRate(taxed).forEach(x => {
    const r = x.r;
    const base = { Rate: x.Rate, Taxable: abs(x.Taxable), Cess: abs(x.Cess), docs: x.docs };
    if (!r.Note) {
      if (registered(r) || r.PartyType === 'SEZ') {
        b2b.push(Object.assign({ GSTIN: r.PartyGSTIN, Name: r.PartyName, Invoice: r.Number, Date: r.Date, Value: abs(r.DocValue), POS: pos(r),
          ReverseCharge: r.Reverse ? 'Y' : 'N', Type: r.PartyType === 'SEZ' ? sezType(x) : 'Regular B2B' }, base));
      } else if (r.PartyType === 'Overseas') {
        exp.push(Object.assign({ ExportType: x.Igst ? 'WPAY' : 'WOPAY', Invoice: r.Number, Date: r.Date, Value: abs(r.DocValue) }, base));
      } else if (inter(r) && abs(r.DocValue) > limit) {
        b2cl.push(Object.assign({ Invoice: r.Number, Date: r.Date, Value: abs(r.DocValue), POS: pos(r) }, base));
      } else {
        const k = pos(r) + '|' + x.Rate;
        const g = b2csMap[k] = b2csMap[k] || { Type: 'OE', POS: pos(r), Rate: x.Rate, Taxable: 0, Cess: 0, docs: [] };
        g.Taxable = round2(g.Taxable + x.Taxable); g.Cess = round2(g.Cess + x.Cess); g.docs.push(...x.docs);
      }
    } else if (registered(r) || r.PartyType === 'SEZ') {
      cdnr.push(Object.assign({ GSTIN: r.PartyGSTIN, Name: r.PartyName, Note: r.Number, Date: r.Date, NoteType: 'C', POS: pos(r), ReverseCharge: r.Reverse ? 'Y' : 'N',
        SupplyType: r.PartyType === 'SEZ' ? sezType(x) : 'Regular B2B', Value: abs(r.DocValue) }, base));
    } else if (r.PartyType === 'Overseas' || (inter(r) && abs(r.DocValue) > limit)) {
      cdnur.push(Object.assign({ URType: r.PartyType === 'Overseas' ? (x.Igst ? 'EXPWP' : 'EXPWOP') : 'B2CL', Note: r.Number, Date: r.Date, NoteType: 'C', POS: pos(r), Value: abs(r.DocValue) }, base));
    } else {
      // A credit note to a consumer reduces B2CS (the tool's practice).
      const k = pos(r) + '|' + x.Rate;
      const g = b2csMap[k] = b2csMap[k] || { Type: 'OE', POS: pos(r), Rate: x.Rate, Taxable: 0, Cess: 0, docs: [] };
      g.Taxable = round2(g.Taxable + x.Taxable); g.Cess = round2(g.Cess + x.Cess); g.docs.push(...x.docs);
    }
  });
  // Nil rated, exempt and non-GST, by inter / intra-state and registered or not.
  const exemp = ['Inter-State supplies to registered persons', 'Intra-State supplies to registered persons', 'Inter-State supplies to unregistered persons', 'Intra-State supplies to unregistered persons']
    .map(Description => ({ Description, Nil: 0, Exempted: 0, NonGST: 0, docs: [] }));
  sales.filter(nilKind).forEach(r => {
    const row = exemp[(inter(r) ? 0 : 1) + (registered(r) || r.PartyType === 'SEZ' ? 0 : 2)];
    row[nilKind(r)] = round2(row[nilKind(r)] + r.Taxable); row.docs.push(docRef(r));
  });
  // The HSN summary, B2B and B2C apart; notes reduce it.
  const hsnOf = list => {
    const g = {};
    list.forEach(r => {
      const k = (r.HSN || '') + '|' + r.UQC + '|' + rateOf(r);
      const x = g[k] = g[k] || { HSN: r.HSN || '', UQC: r.UQC, Rate: rateOf(r), Qty: 0, Value: 0, Taxable: 0, Igst: 0, Cgst: 0, Sgst: 0, Cess: 0 };
      x.Qty = round3(x.Qty + r.Qty); x.Value = round2(x.Value + r.Taxable + r.Tax); x.Taxable = round2(x.Taxable + r.Taxable);
      x.Igst = round2(x.Igst + igstOf(r)); x.Cgst = round2(x.Cgst + comp(r, ['CGST'])); x.Sgst = round2(x.Sgst + comp(r, ['SGST', 'UTGST'])); x.Cess = round2(x.Cess + cessOf(r));
    });
    return Object.values(g).sort((a, b) => (a.HSN < b.HSN ? -1 : a.HSN > b.HSN ? 1 : a.Rate - b.Rate));
  };
  const b2bLike = r => registered(r) || r.PartyType === 'SEZ';
  // Documents issued: each series' first and last number, and how many (a reversed one counted as cancelled).
  const series = {};
  sales.forEach(r => {
    if (!r.Number) return;
    const nature = r.Note ? (r.Reversal ? 'Invoices for outward supply' : 'Credit Note') : 'Invoices for outward supply';
    const number = r.Reversal ? r.OrigNumber : r.Number;
    const prefix = number.replace(/\d+$/, '');
    const s = series[nature + '|' + prefix] = series[nature + '|' + prefix] || { Nature: nature, numbers: new Set(), cancelled: new Set() };
    s.numbers.add(number);
    if (r.Reversal) s.cancelled.add(number);
  });
  const docsIssued = Object.values(series).map(s => {
    const list = [...s.numbers].sort();
    return { Nature: s.Nature, From: list[0], To: list[list.length - 1], Total: list.length, Cancelled: s.cancelled.size };
  });
  return {
    b2b, b2cl, b2cs: Object.values(b2csMap).filter(g => g.Taxable || g.Cess), exp, cdnr, cdnur, exemp,
    hsnB2B: hsnOf(sales.filter(b2bLike)), hsnB2C: hsnOf(sales.filter(r => !b2bLike(r))), docs: docsIssued, B2CLLimit: limit
  };
}

// GSTR-3B's tables.
function gstr3b(rows, config) {
  const home = config.StateCode || '';
  const sales = rows.filter(r => r.Side === 'sale');
  const buys = rows.filter(r => r.Side === 'purchase');
  const line = (Label, list) => ({
    Label, Taxable: sum(list, 'Taxable'), Igst: sum(list, r => comp(r, ['IGST'])), Cgst: sum(list, r => comp(r, ['CGST'])),
    Sgst: sum(list, r => comp(r, ['SGST', 'UTGST'])), Cess: sum(list, r => comp(r, ['CESS'])), docs: refsOf(list)
  });
  const credit = (Label, list, field) => {
    const c = ids => sum(list, r => r.Components.filter(x => ids.includes(x.Component)).reduce((s, x) => s + (field === 'all' ? x.Amount : x[field]), 0));
    return { Label, Igst: c(['IGST']), Cgst: c(['CGST']), Sgst: c(['SGST', 'UTGST']), Cess: c(['CESS']), docs: refsOf(list) };
  };
  const zeroRated = r => r.PartyType === 'Overseas' || r.PartyType === 'SEZ';
  const t31 = {
    a: line('(a) Outward taxable supplies (other than zero rated, nil rated and exempted)', sales.filter(r => !nilKind(r) && r.Category !== 'ZERO' && !zeroRated(r))),
    b: line('(b) Outward taxable supplies (zero rated)', sales.filter(r => !nilKind(r) && (r.Category === 'ZERO' || zeroRated(r)))),
    c: line('(c) Other outward supplies (nil rated, exempted)', sales.filter(r => r.Category === 'NIL' || r.Category === 'EXEMPT')),
    d: line('(d) Inward supplies (liable to reverse charge)', buys.filter(r => r.Reverse)),
    e: line('(e) Non-GST outward supplies', sales.filter(r => r.Category === 'NON_GST'))
  };
  // 3.2: inter-state supplies to unregistered persons, by place of supply.
  const unreg = sales.filter(r => !nilKind(r) && !registered(r) && !zeroRated(r) && (r.PlaceOfSupply || home) !== home);
  const places = {};
  unreg.forEach(r => {
    const p = places[r.PlaceOfSupply] = places[r.PlaceOfSupply] || { POS: stateName(r.PlaceOfSupply), Taxable: 0, Igst: 0, docs: [] };
    p.Taxable = round2(p.Taxable + r.Taxable); p.Igst = round2(p.Igst + igstOf(r)); p.docs.push(docRef(r));
  });
  // 4: input tax credit, the full tax of each purchase in (A), what can't be reclaimed reversed in (B).
  const taxedBuys = buys.filter(r => !nilKind(r) && r.Tax);
  const overseas = r => r.PartyType === 'Overseas';
  const a = {
    1: credit('(1) Import of goods', taxedBuys.filter(r => overseas(r) && r.Goods), 'all'),
    2: credit('(2) Import of services', taxedBuys.filter(r => overseas(r) && !r.Goods), 'all'),
    3: credit('(3) Inward supplies liable to reverse charge (other than 1 and 2)', taxedBuys.filter(r => r.Reverse && !overseas(r)), 'all'),
    4: { Label: '(4) Inward supplies from ISD', Igst: 0, Cgst: 0, Sgst: 0, Cess: 0, docs: [] },
    5: credit('(5) All other ITC', taxedBuys.filter(r => !r.Reverse && !overseas(r)), 'all')
  };
  const b1 = credit('(1) As per rules 38, 42 and 43 of CGST Rules and section 17(5)', taxedBuys.filter(r => r.NonRecoverable), 'NonRecoverable');
  const b2 = { Label: '(2) Others', Igst: 0, Cgst: 0, Sgst: 0, Cess: 0, docs: [] };
  const net = ['Igst', 'Cgst', 'Sgst', 'Cess'].reduce((o, k) => (o[k] = round2([1, 2, 3, 4, 5].reduce((s, n) => s + a[n][k], 0) - b1[k] - b2[k]), o), { Label: '(C) Net ITC available (A) - (B)' });
  // 5: exempt, nil rated and non-GST inward supplies, inter and intra-state.
  const inward = buys.filter(nilKind);
  const t5 = [
    { Label: 'From a supplier under composition scheme, exempt and nil rated supply', Inter: sum(inward.filter(r => r.Category !== 'NON_GST' && (r.PlaceOfSupply || home) !== home), 'Taxable'), Intra: sum(inward.filter(r => r.Category !== 'NON_GST' && (r.PlaceOfSupply || home) === home), 'Taxable') },
    { Label: 'Non-GST supply', Inter: sum(inward.filter(r => r.Category === 'NON_GST' && (r.PlaceOfSupply || home) !== home), 'Taxable'), Intra: sum(inward.filter(r => r.Category === 'NON_GST' && (r.PlaceOfSupply || home) === home), 'Taxable') }
  ];
  // 6.1: what is payable, by component: the output tax less the net credit; reverse charge is paid in cash.
  const payable = ['Igst', 'Cgst', 'Sgst', 'Cess'].map(k => {
    const other = round2(t31.a[k] + t31.b[k]);
    return { Tax: { Igst: 'Integrated tax', Cgst: 'Central tax', Sgst: 'State/UT tax', Cess: 'Cess' }[k], Payable: other, ReverseCharge: t31.d[k], Credit: net[k], Cash: round2(Math.max(0, other - net[k]) + t31.d[k]) };
  });
  return { t31, t32: Object.values(places), t4: { a, b: { 1: b1, 2: b2 }, net }, t5, t61: payable };
}

// ---------- the callable ----------

const REPORTS = { summary: null, vat201: 'AE_VAT', gstr1: 'IN_GST', gstr3b: 'IN_GST' };

// getTaxReport({ companyId, from, to, report }) -> the report, the
// documents behind it (by "Kind:DocID") and what was left out;
// report 'regime' -> the company's regime only.
exports.getTaxReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('TAXREPORTS', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Tax Reports.');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const from = text(d.from, 10), to = text(d.to, 10), report = text(d.report, 20);
  // The screen first asks which reports the company's regime has.
  if (report === 'regime') {
    const c = await taxConfig.configFor(companyId);
    return c ? { configured: true, regime: c.Regime, B2CLLimit: c.B2CLLimit || null } : { configured: false };
  }
  if (!isDate(from) || !isDate(to) || from > to) throw new HttpsError('invalid-argument', 'Choose the period: a From date on or before the To date.');
  if (!(report in REPORTS)) throw new HttpsError('invalid-argument', 'Choose a report.');
  const config = await taxConfig.configFor(companyId);
  if (!config) return { configured: false };
  if (REPORTS[report] && REPORTS[report] !== config.Regime) {
    throw new HttpsError('failed-precondition', 'This report is for ' + (REPORTS[report] === 'AE_VAT' ? 'UAE VAT' : 'India GST') + '; this company\'s regime is ' + (config.Regime || 'its own') + '.');
  }
  const { rows, leftOut } = await gather(companyId, from, to);
  const built = { summary, vat201, gstr1, gstr3b }[report](rows, config);
  const docs = {};
  rows.forEach(r => {
    const k = docRef(r);
    const x = docs[k] = docs[k] || { Kind: r.Kind, DocID: r.DocID, Number: r.Number, Date: r.Date, Party: r.PartyName, Taxable: 0, Tax: 0 };
    x.Taxable = round2(x.Taxable + r.Taxable); x.Tax = round2(x.Tax + r.Tax);
  });
  return { configured: true, regime: config.Regime, report, from, to, data: built, docs, leftOut };
});

module.exports = Object.assign(exports, { monthsOf, rowsOf, gather, summary, vat201, gstr1, gstr3b, B2CL_LIMIT });
