// The period lock (owner, 2026-10-11; docs/modules/PERIOD_CLOSING.md,
// decisions 123, 130, 132-135): nothing dated in a closed month is posted,
// sent for approval or reversed, from any module. Period Closing
// (periodClosing.js) closes the months: periodClosing/{companyId}/
// ClosedThrough holds the last closed month, every month up to it closed.
//
// Checked at the few places every posting passes through:
// - glWriting.buildStockGlEntry (every module's GL entry, the Apps Script
//   ports included) and glWriting.assignStockVoucherNumbering (stock
//   movements with no GL entry: Warehouse Movement);
// - approvals.beginApprovalInstance, which every posting module calls before
//   it posts or sends for approval: the document's own date (decision 132:
//   a draft is saved freely, only posting and sending for approval stop);
// - journal.js (JV / CBT final approval and reversal) and openingBalances.js,
//   which write their own entries;
// - Fixed Assets' posting guard (fixedAssetsCommon.assertFaPostingOpen).
// test/unit/periodLockGuard.test.js fails if a place that writes journal
// entries or posts stock skips it.
//
// A reversal is checked on its own date (decision 130), so a closed month's
// document is reversed into an open month; the original is only marked.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { rtdb, firestore } = require('./firebaseAdmin');

const isDate = d => /^\d{4}-\d{2}-\d{2}/.test(String(d || ''));

async function closedThrough(companyId) {
  if (!companyId) return '';
  return (await rtdb.ref('periodClosing/' + companyId + '/ClosedThrough').get()).val() || '';
}

async function companyName(companyId) {
  const c = (await rtdb.ref('companies/' + companyId).get()).val() || {};
  return c.LegalName || companyId;
}

// Refuses a date in a closed month of the company. `what` names the
// document in the message (optional).
async function assertOpen(companyId, date, what) {
  if (!companyId || !isDate(date)) return;
  const through = await closedThrough(companyId);
  const month = String(date).slice(0, 7);
  if (!through || month > through) return;
  throw new HttpsError('failed-precondition', (what ? what + ': ' : '') + month + ' is closed for ' + (await companyName(companyId)) +
    ' (closed through ' + through + '). Use a date in an open month, or ask a user with the reopen right in Period Closing to reopen it.');
}

// The posting modules' documents and their dates, for the check before
// posting or sending for approval. Modules not listed (requisitions, orders,
// HR, payroll documents) are not checked there; payroll's entries are
// checked when written.
const STOCK = id => rtdb.ref('stock/transactions/' + id).get().then(s => s.val()).then(d => d && { CompanyID: d.CompanyID, Date: d.TransactionDate });
const DOCUMENTS = {
  GRN: STOCK, MATERIALISSUE: STOCK, PRODUCTION: STOCK, DELIVERYNOTE: STOCK, WAREHOUSEMOVEMENT: STOCK,
  STOCKADJUSTMENT: STOCK, PHYSICALCOUNT: STOCK, PURCHASERETURN: STOCK, SALESRETURN: STOCK,
  VENDORINVOICE: id => rtdb.ref('vendorInvoices/' + id).get().then(s => s.val()).then(d => d && { CompanyID: d.CompanyID, Date: d.InvoiceDate }),
  CUSTOMERINVOICE: id => rtdb.ref('customerInvoices/' + id).get().then(s => s.val()).then(d => d && { CompanyID: d.CompanyID, Date: d.InvoiceDate }),
  PDCRECEIVED: id => rtdb.ref('pdcCheques/' + id).get().then(s => s.val()).then(d => d && { CompanyID: d.CompanyID, Date: d.TransactionDate }),
  JV: id => firestore.collection('journalEntries').doc(id).get().then(s => s.exists && { CompanyID: s.data().CompanyID, Date: s.data().JVDate }),
  FAACQ: id => firestore.collection('faPostings').doc(id).get().then(s => s.exists && { CompanyID: s.data().CompanyID, Date: s.data().Date })
};
DOCUMENTS.PDCISSUED = DOCUMENTS.PDCRECEIVED;
DOCUMENTS.CBT = DOCUMENTS.JV;
DOCUMENTS.FAADDDEP = DOCUMENTS.FARETIRE = DOCUMENTS.FAAUC = DOCUMENTS.FAACQ;

// Before a posting module posts a document or sends it for approval. A
// reversal sent for approval (documentNumber "… (Reversal)") is checked on
// its reversal date by its caller and again when the entry is written.
async function assertDocumentOpen(moduleId, documentId, documentNumber) {
  const load = DOCUMENTS[moduleId];
  if (!load || / \(Reversal\)$/.test(String(documentNumber || ''))) return;
  const doc = await load(documentId);
  if (doc) await assertOpen(doc.CompanyID, doc.Date);
}

module.exports = { assertOpen, assertDocumentOpen, closedThrough, DOCUMENTS };
