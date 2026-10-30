// Line tax on purchases (UX round 2, item 32, part 3; owner, 2026-10-26;
// docs/modules/TAX_ENGINE.md, Q313-Q318, Q323-Q324). New development,
// hand-written. A company with a Tax Configuration taxes a Vendor Invoice
// line by line, as salesTax.js does a sale:
//   - a GRN line takes its item's code, a direct line its account's
//     (Chart of Accounts, Q324); another code needs Vendor Invoice's
//     "taxcode" right;
//   - GST's components from the vendor's state (the supply comes from it):
//     CGST + SGST within the company's state, IGST from another or abroad;
//   - each code's recoverable % (Q316): the part reclaimed is debited to the
//     component's input account; the rest is cost: on a direct line its own
//     account, on a GRN line the goods' cost in their warehouse (Q323) as a
//     value-only stock line (stockMovement.js), or the item's consumption
//     account when none of it is left in stock;
//   - reverse charge: the vendor charges no tax; the company accounts for
//     it, crediting the component's output account and reclaiming its
//     recoverable part as input tax.
// The posting and reversal (legacy patches vendor-line-tax (…)) take the GL
// lines and the stock document from purchaseGl.
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const engine = require('./taxEngine');
const taxConfig = require('./taxConfig');
const stockStore = require('./stockStore');
const { computeTax } = require('./salesTax');
const { computeStockMovement, getStockLedgerEntry } = require('./stockMovement');
const { postedFields } = require('./stockPosting');

const round2 = engine.round2;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 40);

// Each line's recoverable and non-recoverable part, per component, and
// whether it is under reverse charge. Pure.
function splitRecoverable(config, tax) {
  const codeOf = id => (config.Codes || []).find(c => c.Code === id) || {};
  const byComp = {};
  tax.TaxLines.forEach(t => {
    const c = codeOf(t.TaxCode);
    const pct = c.RecoverablePercent == null ? 100 : Number(c.RecoverablePercent);
    t.Reverse = Boolean((engine.CATEGORIES[t.Category] || {}).reverse);
    t.RecoverablePercent = pct;
    t.Components.forEach(x => {
      x.Recoverable = round2(x.Amount * pct / 100);
      x.NonRecoverable = round2(x.Amount - x.Recoverable);
      const s = byComp[x.Component] = byComp[x.Component] || { Recoverable: 0, NonRecoverable: 0, Reverse: 0 };
      s.Recoverable = round2(s.Recoverable + x.Recoverable);
      s.NonRecoverable = round2(s.NonRecoverable + x.NonRecoverable);
      if (t.Reverse) s.Reverse = round2(s.Reverse + x.Amount);
    });
    t.Recoverable = round2(t.Components.reduce((s, x) => s + x.Recoverable, 0));
    t.NonRecoverable = round2(t.Tax - t.Recoverable);
  });
  tax.TaxComponents.forEach(c => Object.assign(c, byComp[c.Component] || { Recoverable: 0, NonRecoverable: 0, Reverse: 0 }));
  // The vendor charges the tax of lines not under reverse charge; it adds to the total.
  tax.TaxReverse = round2(tax.TaxLines.filter(t => t.Reverse).reduce((s, t) => s + t.Tax, 0));
  tax.TaxAdded = round2(tax.TaxAmount - tax.TaxReverse);
  tax.TaxRecoverable = round2(tax.TaxLines.reduce((s, t) => s + t.Recoverable, 0));
  return tax;
}

// A Vendor Invoice's tax (patch vendor-line-tax (save)), or null where the
// company has no Tax Configuration (the single Tax % as before).
// p: { companyId, vendor, date, invoiceData, before, role, sourceGRNs, directLines, discount }
async function vendorInvoiceTax(p) {
  const config = await taxConfig.configFor(p.companyId);
  if (!config) return null;
  const d = p.invoiceData || {};
  const asked = {};
  (Array.isArray(d.LineTaxCodes) ? d.LineTaxCodes : []).forEach(x => { if (x && x.Key && x.TaxCode) asked[text(x.Key, 80)] = text(x.TaxCode, 12).toUpperCase(); });
  const before = {};
  ((p.before || {}).TaxLines || []).forEach(t => { before[t.Key] = t.TaxCode; });
  const [items, coa] = await Promise.all([rtdb.ref('items').get().then(s => s.val() || {}), rtdb.ref('coa').get().then(s => s.val() || {})]);
  const accountByCode = {};
  Object.values(coa).forEach(a => { accountByCode[String(a.AccountCode)] = a; });
  const raw = [];
  for (const g of p.sourceGRNs || []) {
    const rec = await stockStore.getTx(g.GRNID);
    // Its stock lines (an item) and its non-stock lines (a category's account, GRN_NON_STOCK.md).
    const lines = ((rec && rec.Lines) || []).map((l, i) => ({ l, key: g.GRNID + '#' + (Number(l.LineNo) || i + 1) }))
      .concat(((rec && rec.NonStockLines) || []).map((l, i) => ({ l, key: g.GRNID + '#ns' + (i + 1), nonStock: true })));
    const amounts = lines.map(x => round2((Number(x.l.Quantity) || 0) * (Number(x.l.UnitCost) || 0)));
    const fix = round2((Number(g.Amount) || 0) - amounts.reduce((s, a) => s + a, 0)); // the GRN's own rounding, on its last line
    if (amounts.length) amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + fix);
    lines.forEach((x, i) => {
      const l = x.l;
      if (x.nonStock) {
        raw.push({ Key: x.key, Label: (g.GRNNumber || g.GRNID) + ' ' + (l.Description || l.AccountCode || ''), Kind: 'direct', AccountCode: l.AccountCode,
          CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '', Default: (accountByCode[String(l.AccountCode)] || {}).TaxCode || '', Amount: amounts[i] });
        return;
      }
      const item = items[l.ItemID] || {};
      raw.push({ Key: x.key, Label: (g.GRNNumber || g.GRNID) + ' ' + (l.ItemCode || item.ItemCode || ''), Kind: 'grn',
        ItemID: l.ItemID, WarehouseID: l.WarehouseID, Default: item.TaxCode || '', HSNCode: item.HSNCode || '', Amount: amounts[i] });
    });
  }
  (p.directLines || []).forEach((l, i) => raw.push({ Key: 'direct#' + (i + 1), Label: 'Direct line ' + (i + 1) + (l.Description ? ' ' + text(l.Description, 60) : ''), Kind: 'direct',
    AccountCode: l.AccountCode, CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '', Default: (accountByCode[String(l.AccountCode)] || {}).TaxCode || '', Amount: l.Amount }));

  let mayChange = null;
  const lines = [];
  for (const l of raw) {
    const code = asked[l.Key] || l.Default;
    if (!code) throw new Error(l.Label + ': no tax code. Give ' + (l.Kind === 'grn' ? 'the item one in Item Master' : 'its account a default tax code in the Chart of Accounts') + ', or choose one on the line.');
    if (code !== l.Default && code !== before[l.Key]) {
      if (mayChange === null) mayChange = await moduleHasCapability('VENDORINVOICE', 'taxcode', p.role);
      if (!mayChange) throw new Error(l.Label + ': changing a line\'s tax code needs the Vendor Invoice "change tax code" right.');
    }
    const c = (config.Codes || []).find(x => x.Code === code);
    if (!c) throw new Error(l.Label + ': tax code ' + code + ' is not set up for this company (Tax Configuration).');
    if (c.Active === false && code !== before[l.Key]) throw new Error(l.Label + ': tax code ' + code + ' is inactive (Tax Configuration).');
    lines.push({ Key: l.Key, Code: code, Amount: l.Amount, Inclusive: false });
  }
  const vendor = p.vendor || {};
  const partyType = vendor.TaxRegistrationType || '';
  // The supply comes from the vendor: its state against the company's.
  const place = config.Regime === 'IN_GST' ? (vendor.TaxState || '') : (config.Regime === 'AE_VAT' && engine.EMIRATES[vendor.TaxState] ? vendor.TaxState : '');
  if (config.Regime === 'IN_GST' && !place && partyType !== 'Overseas' && partyType !== 'SEZ') throw new Error('Give the vendor its state (Vendor Master): it decides CGST + SGST or IGST.');
  const out = splitRecoverable(config, computeTax(config, lines, { date: p.date, placeOfSupply: place, partyType, discount: p.discount, sale: false, regime: config.Regime, rounding: config.Rounding }));
  out.TaxLines.forEach((t, i) => {
    const r = raw[i];
    Object.assign(t, { Label: r.Label, Kind: r.Kind }, r.Kind === 'grn' ? { ItemID: r.ItemID, WarehouseID: r.WarehouseID } : { AccountCode: r.AccountCode, CostCenterID: r.CostCenterID, ProfitCenterID: r.ProfitCenterID },
      r.HSNCode ? { HSNCode: r.HSNCode } : {});
  });
  out.VendorTaxType = partyType;
  return out;
}

// The GL lines of a posted Vendor Invoice's tax (patch vendor-line-tax
// (post), and its reversal with reverse: true), and the stock document
// carrying the non-recoverable tax of its GRN lines into the goods' cost.
// Returns { glLines, ledgerUpdates, docs(gl, now) }.
async function purchaseGl(doc, coa, items, opts) {
  const o = opts || {};
  const flip = l => (o.reverse ? Object.assign({}, l, { Debit: l.Credit, Credit: l.Debit }) : l);
  const dims = { CostCenterID: o.costCenterId || '', ProfitCenterID: o.profitCenterId || '' };
  const acct = (id, what) => {
    const a = coa[id];
    if (!a || !a.IsPostable) throw new Error('The ' + what + ' is not set or no longer valid: check Tax Configuration.');
    return a.AccountCode;
  };
  const gl = [];
  (doc.TaxComponents || []).forEach(c => {
    if (c.Recoverable) gl.push(Object.assign({ AccountCode: acct(c.InputAccountID, c.Component + ' input tax account'), Debit: c.Recoverable, Credit: 0, Description: 'Input tax ' + c.Component + ' — ' + (o.description || '') }, dims));
    if (c.Reverse) gl.push(Object.assign({ AccountCode: acct(c.OutputAccountID, c.Component + ' output tax account'), Debit: 0, Credit: c.Reverse, Description: 'Reverse charge ' + c.Component + ' — ' + (o.description || '') }, dims));
  });
  // The tax that can't be reclaimed: cost.
  const valueLines = [];
  for (const t of doc.TaxLines || []) {
    if (!(t.NonRecoverable > 0)) continue;
    if (t.Kind === 'direct') {
      gl.push({ AccountCode: t.AccountCode, Debit: t.NonRecoverable, Credit: 0, Description: 'Input tax not reclaimed — ' + (t.Label || ''), CostCenterID: t.CostCenterID || dims.CostCenterID, ProfitCenterID: t.ProfitCenterID || dims.ProfitCenterID });
      continue;
    }
    const item = items[t.ItemID] || {};
    const ledger = await getStockLedgerEntry(t.ItemID, t.WarehouseID);
    const held = ledger.Quantity > 0.000001 && (!o.reverse || ledger.TotalValue >= t.NonRecoverable);
    if (held) {
      valueLines.push({ ItemID: t.ItemID, ItemCode: item.ItemCode || '', ItemName: item.ItemName || '', WarehouseID: t.WarehouseID, Direction: o.reverse ? 'Out' : 'In', ValueOnly: true,
        TotalValue: t.NonRecoverable, Quantity: 0, CostCenterID: dims.CostCenterID, ProfitCenterID: dims.ProfitCenterID, SourceKey: t.Key, Description: 'Input tax not reclaimed — ' + (t.Label || '') });
    } else {
      // None of the goods left in that warehouse: the cost has gone with them.
      const a = coa[item.ConsumptionAccountID];
      if (!a || !a.IsPostable) throw new Error((t.Label || '') + ': the item has no valid consumption account for the tax that can\'t be reclaimed (Item Master).');
      gl.push(Object.assign({ AccountCode: a.AccountCode, Debit: t.NonRecoverable, Credit: 0, Description: 'Input tax not reclaimed (no stock left) — ' + (t.Label || '') }, dims));
    }
  }
  // The reversal: every line mirrored (the stock's value lines are Out already).
  const out = { glLines: gl.map(flip), ledgerUpdates: {}, docs: () => ({}) };
  if (valueLines.length) {
    const movement = await computeStockMovement(items, coa, valueLines);
    out.glLines.push(...movement.inventoryGlLines);
    out.ledgerUpdates = movement.ledgerUpdates;
    const id = 'ITXC-' + randomUUID().split('-')[0].toUpperCase();
    out.docs = (glResult, now) => ({ [id]: Object.assign({
      TransactionType: 'InputTaxCost', TransactionDate: o.date || doc.InvoiceDate, Description: (o.reverse ? 'Reversal: ' : '') + 'Input tax not reclaimed — ' + (doc.Description || ''),
      CompanyID: doc.CompanyID, DivisionID: doc.DivisionID || '', BranchID: doc.BranchID || '', CostCenterID: doc.CostCenterID || '', ProfitCenterID: doc.ProfitCenterID || '',
      VendorID: doc.VendorID || '', SourceInvoiceID: o.invoiceId || '', Lines: valueLines, CreatedAt: now, CreatedBy: o.actor || ''
    }, postedFields(glResult, o.actor || '', now)) });
  }
  return out;
}

// A Purchase Return's share of its invoice's tax: each returned line by its
// fraction of the GRN line, every component's amount, recoverable and
// non-recoverable parts scaled; at the accounts the invoice posted to.
function returnShare(inv, fractions) {
  const lines = (inv.TaxLines || []).filter(t => fractions[t.Key] > 0).map(t => {
    const f = Math.min(1, fractions[t.Key]);
    const sc = v => (f >= 1 ? round2(v) : round2((Number(v) || 0) * f));
    const comps = (t.Components || []).map(x => ({ Component: x.Component, Percent: x.Percent, Amount: sc(x.Amount), Recoverable: sc(x.Recoverable), NonRecoverable: round2(sc(x.Amount) - sc(x.Recoverable)) }));
    const tax = round2(comps.reduce((a, x) => a + x.Amount, 0));
    const rec = round2(comps.reduce((a, x) => a + x.Recoverable, 0));
    return Object.assign({}, t, { Taxable: sc(t.Taxable), Tax: tax, Recoverable: rec, NonRecoverable: round2(tax - rec), Components: comps });
  });
  const byComp = {};
  lines.forEach(t => t.Components.forEach(x => {
    const c = byComp[x.Component] = byComp[x.Component] || { Component: x.Component, Amount: 0, Recoverable: 0, NonRecoverable: 0, Reverse: 0 };
    c.Amount = round2(c.Amount + x.Amount); c.Recoverable = round2(c.Recoverable + x.Recoverable); c.NonRecoverable = round2(c.NonRecoverable + x.NonRecoverable);
    if (t.Reverse) c.Reverse = round2(c.Reverse + x.Amount);
  }));
  const accounts = id => (inv.TaxComponents || []).find(x => x.Component === id) || {};
  const comps = Object.values(byComp).filter(c => c.Amount).map(c => Object.assign(c, { OutputAccountID: accounts(c.Component).OutputAccountID || '', InputAccountID: accounts(c.Component).InputAccountID || '' }));
  const sum = (k, pred) => round2(lines.filter(pred || (() => true)).reduce((a, t) => a + t[k], 0));
  const tax = sum('Tax');
  const reverse = sum('Tax', t => t.Reverse);
  return { TaxRegime: inv.TaxRegime || '', PlaceOfSupply: inv.PlaceOfSupply || '', TaxLines: lines, TaxComponents: comps,
    TaxAmount: tax, TaxReverse: reverse, TaxAdded: round2(tax - reverse), TaxRecoverable: sum('Recoverable'), TaxNonRecoverable: sum('NonRecoverable') };
}

// A Purchase Return's tax GL lines: the input tax it reclaimed credited
// back, reverse charge's output debited back. The tax that couldn't be
// reclaimed went into the goods' cost: the goods leave at that cost, so
// the vendor's refund of it lands with the return's variance (the caller).
function returnGl(share, coa, opts) {
  const o = opts || {};
  const dims = { CostCenterID: o.costCenterId || '', ProfitCenterID: o.profitCenterId || '' };
  const acct = (id, what) => {
    const a = coa[id];
    if (!a || !a.IsPostable) throw new Error('The ' + what + ' is not set or no longer valid: check Tax Configuration.');
    return a.AccountCode;
  };
  const gl = [];
  (share.TaxComponents || []).forEach(c => {
    if (c.Recoverable) gl.push(Object.assign({ AccountCode: acct(c.InputAccountID, c.Component + ' input tax account'), Debit: 0, Credit: c.Recoverable, Description: 'Input tax ' + c.Component + ' reversed — ' + (o.description || '') }, dims));
    if (c.Reverse) gl.push(Object.assign({ AccountCode: acct(c.OutputAccountID, c.Component + ' output tax account'), Debit: c.Reverse, Credit: 0, Description: 'Reverse charge ' + c.Component + ' reversed — ' + (o.description || '') }, dims));
  });
  return gl;
}

// The Vendor Invoice screen's tax, as its save will work it out.
exports.previewVendorInvoiceTax = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('VENDORINVOICE', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Vendor Invoice.');
  const d = (request.data || {}).invoiceData || {};
  const companyId = text(d.CompanyID, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const config = await taxConfig.configFor(companyId);
  if (!config) return { configured: false };
  const vendor = d.VendorID ? (await rtdb.ref('vendors/' + text(d.VendorID, 80)).get()).val() : null;
  const sourceGRNs = [];
  for (const x of (Array.isArray(d.SourceGRNs) ? d.SourceGRNs : []).slice(0, 100)) {
    const g = x && x.GRNID ? await stockStore.getTx(text(x.GRNID, 80)) : null;
    if (!g || g.TransactionType !== 'GRN' || g.CompanyID !== companyId) continue;
    sourceGRNs.push({ GRNID: x.GRNID, GRNNumber: g.TransactionNumber || '', Amount: round2((g.Lines || []).concat(g.NonStockLines || []).reduce((s, l) => s + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0)) });
  }
  const directLines = (Array.isArray(d.DirectLines) ? d.DirectLines : []).filter(l => l && String(l.AccountCode || '').trim()).slice(0, 200)
    .map(l => ({ AccountCode: text(l.AccountCode, 30), Description: text(l.Description, 60), CostCenterID: text(l.CostCenterID, 80), Amount: round2(Number(l.Amount) || 0) }));
  const base = {
    configured: true, regime: config.Regime, companyState: config.StateCode || '', vendorState: (vendor || {}).TaxState || '',
    codes: (config.Codes || []).map(c => ({ Code: c.Code, Name: c.Name, Category: c.Category, Active: c.Active !== false, RecoverablePercent: c.RecoverablePercent })),
    canChangeTaxCode: await moduleHasCapability('VENDORINVOICE', 'taxcode', user.profile.role)
  };
  try {
    const before = d.VendorInvoiceID ? await require('./purchaseStore').vendorInvoices.get(text(d.VendorInvoiceID, 80)) : null;
    const tax = await vendorInvoiceTax({ companyId, vendor, date: text(d.InvoiceDate, 10) || new Date().toISOString().slice(0, 10), invoiceData: d, role: user.profile.role,
      before, sourceGRNs, directLines, discount: Number(d.Discount) || 0 });
    return Object.assign(base, { tax });
  } catch (e) {
    return Object.assign(base, { problem: e.message });
  }
});

module.exports = Object.assign(exports, { splitRecoverable, vendorInvoiceTax, purchaseGl, returnShare, returnGl });
