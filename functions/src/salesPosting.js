// A Delivery Note's effects on its Sales Orders and reservations, written
// with its posting (owner, 2026-10-17; docs/modules/TRANSACTIONS_FIRESTORE.md,
// phase T2). New development, hand-written.
//
// Posting a delivery used to change the order and its reservations after
// the posting itself, one write at a time: the delivered quantity of each
// line, the reservations it used up, the order's status. A failure half way
// left a posted delivery with its order untouched. Now the orders and
// reservations are in Firestore (salesStore.js), so planDelivery works out,
// before anything is written, every order and reservation the posting
// changes, exactly as the step-by-step code did, and writePlan adds them to
// the posting's own batch (stockPosting.postStock): all of it lands, or none.
//
// Caller holds the global lock (the reads here must not go stale before the
// batch commits).
'use strict';
const { salesOrders, reservations } = require('./salesStore');
const { applyUpdate } = require('./docStore');
const { reservationRecord, reservationStatusFor } = require('./reservations');

// The orders and reservations a posted ('post') or reversed ('reverse')
// Delivery Note's lines change: { orders: { id: doc }, reservations:
// { id: doc } }, the documents as they are to be written.
//   post:    each line's DeliveredQuantity grows; its Active reservations
//            are used up, oldest first (updateSOLineDeliveredQuantity_,
//            consumeReservationForDelivery_);
//   reverse: each line's DeliveredQuantity shrinks; the quantity is
//            reserved again on an order still reserving
//            (rollbackSOLineDeliveredQuantity_, createStockReservation_);
// then each order's status is refreshed (refreshSalesOrderReservationStatus_).
// reverse needs the delivery's CompanyID.
async function planDelivery(actor, lines, mode, companyId) {
  const now = new Date().toISOString();
  const orders = {}, held = {}, touchedOrders = new Set(), touchedRes = new Set();
  const order = async id => {
    if (!(id in orders)) orders[id] = await salesOrders.get(id);
    return orders[id];
  };
  const loaded = new Set();
  const ofOrder = async soId => {
    if (!loaded.has(soId)) {
      loaded.add(soId);
      const found = soId ? await reservations.query({ SourceType: 'SalesOrder', SourceID: String(soId) }) : {};
      Object.keys(found).forEach(id => { if (!(id in held)) held[id] = found[id]; });
    }
    return Object.keys(held).filter(id => held[id] && held[id].SourceType === 'SalesOrder' && held[id].SourceID === soId).map(id => Object.assign({ ReservationID: id }, held[id]));
  };
  const setOrder = (id, fields) => { orders[id] = applyUpdate(orders[id], fields); touchedOrders.add(id); };
  const setRes = (id, doc) => { held[id] = doc; touchedRes.add(id); };

  for (const l of (lines || [])) {
    const soId = l.SourceSOID, soLineId = l.SourceSOLineID;
    // The line's delivered quantity.
    if (soId && soLineId) {
      const so = await order(soId);
      if (so && so.Lines) {
        setOrder(soId, { Lines: so.Lines.map(x => x.LineID === soLineId
          ? Object.assign({}, x, { DeliveredQuantity: mode === 'post'
            ? Number(x.DeliveredQuantity || 0) + Number(l.Quantity || 0)
            : Math.max(0, Number(x.DeliveredQuantity || 0) - Number(l.Quantity || 0)) })
          : x) });
      }
    }
    if (mode === 'post') {
      // Used up by the delivery, oldest reservation first.
      const lineRes = (await ofOrder(soId))
        .filter(r => r.Status === 'Active' && r.SourceLineID === soLineId)
        .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));
      let remaining = Math.min(l.Quantity, lineRes.reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0));
      for (const r of lineRes) {
        if (remaining <= 0) break;
        const toReduce = Math.min(remaining, Number(r.Quantity));
        const { ReservationID: id } = r;
        if (!(toReduce > 0)) throw new Error('Reduction amount must be greater than zero.');
        if (toReduce > Number(r.Quantity)) throw new Error('Cannot reduce a reservation by more than its own quantity.');
        setRes(id, applyUpdate(held[id], toReduce === Number(r.Quantity)
          ? { Status: 'Released', ReleasedAt: now, ReleasedBy: actor, ReleaseReason: 'Consumed by Delivery Note' }
          : { Quantity: Number(r.Quantity) - toReduce, UpdatedAt: now, UpdatedBy: actor }));
        remaining -= toReduce;
      }
    } else {
      // The stock came back: reserved again, if the order still reserves.
      const so = await order(soId);
      if (so && (so.Status === 'Reserved' || so.Status === 'Partially Reserved')) {
        await ofOrder(soId);
        const { id, doc } = reservationRecord(actor, {
          ItemID: l.ItemID, ItemCode: l.ItemCode, WarehouseID: l.WarehouseID, CompanyID: companyId,
          Quantity: l.Quantity, SourceType: 'SalesOrder', SourceID: l.SourceSOID, SourceLineID: l.SourceSOLineID,
          SourceLabel: so.SONumber, Reason: 'Restored by Delivery Note reversal'
        });
        setRes(id, doc);
      }
    }
  }
  // Each order's status, once.
  const ids = Array.from(new Set((lines || []).map(l => l.SourceSOID)));
  for (const soId of (mode === 'post' ? ids.filter(Boolean) : ids)) {
    const so = await order(soId);
    const status = so && reservationStatusFor(so, await ofOrder(soId));
    if (status) setOrder(soId, { Status: status, UpdatedAt: now });
  }
  const pick = (map, keys) => { const out = {}; [...keys].forEach(k => { out[k] = map[k]; }); return out; };
  return { orders: pick(orders, touchedOrders), reservations: pick(held, touchedRes) };
}

// The plan's documents, into the batch.
async function writePlan(batch, plan) {
  for (const id of Object.keys(plan.orders || {})) await salesOrders.set(id, plan.orders[id], batch);
  for (const id of Object.keys(plan.reservations || {})) await reservations.set(id, plan.reservations[id], batch);
}

// A moved document (movedPaths.js), into the batch: setInBatch writes it
// whole; updateInBatch reads it now (under the lock) and writes it with the
// fields changed, as RTDB's update() would leave it.
async function setInBatch(path, id, doc, batch) {
  return storeAt(path).set(id, doc, batch);
}
async function updateInBatch(path, id, fields, batch) {
  const store = storeAt(path);
  return store.set(id, applyUpdate(await store.get(id), fields), batch);
}
function storeAt(path) {
  const store = require('./movedPaths').storeOf(path);
  if (!store || store.path !== path) throw new Error('salesPosting: ' + path + ' is not a moved collection.');
  return store;
}

// { id: the document with these fields } for the ids given, from the
// documents read (docs; a missing one gets just the fields, as RTDB's
// update() on a missing path made it).
function markDocs(docs, ids, fields) {
  const out = {};
  (ids || []).filter(Boolean).forEach(id => { out[id] = applyUpdate((docs || {})[id] || null, fields); });
  return out;
}

// The postings' own writes, as postStock's also(batch, gl, now): for the
// ported postings (legacy patches sales-posting-atomic-*), which cannot
// write an async callback of their own.
const { postedFields } = require('./stockPosting');
// A Delivery Note's plan (planDelivery).
const planWriter = plan => batch => writePlan(batch, plan);
// A Customer Invoice (or a Vendor Invoice), posted.
// (path: the invoices' collection, customerInvoices unless given; T3 posts
// Vendor Invoices the same way.)
const invoicePostedWriter = (invoiceId, actor, path) => (batch, gl, now) =>
  updateInBatch(path || 'customerInvoices', invoiceId, postedFields(gl, actor, now), batch);
// A Customer (or Vendor) Invoice's reversal (the record to post), and the
// original back to Posted with its link.
const invoiceReversalWriter = (invoiceId, newId, reversal, actor, path) => async (batch, gl, now) => {
  await setInBatch(path || 'customerInvoices', newId, applyUpdate(reversal, postedFields(gl, actor, now)), batch);
  await updateInBatch(path || 'customerInvoices', invoiceId, { Status: 'Posted', ReversalApprovalInstanceID: '', PendingReversalDate: '', ReversedByInvoiceID: newId }, batch);
};

module.exports = { planDelivery, writePlan, setInBatch, updateInBatch, markDocs, planWriter, invoicePostedWriter, invoiceReversalWriter };
