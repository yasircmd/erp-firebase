// Faithfully extracted from the existing Code.gs (not retyped) —
// these are the exact same two constants that already govern module
// access today. Getting either of these wrong in translation would
// mean someone silently loses (or gains) access to a module, so they
// were copied verbatim rather than reconstructed from memory.

const MODULE_REGISTRY = [
  { id: 'USERMGMT', label: 'User Management', capabilities: ['access', 'write'] },
  { id: 'COA', label: 'Chart of Accounts', capabilities: ['access', 'write'] },
  { id: 'JV', label: 'Journal Entry Processing (JV)', capabilities: ['access', 'draft', 'post'] },
  { id: 'CBT', label: 'Cash and Bank Transactions (CBT)', capabilities: ['access', 'draft', 'post'] },
  { id: 'TREEMGMT', label: 'Module Tree & Navigation', capabilities: ['access', 'write'] },
  { id: 'ROLES', label: 'Roles & Permissions', capabilities: ['access', 'write'] },
  { id: 'COMPANYMASTER', label: 'Company Master Data', capabilities: ['access', 'write'] },
  { id: 'VENDORMASTER', label: 'Vendor Master Data', capabilities: ['access', 'write'] },
  { id: 'CUSTOMERMASTER', label: 'Customer Master Data', capabilities: ['access', 'write'] },
  { id: 'PROCUREMENTSETUP', label: 'Procurement Setup', capabilities: ['access', 'write'] },
  { id: 'SALESINVOICESETUP', label: 'Sales Invoice Configuration', capabilities: ['access', 'write'] },
  { id: 'APPROVALCONFIG', label: 'Approval Configuration', capabilities: ['access', 'write'] },
  { id: 'APPROVALTRACKER', label: 'Approval Tracker', capabilities: ['access'] },
  { id: 'PURCHASEREQUISITION', label: 'Purchase Requisition', capabilities: ['access', 'draft', 'post'] },
  { id: 'INVENTORYPURCHASEREQUISITION', label: 'Inventory Purchase Requisition', capabilities: ['access', 'draft', 'post'] },
  { id: 'PURCHASEORDER', label: 'Purchase Order', capabilities: ['access', 'draft', 'post'] },
  { id: 'JOBORDERREQUEST', label: 'Job Order Request', capabilities: ['access', 'draft', 'post'] },
  { id: 'PRICELISTING', label: 'Price Listing', capabilities: ['access', 'write'] },
  { id: 'SALESORDER', label: 'Sales Order', capabilities: ['access', 'draft', 'post'] },
  { id: 'CURRENCYCONFIG', label: 'Currency Configuration', capabilities: ['access', 'write'] },
  { id: 'ORGUNITS', label: 'Organizational Units', capabilities: ['access', 'write'] },
  { id: 'UOM', label: 'Unit of Measure', capabilities: ['access', 'write'] },
  { id: 'ITEMSUBCAT', label: 'Item Sub-Category', capabilities: ['access', 'write'] },
  { id: 'ITEMMASTER', label: 'Item Master', capabilities: ['access', 'write'] },
  { id: 'GLREPORT', label: 'General Ledger Reports (GL)', capabilities: ['access'] },
  { id: 'STOCKAVAILABILITY', label: 'Stock Availability', capabilities: ['access'] },
  { id: 'INVENTORYVALUATION', label: 'Inventory Valuation List', capabilities: ['access', 'write'] },
  { id: 'STOCKLEDGER', label: 'Stock Ledger Report', capabilities: ['access'] },
  { id: 'PRODCONSUMPTION', label: 'Production & Consumption Report', capabilities: ['access'] },
  { id: 'STOCKVALUATION', label: 'Stock Valuation Report', capabilities: ['access'] },
  { id: 'TRIALBALANCE', label: 'Trial Balance (TB)', capabilities: ['access'] },
  { id: 'PROFITLOSS', label: 'Profit and Loss Statement (P&L)', capabilities: ['access'] },
  { id: 'BALANCESHEET', label: 'Balance Sheet (BS)', capabilities: ['access'] },
  { id: 'CASHFLOW', label: 'Cash Flow Statement (CFS)', capabilities: ['access'] },
  { id: 'GRN', label: 'Goods Receipt (GRN)', capabilities: ['access', 'draft', 'post'] },
  { id: 'MATERIALISSUE', label: 'Material Issue (MI)', capabilities: ['access', 'draft', 'post'] },
  { id: 'PRODUCTION', label: 'Production Entry', capabilities: ['access', 'draft', 'post'] },
  { id: 'WAREHOUSEMOVEMENT', label: 'Warehouse Movement', capabilities: ['access', 'draft', 'post'] },
  { id: 'STOCKADJUSTMENT', label: 'Stock Adjustment', capabilities: ['access', 'draft', 'post'] },
  { id: 'PHYSICALCOUNT', label: 'Physical / Cycle Count', capabilities: ['access', 'draft', 'post'] },
  { id: 'BOM', label: 'Bill of Materials', capabilities: ['access', 'write'] },
  { id: 'MATERIALVARIANCE', label: 'Material Variance Report', capabilities: ['access'] },
  { id: 'VENDORINVOICE', label: 'Vendor Invoice Processing', capabilities: ['access', 'draft', 'post'] },
  // New development (not in Code.gs): docs/modules/PURCHASE_RETURN.md.
  { id: 'PURCHASERETURN', label: 'Purchase Return / Debit Note', capabilities: ['access', 'draft', 'post'] },
  { id: 'DELIVERYNOTE', label: 'Delivery Note (Goods Dispatch)', capabilities: ['access', 'draft', 'post'] },
  { id: 'CUSTOMERINVOICE', label: 'Customer Invoice Processing', capabilities: ['access', 'draft', 'post'] },
  { id: 'DATARESET', label: 'Data Reset (Admin)', capabilities: ['access', 'write'] }
];

const DEFAULT_PERMISSIONS = {
  USERMGMT: { access: ['ADMIN'], write: ['ADMIN'] },
  COA:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  JV:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  CBT:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  TREEMGMT: { access: ['ADMIN'], write: ['ADMIN'] },
  ROLES:    { access: ['ADMIN'], write: ['ADMIN'] },
  COMPANYMASTER:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  VENDORMASTER:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  CUSTOMERMASTER: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  PROCUREMENTSETUP: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  SALESINVOICESETUP: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  // Admin-only write, no exceptions — this controls who approves what
  // across every gated module in the system. More sensitive than any
  // individual module's own approval levels used to be.
  APPROVALCONFIG: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'] },
  // Admin only, explicitly — this is the audit/dispute trail across
  // every gated module, deliberately narrower than every other
  // read-only report in this system (which default to a broader
  // access list). Nobody who could be a SUBJECT of an approval
  // decision should also be able to browse the full history of them.
  APPROVALTRACKER: { access: ['ADMIN'] },
  // Deliberately broad, and draft/post kept EQUAL rather than mirroring
  // GRN's pattern of a more-restricted post — GRN's "post" is a real
  // financial/stock commitment needing higher trust, but this module's
  // "Submit" is just "lock and hand off to Procurement," not a
  // financial commitment (see the module's own header comment on why
  // it carries no value/approval gate at all). No reason to trust
  // Submit less than Draft here.
  PURCHASEREQUISITION: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  // Confirmed requesters are Sales and Production specifically, not
  // every department — but this system has no department-specific
  // roles by default (just ADMIN/FINANCE_MGR/ACCOUNTANT/VIEWER), so
  // that restriction has to be enforced by whichever org-specific roles
  // an admin creates in Roles & Permissions (e.g. SALES_STAFF,
  // PRODUCTION_STAFF), granted access here explicitly — same approach
  // taken for Purchase Requisition's own "all departments" scope.
  INVENTORYPURCHASEREQUISITION: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  PURCHASEORDER: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  // Confirmed: Sales and Production only, and confirmed daily-task, no
  // approval gate — same broad default as the other requisition
  // modules, restricted by whatever org-specific roles an admin
  // assigns (e.g. SALES_STAFF, PRODUCTION_STAFF).
  JOBORDERREQUEST: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  PRICELISTING: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  // Sales-facing, same broad-default reasoning as the requisition
  // modules — org-specific SALES_STAFF-style roles assign write access
  // via Roles & Permissions the same way as everywhere else.
  SALESORDER: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  CURRENCYCONFIG: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  ORGUNITS:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  UOM:            { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  ITEMSUBCAT:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  ITEMMASTER:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  GLREPORT:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // Read-only report, same broad-access pattern as GL Report — Sales
  // needs this to actually use Claim/Release intelligently, so it
  // shouldn't be locked behind a narrower role set than Sales Order itself.
  STOCKAVAILABILITY: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // Same sensitivity as Price Listing — cost data feeds margin/COGS,
  // not something every role should be able to change.
  INVENTORYVALUATION: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  STOCKLEDGER:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  PRODCONSUMPTION:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  STOCKVALUATION:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  TRIALBALANCE: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  PROFITLOSS:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  BALANCESHEET: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  CASHFLOW:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  GRN:                { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  VENDORINVOICE:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  // Same as Vendor Invoice (owner decision 7, docs/modules/PURCHASE_RETURN.md).
  PURCHASERETURN:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  DELIVERYNOTE:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  CUSTOMERINVOICE:    { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  MATERIALISSUE:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PRODUCTION:         { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  WAREHOUSEMOVEMENT:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  STOCKADJUSTMENT:    { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PHYSICALCOUNT:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  BOM:                { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  MATERIALVARIANCE:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  DATARESET:          { access: ['ADMIN'], write: ['ADMIN'] }
};

module.exports = { MODULE_REGISTRY, DEFAULT_PERMISSIONS };
