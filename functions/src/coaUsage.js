// Where an account has been used (owner, 2026-10-02; docs/modules/COA_RECODE.md).
// Chart of Accounts gives an account a new code when it moves to another
// head, but only if it has never been used: posted lines keep a copy of the
// code, and drafts, templates and documents refer to it by code, so a used
// account keeps its code and the move is refused.
//
// "Used" = referenced by any transaction, draft or template: every record of
// the transactional stores is searched for the account (its ID under an
// ...Account... key, or its code under an ...AccountCode key). Master data
// (items, vendors, customers, companies, FA classes) link accounts by ID,
// which a new code doesn't affect, so they don't count.
'use strict';
const { rtdb, firestore } = require('./firebaseAdmin');

const RTDB_STORES = [
  ['stock/transactions', 'Stock transaction'], ['vendorInvoices', 'Vendor Invoice'], ['customerInvoices', 'Customer Invoice'],
  ['pdcCheques', 'PDC'], ['recurringJournals', 'Recurring Journal'], ['purchaseRequisitions', 'Purchase Requisition'],
  ['inventoryPurchaseRequisitions', 'Inventory Purchase Requisition'], ['purchaseOrders', 'Purchase Order'], ['salesOrders', 'Sales Order']
];
const FIRESTORE_STORES = [['journalEntries', 'Journal entry'], ['faTransactions', 'Fixed asset transaction'], ['faPostings', 'Fixed asset posting']];

function refersTo(value, accountId, accountCode, key) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(v => refersTo(v, accountId, accountCode, key));
  if (typeof value === 'object') return Object.keys(value).some(k => refersTo(value[k], accountId, accountCode, k));
  if (!/account/i.test(key || '')) return false;
  const s = String(value);
  return s === accountId || (/accountcode$/i.test(key) && accountCode !== '' && s === accountCode);
}

const label = (what, id, r) => what + ' ' + (r.JVNumber || r.TransactionNumber || r.PONumber || r.Name || r.TemplateName || (r.Status === 'Draft' ? 'draft' : id));

// Up to `limit` places the account is used, as readable labels ([] = never used).
async function findAccountUsage(accountId, accountCode, limit) {
  const max = limit || 5;
  const found = [];
  for (const [col, what] of FIRESTORE_STORES) {
    const snap = await firestore.collection(col).get();
    for (const d of snap.docs) {
      if (refersTo(d.data(), accountId, String(accountCode || ''))) found.push(label(what, d.id, d.data()));
      if (found.length >= max) return found;
    }
  }
  for (const [path, what] of RTDB_STORES) {
    const data = (await rtdb.ref(path).get()).val() || {};
    for (const id of Object.keys(data)) {
      if (refersTo(data[id], accountId, String(accountCode || ''))) found.push(label(what, id, data[id]));
      if (found.length >= max) return found;
    }
  }
  return found;
}

module.exports = { findAccountUsage, refersTo };
