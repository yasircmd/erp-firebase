// MIS report builder, the data sets (owner, 2026-11-08; docs/modules/MIS.md,
// phase 4, Q446-Q449): sales lines, purchase lines, GL lines and stock
// movements, each a prepared list of lines with named fields, read for a
// company over 1-24 months ending at the report's month (one query per
// month), then shaped by misQuery.js. New development, hand-written.
//
// Rights (Q448): MIS access AND the data set's own module (Sales lines:
// Customer Invoice; Purchase lines: Vendor Invoice; GL lines: General
// Ledger; Stock movements: Stock Ledger), for the user's companies only.
// Amounts are in the base currency, before tax, after the document's
// discount (shared over its lines). Reversed documents and their reversals
// are left out, as everywhere in MIS.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const M = require('./misCalc');
const D = require('./misData');
const Q = require('./misQuery');

const onCallOptions = { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' };
const r2 = M.round2;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 80);
const live = d => d && d.Status === 'Posted' && !D.reversedOrReversal(d);
const listOf = v => (Array.isArray(v) ? v : Object.values(v || {}));
const MAX_MONTHS = 24, MAX_LINES = 20000;

const T = (label) => ({ label, type: 'text' }), N = (label) => ({ label, type: 'number' });
const COMMON = { date: { label: 'Date', type: 'date' }, month: { label: 'Month', type: 'month' }, number: T('Document') };
const DATASETS = Object.freeze({
  sales: { title: 'Sales lines', module: 'CUSTOMERINVOICE', fields: Object.assign({}, COMMON, { kind: T('Kind'), customer: T('Customer'), rep: T('Sales rep'),
    item: T('Item'), category: T('Category'), account: T('Account'), salesType: T('Sales type'), costCenter: T('Cost center'), project: T('Project'),
    quantity: N('Quantity'), amount: N('Amount') }) },
  purchases: { title: 'Purchase lines', module: 'VENDORINVOICE', fields: Object.assign({}, COMMON, { vendor: T('Vendor'), item: T('Item'), category: T('Category'),
    account: T('Account'), costCenter: T('Cost center'), project: T('Project'), quantity: N('Quantity'), amount: N('Amount') }) },
  gl: { title: 'GL lines', module: 'GLREPORT', fields: Object.assign({}, COMMON, { voucherType: T('Voucher type'), account: T('Account'), accountType: T('Account type'),
    party: T('Party'), costCenter: T('Cost center'), profitCenter: T('Profit center'), project: T('Project'), description: T('Description'),
    debit: N('Debit'), credit: N('Credit'), net: N('Debit − credit') }) },
  stock: { title: 'Stock movements', module: 'STOCKLEDGER', fields: Object.assign({}, COMMON, { type: T('Type'), direction: T('In / out'), item: T('Item'),
    category: T('Category'), warehouse: T('Warehouse'), quantity: N('Quantity (in +, out −)'), value: N('Value (in +, out −)') }) }
});

// The data sets: the four above (Sales and Purchase lines with their variants'
// columns, MODULE_BUILDER.md Q492) and every published built module's (Q489-Q491).
async function allDatasets() {
  const defs = await require('./builtDefinitions').refresh();
  const BMIS = require('./builtMis');
  const withVariants = (ds, base) => Object.assign({}, ds, { fields: Object.assign({}, ds.fields, BMIS.variantColumns(defs, base).fields) });
  return { defs, sets: Object.assign({}, DATASETS, { sales: withVariants(DATASETS.sales, 'CUSTOMERINVOICE'), purchases: withVariants(DATASETS.purchases, 'VENDORINVOICE') }, BMIS.datasetsOf(defs)) };
}

async function names(defs) {
  const [customers, vendors, items, coa, units] = await Promise.all(['customers', 'vendors', 'items', 'coa', 'orgUnits'].map(D.val));
  const unit = id => (units[id] ? [units[id].Code, units[id].Name].filter(Boolean).join(' ') : id || '');
  const itemOf = id => items[id] || {};
  const byCode = {};
  Object.keys(items).forEach(id => { if (items[id] && items[id].ItemCode) byCode[items[id].ItemCode] = Object.assign({ ItemID: id }, items[id]); });
  const acctByCode = {};
  Object.keys(coa).forEach(id => { if (coa[id] && coa[id].AccountCode) acctByCode[coa[id].AccountCode] = coa[id]; });
  return {
    customer: id => (customers[id] && customers[id].CustomerName) || id || '',
    vendor: id => (vendors[id] && vendors[id].VendorName) || id || '',
    item: (id, code) => { const it = id ? itemOf(id) : byCode[code] || {}; return [it.ItemCode || code || '', it.ItemName || ''].filter(Boolean).join(' ') || id || ''; },
    category: (id, code) => (id ? itemOf(id) : byCode[code] || {}).Category || '',
    account: id => (coa[id] ? coa[id].AccountCode + ' ' + coa[id].AccountName : id || ''),
    accountByCode: code => (acctByCode[code] ? code + ' ' + acctByCode[code].AccountName : code || ''),
    accountType: id => (coa[id] || {}).AccountType || '',
    unit,
    // A document's variant and its extra fields (MODULE_BUILDER.md, Q492).
    salesVariant: require('./builtMis').variantColumns(defs, 'CUSTOMERINVOICE').rowValues,
    purchaseVariant: require('./builtMis').variantColumns(defs, 'VENDORINVOICE').rowValues
  };
}

// ---------- the loaders: lines over the months ----------
async function salesLines(companyId, months, n) {
  const { customerInvoices } = require('./salesStore');
  const stockStore = require('./stockStore');
  const reps = await require('./salesRep').repParties();
  const rep = id => (id ? (reps[id] || {}).RepName || id : '');
  const out = [];
  for (const m of months) {
    const invs = Object.values(await customerInvoices.query({ CompanyID: companyId, Period: m })).filter(live);
    invs.forEach(i => {
      const sub = Number(i.Subtotal) || 0, f = (sub ? (sub - (Number(i.Discount) || 0)) / sub : 1) * (Number(i.ExchangeRate) || 1);
      const base = { date: i.InvoiceDate, month: m, number: i.TransactionNumber || '', kind: 'Invoice', customer: n.customer(i.CustomerID), rep: rep(i.SalesRepEmployeeID),
        costCenter: n.unit(i.CostCenterID), project: n.unit(i.ProjectID), salesType: '', account: '', ...n.salesVariant(i) };
      listOf(i.SourceDeliveryNotes).forEach(d => listOf(d.Lines).forEach(l => out.push(Object.assign({}, base, { item: n.item('', l.ItemCode), category: n.category('', l.ItemCode),
        salesType: d.SalesTypeID || '', quantity: Number(l.Quantity) || 0, amount: r2((Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0) * f) }))));
      listOf(i.ItemLines).forEach(l => out.push(Object.assign({}, base, { item: n.item(l.ItemID, l.ItemCode), category: n.category(l.ItemID, l.ItemCode),
        salesType: i.ItemSalesTypeID || '', quantity: Number(l.Quantity) || 0, amount: r2((Number(l.Amount) || 0) * f) })));
      listOf(i.DirectLines).forEach(l => out.push(Object.assign({}, base, { item: '', category: '', account: n.accountByCode(l.AccountCode), salesType: l.SalesTypeID || '',
        costCenter: n.unit(l.CostCenterID || i.CostCenterID), project: n.unit(l.ProjectID || i.ProjectID), quantity: 0, amount: r2((Number(l.Amount) || 0) * f) })));
    });
    for (const [type, kind, sign] of [['RetailSale', 'Retail sale', 1], ['SalesReturn', 'Sales return', -1], ['RetailReturn', 'Retail return', -1]]) {
      const txs = Object.values(await stockStore.queryTx({ CompanyID: companyId, Period: m, TransactionType: type })).filter(live);
      txs.forEach(t => {
        const lines = listOf(t.Lines).filter(l => l && l.ItemID);
        const gross = lines.reduce((s, l) => s + lineValue(l), 0);
        const net = type === 'SalesReturn' ? (Number(t.ReturnValue) || 0) - (Number(t.DiscountAmount) || 0) : (Number(t.Total) || 0) - (Number(t.TaxAmount) || 0);
        const f = gross ? net / gross : 0;
        lines.forEach(l => out.push({ ...n.salesVariant(null), date: t.TransactionDate, month: m, number: t.TransactionNumber || '', kind, customer: n.customer(t.CustomerID), rep: rep(t.SalesRepEmployeeID),
          item: n.item(l.ItemID), category: n.category(l.ItemID), account: '', salesType: t.SalesTypeName || t.SalesTypeID || '', costCenter: n.unit(l.CostCenterID || t.CostCenterID),
          project: n.unit(t.ProjectID), quantity: sign * (Number(l.Quantity) || 0), amount: r2(sign * lineValue(l) * f) }));
      });
    }
    if (out.length > MAX_LINES) break;
  }
  return out;
}
// A sales line's value before the document's own adjustments.
const lineValue = l => (l.Amount != null ? (Number(l.Amount) || 0) - (Number(l.Discount) || 0) : (Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0));

async function purchaseLines(companyId, months, n) {
  const { vendorInvoices } = require('./purchaseStore');
  const stockStore = require('./stockStore');
  const out = [];
  for (const m of months) {
    const invs = Object.values(await vendorInvoices.query({ CompanyID: companyId, Period: m })).filter(live);
    const grnIds = [...new Set(invs.flatMap(i => listOf(i.SourceGRNs).map(g => g.GRNID)).filter(Boolean))];
    const grns = grnIds.length ? await stockStore.getTxs(grnIds) : {};
    invs.forEach(i => {
      const sub = Number(i.Subtotal) || 0, f = (sub ? (sub - (Number(i.Discount) || 0)) / sub : 1) * (Number(i.ExchangeRate) || 1);
      const base = { date: i.InvoiceDate, month: m, number: i.TransactionNumber || '', vendor: n.vendor(i.VendorID), costCenter: n.unit(i.CostCenterID), project: n.unit(i.ProjectID), ...n.purchaseVariant(i) };
      listOf(i.SourceGRNs).forEach(g => {
        const grn = grns[g.GRNID] || {};
        listOf(grn.Lines).concat(listOf(grn.NonStockLines)).forEach(l => out.push(Object.assign({}, base, { item: n.item(l.ItemID, l.ItemCode), category: n.category(l.ItemID, l.ItemCode),
          account: l.AccountID ? n.account(l.AccountID) : '', quantity: Number(l.Quantity) || 0, amount: r2((Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0) * f) })));
      });
      listOf(i.DirectLines).forEach(l => out.push(Object.assign({}, base, { item: '', category: '', account: n.accountByCode(l.AccountCode),
        costCenter: n.unit(l.CostCenterID || i.CostCenterID), project: n.unit(l.ProjectID || i.ProjectID), quantity: 0, amount: r2((Number(l.Amount) || 0) * f) })));
    });
    if (out.length > MAX_LINES) break;
  }
  return out;
}

async function glLines(companyId, months, n) {
  const from = months[0] + '-01', to = M.lastDay(months[months.length - 1]);
  const entries = (await D.postedEntries(companyId, to, from)).filter(e => !D.reversedOrReversal(e));
  const out = [];
  entries.forEach(e => listOf(e.Lines).forEach(l => {
    const debit = r2(l.Debit), credit = r2(l.Credit);
    out.push({ date: e.JVDate, month: M.monthOf(e.JVDate), number: e.JVNumber || '', voucherType: e.VoucherType || '', account: n.account(l.AccountID), accountType: n.accountType(l.AccountID),
      party: l.PartyType ? l.PartyType + ': ' + (l.PartyName || l.PartyID || '') : '', costCenter: n.unit(l.CostCenterID), profitCenter: n.unit(l.ProfitCenterID), project: n.unit(l.ProjectID),
      description: l.Description || e.Description || '', debit, credit, net: r2(debit - credit) });
  }));
  return out;
}

// As the Stock Ledger reads them: each posted line's Direction; a warehouse
// movement out of one warehouse and into the other.
async function stockLines(companyId, months, n) {
  const stockStore = require('./stockStore');
  const out = [];
  for (const m of months) {
    const txs = Object.values(await stockStore.queryTx({ CompanyID: companyId, Period: m })).filter(t => t && t.Status === 'Posted');
    txs.forEach(t => listOf(t.Lines).forEach(l => {
      if (!l || !l.ItemID) return;
      const qty = Number(l.Quantity) || 0, value = l.TotalValue != null ? Number(l.TotalValue) || 0 : r2(qty * (Number(l.UnitCost) || 0));
      const row = dir => ({ date: t.TransactionDate, month: m, number: t.TransactionNumber || '', type: t.TransactionType, direction: dir, item: n.item(l.ItemID), category: n.category(l.ItemID),
        warehouse: n.unit(dir === 'In' && t.TransactionType === 'WarehouseMovement' ? l.ToWarehouseID : (l.FromWarehouseID || l.WarehouseID)),
        quantity: dir === 'In' ? qty : -qty, value: r2(dir === 'In' ? value : -value) });
      if (t.TransactionType === 'WarehouseMovement' && l.ToWarehouseID) { out.push(row('Out'), row('In')); return; }
      out.push(row(l.Direction === 'In' ? 'In' : 'Out'));
    }));
    if (out.length > MAX_LINES) break;
  }
  return out;
}
const LOADERS = { sales: salesLines, purchases: purchaseLines, gl: glLines, stock: stockLines };

// ---------- the callables ----------
async function rightsFor(user, sets) {
  const out = {};
  for (const [id, ds] of Object.entries(sets)) out[id] = await moduleHasCapability(ds.module, 'access', user.profile.role);
  return out;
}
async function requireMis(user) {
  if (!(await moduleHasCapability('MIS', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to MIS reports.');
}

// The data sets this user may build on, with their fields.
exports.getMisDatasets = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireMis(user);
  const { sets } = await allDatasets();
  const can = await rightsFor(user, sets);
  return { datasets: Object.entries(sets).filter(([id]) => can[id]).map(([id, ds]) => ({ id, title: ds.title, built: Boolean(ds.built), fields: Object.entries(ds.fields).map(([key, f]) => ({ key, label: f.label, type: f.type })) })),
    ops: Q.OPS, aggs: Q.AGGS, maxMonths: MAX_MONTHS };
});

// Build: { dataset, companyId, month (the last), months (1-24), spec } → the result.
async function build(user, d) {
  await requireMis(user);
  const id = text(d.dataset, 40);
  const { defs, sets } = await allDatasets();
  const ds = sets[id];
  if (!ds) throw new HttpsError('invalid-argument', 'Choose a data set.');
  if (!(await moduleHasCapability(ds.module, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to ' + ds.title.toLowerCase() + ' (it needs the ' + ds.module + ' module).');
  const companyId = text(d.companyId, 80);
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const month = text(d.month, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpsError('invalid-argument', 'Choose a month.');
  const span = Math.min(MAX_MONTHS, Math.max(1, Math.floor(Number(d.months) || 1)));
  const months = M.monthsBetween(M.addMonths(month, 1 - span), month);
  let spec;
  try { spec = Q.cleanSpec(d.spec, ds.fields); } catch (e) { throw new HttpsError('invalid-argument', e.message); }
  const lines = ds.built ? await require('./builtMis').rowsOf(ds, defs, companyId, months) : await LOADERS[id](companyId, months, await names(defs));
  const result = Q.run(lines, spec, ds.fields);
  return Object.assign(result, { dataset: id, title: ds.title, period: months[0] + (months.length > 1 ? ' to ' + month : ''), lines: lines.length, linesTruncated: lines.length > MAX_LINES });
}
exports.runMisBuilder = onCallWithMessages(onCallOptions, async (request) => build(await requireUser(request), request.data || {}));

// A saved builder report as MIS report rows, for a chart or a dashboard tile
// (Q449): its first grouping and first total, on the month given (or its own fixed one).
exports.runSavedMisBuilder = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const snap = await firestore.collection('misReports').doc(text(d.id, 60) || '-').get();
  const rep = snap.exists ? snap.data() : null;
  if (!rep || rep.Type !== 'builder') throw new HttpsError('not-found', 'That saved report no longer exists.');
  if (rep.OwnerUID !== user.uid && !(rep.SharedRoles || []).includes(user.profile.role)) throw new HttpsError('permission-denied', 'That report is not shared with you.');
  const month = rep.Period && rep.Period.kind === 'fixed' ? rep.Period.month : text(d.month, 7);
  const r = await build(user, { dataset: rep.Builder.dataset, months: rep.Builder.months, spec: rep.Builder.spec, companyId: text(d.companyId, 80) || rep.CompanyID, month });
  return { type: 'builder', title: rep.Name, period: { current: r.period }, rows: Q.asReportRows(r), result: r };
});

module.exports = Object.assign(exports, { DATASETS, MAX_MONTHS, LOADERS, build, allDatasets });
