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
  { ModuleID: 'CBT', Label: 'Cash & Bank Transactions' },
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
];

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
  CUSTOMERINVOICE: { type: 'rtdb', path: 'customerInvoices' },
  PURCHASEREQUISITION: { type: 'rtdb', path: 'purchaseRequisitions' },
  INVENTORYPURCHASEREQUISITION: { type: 'rtdb', path: 'inventoryPurchaseRequisitions' },
  JOBORDERREQUEST: { type: 'rtdb', path: 'jobOrderBatches' }
};

module.exports = { FIRESTORE_JOURNAL_ENTRIES_COLLECTION, APPROVAL_GATEABLE_MODULES, APPROVAL_MODULE_STORAGE_ };
