// Numbering (owner, 2026-10-09; docs/modules/NUMBERING.md, decisions 80-83).
// New development, hand-written.
//
// Every document number and master code the system gives is made here, from
// a format built of parts (decision 82): the prefix text, the company code
// (yes/no), the year (none, 2 or 4 digits), their order, a separator and the
// number of digits. One format per type for the whole system (decision 81);
// the defaults are exactly the shapes the system has always used, so nothing
// changes until a format is customized. Codes are always automatic (83);
// account codes and the audit references (TXN-, STK-, PRL-) are not made here
// (80).
//
// The running number is kept per "everything but the running number" (the
// scope): with the year in the format it restarts each year; without the
// company code, all companies share one sequence. A default-shaped number
// uses exactly the counter the system always used (gl/counters,
// stock/counters/voucher, itemCounters, ...), so Data Reset still restarts
// it. A customized one counts under the same root (<root>/_fmt/<scope>), so
// the same reset clears it, and each number it gives is recorded
// (<root>/_issued/<number>) and never given twice. A format may not take
// another type's current, default or earlier shape.
//
// Settings: numbering/formats/{kind}; changes: numbering/log.
'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'NUMBERING';
const FORMATS = 'numbering/formats/';
const LOG = 'numbering/log';
const val = async path => (await rtdb.ref(path).get()).val();

// ---------- the numbered types ----------

// Document and voucher prefixes (the GL and the documents before it).
// Stock and finance documents come from glWriting's own map; these are the
// rest (Journal, Cash & Bank, purchasing, sales orders and their proforma
// invoices, job orders, the recurring-journal templates).
const OTHER_DOCUMENTS = [
  ['JV', 'Journal Voucher'], ['CR', 'Cash Receipt'], ['BR', 'Bank Receipt'], ['CP', 'Cash Payment'], ['BP', 'Bank Payment'],
  ['FT', 'Fund Transfer'], ['PR', 'Purchase Requisition'], ['IPR', 'Internal Purchase Request'], ['PO', 'Purchase Order'],
  ['SO', 'Sales Order'], ['JOB', 'Job Order Batch'],
  // Printed from a Sales Order, posting nothing (docs/modules/UX_ROUND2.md item 22).
  ['PI', 'Proforma Invoice']
];
// Numbered from stock/counters/voucher like the stock documents, though not
// in their map.
const MORE_STOCK_DOCUMENTS = [['RJT', 'Recurring Journal Template']];
const STOCK_LABELS = {
  GRN: 'Goods Receipt', MaterialIssue: 'Material Issue', Production: 'Production', WarehouseMovement: 'Warehouse Movement',
  StockAdjustment: 'Stock Adjustment', PhysicalCount: 'Physical Count', VendorInvoice: 'Vendor Invoice', DeliveryNote: 'Delivery Note',
  CustomerInvoice: 'Customer Invoice', PurchaseReturn: 'Debit Note (Purchase Return)', SalesReturn: 'Credit Note (Sales Return)',
  PDCReceived: 'PDC Received', PDCReceivedClear: 'PDC Received, cleared', PDCIssued: 'PDC Issued', PDCIssuedClear: 'PDC Issued, cleared',
  FACapitalization: 'Asset Capitalization', FADepreciation: 'Depreciation', FAAdditionalDepreciation: 'Additional Depreciation',
  FATakeOver: 'Asset Take-over', FARetirement: 'Asset Retirement', FAAuCCost: 'Capital Work in Progress, cost',
  FAAuCSettlement: 'Capital Work in Progress, settlement', RecurringJV: 'Recurring Journal', OpeningBalance: 'Opening Balance',
  OpeningStock: 'Opening Stock', Payroll: 'Payroll', PayrollPayment: 'Payroll Payment', PayrollLoan: 'Payroll Loan',
  PayrollProvision: 'Provision Claim', FinalSettlement: 'Final Settlement (journal)', RetailSale: 'Retail Sale', RetailReturn: 'Retail Return',
  YearEndClose: 'Year-End Closing'
};
const ITEM_CATEGORY_PREFIXES = { RawMaterial: 'RM', SemiFinishedGood: 'SFG', FinishedGood: 'FG', Consumable: 'CONS', Scrap: 'SCRAP' };
const ITEM_LABELS = { RawMaterial: 'Raw Material', SemiFinishedGood: 'Semi-Finished Good', FinishedGood: 'Finished Good', Consumable: 'Consumable', Scrap: 'Scrap' };

const docFormat = p => ({ Prefix: p, Company: true, Year: 'YY', Order: 'YC', Sep: '-', Digits: 6 });
const codeFormat = (p, digits) => ({ Prefix: p, Company: false, Year: '', Order: 'YC', Sep: '-', Digits: digits });

// Each kind: { key, group, label, default, company (may carry the company
// code), root (where its counters live), home(c) (the counter the default
// format always used), others(c) (other counters its default numbers may
// have come from) }.
const GL = 'gl/counters', STOCK = 'stock/counters/voucher';
function docKind(p, label, tree) {
  const other = tree === GL ? STOCK : GL;
  return {
    key: 'doc:' + p, group: 'Documents', label, default: docFormat(p), company: true, root: tree,
    home: c => tree + '/' + p + '/' + c.year + '/' + c.co, others: c => [other + '/' + p + '/' + c.year + '/' + c.co]
  };
}
const codeKind = (key, group, label, format, company, root, home) =>
  ({ key, group, label, default: format, company, root, home, others: () => [] });
let KINDS = null;
function kinds() {
  if (KINDS) return KINDS;
  const { STOCK_TRANSACTION_PREFIXES } = require('./glWriting');
  const docs = {};
  OTHER_DOCUMENTS.forEach(([p, label]) => { docs[p] = { tree: GL, labels: [label] }; });
  MORE_STOCK_DOCUMENTS.forEach(([p, label]) => { docs[p] = { tree: STOCK, labels: [label] }; });
  Object.entries(STOCK_TRANSACTION_PREFIXES).forEach(([type, p]) => {
    (docs[p] = docs[p] || { tree: STOCK, labels: [] }).labels.push(STOCK_LABELS[type] || type);
  });
  const list = Object.keys(docs).sort().map(p => docKind(p, docs[p].labels.join(' / '), docs[p].tree));
  Object.entries(ITEM_CATEGORY_PREFIXES).forEach(([cat, p]) =>
    list.push(codeKind('item:' + cat, 'Master codes', 'Item — ' + ITEM_LABELS[cat], codeFormat(p, 6), false, 'itemCounters', () => 'itemCounters/' + p)));
  list.push(
    codeKind('vendor', 'Master codes', 'Vendor', codeFormat('VEN', 6), false, 'vendorCounters', () => 'vendorCounters/VEN'),
    codeKind('customer:CL', 'Master codes', 'Customer — local', codeFormat('CL', 6), false, 'customerCounters', () => 'customerCounters/CL'),
    codeKind('customer:CE', 'Master codes', 'Customer — export', codeFormat('CE', 6), false, 'customerCounters', () => 'customerCounters/CE'),
    codeKind('employee', 'Master codes', 'Employee', codeFormat('EMP', 4), false, 'hrCounters', () => 'hrCounters/EMP'),
    codeKind('asset', 'Master codes', 'Fixed Asset', Object.assign(codeFormat('FA', 6), { Company: true }), true, 'fa/counters', c => 'fa/counters/asset/' + c.co),
    codeKind('hr:LV', 'HR documents', 'Leave Application', Object.assign(codeFormat('LV', 4), { Year: 'YYYY' }), false, 'hrCounters', c => 'hrCounters/LV-' + c.year),
    codeKind('hr:EC', 'HR documents', 'Employee Change', Object.assign(codeFormat('EC', 4), { Year: 'YYYY' }), false, 'hrCounters', c => 'hrCounters/EC-' + c.year),
    codeKind('hr:IP', 'HR documents', 'Interim Payroll', codeFormat('IP', 4), false, 'hrCounters', () => 'hrCounters/IP'),
    codeKind('hr:LN', 'HR documents', 'Loan / Advance', codeFormat('LN', 4), false, 'hrCounters', () => 'hrCounters/LN'),
    codeKind('hr:FS', 'HR documents', 'Final Settlement', codeFormat('FS', 4), false, 'hrCounters', () => 'hrCounters/FS'),
    // Employee Portal requests (docs/modules/EMPLOYEE_PORTAL.md, step 2).
    codeKind('hr:PQ', 'HR documents', 'Payroll Query', Object.assign(codeFormat('PQ', 4), { Year: 'YYYY' }), false, 'hrCounters', c => 'hrCounters/PQ-' + c.year),
    codeKind('hr:LR', 'HR documents', 'Loan / Advance Request', Object.assign(codeFormat('LR', 4), { Year: 'YYYY' }), false, 'hrCounters', c => 'hrCounters/LR-' + c.year),
    codeKind('hr:RC', 'HR documents', 'Reimbursement Claim', Object.assign(codeFormat('RC', 4), { Year: 'YYYY' }), false, 'hrCounters', c => 'hrCounters/RC-' + c.year),
    // Requests of the types HR sets up (docs/modules/EMPLOYEE_REQUEST_TYPES.md, Q306): one series.
    codeKind('hr:RQ', 'HR documents', 'Employee Request', Object.assign(codeFormat('RQ', 4), { Year: 'YYYY' }), false, 'hrCounters', c => 'hrCounters/RQ-' + c.year)
  );
  KINDS = list;
  return list;
}
const kindOf = key => kinds().find(k => k.key === key);

// ---------- formats ----------

const FIELDS = ['Prefix', 'Company', 'Year', 'Order', 'Sep', 'Digits'];
const pick = f => Object.fromEntries(FIELDS.map(k => [k, f[k]]));
const sameFormat = (a, b) => FIELDS.every(k => a[k] === b[k]);
const sameShape = (a, b) => FIELDS.filter(k => k !== 'Digits').every(k => String(a[k]).toUpperCase() === String(b[k]).toUpperCase());

// The number's text: the prefix, the company code and year in their order,
// then the running number. With seq null, the scope ("everything but the
// running number") instead.
function render(f, c, seq) {
  const year = f.Year === 'YYYY' ? String(c.year) : f.Year === 'YY' ? String(c.year).slice(-2) : '';
  const co = f.Company ? c.co : '';
  const mids = f.Order === 'CY' ? [co, year] : [year, co];
  const head = [f.Prefix].concat(mids.filter(Boolean)).join(f.Sep);
  return seq === null ? head + f.Sep : head + f.Sep + String(seq).padStart(f.Digits, '0');
}
const keyOf = scope => scope.replace(/\//g, '~').replace(/[.#$[\]]/g, '_') + '|';

function validate(kind, f) {
  const out = {
    Prefix: String(f.Prefix || '').trim(), Company: f.Company === true, Year: String(f.Year || ''), Order: f.Order === 'CY' ? 'CY' : 'YC',
    Sep: String(f.Sep === undefined ? '-' : f.Sep), Digits: Number(f.Digits)
  };
  if (!/^[A-Za-z0-9]{1,10}$/.test(out.Prefix)) throw new HttpsError('invalid-argument', 'The prefix is 1 to 10 letters or digits.');
  if (out.Company && !kind.company) throw new HttpsError('invalid-argument', kind.label + ' belongs to no single company, so it can\'t carry the company code.');
  if (!['', 'YY', 'YYYY'].includes(out.Year)) throw new HttpsError('invalid-argument', 'Choose the year: none, 2 or 4 digits.');
  if (!['-', '/', ''].includes(out.Sep)) throw new HttpsError('invalid-argument', 'The separator is "-", "/" or none.');
  if (!(Number.isInteger(out.Digits) && out.Digits >= 3 && out.Digits <= 10)) throw new HttpsError('invalid-argument', 'The running number has 3 to 10 digits.');
  return out;
}

async function formatsNow() {
  const saved = (await val(FORMATS.slice(0, -1))) || {};
  const out = {};
  kinds().forEach(k => { out[k.key] = saved[k.key] ? Object.assign({}, k.default, pick(saved[k.key])) : k.default; });
  return out;
}

// ---------- the next number ----------

async function companyRef(companyId) {
  if (!companyId) return '';
  return require('./glWriting').getCompanyRefCode(companyId);
}

// The next number of a kind. ctx: { companyId, year } (year defaults to this
// year). Callers of the document numbers hold the global lock, as before;
// the counters are transactions regardless.
async function next(key, ctx) {
  const kind = kindOf(key);
  if (!kind) throw new Error('Unknown numbering type: ' + key);
  const saved = await val(FORMATS + key);
  const f = saved ? Object.assign({}, kind.default, pick(saved)) : kind.default;
  const c = { year: Number((ctx && ctx.year) || new Date().getUTCFullYear()), co: '' };
  if (f.Company && !(ctx && ctx.companyId)) throw new Error(kind.label + ': the number carries the company code, but no company was given.');
  if (f.Company || kind.default.Company) c.co = await companyRef(ctx && ctx.companyId);
  const scope = render(f, c, null);
  const isDefault = scope === render(kind.default, c, null);
  // The default carries on in the counter it always used (higher than any
  // other counter its numbers may have come from).
  let floor = 0;
  if (isDefault) for (const p of kind.others(c)) floor = Math.max(floor, Number(await val(p)) || 0);
  const counter = rtdb.ref(isDefault ? kind.home(c) : kind.root + '/_fmt/' + keyOf(scope));
  const issued = n => rtdb.ref(kind.root + '/_issued/' + keyOf(n));
  for (let tries = 0; tries < 1000; tries++) {
    // A transaction's first try may see the local cache (null): the retry
    // with the server's value replaces it.
    const res = await counter.transaction(cur => Math.max(Number(cur) || 0, floor) + 1);
    const number = render(f, c, res.snapshot.val());
    // Never a number already given by a customized format.
    if ((await issued(number).get()).exists()) continue;
    if (!isDefault) await issued(number).set(true);
    return number;
  }
  throw new Error(kind.label + ': no free number found; check the format in Numbering.');
}

// Item categories of the owner's own (docs/modules/ITEM_CATEGORIES_CUSTOM.md,
// decision 204): one code type each, with its own prefix and sequence,
// formatted here like the five. itemCategories/{id} { Name, Prefix }.
const customItemKey = id => 'item:X-' + id;
function itemCategoryKind(id, c) {
  let k = kindOf(customItemKey(id));
  if (!k) { k = codeKind(customItemKey(id), 'Master codes', '', codeFormat(c.Prefix, 6), false, 'itemCounters', () => 'itemCounters/' + c.Prefix); kinds().push(k); }
  k.label = 'Item — ' + c.Name;
  return k;
}
async function loadItemCategoryKinds() {
  const all = (await val('itemCategories')) || {};
  Object.keys(all).forEach(id => { if (all[id] && all[id].Prefix) itemCategoryKind(id, all[id]); });
}
const customItemCode = (id, c) => { itemCategoryKind(id, c); return next(customItemKey(id), {}); };
// A new category's prefix would give the numbers another type gives (as saveNumberingFormat refuses): that type's name.
async function prefixClash(prefix) {
  await loadItemCategoryKinds();
  const f = codeFormat(prefix, 6), all = await formatsNow();
  const k = kinds().find(x => sameShape(all[x.key], f) || sameShape(x.default, f));
  return k ? k.label : '';
}

// The generators the system already had, by their old signatures.
const voucherNumber = (prefix, year, companyId) => {
  // A prefix added later by new development: numbered by the default.
  if (!kindOf('doc:' + prefix)) kinds().push(docKind(prefix, prefix, STOCK));
  return next('doc:' + prefix, { year, companyId });
};
const itemCode = category => {
  if (!ITEM_CATEGORY_PREFIXES[category]) throw new Error('Unknown item category: ' + category);
  return next('item:' + category, {});
};
const vendorCode = () => next('vendor', {});
const customerCode = isExport => next(isExport ? 'customer:CE' : 'customer:CL', {});
const employeeCode = () => next('employee', {});
const assetNumber = companyId => next('asset', { companyId });
const hrNumber = (prefix, year) => next('hr:' + prefix, { year });

// The counter a code came from, for Master Import's clean-up after a failed
// run (docs/modules/MASTER_IMPORT.md): matched against the current formats.
async function counterPathOfCode(code) {
  const text = String(code || '');
  const all = await formatsNow();
  const esc = t => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  for (const k of kinds()) {
    const f = all[k.key];
    const parts = [esc(f.Prefix)];
    (f.Order === 'CY' ? ['C', 'Y'] : ['Y', 'C']).forEach(m => {
      if (m === 'Y' && f.Year) parts.push(f.Year === 'YYYY' ? '(?<y>\\d{4})' : '(?<y>\\d{2})');
      if (m === 'C' && f.Company) parts.push('(?<co>\\d{2,}?)');
    });
    const m = text.match(new RegExp('^(?<scope>' + parts.join(esc(f.Sep)) + esc(f.Sep) + ')\\d{' + f.Digits + ',}$'));
    if (!m) continue;
    const g = m.groups;
    const c = { year: g.y ? Number(g.y.length === 2 ? '20' + g.y : g.y) : new Date().getUTCFullYear(), co: g.co || '' };
    // The counter it came from: the default's own, or the customized one.
    return g.scope === render(k.default, c, null) ? k.home(c) : k.root + '/_fmt/' + keyOf(g.scope);
  }
  return '';
}

// Where a customized code is recorded as given (none for a default one).
async function issuedPathOfCode(code) {
  const counter = await counterPathOfCode(code);
  const m = counter.match(/^(.*)\/_fmt\//);
  return m ? m[1] + '/_issued/' + keyOf(String(code)) : '';
}

// ---------- the screen ----------

async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change the numbering.' : 'You do not have access to Numbering.');
  }
}

exports.getNumbering = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  await loadItemCategoryKinds();
  const all = await formatsNow();
  const sample = { year: new Date().getUTCFullYear(), co: '01' };
  const log = Object.values((await val(LOG)) || {}).sort((a, b) => String(b.At).localeCompare(String(a.At))).slice(0, 50);
  return {
    canWrite: await moduleHasCapability(MODULE_ID, 'write', user.profile.role),
    kinds: kinds().map(k => ({
      key: k.key, group: k.group, label: k.label, company: k.company, format: all[k.key], default: k.default,
      isDefault: sameFormat(all[k.key], k.default), sample: render(all[k.key], sample, 1)
    })),
    log
  };
});

exports.saveNumberingFormat = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  await loadItemCategoryKinds();
  const d = request.data || {};
  const kind = kindOf(String(d.kind || ''));
  if (!kind) throw new HttpsError('not-found', 'Unknown numbering type.');
  const f = d.reset === true ? Object.assign({}, kind.default) : validate(kind, d.format || {});
  const all = await formatsNow();
  // Two types must never give the same numbers: not another type's current
  // format, its default (numbers given before), or any shape it had.
  const earlier = Object.values((await val(LOG)) || {}).filter(e => e.Format);
  const clash = kinds().find(k => k.key !== kind.key && (sameShape(all[k.key], f) || sameShape(k.default, f) ||
    earlier.some(e => e.Kind === k.key && sameShape(e.Format, f))));
  if (clash) throw new HttpsError('already-exists', 'That would give the same numbers as ' + clash.label + ' (' + render(all[clash.key], { year: new Date().getUTCFullYear(), co: '01' }, 1) + '): change the prefix.');
  const before = all[kind.key];
  if (sameFormat(before, f)) return { success: true, unchanged: true };
  const now = new Date().toISOString();
  const by = user.profile.username || user.uid;
  const sample = { year: new Date().getUTCFullYear(), co: '01' };
  const path = FORMATS + kind.key;
  await rtdb.ref().update({
    [path]: sameFormat(f, kind.default) ? null : Object.assign({}, f, { UpdatedAt: now, UpdatedBy: by }),
    [LOG + '/' + rtdb.ref(LOG).push().key]: { Kind: kind.key, Label: kind.label, From: render(before, sample, 1), To: render(f, sample, 1), Format: f, At: now, By: by }
  });
  return { success: true, sample: render(f, sample, 1) };
});

module.exports = Object.assign(exports, {
  next, voucherNumber, itemCode, customItemCode, prefixClash, loadItemCategoryKinds, ITEM_CATEGORY_PREFIXES, ITEM_LABELS, vendorCode, customerCode, employeeCode, assetNumber, hrNumber, counterPathOfCode, issuedPathOfCode,
  _test: { render, validate, kinds, keyOf }
});
