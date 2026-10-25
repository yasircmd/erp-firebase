// One stock posting, all or none (owner, 2026-10-17; decision 238;
// docs/modules/TRANSACTIONS_FIRESTORE.md, phase T1b). New development,
// hand-written.
//
// A posting used to be three separate writes under the global lock: the GL
// entry (Firestore), the running balances (RTDB), the document's status
// (RTDB). commitAttempt.js narrowed the gap between them and made a
// half-done posting detectable ('Committing'), but could not rule one out.
// Now the balances and the documents are in Firestore too (stockStore.js),
// so postStock writes the GL entry, every balance the posting moves and
// every document it changes (the posted one, a reversal and its original)
// in ONE Firestore batch: all of them land, or none. A document goes from
// Draft (or Rejected / PendingApproval) straight to Posted.
//
// Before the batch: buildStockGlEntry validates the entry, checks the
// period lock and takes the voucher number (so a refused posting moves
// nothing). After it: the caller's side effects in RTDB (PO and SO
// quantities, reservations, shortfall allocation) run as before; they move
// to Firestore with their own documents (phases T2, T3).
'use strict';
const { firestore } = require('./firebaseAdmin');
const { buildStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const stockStore = require('./stockStore');

// A Firestore batch takes at most 500 writes: the GL entry, the documents
// and the balances.
const MAX_WRITES = 500;

// What finalizeCommitAttempt wrote on a posted document, so a posted
// document keeps the fields it always had.
function postedFields(gl, actor, now) {
  return {
    Status: 'Posted', TransactionNumber: gl.jvNumber, TransactionRef: gl.transactionRef,
    LinkedJVID: gl.jvId, CommitAttemptID: '', CommitAttemptStartedAt: '',
    PostedAt: now, PostedBy: actor, UpdatedAt: now, UpdatedBy: actor
  };
}

// The balances a movement writes ({ 'itemId|warehouseId': entry }), as
// commitStockLedgerUpdates writes them.
function ledgerEntries(ledgerUpdates, now) {
  const out = {};
  Object.keys(ledgerUpdates || {}).forEach(key => {
    const u = ledgerUpdates[key];
    out[key] = { Quantity: u.Quantity, AvgCost: u.AvgCost, TotalValue: u.TotalValue, UpdatedAt: now };
  });
  return out;
}

// user: the poster. gl: { type, date, description, reference, lines,
// dimensions, extra } for writeStockGlEntry's arguments, or null for a
// posting without a GL entry (Warehouse Movement). ledgerUpdates: from
// computeStockMovement. documents(gl, now): the documents to write, as
// { id: the whole document } (stockStore.applyUpdate(existing, fields)
// gives an existing one with its changes). also(batch, gl, now), optional:
// the posting's other Firestore writes (a reversed GL entry's mark), in the
// same batch. Returns the GL result, as writeStockGlEntry did (null without
// a GL entry). gl may also be a list of entries, all in the one batch (the
// cheques of a PDC entry, docs/modules/PDC_MULTI_CHEQUE.md, Q290): the GL
// result is then their list.
async function postStock(user, gl, ledgerUpdates, documents, also) {
  const now = new Date().toISOString();
  const specs = Array.isArray(gl) ? gl : (gl ? [gl] : []);
  const builts = [];
  for (const g of specs) builts.push(await buildStockGlEntry(user, g.type, g.date, g.description, g.reference, g.lines, g.dimensions, g.extra));
  const results = builts.map(b => ({ jvId: b.jvId, jvNumber: b.jvNumber, transactionRef: b.transactionRef, jvDate: b.record.JVDate, adjustedFrom: b.record.AdjustedFromDate || '' }));
  const glResult = Array.isArray(gl) ? results : (results[0] || null);
  const docs = documents(glResult, now) || {};
  const balances = ledgerEntries(ledgerUpdates, now);
  const writes = builts.length + Object.keys(docs).length + Object.keys(balances).length;
  if (writes > MAX_WRITES) throw new Error('This posting moves too many stock balances at once (' + writes + ' writes; at most ' + MAX_WRITES + '). Split it into smaller documents.');

  const batch = firestore.batch();
  builts.forEach(b => batch.set(firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(b.jvId), b.record));
  await stockStore.setLedgerEntries(balances, batch);
  for (const id of Object.keys(docs)) await stockStore.setTx(id, docs[id], batch);
  if (also) {
    let more = 0;
    const counted = ['set', 'update', 'delete'].reduce((o, m) => Object.assign(o, { [m]: (...a) => { more++; batch[m](...a); return counted; } }), {});
    await also(counted, glResult, now);
    if (writes + more > MAX_WRITES) throw new Error('This posting moves too many stock balances at once (' + (writes + more) + ' writes; at most ' + MAX_WRITES + '). Split it into smaller documents.');
  }
  await batch.commit();
  return glResult;
}

module.exports = { postStock, postedFields, ledgerEntries, MAX_WRITES };
