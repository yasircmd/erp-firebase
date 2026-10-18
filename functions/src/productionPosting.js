// A Production Entry's effects on its Job Order lines, their linked Sales
// Orders and the reservations, written with its posting (owner, 2026-10-17;
// docs/modules/TRANSACTIONS_FIRESTORE.md, phase T4). New development,
// hand-written.
//
// Posting a Production Entry used to update its Job Order lines after the
// posting itself, one write at a time (updateJobOrderLineProgressAfterProduction_,
// allocateProducedQuantityToLinkedSalesOrders_ and, for a reversal,
// rollbackJobOrderLineAfterReversal_). Now the Job Orders are in Firestore
// too (jobStore.js), so planProduction works out, before anything is
// written, every line, reservation and order the posting changes, exactly
// as those functions did, and planWriter adds them to the posting's batch.
//
// What the step-by-step code read after the batch (the produced quantity
// of a line, counted from every posted Production Entry) now has to count
// the entry being posted too: it is passed in (inflightLines).
//
// Caller holds the global lock.
'use strict';
const firebaseAdmin = require('./firebaseAdmin');
const { applyUpdate, keyOrder } = require('./docStore');
const { salesOrders, reservations } = require('./salesStore');
const { jobOrderLines, jobOrderBatches } = require('./jobStore');
const stockStore = require('./stockStore');
const { reservationRecord, reservationStatusFor } = require('./reservations');

const TERMINAL_FORWARD = ['Stopped', 'Cancelled', 'Completed'];

// mode 'post': lineQuantities { lineId: newly produced quantity } (in the
// order the posting found them). mode 'reverse': lineIds (the lines the
// reversed entry fed). prodId: the posted entry (post) or the reversed
// original (reverse): its reservations carry it as CreatedByProductionID.
// inflightLines: the lines of the entry being posted (its own Direction and
// JobOrderLineID). Returns { lines, orders, reservations }: { id: document
// as it is to be written }.
async function planProduction(actor, { mode, prodId, lineQuantities, lineIds, inflightLines }) {
  const now = new Date().toISOString();
  const state = { lines: {}, orders: {}, reservations: {} };
  const touched = { lines: new Set(), orders: new Set(), reservations: new Set() };
  const set = (kind, id, doc) => { state[kind][id] = doc; touched[kind].add(id); };

  const line = async id => {
    if (!(id in state.lines)) state.lines[id] = await jobOrderLines.get(id);
    return state.lines[id];
  };
  const order = async id => {
    if (!(id in state.orders)) state.orders[id] = await salesOrders.get(id);
    return state.orders[id];
  };
  // A Sales Order's reservations, read once, then as this plan leaves them.
  const loadedOrders = new Set();
  const ofOrder = async soId => {
    if (!loadedOrders.has(soId)) {
      loadedOrders.add(soId);
      const found = soId ? await reservations.query({ SourceType: 'SalesOrder', SourceID: String(soId) }) : {};
      Object.keys(found).forEach(id => { if (!(id in state.reservations)) state.reservations[id] = found[id]; });
    }
    return Object.keys(state.reservations).sort(keyOrder)
      .filter(id => state.reservations[id] && state.reservations[id].SourceType === 'SalesOrder' && state.reservations[id].SourceID === soId)
      .map(id => Object.assign({ ReservationID: id }, state.reservations[id]));
  };
  const refreshOrder = async soId => {
    const so = await order(soId);
    const status = so && reservationStatusFor(so, await ofOrder(soId));
    if (status) set('orders', soId, applyUpdate(so, { Status: status, UpdatedAt: now }));
  };

  // computeJobOrderLineProducedQty_: every posted Production Entry's lines
  // for this Job Order line, In less Out, and the entry being posted.
  let posted = null;
  const produced = async l => {
    if (!posted) posted = await stockStore.queryTx({ TransactionType: 'Production', Status: 'Posted' });
    let n = 0;
    const count = x => {
      if (x.ItemCode !== l.ItemCode || x.JobOrderLineID !== l.LineID) return;
      if (x.Direction === 'In') n += Number(x.Quantity) || 0;
      else if (x.Direction === 'Out') n -= Number(x.Quantity) || 0;
    };
    Object.values(posted).forEach(t => { if (t.TransactionType === 'Production' && t.Status === 'Posted') (t.Lines || []).forEach(count); });
    (inflightLines || []).forEach(count);
    return n;
  };

  let items = null;
  // allocateProducedQuantityToLinkedSalesOrders_.
  const allocate = async (l, newlyProduced) => {
    let remaining = newlyProduced;
    const links = l.LinkedSalesOrderLines || [];
    if (!links.length || remaining <= 0) return;
    const candidates = [];
    for (const link of links) {
      const so = await order(link.SOID);
      if (!so || (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved')) continue;
      const soLine = (so.Lines || []).find(x => x.LineID === link.SOLineID);
      if (!soLine) continue;
      const reserved = (await ofOrder(link.SOID)).filter(r => r.Status === 'Active' && r.SourceLineID === link.SOLineID)
        .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
      const shortfall = Number(soLine.OrderedQuantity) - reserved;
      if (shortfall > 0) candidates.push({ SOID: link.SOID, SONumber: so.SONumber, SOLineID: link.SOLineID, WarehouseID: soLine.WarehouseID, Shortfall: shortfall, CompanyID: so.CompanyID });
    }
    if (!items) items = (await firebaseAdmin.rtdb.ref('items').get()).val() || {};
    const itemId = Object.keys(items).find(id => items[id].ItemCode === l.ItemCode) || '';
    const touchedOrders = new Set();
    for (const c of candidates) {
      if (remaining <= 0) break;
      const toAllocate = Math.min(remaining, c.Shortfall);
      if (toAllocate <= 0) continue;
      const { id, doc } = reservationRecord(actor, {
        ItemID: itemId, ItemCode: l.ItemCode, WarehouseID: c.WarehouseID, CompanyID: c.CompanyID, Quantity: toAllocate,
        SourceType: 'SalesOrder', SourceID: c.SOID, SourceLineID: c.SOLineID, SourceLabel: c.SONumber, CreatedByProductionID: prodId || ''
      });
      set('reservations', id, doc);
      remaining -= toAllocate;
      touchedOrders.add(c.SOID);
    }
    for (const soId of touchedOrders) await refreshOrder(soId);
  };

  if (mode === 'post') {
    // updateJobOrderLineProgressAfterProduction_, for each line in turn.
    for (const lineId of Object.keys(lineQuantities || {})) {
      const l0 = await line(lineId);
      if (!l0) continue;
      const l = Object.assign({}, l0, { LineID: lineId });
      if (TERMINAL_FORWARD.includes(l.Status)) continue;
      await allocate(l, lineQuantities[lineId]);
      const n = await produced(l);
      if (n >= l.OrderedQuantity) { set('lines', lineId, applyUpdate(l0, { Status: 'Completed', CompletedAt: now, UpdatedAt: now })); continue; }
      if (l.Status === 'Accepted' || l.Status === 'Open') set('lines', lineId, applyUpdate(l0, { Status: 'In Progress', UpdatedAt: now }));
    }
  } else {
    // rollbackJobOrderLineAfterReversal_, for each line in turn.
    let own = null;
    for (const lineId of (lineIds || [])) {
      const l0 = await line(lineId);
      if (!l0) continue;
      const l = Object.assign({}, l0, { LineID: lineId });
      // This posting's own reservations, released (the first line releases
      // them all; they are no longer Active for the next).
      if (!own) own = await reservations.query({ Status: 'Active', CreatedByProductionID: String(prodId || '') });
      const touchedOrders = new Set();
      for (const id of Object.keys(own)) {
        if (!(id in state.reservations)) state.reservations[id] = own[id];
        const r = state.reservations[id];
        if (!r || r.Status !== 'Active' || r.CreatedByProductionID !== prodId) continue;
        set('reservations', id, applyUpdate(r, { Status: 'Released', ReleasedAt: now, ReleasedBy: actor, ReleaseReason: 'Production Entry reversed' }));
        if (r.SourceType === 'SalesOrder') touchedOrders.add(r.SourceID);
      }
      for (const soId of touchedOrders) await refreshOrder(soId);

      if (l.Status === 'Stopped' || l.Status === 'Cancelled') continue;
      const n = await produced(l);
      if (l.OrderedQuantity > 0 && n >= l.OrderedQuantity) {
        if (l.Status !== 'Completed') set('lines', lineId, applyUpdate(l0, { Status: 'Completed', CompletedAt: now, UpdatedAt: now }));
        continue;
      }
      if (['Accepted', 'Open', 'In Progress', 'Completed'].indexOf(l.Status) === -1) continue;
      const batch = await jobOrderBatches.get(l.ParentBatchID);
      const pre = batch && batch.Origin === 'Production' ? 'Open' : 'Accepted';
      const target = n > 0 ? 'In Progress' : pre;
      if (target !== l.Status) {
        const fields = { Status: target, UpdatedAt: now };
        if (l.Status === 'Completed') fields.CompletedAt = null;
        set('lines', lineId, applyUpdate(l0, fields));
      }
    }
  }
  const pick = kind => { const out = {}; touched[kind].forEach(id => { out[id] = state[kind][id]; }); return out; };
  return { lines: pick('lines'), orders: pick('orders'), reservations: pick('reservations') };
}

// The plan's documents, into the batch: postStock's also(batch).
const planWriter = plan => async batch => {
  for (const id of Object.keys(plan.lines || {})) await jobOrderLines.set(id, plan.lines[id], batch);
  for (const id of Object.keys(plan.orders || {})) await salesOrders.set(id, plan.orders[id], batch);
  for (const id of Object.keys(plan.reservations || {})) await reservations.set(id, plan.reservations[id], batch);
};

module.exports = { planProduction, planWriter };
