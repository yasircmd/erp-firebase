// Data Reset for every module (owner, 2026-10-24; docs/modules/DATA_RESET.md,
// decisions 283-286). New development, hand-written: the ported Data Reset
// (Code.gs DATA_RESET_CATEGORIES) keeps its 18 categories, and hands the
// ones here to this module (patches data-reset-all-modules), as well as the
// check that a master is not cleared while transactions still use it (284).
//
// Each category: label, detail, group (transactional, master or setup), the
// Firestore collections and RTDB paths it clears, the counters it restarts,
// and `records` when its records may be browsed and deleted one by one (a
// master others depend on is cleared whole only, after them).
// Clearing a Firestore collection deletes its documents' sub-collections
// too (a payroll run's payslips, a request's messages).
'use strict';

const { rtdb, firestore, admin } = require('./firebaseAdmin');
const movedPaths = require('./movedPaths');

const T = 'transactional', M = 'master', S = 'setup';
const CATEGORIES = {
  salesOrders: { label: 'Sales Orders & Reservations', group: T, fs: ['salesOrders', 'stockReservations'], count: ['salesOrders'],  records: 'salesOrders',
    detail: 'Every Sales Order, and the stock reserved for them. Their Delivery Notes are in Stock Transactions, their invoices in Customer Invoices.' },
  purchasing: { label: 'Purchase Requisitions & Orders', group: T, fs: ['purchaseRequisitions', 'inventoryPurchaseRequisitions', 'purchaseOrders'], records: 'purchaseOrders',
    detail: 'Purchase Requisitions, Inventory Purchase Requisitions and Purchase Orders. Their GRNs are in Stock Transactions, their bills in Vendor Invoices.' },
  jobOrders: { label: 'Job Orders', group: T, fs: ['jobOrderBatches', 'jobOrderLines'], count: ['jobOrderBatches'],  records: 'jobOrderBatches',
    detail: 'Every Job Order and its lines. The production posted against them is in Stock Transactions.' },
  approvalRecords: { label: 'Approval Records', group: T, fs: ['approvalInstances'], records: 'approvalInstances',
    detail: 'The Approval Tracker\'s history: every document\'s approvals, pending, approved, rejected or closed. A document waiting for approval when this is cleared can no longer be approved: clear it with its documents.' },
  eInvoices: { label: 'E-invoices', group: T, rtdb: ['eInvoices'], records: 'rtdb:eInvoices',
    detail: 'The e-invoice (PINT AE) prepared for each invoice and credit note. Their invoices are in Customer Invoices and Stock Transactions.' },
  employeeChanges: { label: 'Employee Changes', group: T, fs: ['employeeChanges'], records: 'employeeChanges',
    detail: 'Every employee change (transfer, promotion, salary change and the like), draft, pending or applied. What an applied change did stays in the employee\'s record.' },
  leave: { label: 'Leave', group: T, fs: ['leaveRequests', 'leaveAdjustments', 'leaveAccruals', 'leaveOpenings', 'leaveMonths', 'leaveYearCloses'], records: 'leaveRequests',
    detail: 'Leave requests, balance adjustments, accruals, opening balances, locked months and year closes.' },
  payrollRuns: { label: 'Payroll Runs & Payslips', group: T, fs: ['payrollRuns', 'payrollInputs', 'payrollInterim', 'payrollAccrualClaims', 'payrollProvisionOpenings', 'salaryHolds'], count: ['payrollRuns', 'payrollInputs', 'payrollInterim', 'payrollAccrualClaims', 'salaryHolds'],  counters: ['payroll/counters'], records: 'payrollRuns',
    detail: 'Payroll runs with their payslips and payments, earnings and deductions, interim batches, provision (gratuity, leave salary) claims and openings, and salary holds. Their GL entries are in GL Journal Entries: clear both together.' },
  payrollSettlements: { label: 'Final Settlements', group: T, fs: ['payrollSettlements'], records: 'payrollSettlements',
    detail: 'Every final (end-of-service) settlement. Their GL entries are in GL Journal Entries: clear both together.' },
  payrollLoans: { label: 'Payroll Loans & Advances', group: T, fs: ['payrollLoans'], records: 'payrollLoans',
    detail: 'Every loan and salary advance with its schedule. Payouts and repayments posted are in GL Journal Entries and Payroll Runs.' },
  clearances: { label: 'Clearances', group: T, fs: ['clearances'], records: 'clearances',
    detail: 'Every leaver\'s clearance, with its steps, checklists, notes and amounts to recover. A leaver still to be settled gets a new one, from the company\'s set-up.' },
  employeeRequests: { label: 'Employee Requests', group: T, fs: ['employeeRequests'], records: 'employeeRequests',
    detail: 'Payroll queries, expense claims and loan requests from the Employee Portal, with their messages.' },
  supportingDocuments: { label: 'Supporting Documents', group: T, fs: ['attachments', 'attachmentLog', 'attachmentFolders'], count: ['attachments'],  files: true,
    detail: 'Every supporting document attached to an entry or record (employees\' and company documents included), and their files: moved to the trash of the connected document storage (Google Drive keeps them there for 30 days). Needs the document storage connected.' },
  companyDocuments: { label: 'Company Documents', group: T, fs: ['companyDocuments', 'companyDocumentLog'], count: ['companyDocuments'],  records: 'companyDocuments',
    detail: 'The register of company documents (licences, contracts and the like). Their files are Supporting Documents: clear both together.' },
  periodClosing: { label: 'Period Closing', group: T, rtdb: ['periodClosing'],
    detail: 'Which months and financial years are closed, for every company, and the closing checklist. Cleared, every month is open again.' },
  logs: { label: 'Logs', group: T, rtdb: ['masterImports', 'coaRenumberLog'],
    detail: 'The Master Import log and the Chart of Accounts renumbering log.' },

  employees: { label: 'Employees', group: M, fs: ['employees', 'employeeCompensation', 'employeeHistory', 'employeeDocuments', 'essAccounts', 'essUids'], count: ['employees'],  rtdb: ['salesReps'], counters: ['hrCounters'], ess: true,
    detail: 'Every employee with their compensation, history, documents register and sales-rep set-up, and their Employee Portal sign-ins (decision 283). The HR numbering (employee numbers, leave and other HR documents) restarts. Their documents\' files are Supporting Documents.' },
  vendors: { label: 'Vendors', group: M, rtdb: ['vendors'], counters: ['vendorCounters'],
    detail: 'Every vendor; vendor codes restart.' },
  customers: { label: 'Customers', group: M, rtdb: ['customers'], counters: ['customerCounters'],
    detail: 'Every customer; customer codes restart.' },
  priceLists: { label: 'Price Lists', group: M, rtdb: ['priceLists', 'priceListLines'], count: ['priceLists'],  records: 'rtdb:priceLists',
    detail: 'Every price list and its lines.' },
  inventoryValuation: { label: 'Inventory Valuation List', group: M, rtdb: ['inventoryValuationLines'], records: 'rtdb:inventoryValuationLines',
    detail: 'The valuation costs per item and date (used by Production).' },
  requisitionCategories: { label: 'Requisition Categories', group: M, rtdb: ['requisitionCategories'],
    detail: 'Procurement Setup\'s requisition categories.' },
  itemCategories: { label: 'Item Categories', group: M, rtdb: ['itemCategories'],
    detail: 'The custom item categories.' },
  itemBarcodes: { label: 'Item Barcodes', group: M, rtdb: ['itemBarcodes'], counters: ['barcodeCounters'], records: 'rtdb:itemBarcodes',
    detail: 'Every barcode given to an item; generated barcodes restart.' },
  currencies: { label: 'Currencies & Exchange Rates', group: M, rtdb: ['currencies', 'exchangeRates'], count: ['currencies'], 
    detail: 'The currencies and their exchange rates. The default currency is set again in Currency Configuration.' },
  shareholders: { label: 'Shareholders', group: M, rtdb: ['companyShareholders'],
    detail: 'Each company\'s shareholders and issued shares.' },

  hrSetup: { label: 'HR Setup', group: S, fs: ['hrGrades', 'hrDesignations', 'hrFields', 'hrDocumentTypes', 'hrLeaveTypes', 'hrWorkCalendars', 'hrWorkSchedules', 'hrLeavingReasons', 'clearanceSetup'],
    detail: 'Grades, designations, employee fields, document types, leave types, working calendars, work schedules, leaving reasons and the clearance steps. The defaults come back when HR Setup is next opened.' },
  payrollSetup: { label: 'Payroll Setup', group: S, fs: ['hrPayElements', 'payrollSettings', 'payrollPaymentFormats', 'payrollLoanTypes', 'payrollAccrualTypes', 'reimbursementCategories', 'employeeRequestHandlers', 'employeeRequestTypes'],
    detail: 'Pay elements, payroll accounting, payment file formats, loan and provision types, reimbursement categories, the employee request types and who handles employee requests.' },
  approvalSetup: { label: 'Approval Configuration', group: S, rtdb: ['approvalConfigurations', 'approvalLevels', 'approvalFollowUpSettings', 'approvalFollowUps'],
    detail: 'Which documents need approval, their levels and approvers, and the follow-up teams. Cleared, documents post without approval until it is set again.' },
  settings: { label: 'Numbering & Settings', group: S, rtdb: ['numbering', 'salesInvoiceSettings', 'eInvoiceSettings', 'barcodeSettings', 'retailSales', 'fxSettings', 'openingBalances/settings'], fs: ['companyDocumentCategories'],
    detail: 'Document numbering formats; Sales Invoice, e-invoicing, barcode, retail counter, exchange-rate and opening-balance settings; company document categories.' }
};

// What uses each master (decision 284): a master is cleared only once these
// are empty, or cleared in the same reset. The ported categories' keys are
// the ported Data Reset's own (glEntries, stockData, ...).
const TXN = ['glEntries', 'stockData', 'vendorInvoices', 'customerInvoices', 'openingBalanceBatches', 'pdcCheques', 'fixedAssets', 'recurringJournals',
  'salesOrders', 'purchasing', 'jobOrders', 'employeeChanges', 'leave', 'payrollRuns', 'payrollSettlements', 'payrollLoans', 'employeeRequests', 'clearances'];
const USED_BY = {
  companies: TXN.concat(['employees']),
  coa: ['glEntries', 'recurringJournals', 'openingBalanceBatches'],
  orgUnits: ['glEntries', 'stockData'],
  items: ['stockData', 'salesOrders', 'purchasing', 'jobOrders', 'boms', 'vendorInvoices', 'customerInvoices'],
  uoms: ['stockData', 'items'],
  itemSubCategories: ['items'],
  itemCategories: ['items'],
  customerClassifications: ['customers'],
  salesTypes: ['customerInvoices'],
  vendors: ['vendorInvoices', 'purchasing', 'pdcCheques', 'stockData'],
  customers: ['customerInvoices', 'salesOrders', 'pdcCheques', 'stockData'],
  employees: ['employeeChanges', 'leave', 'payrollRuns', 'payrollSettlements', 'payrollLoans', 'employeeRequests', 'clearances'],
  requisitionCategories: ['purchasing'],
  fixedAssetSetup: ['fixedAssets'],
  hrSetup: ['employees', 'leave'],
  payrollSetup: ['employees', 'payrollRuns']
};

// The ported Data Reset's shape, so its counts, browse and screen work
// unchanged: paths ('firestore:' prefixed, as it marks Firestore), the path
// to browse (or none), and handledBy.
function legacyShaped() {
  const out = {};
  Object.keys(CATEGORIES).forEach(key => {
    const c = CATEGORIES[key];
    out[key] = {
      paths: (c.fs || []).map(x => 'firestore:' + x).concat(c.rtdb || [], c.counters || []),
      recordsPath: !c.records ? null : c.records.startsWith('rtdb:') ? c.records.slice(5) : 'firestore:' + c.records,
      label: c.label, detail: c.detail, group: c.group, handledBy: 'dataReset'
    };
  });
  return out;
}

// Records, not counters: what "still used" means. A category's `count`
// names the stores that hold its records (an employee, not their sign-in);
// else every store it clears.
const fsCount = async col => (await firestore.collection(col).count().get()).data().count;
async function rtdbCount(path) {
  const v = (await rtdb.ref(path).get()).val();
  return v && typeof v === 'object' ? Object.keys(v).length : 0;
}
// A ported category's records: its browse path (or first path), wherever it is now.
const MOVED_COLLECTION = { 'stock/transactions': 'stockTransactions', 'stock/ledger': 'stockLedger', 'stock/reservations': 'stockReservations' };
async function pathCount(path) {
  if (path.startsWith('firestore:')) return fsCount(path.slice('firestore:'.length));
  if (movedPaths.isMoved(path)) {
    const store = movedPaths.storeOf(path);
    return fsCount(MOVED_COLLECTION[path] || (store && store.collection) || path);
  }
  return rtdbCount(path);
}
async function recordCount(key, legacyCategories) {
  const c = CATEGORIES[key];
  if (c) {
    const fsStores = c.count ? (c.fs || []).filter(x => c.count.includes(x)) : (c.fs || []);
    const rtdbStores = c.count ? (c.rtdb || []).filter(x => c.count.includes(x)) : (c.rtdb || []);
    const counts = await Promise.all(fsStores.map(fsCount).concat(rtdbStores.map(rtdbCount)));
    return counts.reduce((a, b) => a + b, 0);
  }
  const l = legacyCategories && legacyCategories[key];
  if (!l) return 0;
  return pathCount(l.recordsPath || l.paths[0]);
}

// Decision 284: refused while what uses a chosen master still has records
// and is not chosen too. Returns the message, or '' when it may go ahead.
async function refusal(keys, legacyCategories) {
  const chosen = new Set(keys);
  const label = k => (CATEGORIES[k] || (legacyCategories && legacyCategories[k]) || {}).label || k;
  const problems = [];
  for (const key of keys) {
    const users = (USED_BY[key] || []).filter(u => !chosen.has(u));
    const inUse = [];
    for (const u of users) {
      const n = await recordCount(u, legacyCategories);
      if (n) inUse.push(label(u) + ' (' + n + ')');
    }
    if (inUse.length) problems.push(label(key) + ' is still used by ' + inUse.join(', '));
  }
  return problems.length ? problems.join('; ') + '. Select those too, or clear them first. Nothing was deleted.' : '';
}

// Decision 283: the Employee Portal sign-ins, in this corporate's
// Authentication. Never an ERP user's account, even if it is one.
async function portalUids() {
  const [accounts, uids, users] = await Promise.all([firestore.collection('essAccounts').get(), firestore.collection('essUids').get(), rtdb.ref('users').get()]);
  const erpUsers = new Set(Object.keys(users.val() || {}));
  const all = new Set(uids.docs.map(d => d.id));
  accounts.docs.forEach(d => { const u = d.data().Uid; if (u) all.add(u); });
  return [...all].filter(u => !erpUsers.has(u));
}
async function deletePortalSignIns() {
  const uids = await portalUids();
  for (let i = 0; i < uids.length; i += 1000) await admin.auth().deleteUsers(uids.slice(i, i + 1000));
  return uids.length;
}

// Decision 286: the files too, to the storage's trash. Refused before
// anything is deleted when the storage is not connected.
async function storedFiles() {
  const snap = await firestore.collection('attachments').get();
  return snap.docs.map(d => d.data().StorageFileID).filter(Boolean);
}
async function storageFor(fileIds) {
  if (!fileIds.length) return null;
  try { return await require('./documentStorage').connected(); } catch (e) {
    throw new Error('Supporting Documents has ' + fileIds.length + ' file(s) in the document storage, which is not connected: connect it in Document Storage first. Nothing was deleted.');
  }
}

async function clear(key) {
  const c = CATEGORIES[key];
  if (!c) throw new Error('Unknown category: ' + key);
  let files = 0, signIns = 0;
  if (c.files) {
    const ids = await storedFiles();
    const storage = await storageFor(ids);
    for (const id of ids) { await storage.api.trash(storage.s, id); files++; }
  }
  if (c.ess) signIns = await deletePortalSignIns();
  for (const col of c.fs || []) await firestore.recursiveDelete(firestore.collection(col));
  for (const path of (c.rtdb || []).concat(c.counters || [])) await rtdb.ref(path).remove();
  return { files, signIns };
}

// Chosen records of a category that may be browsed.
async function deleteRecords(key, ids) {
  const c = CATEGORIES[key];
  if (!c || !c.records) throw new Error('Records of this category can\'t be deleted one by one: clear it whole.');
  for (const id of ids) {
    if (c.records.startsWith('rtdb:')) await rtdb.ref(c.records.slice(5) + '/' + id).remove();
    else await firestore.recursiveDelete(firestore.collection(c.records).doc(String(id)));
  }
  // A Sales Order's reservations go with it.
  if (key === 'salesOrders') {
    for (let i = 0; i < ids.length; i += 30) {
      const res = await firestore.collection('stockReservations').where('SourceID', 'in', ids.slice(i, i + 30).map(String)).get();
      for (const d of res.docs) await d.ref.delete();
    }
  }
  return ids.length;
}

// How a record is listed when browsing its category.
function summary(key, id, r) {
  r = r || {};
  const number = r.TransactionNumber || r.SONumber || r.PONumber || r.PRNumber || r.IPRNumber || r.BatchNumber || r.Number || r.RunNumber || r.LoanNumber ||
    r.SettlementNumber || r.LeaveNumber || r.ChangeNumber || r.DocumentNumber || r.Code || r.Barcode || id;
  const what = r.Description || r.Name || r.Title || r.EmployeeName || r.CustomerName || r.VendorName || r.ItemCode || r.ModuleID || '';
  const date = r.Date || r.SODate || r.PODate || r.FromDate || r.Month || r.EffectiveDate || (r.CreatedAt || '').slice(0, 10);
  return [number, what].filter(Boolean).join(' — ') + (date ? ' · ' + date : '') + (r.Status ? ' [' + r.Status + ']' : '');
}

module.exports = { CATEGORIES, USED_BY, legacyShaped, recordCount, refusal, clear, deleteRecords, summary, portalUids };
