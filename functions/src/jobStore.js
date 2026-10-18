// Job Order batches and lines, and post-dated cheques, in Firestore
// (owner, 2026-10-17; docs/modules/TRANSACTIONS_FIRESTORE.md, phase T4).
// New development, hand-written.
//
// They were RTDB's jobOrderBatches/{id}, jobOrderLines/{id} and
// pdcCheques/{id}. Same ids, same fields, the same shape RTDB gave
// (docStore.js); a reader asks for what it needs (query) instead of
// downloading the collection.
//
// Queries are equality only; see docStore.js.
'use strict';
const { makeStore } = require('./docStore');

const jobOrderBatches = makeStore({
  name: 'Job Order batch', path: 'jobOrderBatches', collection: 'jobOrderBatches',
  fields: ['Status', 'CompanyID', 'BatchNumber', 'Origin', 'CreatedBy']
});

const jobOrderLines = makeStore({
  name: 'Job Order line', path: 'jobOrderLines', collection: 'jobOrderLines',
  fields: ['Status', 'ParentBatchID', 'ItemCode', 'SubJONumber']
});

const pdcCheques = makeStore({
  name: 'PDC', path: 'pdcCheques', collection: 'pdcCheques',
  fields: ['Status', 'CompanyID', 'Direction', 'PartyType', 'PartyID', 'BankAccountID', 'ChequeNumber', 'CreatedBy', 'LinkedJVID']
});

module.exports = { jobOrderBatches, jobOrderLines, pdcCheques };
