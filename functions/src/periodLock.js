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
const { AsyncLocalStorage } = require('async_hooks');
const { HttpsError } = require('firebase-functions/v2/https');
const { rtdb, firestore } = require('./firebaseAdmin');
const stockStore = require('./stockStore');

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
const STOCK = id => stockStore.snapTx(id).then(s => s.val()).then(d => d && { CompanyID: d.CompanyID, Date: d.TransactionDate });
const DOCUMENTS = {
  GRN: STOCK, MATERIALISSUE: STOCK, PRODUCTION: STOCK, DELIVERYNOTE: STOCK, WAREHOUSEMOVEMENT: STOCK,
  STOCKADJUSTMENT: STOCK, PHYSICALCOUNT: STOCK, PURCHASERETURN: STOCK, SALESRETURN: STOCK,
  VENDORINVOICE: id => require('./purchaseStore').vendorInvoices.get(id).then(d => d && { CompanyID: d.CompanyID, Date: d.InvoiceDate }),
  CUSTOMERINVOICE: id => require('./salesStore').customerInvoices.get(id).then(d => d && { CompanyID: d.CompanyID, Date: d.InvoiceDate }),
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

// ---------- Step 1c: payroll and depreciation (decisions 131, 136-139) ----------
// Their reversals are dated as the original (the run's month end, the
// payment's date), and a reversed run is redone for its own month. When
// that month is closed, the user is warned and, on Continue, the entry is
// posted on the first day of the first open month instead (the run, its
// payslips and the asset records keep their own month).
//
// The Continue is the request's adjustInOpenMonth: callable.js runs every
// callable in this context, so a reversal reached several calls deep (an
// interim batch undoing its payments) sees it without being passed it.
const consentStore = new AsyncLocalStorage();
const runWithConsent = (consent, fn) => consentStore.run({ adjust: consent === true }, fn);
const consentGiven = () => Boolean((consentStore.getStore() || {}).adjust);

const addMonth = m => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); };
// The marker the screens look for before asking (keep in step with them).
const ADJUST_MARKER = 'It can be adjusted in the first open month';

// The date to post on: `date` when its month is open; when it is closed, the
// first open day if the user agreed (consent), else a refusal that offers it.
async function adjustableDate(companyId, date, consent, what) {
  if (!companyId || !isDate(date)) return date;
  const through = await closedThrough(companyId);
  const month = String(date).slice(0, 7);
  if (!through || month > through) return date;
  const firstOpen = addMonth(through) + '-01';
  if (consent) return firstOpen;
  throw new HttpsError('failed-precondition', (what ? what + ': ' : '') + month + ' is closed for ' + (await companyName(companyId)) + '. ' +
    ADJUST_MARKER + ': it is posted on ' + firstOpen + ' (the run or document keeps its own month). Continue to adjust it there, or reopen ' + month + ' in Period Closing first.');
}

// The postings this applies to: payroll's and depreciation's, when they are
// a reversal (ReversalOfJV) or the redo of a run reversed that way.
const ADJUSTABLE_TYPES = new Set(['Payroll', 'PayrollPayment', 'PayrollLoan', 'PayrollProvision', 'FinalSettlement', 'FADepreciation']);

module.exports = { assertOpen, assertDocumentOpen, closedThrough, DOCUMENTS, runWithConsent, consentGiven, adjustableDate, ADJUSTABLE_TYPES, ADJUST_MARKER };
