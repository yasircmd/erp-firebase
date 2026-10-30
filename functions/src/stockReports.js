// Stock reports (owner, 2026-10-12; docs/modules/STOCK_REPORTS.md,
// decisions 144-147): the Expiry / Batch Report and the Reorder / Low Stock
// Report, read-only, each its own module and access right.
//
// Expiry / Batch: the stock ledger has no batch dimension, so each batch's
// remaining stock is worked out from the posted movements up to the date
// (as Inventory Aging does): every receipt adds a layer with its batch and
// expiry; what goes out is taken from the named batch when the line names
// one, else from the batch that expires first (first expiry, first out,
// decision 144); a warehouse transfer moves the layers it takes. Value: the
// item-and-warehouse's value shared by quantity (average cost).
//
// Reorder: per item with a reorder level, available = on hand − reserved
// (active sales-order reservations) + on order (approved purchase orders
// not yet received), against the level (146); the shortfall is suggested
// (147).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const stockStore = require('./stockStore');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { countedTransactions } = require('./agingReports');

const onCallOptions = { region: 'us-central1' };
const round2 = n => Math.round(n * 100) / 100;
const round6 = n => Math.round(n * 1e6) / 1e6;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

async function checkAccess(user, moduleId, label, d) {
  if (!(await moduleHasCapability(moduleId, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to ' + label + '.');
  const companyId = String(d.companyId || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return companyId;
}

async function masters(companyId) {
  const [itemSnap, unitSnap, uomSnap] = await Promise.all([rtdb.ref('items').get(), rtdb.ref('orgUnits').get(), rtdb.ref('uoms').get()]);
  const items = itemSnap.val() || {}, units = unitSnap.val() || {}, uoms = uomSnap.val() || {};
  const warehouses = Object.entries(units).filter(([, u]) => u.Type === 'Warehouse' && (!u.CompanyID || u.CompanyID === companyId))
    .map(([id, u]) => ({ ID: id, Label: (u.Code ? u.Code + ' — ' : '') + (u.Name || '') })).sort((a, b) => a.Label.localeCompare(b.Label));
  const categories = [...new Set(Object.values(items).filter(i => !i.CompanyID || i.CompanyID === companyId).map(i => i.Category).filter(Boolean))].sort();
  return { items, units, uoms, warehouses, categories };
}

// ---------- Expiry / Batch ----------

// Each (item, warehouse): its batch layers { Batch, Expiry, Received, Qty }
// and its value, after replaying the movements.
function replayBatches(transactions) {
  const st = {};
  const expiryOf = {}; // item|batch → the expiry a receipt recorded (a later receipt of the batch without one takes it)
  const at = (item, wh) => (st[item + '|' + wh] = st[item + '|' + wh] || { item, wh, layers: [], value: 0, qty: 0 });
  const fefo = (a, b) => (a.Expiry || '9999-99-99').localeCompare(b.Expiry || '9999-99-99') || a.Received.localeCompare(b.Received);
  // What goes out: the named batch first, then first expiry first out.
  const take = (s, qty, batch) => {
    const out = [];
    let left = qty;
    const order = s.layers.slice().sort(fefo);
    const named = batch ? order.filter(l => l.Batch === batch) : [];
    for (const l of named.concat(order.filter(x => !named.includes(x)))) {
      if (left <= 1e-9) break;
      const q = Math.min(l.Qty, left);
      if (q <= 0) continue;
      out.push(Object.assign({}, l, { Qty: q }));
      l.Qty = round6(l.Qty - q); left = round6(left - q);
    }
    s.layers = s.layers.filter(l => l.Qty > 1e-9);
    s.qty = round6(s.qty - (qty - left));
    return out;
  };
  const put = (s, layer) => {
    const same = s.layers.find(l => l.Batch === layer.Batch && l.Expiry === layer.Expiry && l.Received === layer.Received);
    if (same) same.Qty = round6(same.Qty + layer.Qty); else s.layers.push(Object.assign({}, layer));
    s.qty = round6(s.qty + layer.Qty);
  };
  transactions.forEach(t => (t.Lines || []).forEach(l => {
    if (l.ValueOnly && l.ItemID) { // value only (TAX_ENGINE.md, Q323): the cost changes, not the quantity
      const v = at(l.ItemID, l.WarehouseID);
      v.value = round2(v.value + (l.Direction === 'Out' ? -1 : 1) * (Number(l.TotalValue) || 0));
      return;
    }
    const qty = Number(l.Quantity) || 0;
    if (!(qty > 0) || !l.ItemID) return;
    const value = Number(l.TotalValue) || 0;
    const batch = String(l.BatchNumber || '').trim();
    if (t.TransactionType === 'WarehouseMovement') {
      const from = at(l.ItemID, l.FromWarehouseID || l.WarehouseID), to = at(l.ItemID, l.ToWarehouseID);
      take(from, qty, batch).forEach(x => put(to, x)); // moved stock keeps its batch, expiry and receipt date
      from.value = round2(from.value - value); to.value = round2(to.value + value);
      return;
    }
    const s = at(l.ItemID, l.WarehouseID);
    if (l.Direction === 'In') {
      let expiry = String(l.ExpiryDate || '').trim();
      if (batch && expiry) expiryOf[l.ItemID + '|' + batch] = expiry;
      if (batch && !expiry) expiry = expiryOf[l.ItemID + '|' + batch] || '';
      put(s, { Batch: batch, Expiry: expiry, Received: t.TransactionDate, Qty: qty });
      s.value = round2(s.value + value);
    } else if (l.Direction === 'Out') {
      take(s, qty, batch);
      s.value = round2(s.value - value);
    }
  }));
  return st;
}

async function batchExpiry(companyId, asOf, warehouseId, category, withinDays, batchTrackedOnly) {
  // The company's posted stock transactions (stockStore.js), not every one.
  const [txSnap, m] = await Promise.all([stockStore.queryTx({ CompanyID: companyId, Status: 'Posted' }).then(v => ({ val: () => v })), masters(companyId)]);
  const st = replayBatches(countedTransactions(txSnap.val(), companyId, asOf));
  const until = new Date(Date.parse(asOf + 'T00:00:00Z') + withinDays * 86400000).toISOString().slice(0, 10);
  const rows = [];
  Object.values(st).forEach(s => {
    if (warehouseId && s.wh !== warehouseId) return;
    const item = m.items[s.item] || {};
    if (category && item.Category !== category) return;
    if (batchTrackedOnly && !item.BatchTracked) return;
    const unitValue = s.qty > 1e-9 ? s.value / s.qty : 0;
    // One row per batch (its layers merged; the earliest receipt shown).
    const byBatch = {};
    s.layers.forEach(l => {
      const k = l.Batch + '|' + l.Expiry;
      const r = byBatch[k] = byBatch[k] || { Batch: l.Batch, Expiry: l.Expiry, Received: l.Received, Qty: 0 };
      r.Qty = round6(r.Qty + l.Qty);
      if (l.Received < r.Received) r.Received = l.Received;
    });
    Object.values(byBatch).forEach(b => {
      const days = b.Expiry ? daysBetween(asOf, b.Expiry) : null;
      rows.push({
        ItemID: s.item, ItemCode: item.ItemCode || s.item, ItemName: item.ItemName || '', Category: item.Category || '',
        WarehouseID: s.wh, Warehouse: ((m.units[s.wh] || {}).Code || s.wh), UOM: (m.uoms[item.UOMID] || {}).Code || '',
        Batch: b.Batch, Received: b.Received, Expiry: b.Expiry, DaysToExpiry: days, Qty: b.Qty, Value: round2(b.Qty * unitValue),
        Status: !b.Expiry ? 'No expiry date' : b.Expiry < asOf ? 'Expired' : b.Expiry <= until ? 'Expiring' : 'OK'
      });
    });
  });
  rows.sort((a, b) => (a.Expiry || '9999-99-99').localeCompare(b.Expiry || '9999-99-99') || a.ItemCode.localeCompare(b.ItemCode) || a.Batch.localeCompare(b.Batch));
  const sum = st => round2(rows.filter(r => r.Status === st).reduce((x, r) => x + r.Value, 0));
  return {
    CompanyID: companyId, AsOf: asOf, WithinDays: withinDays, Until: until, WarehouseID: warehouseId || '', Rows: rows,
    Totals: { Expired: sum('Expired'), Expiring: sum('Expiring'), OK: sum('OK'), NoExpiry: sum('No expiry date'), Value: round2(rows.reduce((x, r) => x + r.Value, 0)) },
    Warehouses: m.warehouses, Categories: m.categories
  };
}

exports.getBatchExpiryReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const companyId = await checkAccess(user, 'BATCHEXPIRY', 'the Expiry / Batch Report', d);
  const asOf = String(d.asOf || '').trim() || today();
  if (!isDate(asOf)) throw new HttpsError('invalid-argument', 'Enter the "as at" date.');
  const within = d.withinDays === undefined || d.withinDays === '' ? 90 : Number(d.withinDays);
  if (!Number.isInteger(within) || within < 0 || within > 3650) throw new HttpsError('invalid-argument', '"Expiring within" is a number of days from 0 to 3650.');
  return batchExpiry(companyId, asOf, String(d.warehouseId || '').trim(), String(d.category || '').trim(), within, d.batchTrackedOnly !== false);
});

// ---------- Reorder / Low Stock ----------

async function reorder(companyId, warehouseId, category, onlyBelow) {
  const [ledgerSnap, resSnap, poSnap, txSnap, m] = await Promise.all([
    stockStore.allLedger(warehouseId ? { WarehouseID: warehouseId } : undefined).then(v => ({ val: () => v })), require('./salesStore').reservations.query({ CompanyID: companyId, Status: 'Active' }).then(v => ({ val: () => v })), require('./purchaseStore').purchaseOrders.query({ Status: 'Approved', CompanyID: companyId }).then(v => ({ val: () => v })),
    stockStore.queryTx({ CompanyID: companyId, Status: 'Posted' }).then(v => ({ val: () => v })), masters(companyId)
  ]);
  const ledger = ledgerSnap.val() || {}, reservations = resSnap.val() || {}, pos = poSnap.val() || {};
  const myWh = new Set(m.warehouses.map(w => w.ID));
  const counts = wh => (warehouseId ? wh === warehouseId : myWh.has(wh));
  const byCode = {};
  Object.entries(m.items).forEach(([id, it]) => { if (it.ItemCode) byCode[it.ItemCode] = id; });
  const sums = {}; // itemId → { onHand, reserved, onOrder, lastIn, lastOut }
  const at = id => (sums[id] = sums[id] || { onHand: 0, reserved: 0, onOrder: 0, lastIn: '', lastOut: '' });
  Object.entries(ledger).forEach(([itemId, whs]) => Object.entries(whs || {}).forEach(([wh, l]) => { if (counts(wh)) at(itemId).onHand += Number((l || {}).Quantity) || 0; }));
  Object.values(reservations).forEach(r => {
    if (r.Status === 'Active' && r.CompanyID === companyId && counts(r.WarehouseID)) at(r.ItemID).reserved += Number(r.Quantity) || 0;
  });
  // On order: approved purchase orders not yet received (a line with no
  // warehouse counts only when all warehouses are shown).
  Object.values(pos).forEach(po => {
    if (po.Status !== 'Approved' || po.CompanyID !== companyId) return;
    (po.Lines || []).forEach(l => {
      const itemId = l.ItemID || byCode[l.ItemCode];
      if (!itemId) return;
      if (warehouseId ? l.WarehouseID !== warehouseId : (l.WarehouseID && !myWh.has(l.WarehouseID))) return;
      at(itemId).onOrder += Math.max(0, (Number(l.Quantity) || 0) - (Number(l.ReceivedQuantity) || 0));
    });
  });
  Object.values(txSnap.val() || {}).forEach(t => {
    if (t.Status !== 'Posted' || t.CompanyID !== companyId) return;
    (t.Lines || []).forEach(l => {
      if (!l.ItemID || !sums[l.ItemID] && !(m.items[l.ItemID] || {}).ReorderLevel) return;
      const wh = l.Direction === 'In' ? l.WarehouseID || l.ToWarehouseID : l.WarehouseID || l.FromWarehouseID;
      if (warehouseId && wh !== warehouseId) return;
      if (t.TransactionType === 'WarehouseMovement' && !warehouseId) return; // a transfer is neither a receipt nor an issue of the company
      const s = at(l.ItemID), d = t.TransactionDate || '';
      if (l.Direction === 'In' && d > s.lastIn) s.lastIn = d;
      if (l.Direction === 'Out' && d > s.lastOut) s.lastOut = d;
    });
  });
  const rows = [];
  Object.entries(m.items).forEach(([id, it]) => {
    const level = Number(it.ReorderLevel) || 0;
    if (!(level > 0) || (it.CompanyID && it.CompanyID !== companyId) || (it.Status && it.Status !== 'Active')) return;
    if (category && it.Category !== category) return;
    const s = sums[id] || { onHand: 0, reserved: 0, onOrder: 0, lastIn: '', lastOut: '' };
    const available = round6(s.onHand - s.reserved + s.onOrder);
    const shortfall = round6(Math.max(0, level - available));
    const row = {
      ItemID: id, ItemCode: it.ItemCode || id, ItemName: it.ItemName || '', Category: it.Category || '', UOM: (m.uoms[it.UOMID] || {}).Code || '',
      OnHand: round6(s.onHand), Reserved: round6(s.reserved), OnOrder: round6(s.onOrder), Available: available, ReorderLevel: level,
      Shortfall: shortfall, Suggested: shortfall, Below: available < level - 1e-9, LastIn: s.lastIn, LastOut: s.lastOut
    };
    if (!onlyBelow || row.Below) rows.push(row);
  });
  rows.sort((a, b) => Number(b.Below) - Number(a.Below) || (b.Shortfall / b.ReorderLevel) - (a.Shortfall / a.ReorderLevel) || a.ItemCode.localeCompare(b.ItemCode));
  return { CompanyID: companyId, WarehouseID: warehouseId || '', Rows: rows, BelowCount: rows.filter(r => r.Below).length, Warehouses: m.warehouses, Categories: m.categories };
}

exports.getReorderReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const companyId = await checkAccess(user, 'REORDER', 'the Reorder / Low Stock Report', d);
  return reorder(companyId, String(d.warehouseId || '').trim(), String(d.category || '').trim(), d.onlyBelow !== false);
});

module.exports.replayBatches = replayBatches;
