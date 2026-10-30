// Both extracted verbatim from Code.gs — same reasoning as
// moduleRegistry.js. APPROVAL_MODULE_STORAGE_ in particular is
// load-bearing for the orphaned-task fix in homeTasks.js: getting a
// module's storage location wrong here would silently break that
// module's own stale/orphaned-task detection, not just throw.

const FIRESTORE_JOURNAL_ENTRIES_COLLECTION = 'journalEntries';

const APPROVAL_GATEABLE_MODULES = [
  { ModuleID: 'PURCHASEREQUISITION', Label: 'Purchase Requisition' },
  { ModuleID: 'INVENTORYPURCHASEREQUISITION', Label: 'Inventory Purchase Requisition' },
  { ModuleID: 'JOBORDERREQUEST', Label: 'Job Order Request' },
  { ModuleID: 'JV', Label: 'Journal Entry (JV)' },
  // CBT is four transactions, each with its own approvers (owner, 2026-09-29;
  // docs/modules/APPROVAL_ROUTING.md). The approval still belongs to CBT;
  // these are the Approval Configuration entries its voucher types use.
  { ModuleID: 'CBT_CASHRECEIPT', Label: 'Cash & Bank — Cash Receipt' },
  { ModuleID: 'CBT_BANKRECEIPT', Label: 'Cash & Bank — Bank Receipt' },
  { ModuleID: 'CBT_CASHPAYMENT', Label: 'Cash & Bank — Cash Payment' },
  { ModuleID: 'CBT_BANKPAYMENT', Label: 'Cash & Bank — Bank Payment' },
  { ModuleID: 'CBT_FUNDTRANSFER', Label: 'Cash & Bank — Fund Transfer' },
  { ModuleID: 'GRN', Label: 'Goods Receipt Note' },
  { ModuleID: 'MATERIALISSUE', Label: 'Material Issue' },
  { ModuleID: 'PRODUCTION', Label: 'Production Entry' },
  { ModuleID: 'STOCKADJUSTMENT', Label: 'Stock Adjustment' },
  { ModuleID: 'WAREHOUSEMOVEMENT', Label: 'Warehouse Movement' },
  { ModuleID: 'PHYSICALCOUNT', Label: 'Physical Inventory Counting & Adjustments' },
  { ModuleID: 'PURCHASEORDER', Label: 'Purchase Order' },
  { ModuleID: 'VENDORINVOICE', Label: 'Vendor Invoice Processing' },
  { ModuleID: 'PURCHASERETURN', Label: 'Purchase Return / Debit Note' },
  { ModuleID: 'DELIVERYNOTE', Label: 'Delivery Note (Goods Dispatch)' },
  { ModuleID: 'CUSTOMERINVOICE', Label: 'Customer Invoice Processing' },
  { ModuleID: 'SALESRETURN', Label: 'Sales Return / Credit Note' },
  { ModuleID: 'PDCRECEIVED', Label: 'PDC Received' },
  { ModuleID: 'PDCISSUED', Label: 'PDC Issued' },
  { ModuleID: 'FAACQ', Label: 'Fixed Asset Capitalization' },
  { ModuleID: 'FAADDDEP', Label: 'Additional Depreciation' },
  { ModuleID: 'FARETIRE', Label: 'Fixed Asset Retirement' },
  { ModuleID: 'FAAUC', Label: 'Capital Work in Progress' },
  { ModuleID: 'RECURRINGJV', Label: 'Recurring Journal Entries' },
  { ModuleID: 'BUDGET', Label: 'Budget (the amount is the year\'s budgeted costs)' },
  { ModuleID: 'EMPCHANGE', Label: 'Employee Change (promotion, increment, transfer)' },
  { ModuleID: 'LEAVE', Label: 'Leave (the amount is the days)' },
  { ModuleID: 'LEAVE_ABSENCE', Label: 'Absence, unauthorised (the amount is the days)' },
  { ModuleID: 'PAYROLL', Label: 'Payroll run (the amount is the net pay)' },
  { ModuleID: 'PAYROLLLOAN', Label: 'Loan / advance (the amount is the loan)' },
  { ModuleID: 'PAYROLLFS', Label: 'Final settlement (the amount is the net)' },
  { ModuleID: 'PAYROLLIP', Label: 'Interim payroll (the amount is the batch total)' },
  // Employee Portal claims (docs/modules/EMPLOYEE_PORTAL.md, step 3); the approval belongs to Employee Requests.
  { ModuleID: 'REIMBURSEMENT', Label: 'Reimbursement claim (the amount is the claim total)' },
];

// 'stock/transactions' is the name the stock modules' documents keep; they
// are in Firestore (stockStore.js), and the readers route by it.
const APPROVAL_MODULE_STORAGE_ = {
  JV: { type: 'firestore', collection: FIRESTORE_JOURNAL_ENTRIES_COLLECTION },
  CBT: { type: 'firestore', collection: FIRESTORE_JOURNAL_ENTRIES_COLLECTION },
  GRN: { type: 'rtdb', path: 'stock/transactions' },
  MATERIALISSUE: { type: 'rtdb', path: 'stock/transactions' },
  PRODUCTION: { type: 'rtdb', path: 'stock/transactions' },
  STOCKADJUSTMENT: { type: 'rtdb', path: 'stock/transactions' },
  WAREHOUSEMOVEMENT: { type: 'rtdb', path: 'stock/transactions' },
  PHYSICALCOUNT: { type: 'rtdb', path: 'stock/transactions' },
  DELIVERYNOTE: { type: 'rtdb', path: 'stock/transactions' },
  PURCHASEORDER: { type: 'rtdb', path: 'purchaseOrders' },
  VENDORINVOICE: { type: 'rtdb', path: 'vendorInvoices' },
  PURCHASERETURN: { type: 'rtdb', path: 'stock/transactions' },
  SALESRETURN: { type: 'rtdb', path: 'stock/transactions' },
  PDCRECEIVED: { type: 'rtdb', path: 'pdcCheques' },
  PDCISSUED: { type: 'rtdb', path: 'pdcCheques' },
  FAACQ: { type: 'firestore', collection: 'faPostings' },
  FAADDDEP: { type: 'firestore', collection: 'faPostings' },
  FARETIRE: { type: 'firestore', collection: 'faPostings' },
  FAAUC: { type: 'firestore', collection: 'faPostings' },
  RECURRINGJV: { type: 'rtdb', path: 'recurringJournals' },
  BUDGET: { type: 'firestore', collection: 'budgets' },
  CUSTOMERINVOICE: { type: 'rtdb', path: 'customerInvoices' },
  PURCHASEREQUISITION: { type: 'rtdb', path: 'purchaseRequisitions' },
  INVENTORYPURCHASEREQUISITION: { type: 'rtdb', path: 'inventoryPurchaseRequisitions' },
  // One approval per Job Order LINE (acceptance / stop, docs/modules/JOB_ORDER_ACCEPTANCE.md).
  JOBORDERREQUEST: { type: 'rtdb', path: 'jobOrderLines' },
  EMPCHANGE: { type: 'firestore', collection: 'employeeChanges' },
  LEAVE: { type: 'firestore', collection: 'leaveRequests' },
  PAYROLL: { type: 'firestore', collection: 'payrollRuns' },
  PAYROLLLOAN: { type: 'firestore', collection: 'payrollLoans' },
  PAYROLLFS: { type: 'firestore', collection: 'payrollSettlements' },
  PAYROLLIP: { type: 'firestore', collection: 'payrollInterim' },
  EMPREQUESTS: { type: 'firestore', collection: 'employeeRequests' }
};

// CBT voucher type -> its Approval Configuration entry.
const CBT_APPROVAL_KEYS = {
  'Cash Receipt': 'CBT_CASHRECEIPT', 'Bank Receipt': 'CBT_BANKRECEIPT',
  'Cash Payment': 'CBT_CASHPAYMENT', 'Bank Payment': 'CBT_BANKPAYMENT',
  'Fund Transfer': 'CBT_FUNDTRANSFER'
};

// The label a Home task or list shows for an approval: its Approval
// Configuration entry (ConfigKey, e.g. a CBT voucher type), else its module.
// CBT approvals from before the split have no ConfigKey.
function approvalLabelOf(inst) {
  const byId = id => APPROVAL_GATEABLE_MODULES.find(m => m.ModuleID === id);
  const entry = (inst.ConfigKey && byId(inst.ConfigKey)) || byId(inst.ModuleID);
  if (entry) return entry.Label;
  return inst.ModuleID === 'CBT' ? 'Cash & Bank Transactions' : inst.ModuleID;
}

module.exports = { FIRESTORE_JOURNAL_ENTRIES_COLLECTION, APPROVAL_GATEABLE_MODULES, APPROVAL_MODULE_STORAGE_, CBT_APPROVAL_KEYS, approvalLabelOf };
