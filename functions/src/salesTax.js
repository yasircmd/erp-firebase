// Line tax on sales documents (UX round 2, item 32, part 2; owner,
// 2026-10-26; docs/modules/TAX_ENGINE.md, Q313-Q318). New development,
// hand-written. A company with a Tax Configuration (taxConfig.js) charges
// tax line by line: each line's code from its item (or its Sales Type),
// changed on the line only with the document's "taxcode" right (Q313); the
// rate valid on the document's date (Q317); GST's components from the place
// of supply (Q318); prices inclusive where the line's price list says so
// (Q314); rounded per line or per code on the document (Q315). A company
// without one keeps the single Tax % (the legacy behaviour, unchanged).
//
// computeTax is pure (the unit tests drive it); invoiceTax gathers a
// Customer Invoice's lines and calls it (the legacy save, patch
// invoice-line-tax); the posting and reversal take the components it
// stored (componentGlLines).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const engine = require('./taxEngine');
const taxConfig = require('./taxConfig');
const stockStore = require('./stockStore');
const { salesOrders } = require('./salesStore');

const round2 = engine.round2;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 40);

// Split `total` over `weights` in proportion, in cents, the last taking the rest.
function apportion(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum || !total) return weights.map(() => 0);
  let left = round2(total);
  return weights.map((w, i) => {
    if (i === weights.length - 1) return round2(left);
    const part = round2(total * w / sum);
    left = round2(left - part);
    return part;
  });
}

// lines: [{ Key, Code, Amount, Inclusive }] (Amount before the discount).
// opts: { date, placeOfSupply, partyType, discount, sale }.
// A sale under reverse charge charges nothing: the buyer accounts for it.
function computeTax(config, lines, opts) {
  const o = opts || {};
  const shares = apportion(Number(o.discount) || 0, lines.map(l => Math.max(0, Number(l.Amount) || 0)));
  const work = lines.map((l, i) => {
    const c = (config.Codes || []).find(x => x.Code === l.Code);
    if (!c) throw new Error('Tax code ' + l.Code + ' is not set up for this company (Tax Configuration).');
    const comps = o.sale && engine.CATEGORIES[c.Category].reverse ? [] : engine.componentsOf(config, l.Code, o.date, o);
    const pct = comps.reduce((s, x) => s + x.Percent, 0);
    const base = round2((Number(l.Amount) || 0) - shares[i]);
    const net = l.Inclusive ? base / (1 + pct / 100) : base;
    return { l, c, comps, pct, base, raw: comps.map(x => net * x.Percent / 100) };
  });
  // Per line: each component rounded on its line. Per document: each code's
  // component rounded on its total, the cents put on its largest line.
  const amounts = work.map(w => w.raw.map(round2));
  if (config.Rounding === 'document') {
    const groups = {};
    work.forEach((w, i) => w.comps.forEach((x, j) => {
      const g = groups[w.l.Code + '|' + x.Component] = groups[w.l.Code + '|' + x.Component] || { raw: 0, cells: [] };
      g.raw += w.raw[j]; g.cells.push([i, j]);
    }));
    Object.values(groups).forEach(g => {
      const diff = round2(round2(g.raw) - g.cells.reduce((s, [i, j]) => s + amounts[i][j], 0));
      if (!diff) return;
      const [bi, bj] = g.cells.reduce((best, cell) => (Math.abs(work[cell[0]].base) > Math.abs(work[best[0]].base) ? cell : best));
      amounts[bi][bj] = round2(amounts[bi][bj] + diff);
    });
  }
  const taxLines = work.map((w, i) => {
    const tax = round2(amounts[i].reduce((s, a) => s + a, 0));
    return {
      Key: w.l.Key, TaxCode: w.c.Code, Category: w.c.Category, Percent: Math.round(w.pct * 10000) / 10000, Inclusive: Boolean(w.l.Inclusive),
      Taxable: w.l.Inclusive ? round2(w.base - tax) : w.base, Tax: tax,
      Components: w.comps.map((x, j) => ({ Component: x.Component, Percent: x.Percent, Amount: amounts[i][j] }))
    };
  });
  return summarize(id => (config.Components || []).find(c => c.Code === id), taxLines, o);
}

// The document's totals from its lines (a return's share of them too).
// accountsOf(component) gives its { OutputAccountID, InputAccountID }.
function summarize(accountsOf, taxLines, o) {
  const byCode = {}, byComp = {};
  taxLines.forEach(t => {
    const s = byCode[t.TaxCode + '|' + t.Percent] = byCode[t.TaxCode + '|' + t.Percent] || { TaxCode: t.TaxCode, Category: t.Category, Percent: t.Percent, Taxable: 0, Tax: 0, Components: {} };
    s.Taxable = round2(s.Taxable + t.Taxable); s.Tax = round2(s.Tax + t.Tax);
    t.Components.forEach(x => {
      s.Components[x.Component] = round2((s.Components[x.Component] || 0) + x.Amount);
      byComp[x.Component] = round2((byComp[x.Component] || 0) + x.Amount);
    });
  });
  const comp = id => accountsOf(id) || {};
  return {
    TaxRegime: (o || {}).regime || '', TaxRounding: (o || {}).rounding || '', PlaceOfSupply: (o || {}).placeOfSupply || '',
    TaxLines: taxLines,
    TaxSummary: Object.values(byCode),
    TaxComponents: Object.keys(byComp).filter(k => byComp[k]).map(k => ({ Component: k, Amount: byComp[k], OutputAccountID: comp(k).OutputAccountID || '', InputAccountID: comp(k).InputAccountID || '' })),
    TaxAmount: round2(taxLines.reduce((s, t) => s + t.Tax, 0)),
    TaxAdded: round2(taxLines.filter(t => !t.Inclusive).reduce((s, t) => s + t.Tax, 0)),
    TaxIncluded: round2(taxLines.filter(t => t.Inclusive).reduce((s, t) => s + t.Tax, 0))
  };
}

// A part of a document's lines (a return of some quantity): each line's
// taxable and components scaled by its fraction, rounded per line; the
// accounts the document posted to.
function shareOf(doc, fractions) {
  const lines = (doc.TaxLines || []).filter(t => fractions[t.Key] > 0).map(t => {
    const f = fractions[t.Key];
    const comps = (t.Components || []).map(x => ({ Component: x.Component, Percent: x.Percent, Amount: f >= 1 ? x.Amount : round2(x.Amount * f) }));
    return Object.assign({}, t, { Taxable: f >= 1 ? t.Taxable : round2(t.Taxable * f), Tax: round2(comps.reduce((s, x) => s + x.Amount, 0)), Components: comps });
  });
  const accounts = id => (doc.TaxComponents || []).find(x => x.Component === id);
  return summarize(accounts, lines, { placeOfSupply: doc.PlaceOfSupply, regime: doc.TaxRegime, rounding: doc.TaxRounding });
}

// The GL lines for a document's tax components: output tax credited on a
// sale (debited when `reverse`). The accounts as configured when it posted.
function componentGlLines(doc, coa, opts) {
  const o = opts || {};
  return (doc.TaxComponents || []).filter(x => x.Amount).map(x => {
    const id = o.input ? x.InputAccountID : x.OutputAccountID;
    const a = coa[id];
    if (!a || !a.IsPostable) throw new Error('The ' + x.Component + ' ' + (o.input ? 'input' : 'output') + ' tax account is not set or no longer valid: check Tax Configuration.');
    const amt = round2(Math.abs(x.Amount));
    const credit = (x.Amount > 0) !== Boolean(o.reverse);
    return { AccountCode: a.AccountCode, Debit: credit ? 0 : amt, Credit: credit ? amt : 0, Description: (o.label || 'Output tax') + ' ' + x.Component + ' — ' + (o.description || ''), CostCenterID: o.costCenterId || '', ProfitCenterID: o.profitCenterId || '' };
  });
}

async function priceListIncludesTax(cache, soId) {
  if (!soId) return false;
  if (!(soId in cache)) {
    const so = await salesOrders.get(soId);
    const pl = so && so.PriceListID ? (await rtdb.ref('priceLists/' + so.PriceListID).get()).val() : null;
    cache[soId] = Boolean(pl && pl.PricesIncludeTax);
  }
  return cache[soId];
}

// A Customer Invoice's tax (patch invoice-line-tax), or null where the
// company has no Tax Configuration (the single Tax % as before).
// p: { companyId, customer, date, invoiceData, before, role,
//      sourceDeliveryNotes, itemLines, directLines, discount }
async function invoiceTax(p) {
  const config = await taxConfig.configFor(p.companyId);
  if (!config) return null;
  const d = p.invoiceData || {};
  const asked = {};
  (Array.isArray(d.LineTaxCodes) ? d.LineTaxCodes : []).forEach(x => { if (x && x.Key && x.TaxCode) asked[text(x.Key, 80)] = text(x.TaxCode, 12).toUpperCase(); });
  const before = {};
  ((p.before || {}).TaxLines || []).forEach(t => { before[t.Key] = t.TaxCode; });
  const [items, salesTypes] = await Promise.all([rtdb.ref('items').get().then(s => s.val() || {}), rtdb.ref('salesTypes').get().then(s => s.val() || {})]);
  const itemByCode = {};
  Object.keys(items).forEach(id => { itemByCode[items[id].ItemCode] = items[id]; });
  const soCache = {};
  const raw = [];
  for (const dn of p.sourceDeliveryNotes || []) {
    const rec = await stockStore.getTx(dn.DeliveryNoteID);
    const recLines = (rec && rec.Lines) || [];
    const amounts = (dn.Lines || []).map(l => round2(l.Quantity * l.UnitPrice));
    const fix = round2(dn.Amount - amounts.reduce((s, a) => s + a, 0)); // the DN's own rounding, on its last line
    if (amounts.length) amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + fix);
    for (let i = 0; i < (dn.Lines || []).length; i++) {
      const l = dn.Lines[i], r = recLines[i] || {};
      raw.push({ Key: dn.DeliveryNoteID + '#' + (Number(r.LineNo) || i + 1), Label: (dn.DeliveryNoteNumber || dn.DeliveryNoteID) + ' ' + l.ItemCode, ItemCode: l.ItemCode, SalesTypeID: dn.SalesTypeID, Amount: amounts[i], Inclusive: await priceListIncludesTax(soCache, r.SourceSOID) });
    }
  }
  for (let i = 0; i < (p.itemLines || []).length; i++) {
    const l = p.itemLines[i];
    raw.push({ Key: 'item#' + (i + 1), Label: 'Item line ' + (i + 1) + ' ' + l.ItemCode, ItemCode: l.ItemCode, SalesTypeID: d.ItemSalesTypeID, Amount: l.Amount, Inclusive: await priceListIncludesTax(soCache, l.SourceSOID) });
  }
  (p.directLines || []).forEach((l, i) => raw.push({ Key: 'direct#' + (i + 1), Label: 'Direct line ' + (i + 1) + (l.Description ? ' ' + text(l.Description, 60) : ''), SalesTypeID: l.SalesTypeID, Amount: l.Amount, Inclusive: false }));

  let mayChange = null;
  const lines = [];
  for (const l of raw) {
    const item = l.ItemCode ? itemByCode[l.ItemCode] : null;
    const def = (item && item.TaxCode) || (salesTypes[l.SalesTypeID] || {}).TaxCode || '';
    const code = asked[l.Key] || def;
    if (!code) throw new Error(l.Label + ': no tax code. Give ' + (item ? 'the item one in Item Master, or ' : '') + 'its Sales Type a default tax code (Sales Invoice Configuration).');
    if (code !== def && code !== before[l.Key]) {
      if (mayChange === null) mayChange = await moduleHasCapability('CUSTOMERINVOICE', 'taxcode', p.role);
      if (!mayChange) throw new Error(l.Label + ': changing a line\'s tax code needs the Customer Invoice "change tax code" right.');
    }
    const c = (config.Codes || []).find(x => x.Code === code);
    if (!c) throw new Error(l.Label + ': tax code ' + code + ' is not set up for this company (Tax Configuration).');
    if (c.Active === false && code !== before[l.Key]) throw new Error(l.Label + ': tax code ' + code + ' is inactive (Tax Configuration).');
    lines.push({ Key: l.Key, Code: code, Amount: l.Amount, Inclusive: l.Inclusive, HSNCode: (item && item.HSNCode) || '' });
  }
  const customer = p.customer || {};
  const partyType = customer.TaxRegistrationType || '';
  let place = text(d.PlaceOfSupply, 3).toUpperCase() || customer.TaxState || '';
  if (config.Regime === 'IN_GST') {
    if (place && !engine.GST_STATES[place]) throw new Error('Choose a valid place of supply (a GST state).');
    if (!place && partyType !== 'Overseas' && partyType !== 'SEZ') throw new Error('Choose the place of supply: the state the goods or services go to (the customer\'s state in Customer Master).');
  } else if (config.Regime === 'AE_VAT' && place && !engine.EMIRATES[place]) place = '';
  const out = computeTax(config, lines, { date: p.date, placeOfSupply: place, partyType, discount: p.discount, sale: true, regime: config.Regime, rounding: config.Rounding });
  out.TaxLines.forEach((t, i) => { t.Label = raw[i].Label; if (lines[i].HSNCode) t.HSNCode = lines[i].HSNCode; });
  out.CustomerTaxType = partyType;
  return out;
}

// The tax a delivery's inclusive lines hold (its revenue is net of it).
// An invoice's own item lines (its automatic Delivery Note) are keyed item#n.
function includedTaxOf(doc, dnId) {
  const auto = doc.AutoDeliveryNoteID && doc.AutoDeliveryNoteID === dnId;
  return round2(((doc || {}).TaxLines || []).filter(t => t.Inclusive && (t.Key.startsWith(dnId + '#') || (auto && t.Key.startsWith('item#')))).reduce((s, t) => s + t.Tax, 0));
}

// The codes a company's posted documents use: kept so Tax Configuration
// won't remove them (taxConfig.usedCodes).
async function recordCodeUse(companyId, doc) {
  const codes = [...new Set(((doc || {}).TaxLines || []).map(t => t.TaxCode).filter(Boolean))];
  if (!codes.length) return;
  const set = { UpdatedAt: new Date().toISOString() };
  codes.forEach(c => { set[c] = true; });
  await firestore.collection('taxCodeUse').doc(companyId).set(set, { merge: true });
}

// The Customer Invoice screen's tax, as its save will work it out: each
// line's code, rate and tax, the summary, the codes it may choose from.
// { configured: false } for a company without a Tax Configuration.
exports.previewInvoiceTax = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('CUSTOMERINVOICE', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Customer Invoice.');
  const d = (request.data || {}).invoiceData || {};
  const companyId = text(d.CompanyID, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const config = await taxConfig.configFor(companyId);
  if (!config) return { configured: false };
  const customer = d.CustomerID ? (await rtdb.ref('customers/' + text(d.CustomerID, 80)).get()).val() : null;
  const sourceDeliveryNotes = [];
  for (const x of (Array.isArray(d.SourceDeliveryNotes) ? d.SourceDeliveryNotes : []).slice(0, 100)) {
    const dn = x && x.DeliveryNoteID ? await stockStore.getTx(text(x.DeliveryNoteID, 80)) : null;
    if (!dn || dn.TransactionType !== 'DeliveryNote' || dn.CompanyID !== companyId) continue;
    const lines = (dn.Lines || []).map(l => ({ ItemCode: l.ItemCode, Quantity: Number(l.Quantity) || 0, UnitPrice: Number(l.UnitPrice) || 0 }));
    sourceDeliveryNotes.push({ DeliveryNoteID: x.DeliveryNoteID, DeliveryNoteNumber: dn.TransactionNumber || '', SalesTypeID: text(x.SalesTypeID, 80), Lines: lines, Amount: round2(lines.reduce((s, l) => s + l.Quantity * l.UnitPrice, 0)) });
  }
  const itemLines = (Array.isArray(d.ItemLines) ? d.ItemLines : []).filter(l => l && l.ItemCode).slice(0, 200)
    .map(l => ({ ItemCode: text(l.ItemCode, 60), SourceSOID: text(l.SourceSOID, 80), Amount: round2((Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0)) }));
  const directLines = (Array.isArray(d.DirectLines) ? d.DirectLines : []).filter(l => l && String(l.AccountCode || '').trim()).slice(0, 200)
    .map(l => ({ SalesTypeID: text(l.SalesTypeID, 80), Description: text(l.Description, 60), Amount: round2(Number(l.Amount) || 0) }));
  const base = {
    configured: true, regime: config.Regime, companyState: config.StateCode || '',
    codes: (config.Codes || []).map(c => ({ Code: c.Code, Name: c.Name, Category: c.Category, Active: c.Active !== false })),
    places: config.Regime === 'IN_GST' ? engine.GST_STATES : config.Regime === 'AE_VAT' ? engine.EMIRATES : {},
    customerState: (customer || {}).TaxState || '', customerTaxType: (customer || {}).TaxRegistrationType || '',
    canChangeTaxCode: await moduleHasCapability('CUSTOMERINVOICE', 'taxcode', user.profile.role)
  };
  try {
    const before = d.CustomerInvoiceID ? await require('./salesStore').customerInvoices.get(text(d.CustomerInvoiceID, 80)) : null;
    const tax = await invoiceTax({ companyId, customer, date: text(d.InvoiceDate, 10) || new Date().toISOString().slice(0, 10), invoiceData: d, role: user.profile.role,
      before, sourceDeliveryNotes, itemLines, directLines, discount: Number(d.Discount) || 0 });
    return Object.assign(base, { tax });
  } catch (e) {
    return Object.assign(base, { problem: e.message });
  }
});

module.exports = Object.assign(exports, { apportion, computeTax, summarize, shareOf, componentGlLines, includedTaxOf, invoiceTax, recordCodeUse });
