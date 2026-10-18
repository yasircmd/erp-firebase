// Reading only the records with a given Status (owner, 2026-10-17;
// docs/modules/TRANSACTIONS_FIRESTORE.md, step 0). New development,
// hand-written.
//
// rtdb.ref(path).get() downloads the whole collection, which grows with
// every document ever saved; the home page did that for ten collections on
// every visit, to find a handful of drafts. An RTDB query on Status, served
// from the database's own index, downloads only the matching records.
//
// The index is declared in database.rules.json (".indexOn": ["Status"]).
// Without it the database refuses the query ("Index not defined"), so the
// rules go live before the functions that use it (tools/deploy-rules.sh
// first). Only the paths listed here can be read this way, and
// functions/test/unit/rtdbStatus.test.js checks each one has its index.
'use strict';
const { rtdb } = require('./firebaseAdmin');

// (stock/transactions (T1), salesOrders and customerInvoices (T2), the
// purchase documents (T3) moved to Firestore, movedPaths.js; their RTDB
// indexes stay in database.rules.json until no live function queries them.)
const STATUS_INDEXED_PATHS = [
  'jobOrderBatches', 'jobOrderLines', 'pdcCheques',
  'recurringJournals', 'approvalInstances'
];

// { id: record } of the records at path whose Status is status.
async function withStatus(path, status) {
  if (!STATUS_INDEXED_PATHS.includes(path)) throw new Error('No Status index for ' + path + ': add it to database.rules.json and STATUS_INDEXED_PATHS.');
  return (await rtdb.ref(path).orderByChild('Status').equalTo(status).get()).val() || {};
}

module.exports = { STATUS_INDEXED_PATHS, withStatus };
