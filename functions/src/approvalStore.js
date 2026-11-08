// Approval instances in Firestore (owner, 2026-10-17; decision 240;
// docs/modules/TRANSACTIONS_FIRESTORE.md, phase T5). New development,
// hand-written.
//
// They were RTDB's approvalInstances/{id}: one per document sent for
// approval, read by every module that has an approval gate. Same ids, same
// fields, the same shape RTDB gave (docStore.js); a reader asks for what it
// needs (query) instead of downloading the collection.
//
//   approvalInstances/{id}   plus _q { ApproverUserIDs }
//
// Queries are equality only (and array-contains on the approvers); see
// docStore.js.
'use strict';
const { makeStore } = require('./docStore');

const listOf = v => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])).filter(Boolean);

const approvalInstances = makeStore({
  name: 'approval', path: 'approvalInstances', collection: 'approvalInstances',
  fields: ['Status', 'ModuleID', 'ConfigKey', 'DocumentID', 'CreatedBy'],
  derived: {
    // Every approver a level names (as delegated, if it was).
    ApproverUserID: { field: 'ApproverUserIDs', op: 'array-contains', value: d => [...new Set(listOf(d.RequiredLevels).map(l => l.ApproverUserID).filter(Boolean).map(String))].sort() }
  },
  // Task emails (docs/modules/TASK_EMAILS.md): every module's approvals, the
  // ported ones too, are written here, so here is where an approver given a
  // task, or a submitter's rejection, is told.
  afterWrite: (id, before, after) => require('./taskMail').approvalChanged(id, before, after)
});

module.exports = { approvalInstances };
