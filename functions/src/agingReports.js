// Aging Reports (owner, 2026-10-11; docs/modules/AGING_REPORTS.md,
// decisions 118-121): Customer Aging, Vendor Aging and Inventory Aging,
// read-only, each its own module and access right.
//
// Customer / Vendor: every party's open items as at a date, from the same
// engine as the Statements of Account (partyLedger.openItemsFrom and
// partyStatement.openItemRows), the invoices and entries read once for all
// parties. Owed items go into buckets by days overdue (from the due date)
// or by days since the invoice date (decision 118); advances and open
// credits are a separate "Unapplied credits" column (decision 119).
//
// Inventory: the stock on hand as at a date, aged first in first out by
// receipt date (decision 120), in six buckets (decision 121). Posted stock
// movements are replayed in date order, each warehouse holding a queue of
// dated layers: a receipt adds a layer, an issue takes from the oldest, a
// warehouse transfer moves the layers it takes (keeping their dates). A
// document reversed by a reversal dated on or before the date drops out
// with its reversal. Value: the movements' own values (moving average
// cost), so the totals match the stock ledger.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { PARTY_TYPES, openItemsFrom } = require('./partyLedger');
const { openItemRows, GROWS } = require('./partyStatement');
const { pendingPdcsFrom, PDC_PATH } = require('./pdc');

const onCallOptions = { region: 'us-central1' };
const PARTY_MODULES = { Customer: 'CUSTOMERAGING', Vendor: 'VENDORAGING' };
const INVENTORY_MODULE = 'INVENTORYAGING';

// Decision 118: by days overdue (the SOA's buckets) or by invoice age.
const BUCKETS = {
  due: [
    { key: 'notDue', label: 'Not yet due', max: 0 },
    { key: 'd1_30', label: '1–30', max: 30 },
    { key: 'd31_60', label: '31–60', max: 60 },
    { key: 'd61_90', label: '61–90', max: 90 },
    { key: 'd90plus', label: '90+', max: Infinity }
  ],
  invoice: [
    { key: 'd0_30', label: '0–30', max: 30 },
    { key: 'd31_60', label: '31–60', max: 60 },
    { key: 'd61_90', label: '61–90', max: 90 },
    { key: 'd91_120', label: '91–120', max: 120 },
    { key: 'd120plus', label: '120+', max: Infinity }
  ]
};
// Decision 121.
const STOCK_BUCKETS = [
  { key: 'd0_30', label: '0–30', max: 30 },
  { key: 'd31_60', label: '31–60', max: 60 },
  { key: 'd61_90', label: '61–90', max: 90 },
  { key: 'd91_180', label: '91–180', max: 180 },
  { key: 'd181_365', label: '181–365', max: 365 },
  { key: 'd365plus', label: 'Over 365', max: Infinity }
];

const round2 = n => Math.round(n * 100) / 100;
const round6 = n => Math.round(n * 1e6) / 1e6;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const bucketOf = (list, days) => list.find(b => days <= b.max).key;
const zeros = list => Object.fromEntries(list.map(b => [b.key, 0]));
const today = () => new Date().toISOString().slice(0, 10);

async function checkAccess(user, moduleId, label, d) {
  if (!(await moduleHasCapability(moduleId, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to ' + label + '.');
  const companyId = String(d.companyId || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const asOf = String(d.asOf || '').trim() || today();
  if (!isDate(asOf)) throw new HttpsError('invalid-argument', 'Enter the "as at" date.');
  return { companyId, asOf };
}

// ---------- Customer / Vendor ----------

async function partyAging(partyType, companyId, asOf, basis, only) {
  const cfg = PARTY_TYPES[partyType];
  const buckets = BUCKETS[basis];
  const [partiesSnap, otherSnap, invSnap, pdcSnap, coaSnap, entrySnap] = await Promise.all([
    rtdb.ref(cfg.path).get(), rtdb.ref(PARTY_TYPES[partyType === 'Vendor' ? 'Customer' : 'Vendor'].path).get(),
    rtdb.ref(cfg.invoicePath).get(), rtdb.ref(PDC_PATH).get(), rtdb.ref('coa').get(),
    firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).get()
  ]);
  const parties = partiesSnap.val() || {}, invoices = invSnap.val() || {}, pdcs = pdcSnap.val() || {}, coa = coaSnap.val() || {};
  const entries = entrySnap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
  // The entries tagged with each party, found once.
  const byParty = {};
  entries.forEach(e => (e.PartyKeys || []).forEach(k => { (byParty[k] = byParty[k] || []).push(e); }));

  const ids = Object.keys(parties).filter(id => (!parties[id].CompanyID || parties[id].CompanyID === companyId) && (!only || only.includes(id)));
  const rows = [];
  for (const id of ids) {
    const party = parties[id];
    const items = openItemsFrom(partyType, id, party, asOf, invoices, byParty[partyType + ':' + id] || []);
    const open = openItemRows(partyType, party, items, companyId, asOf);
    const pending = pendingPdcsFrom(pdcs, partyType, id, companyId, asOf);
    if (!open.length && !pending.length) continue;
    const row = { PartyID: id, Code: party[cfg.codeField] || '', Name: party[cfg.nameField] || '', Classification: party.Classification || '',
      Terms: Number(party.PaymentTermsDays) || 0, Buckets: zeros(buckets), Owed: 0, Unapplied: 0, Net: 0, OldestDays: 0,
      PendingPdc: round2(pending.reduce((s, p) => s + p.Amount, 0)), Items: [] };
    open.forEach(i => {
      const age = basis === 'due' ? daysBetween(i.DueDate, asOf) : Math.max(0, daysBetween(i.Date, asOf));
      if (i.Outstanding > 0) {
        const b = bucketOf(buckets, age);
        row.Buckets[b] = round2(row.Buckets[b] + i.Outstanding);
        row.Owed = round2(row.Owed + i.Outstanding);
        row.OldestDays = Math.max(row.OldestDays, age);
        row.Items.push(Object.assign({}, i, { Age: age, Bucket: b }));
      } else {
        row.Unapplied = round2(row.Unapplied - i.Outstanding);
        row.Items.push(Object.assign({}, i, { Age: age, Bucket: 'unapplied' }));
      }
    });
    row.Net = round2(row.Owed - row.Unapplied);
    rows.push(row);
  }
  rows.sort((a, b) => b.Net - a.Net || a.Name.localeCompare(b.Name));
  const totals = { Buckets: zeros(buckets), Owed: 0, Unapplied: 0, Net: 0, PendingPdc: 0 };
  rows.forEach(r => {
    buckets.forEach(b => { totals.Buckets[b.key] = round2(totals.Buckets[b.key] + r.Buckets[b.key]); });
    ['Owed', 'Unapplied', 'Net', 'PendingPdc'].forEach(k => { totals[k] = round2(totals[k] + r[k]); });
  });

  // The control accounts in the GL at the date (for every party, not just
  // the ones chosen): comparable only when no party of the other kind in
  // this company posts to them.
  let control = { status: 'none' };
  const accountsOf = (all, type) => new Set(Object.values(all).filter(p => !p.CompanyID || p.CompanyID === companyId).map(p => p[PARTY_TYPES[type].accountField]).filter(Boolean));
  const mine = accountsOf(parties, partyType), others = accountsOf(otherSnap.val() || {}, partyType === 'Vendor' ? 'Customer' : 'Vendor');
  if (only) control = { status: 'partial' };
  else if ([...mine].some(a => others.has(a))) control = { status: 'shared' };
  else if (mine.size) {
    let dr = 0, cr = 0;
    entries.forEach(e => {
      if (e.Status !== 'Posted' || !(String(e.JVDate || '') <= asOf)) return;
      (e.Lines || []).forEach(l => { if (mine.has(l.AccountID)) { dr += Number(l.Debit) || 0; cr += Number(l.Credit) || 0; } });
    });
    const balance = round2(GROWS[partyType] === 'Dr' ? dr - cr : cr - dr);
    control = { status: 'ok', Accounts: [...mine].map(a => (coa[a] || {}).AccountCode || a).sort(), Balance: balance, Difference: round2(totals.Net - balance) };
  }
  return { PartyType: partyType, CompanyID: companyId, AsOf: asOf, Basis: basis, Buckets: buckets.map(b => ({ key: b.key, label: b.label })), Rows: rows, Totals: totals, Control: control };
}

exports.getPartyAging = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const partyType = String(d.partyType || '').trim();
  if (!PARTY_MODULES[partyType]) throw new HttpsError('invalid-argument', 'Party type must be Customer or Vendor.');
  const { companyId, asOf } = await checkAccess(user, PARTY_MODULES[partyType], partyType + ' Aging', d);
  const basis = d.basis === 'invoice' ? 'invoice' : 'due';
  const only = Array.isArray(d.partyIds) && d.partyIds.length ? d.partyIds.map(String) : null;
  return partyAging(partyType, companyId, asOf, basis, only);
});

// ---------- Inventory ----------

// The stock movements that count as at the date: posted, dated on or
// before it, and not reversed by a reversal that also counts.
function countedTransactions(all, companyId, asOf) {
  const posted = Object.entries(all || {}).map(([id, t]) => Object.assign({ _id: id }, t))
    .filter(t => t.Status === 'Posted' && t.CompanyID === companyId && Array.isArray(t.Lines) && t.Lines.length && String(t.TransactionDate || '') <= asOf);
  const ids = new Set(posted.map(t => t._id));
  const dropped = new Set();
  posted.forEach(t => Object.keys(t).forEach(k => {
    if (!/^ReversalOf/.test(k) || k === 'ReversalOfType') return;
    const orig = t[k];
    if (typeof orig === 'string' && ids.has(orig)) { dropped.add(orig); dropped.add(t._id); }
  }));
  return posted.filter(t => !dropped.has(t._id))
    .sort((a, b) => (a.TransactionDate + (a.PostedAt || a.CreatedAt || '')).localeCompare(b.TransactionDate + (b.PostedAt || b.CreatedAt || '')));
}

// Each (item, warehouse) a queue of { Qty, Date } layers, oldest first, and
// its value; returns { 'item|wh': { layers, value, lastIn, lastOut } }.
function replayLayers(transactions) {
  const st = {};
  const at = (item, wh) => (st[item + '|' + wh] = st[item + '|' + wh] || { item, wh, layers: [], value: 0, lastIn: '', lastOut: '', short: 0 });
  const take = (s, qty) => { // oldest first; returns the layers taken
    const out = [];
    let left = qty;
    while (left > 1e-9 && s.layers.length) {
      const l = s.layers[0];
      const q = Math.min(l.Qty, left);
      out.push({ Qty: q, Date: l.Date });
      l.Qty = round6(l.Qty - q); left = round6(left - q);
      if (l.Qty <= 1e-9) s.layers.shift();
    }
    if (left > 1e-9) s.short = round6(s.short + left); // issued beyond the receipts on record
    return out;
  };
  transactions.forEach(t => (t.Lines || []).forEach(l => {
    const qty = Number(l.Quantity) || 0;
    if (!(qty > 0) || !l.ItemID) return;
    const value = Number(l.TotalValue) || 0;
    if (t.TransactionType === 'WarehouseMovement') {
      const from = at(l.ItemID, l.FromWarehouseID || l.WarehouseID), to = at(l.ItemID, l.ToWarehouseID);
      take(from, qty).forEach(x => to.layers.push(x));
      to.layers.sort((a, b) => a.Date.localeCompare(b.Date)); // moved stock keeps its age
      from.value = round2(from.value - value); to.value = round2(to.value + value);
      return;
    }
    const s = at(l.ItemID, l.WarehouseID);
    if (l.Direction === 'In') { s.layers.push({ Qty: qty, Date: t.TransactionDate }); s.value = round2(s.value + value); s.lastIn = t.TransactionDate; }
    else if (l.Direction === 'Out') { take(s, qty); s.value = round2(s.value - value); s.lastOut = t.TransactionDate; }
  }));
  return st;
}

async function inventoryAging(companyId, asOf, warehouseId, category, onlyWithStock) {
  const [txSnap, itemSnap, unitSnap, uomSnap] = await Promise.all([rtdb.ref('stock/transactions').get(), rtdb.ref('items').get(), rtdb.ref('orgUnits').get(), rtdb.ref('uoms').get()]);
  const items = itemSnap.val() || {}, units = unitSnap.val() || {}, uoms = uomSnap.val() || {};
  const st = replayLayers(countedTransactions(txSnap.val(), companyId, asOf));
  // One row per item (per warehouse when one is chosen).
  const rows = {};
  Object.values(st).forEach(s => {
    if (warehouseId && s.wh !== warehouseId) return;
    const item = items[s.item] || {};
    if (category && item.Category !== category) return;
    const r = rows[s.item] = rows[s.item] || { ItemID: s.item, ItemCode: item.ItemCode || s.item, ItemName: item.ItemName || '', Category: item.Category || '',
      UOM: (uoms[item.UOMID] || {}).Code || '', Qty: 0, Value: 0, QtyBuckets: zeros(STOCK_BUCKETS), Buckets: zeros(STOCK_BUCKETS), LastIn: '', LastOut: '', Short: 0, OldestDays: 0 };
    s.layers.forEach(l => { const b = bucketOf(STOCK_BUCKETS, daysBetween(l.Date, asOf)); r.QtyBuckets[b] = round6(r.QtyBuckets[b] + l.Qty); r.Qty = round6(r.Qty + l.Qty); r.OldestDays = Math.max(r.OldestDays, daysBetween(l.Date, asOf)); });
    r.Value = round2(r.Value + s.value);
    if (s.lastIn > r.LastIn) r.LastIn = s.lastIn;
    if (s.lastOut > r.LastOut) r.LastOut = s.lastOut;
    r.Short = round6(r.Short + s.short);
  });
  const list = Object.values(rows).filter(r => !onlyWithStock || r.Qty > 1e-9);
  // The value split as the quantity is (the books hold an average cost, not per-receipt costs).
  list.forEach(r => {
    let left = r.Value;
    STOCK_BUCKETS.forEach((b, i) => {
      const v = r.Qty > 1e-9 ? (i === STOCK_BUCKETS.length - 1 ? left : round2(r.Value * r.QtyBuckets[b.key] / r.Qty)) : 0;
      r.Buckets[b.key] = round2(v); left = round2(left - r.Buckets[b.key]);
    });
    if (r.Qty <= 1e-9) r.Buckets[STOCK_BUCKETS[STOCK_BUCKETS.length - 1].key] = 0;
  });
  list.sort((a, b) => a.ItemCode.localeCompare(b.ItemCode));
  const totals = { Value: 0, Buckets: zeros(STOCK_BUCKETS) };
  list.forEach(r => { totals.Value = round2(totals.Value + r.Value); STOCK_BUCKETS.forEach(b => { totals.Buckets[b.key] = round2(totals.Buckets[b.key] + r.Buckets[b.key]); }); });
  const warehouses = Object.entries(units).filter(([, u]) => u.Type === 'Warehouse' && (!u.CompanyID || u.CompanyID === companyId))
    .map(([id, u]) => ({ ID: id, Label: (u.Code ? u.Code + ' — ' : '') + (u.Name || '') })).sort((a, b) => a.Label.localeCompare(b.Label));
  const categories = [...new Set(Object.values(items).filter(i => !i.CompanyID || i.CompanyID === companyId).map(i => i.Category).filter(Boolean))].sort();
  return { CompanyID: companyId, AsOf: asOf, WarehouseID: warehouseId || '', Buckets: STOCK_BUCKETS.map(b => ({ key: b.key, label: b.label })), Rows: list, Totals: totals, Warehouses: warehouses, Categories: categories };
}

exports.getInventoryAging = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const { companyId, asOf } = await checkAccess(user, INVENTORY_MODULE, 'Inventory Aging', d);
  return inventoryAging(companyId, asOf, String(d.warehouseId || '').trim(), String(d.category || '').trim(), d.onlyWithStock !== false);
});

// Period Closing's checklist uses the reports' own figures (docs/modules/PERIOD_CLOSING.md).
module.exports.partyAging = partyAging;
module.exports.inventoryAging = inventoryAging;
module.exports.BUCKETS = BUCKETS;
module.exports.STOCK_BUCKETS = STOCK_BUCKETS;
module.exports.replayLayers = replayLayers;
module.exports.countedTransactions = countedTransactions;
