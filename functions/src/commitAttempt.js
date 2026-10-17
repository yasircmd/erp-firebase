const { randomUUID } = require('crypto');
const { rtdb } = require('./firebaseAdmin');
const stockStore = require('./stockStore');
const movedPaths = require('./movedPaths');

// The document's update: stock transactions (no collectionPath) and the
// other moved documents (movedPaths.js) are in Firestore; the rest still in
// RTDB.
const updateDoc = (collectionPath, id, fields) => (!collectionPath ? stockStore.updateTx(id, fields)
  : movedPaths.storeOf(collectionPath) ? movedPaths.storeOf(collectionPath).update(id, fields)
  : rtdb.ref(collectionPath + '/' + id).update(fields));

// Ported from beginCommitAttempt_/abandonCommitAttempt_/finalizeCommitAttempt_.
// See lock.js and stockMovement.js's own comments for the surrounding
// pattern this is part of: narrow the window where a Firestore GL
// write and an RTDB ledger write could disagree, and make any
// disagreement detectable rather than silent — not full cross-database
// atomicity, which isn't achievable here.
async function beginCommitAttempt(transactionId, actor, collectionPath) {
  const attemptId = randomUUID();
  const now = new Date().toISOString();
  await updateDoc(collectionPath, transactionId, {
    Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
    UpdatedAt: now, UpdatedBy: actor
  });
  return attemptId;
}

// Only ever called when nothing has actually been written yet — see
// the ordering guarantee in the original Code.gs section comment.
async function abandonCommitAttempt(transactionId, priorStatus, actor, collectionPath) {
  const now = new Date().toISOString();
  await updateDoc(collectionPath, transactionId, {
    Status: priorStatus, CommitAttemptID: '', CommitAttemptStartedAt: '',
    UpdatedAt: now, UpdatedBy: actor
  });
}

async function finalizeCommitAttempt(transactionId, glResult, extraFields, actor, collectionPath) {
  const now = new Date().toISOString();
  await updateDoc(collectionPath, transactionId, Object.assign({
    Status: 'Posted', TransactionNumber: glResult.jvNumber, TransactionRef: glResult.transactionRef,
    LinkedJVID: glResult.jvId, CommitAttemptID: '', CommitAttemptStartedAt: '',
    PostedAt: now, PostedBy: actor, UpdatedAt: now, UpdatedBy: actor
  }, extraFields || {}));
}

module.exports = { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt };
