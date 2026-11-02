// Closing a Sales Order, and reopening it (owner, 2026-11-02; docs/modules/
// SO_CLOSE.md, decisions Q379-Q382). New development, hand-written.
//
// Close short-closes a confirmed order (Reserved or Partially Reserved):
// what is left of it is no longer expected. Its Active reservations are
// released, it gets status Closed, and no more Delivery Notes or invoices can
// be made from it (they take only Reserved or Partially Reserved orders).
// What was delivered stays as it is. A reason is required; the Sales Order
// post right (who confirms and cancels) may close; no approval (Q381).
//
// Reopen puts a Closed order back with a reason (Q382): Delivered if every
// line is delivered, else Partially Reserved (its reservations are not
// restored; Claim reserves again).
//
// Each close and reopen is written to the order's CloseLog. Under the global
// lock, in one batch: the order and its reservations land together.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const { firestore } = require('./firebaseAdmin');
const { salesOrders, reservations } = require('./salesStore');
const { applyUpdate } = require('./docStore');

const onCallOptions = { region: 'us-central1' };
const OPEN = ['Reserved', 'Partially Reserved'];

const left = so => (so.Lines || []).reduce((s, l) => s + Math.max(0, (Number(l.OrderedQuantity) || 0) - (Number(l.DeliveredQuantity) || 0)), 0);
const allDelivered = so => (so.Lines || []).length > 0 && left(so) === 0;

async function start(request, what) {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('SALESORDER', 'post', user.profile.role))) {
    throw new HttpsError('permission-denied', 'You do not have the right to ' + what + ' Sales Orders (Sales Order: post).');
  }
  const d = request.data || {};
  const soId = String(d.soId || '').trim();
  const reason = String(d.reason || '').trim().slice(0, 500);
  if (!soId) throw new HttpsError('invalid-argument', 'Choose a Sales Order.');
  if (!reason) throw new HttpsError('invalid-argument', 'Give a reason to ' + what + ' the Sales Order.');
  return { user, soId, reason, actor: user.profile.username || user.uid };
}
async function load(user, soId) {
  const so = await salesOrders.get(soId);
  if (!so) throw new HttpsError('not-found', 'Sales Order not found.');
  if (!userCanAccessCompany(user.profile, so.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return so;
}

exports.closeSalesOrder = onCallWithMessages(onCallOptions, async (request) => {
  const { user, soId, reason, actor } = await start(request, 'close');
  return withGlobalLock(user.uid, async () => {
    const so = await load(user, soId);
    if (so.Status === 'Closed') throw new HttpsError('failed-precondition', 'This Sales Order is already Closed.');
    if (so.Status === 'Delivered') throw new HttpsError('failed-precondition', 'This Sales Order is fully delivered: there is nothing left to close.');
    if (!OPEN.includes(so.Status)) throw new HttpsError('failed-precondition', 'Only a confirmed Sales Order (Reserved or Partially Reserved) can be closed; this one is ' + so.Status + '.');
    const now = new Date().toISOString();
    const found = await reservations.query({ SourceType: 'SalesOrder', SourceID: soId });
    const active = Object.keys(found).filter(id => found[id] && found[id].Status === 'Active');
    const batch = firestore.batch();
    for (const id of active) {
      await reservations.set(id, applyUpdate(found[id], { Status: 'Released', ReleasedAt: now, ReleasedBy: actor, ReleaseReason: 'Sales Order closed' }), batch);
    }
    const remaining = left(so);
    await salesOrders.set(soId, applyUpdate(so, {
      Status: 'Closed', StatusBeforeClose: so.Status, ClosedAt: now, ClosedBy: actor, CloseReason: reason,
      CloseLog: (so.CloseLog || []).concat([{ Action: 'Closed', At: now, By: actor, Reason: reason, Left: remaining }]),
      UpdatedAt: now, UpdatedBy: actor
    }), batch);
    await batch.commit();
    return { success: true, status: 'Closed', released: active.length, left: remaining };
  });
});

exports.reopenSalesOrder = onCallWithMessages(onCallOptions, async (request) => {
  const { user, soId, reason, actor } = await start(request, 'reopen');
  return withGlobalLock(user.uid, async () => {
    const so = await load(user, soId);
    if (so.Status !== 'Closed') throw new HttpsError('failed-precondition', 'Only a Closed Sales Order can be reopened.');
    const now = new Date().toISOString();
    const status = allDelivered(so) ? 'Delivered' : 'Partially Reserved';
    await salesOrders.set(soId, applyUpdate(so, {
      Status: status, ReopenedAt: now, ReopenedBy: actor, ReopenReason: reason,
      CloseLog: (so.CloseLog || []).concat([{ Action: 'Reopened', At: now, By: actor, Reason: reason }]),
      UpdatedAt: now, UpdatedBy: actor
    }));
    return { success: true, status };
  });
});

module.exports._left = left;
