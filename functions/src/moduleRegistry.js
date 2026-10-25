// Faithfully extracted from the existing Code.gs (not retyped) —
// these are the exact same two constants that already govern module
// access today. Getting either of these wrong in translation would
// mean someone silently loses (or gains) access to a module, so they
// were copied verbatim rather than reconstructed from memory.

const MODULE_REGISTRY = [
  { id: 'USERMGMT', label: 'User Management', capabilities: ['access', 'write'] },
  { id: 'COA', label: 'Chart of Accounts', capabilities: ['access', 'write'] },
  { id: 'JV', label: 'Journal Entry Processing (JV)', capabilities: ['access', 'draft', 'post', 'rematch'] }, // rematch: UX_TIER3.md G
  { id: 'CBT', label: 'Cash and Bank Transactions (CBT)', capabilities: ['access', 'draft', 'post', 'rematch'] },
  { id: 'TREEMGMT', label: 'Module Tree & Navigation', capabilities: ['access', 'write'] },
  { id: 'ROLES', label: 'Roles & Permissions', capabilities: ['access', 'write'] },
  { id: 'COMPANYMASTER', label: 'Company Master Data', capabilities: ['access', 'write', 'shareholders'] }, // shareholders: UX_TIER3.md F
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
  { id: 'CURRENCYCONFIG', label: 'Currency Configuration', capabilities: ['access', 'write', 'rates'] }, // rates: docs/modules/MULTI_CURRENCY.md
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
  { id: 'PROJECTREPORT', label: 'Project Report', capabilities: ['access'] }, // docs/modules/PROJECTS_DIMENSIONS.md
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
  // New development (not in Code.gs): docs/modules/SALES_RETURN.md.
  { id: 'SALESRETURN', label: 'Sales Return / Credit Note', capabilities: ['access', 'draft', 'post'] },
  // New development (not in Code.gs): docs/modules/VENDOR_SOA.md, CUSTOMER_SOA.md.
  { id: 'VENDORSOA', label: 'Vendor Statement of Account (SOA)', capabilities: ['access'] },
  { id: 'CUSTOMERSOA', label: 'Customer Statement of Account (SOA)', capabilities: ['access'] },
  // New development (not in Code.gs): docs/modules/AGING_REPORTS.md.
  { id: 'CUSTOMERAGING', label: 'Customer Aging', capabilities: ['access'] },
  { id: 'VENDORAGING', label: 'Vendor Aging', capabilities: ['access'] },
  { id: 'INVENTORYAGING', label: 'Inventory Aging', capabilities: ['access'] },
  // New development (not in Code.gs): docs/modules/STOCK_REPORTS.md.
  { id: 'BATCHEXPIRY', label: 'Expiry / Batch Report', capabilities: ['access'] },
  { id: 'REORDER', label: 'Reorder / Low Stock Report', capabilities: ['access'] },
  // New development (not in Code.gs): docs/modules/PERIOD_CLOSING.md. close
  // also changes the Setup; reopen needs a reason.
  { id: 'PERIODCLOSE', label: 'Period Closing', capabilities: ['access', 'close', 'reopen'] },
  // New development (not in Code.gs): docs/modules/PDC.md.
  { id: 'PDCRECEIVED', label: 'PDC Received', capabilities: ['access', 'draft', 'post'] },
  { id: 'PDCISSUED', label: 'PDC Issued', capabilities: ['access', 'draft', 'post'] },
  // New development (not in Code.gs): docs/modules/FIXED_ASSETS.md, phase 1.
  { id: 'FACONFIG', label: 'Fixed Asset Configuration', capabilities: ['access', 'write'] },
  { id: 'FAASSET', label: 'Fixed Asset Master', capabilities: ['access', 'draft'] },
  { id: 'FAACQ', label: 'Fixed Asset Capitalization', capabilities: ['access', 'draft', 'post'] },
  { id: 'FADEPRUN', label: 'Depreciation Run', capabilities: ['access', 'post', 'reverse'] },
  { id: 'FAADDDEP', label: 'Additional Depreciation', capabilities: ['access', 'draft', 'post'] },
  { id: 'FAREGISTER', label: 'Fixed Asset Register', capabilities: ['access'] },
  // docs/modules/FIXED_ASSETS.md, phase 2.
  { id: 'FARETIRE', label: 'Fixed Asset Retirement', capabilities: ['access', 'draft', 'post'] },
  // Capital Work in Progress (Assets under Construction), owner 2026-09-28.
  { id: 'FAAUC', label: 'Capital Work in Progress', capabilities: ['access', 'draft', 'post'] },
  // New development (not in Code.gs): docs/modules/RECURRING_JOURNAL.md.
  { id: 'RECURRINGJV', label: 'Recurring Journal Entries', capabilities: ['access', 'draft', 'post'] },
  { id: 'DATARESET', label: 'Data Reset (Admin)', capabilities: ['access', 'write'] },
  // New development: docs/modules/MASTER_IMPORT.md. Importing also needs
  // write on the master being imported.
  { id: 'MASTERIMPORT', label: 'Master Data Import', capabilities: ['access'] },
  // New development: docs/modules/OPENING_BALANCES.md (Admin only, owner
  // decision 6: no approval).
  { id: 'OPENINGBALANCES', label: 'Opening Balances', capabilities: ['access'] },
  // New development: docs/modules/ATTACHMENTS.md. Access = Admin of the
  // document storage: sees its link, removes posted entries' documents.
  { id: 'DOCUMENTSTORAGE', label: 'Document Storage', capabilities: ['access'] },
  // New development: docs/modules/COMPANY_DOCUMENTS.md (owner decision 1:
  // its own permission; access views, write adds, changes and removes).
  { id: 'COMPANYDOCS', label: 'Company Documents', capabilities: ['access', 'write'] },
  // New development: docs/modules/HR_EMPLOYEES.md. EMPLOYEES "sensitive" =
  // sees pay, bank details, sensitive extra fields and documents (owner
  // decision 7, revised).
  { id: 'HRSETUP', label: 'HR Setup', capabilities: ['access', 'write'] },
  // "portal": switches employees' Employee Portal access on and off, resets
  // their passwords (docs/modules/EMPLOYEE_PORTAL.md, decision 95).
  { id: 'EMPLOYEES', label: 'Employees', capabilities: ['access', 'write', 'sensitive', 'portal'] },
  // Promotion / increment / transfer documents, approved through Approval
  // Configuration (docs/modules/HR_EMPLOYEES.md, step 4).
  { id: 'EMPCHANGE', label: 'Employee Changes', capabilities: ['access', 'draft', 'post'] },
  { id: 'LEAVE', label: 'Leave Register', capabilities: ['access', 'draft', 'post', 'lock', 'reopen'] },
  { id: 'LEAVEREPORTS', label: 'Leave Reports', capabilities: ['access'] },
  // HR Payroll (docs/modules/HR_PAYROLL.md, step 2): the monthly run.
  { id: 'PAYROLL', label: 'Payroll', capabilities: ['access', 'draft', 'post', 'pay'] },
  // Payroll Setup (step 4): pay elements, payroll settings, payment file formats.
  { id: 'PAYROLLSETUP', label: 'Payroll Setup', capabilities: ['access', 'write'] },
  // Loans & Advances (step 4b): entered, approved, paid out, recovered by the runs.
  { id: 'PAYROLLLOAN', label: 'Loans & Advances', capabilities: ['access', 'draft', 'pay'] },
  // Final Settlements (step 5b): an employee leaving: gratuity, leave, notice, loans.
  { id: 'PAYROLLFS', label: 'Final Settlements', capabilities: ['access', 'draft', 'post', 'pay'] },
  // HR Payroll step 5c: interim payroll (settlements and loans paid between runs).
  { id: 'PAYROLLIP', label: 'Interim Payroll', capabilities: ['access', 'draft', 'pay'] },
  // HR Payroll step 7b: the payroll inputs in their own module (docs/modules/HR_PAYROLL.md, step 7).
  { id: 'PAYROLLED', label: 'Earnings & Deductions', capabilities: ['access', 'draft'] },
  // HR Payroll step 7c: the employee provisions in their own module; inside,
  // Payroll's rights apply (decision 60), so it has only access.
  { id: 'PROVISIONS', label: 'Provisions', capabilities: ['access'] },
  // Direct Retail Sales (docs/modules/RETAIL_SALES.md): post = sell and reverse, write = setup,
  // report = every user's sales (without it, a user sees only the sales they billed).
  { id: 'RETAILSALES', label: 'Retail Sales', capabilities: ['access', 'post', 'write', 'report', 'return'] },
  // Numbering (docs/modules/NUMBERING.md): the formats of document numbers and codes.
  { id: 'NUMBERING', label: 'Numbering', capabilities: ['access', 'write'] },
  // Employee Requests (docs/modules/EMPLOYEE_PORTAL.md, step 2): payroll
  // queries and loan requests from the Employee Portal. access sees them,
  // handle replies and decides, setup names the handlers.
  { id: 'EMPREQUESTS', label: 'Employee Requests', capabilities: ['access', 'handle', 'setup'] },
  // A leaver's clearance (docs/modules/LEAVER_CLEARANCE.md; owner, 2026-10-25):
  // access sees a company's clearances and signs off a step of one's own
  // team; manage signs off any step and reopens; setup sets the steps.
  { id: 'CLEARANCE', label: 'Clearances', capabilities: ['access', 'manage', 'setup'] },
  // Developer (docs/modules/MULTI_CORPORATE.md, M2; owner, 2026-10-19): the
  // firm's own screen for its corporates. internal: no Help page.
  // homeOnly: only Corporate 100 ever has it, whatever a role says.
  { id: 'DEVELOPER', label: 'Developer', capabilities: ['access', 'write'], internal: true, homeOnly: true },
  // Support (MULTI_CORPORATE.md, M3; decisions 252-254, 256): a client
  // corporate's Admin sends issues to the firm. clientOnly: never Corporate
  // 100's own (it is the firm), though its tree can hold the item for the
  // corporates that follow it.
  { id: 'SUPPORT', label: 'Support', capabilities: ['access'], clientOnly: true }
];

const DEFAULT_PERMISSIONS = {
  USERMGMT: { access: ['ADMIN'], write: ['ADMIN'] },
  COA:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  JV:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'], rematch: ['ADMIN', 'FINANCE_MGR'] },
  CBT:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'], rematch: ['ADMIN', 'FINANCE_MGR'] },
  TREEMGMT: { access: ['ADMIN'], write: ['ADMIN'] },
  ROLES:    { access: ['ADMIN'], write: ['ADMIN'] },
  COMPANYMASTER:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN'], shareholders: ['ADMIN'] },
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
  CURRENCYCONFIG: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'], rates: ['ADMIN', 'FINANCE_MGR'] },
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
  PROJECTREPORT: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  BALANCESHEET: { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  CASHFLOW:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  GRN:                { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  VENDORINVOICE:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  // Same as Vendor Invoice (owner decision 7, docs/modules/PURCHASE_RETURN.md).
  PURCHASERETURN:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  DELIVERYNOTE:       { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  CUSTOMERINVOICE:    { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  // Same as Customer Invoice (owner decision 6, docs/modules/SALES_RETURN.md).
  SALESRETURN:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  // Read-only reports, same broad access as the other reports (SOA decision 6).
  VENDORSOA:          { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  CUSTOMERSOA:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // Read-only reports, as the SOAs (docs/modules/AGING_REPORTS.md).
  CUSTOMERAGING:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  VENDORAGING:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  INVENTORYAGING:     { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // Read-only reports, as the aging reports (docs/modules/STOCK_REPORTS.md).
  BATCHEXPIRY:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  REORDER:            { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  // docs/modules/PERIOD_CLOSING.md (design → rights).
  PERIODCLOSE:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], close: ['ADMIN', 'FINANCE_MGR'], reopen: ['ADMIN', 'FINANCE_MGR'] },
  // Same as CBT (PDC decision 9); 'post' also covers clear, bounce, cancel and undo.
  PDCRECEIVED:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PDCISSUED:          { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  FACONFIG:           { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  FAASSET:            { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'] },
  FAACQ:              { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  FADEPRUN:           { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], post: ['ADMIN', 'FINANCE_MGR'], reverse: ['ADMIN', 'FINANCE_MGR'] },
  FAADDDEP:           { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  FAREGISTER:         { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  FARETIRE:           { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  FAAUC:              { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  RECURRINGJV:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  MATERIALISSUE:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PRODUCTION:         { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  WAREHOUSEMOVEMENT:  { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  STOCKADJUSTMENT:    { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  PHYSICALCOUNT:      { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], draft: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], post: ['ADMIN', 'FINANCE_MGR'] },
  BOM:                { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], write: ['ADMIN', 'FINANCE_MGR'] },
  MATERIALVARIANCE:   { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'] },
  DATARESET:          { access: ['ADMIN'], write: ['ADMIN'] },
  MASTERIMPORT:       { access: ['ADMIN'] },
  OPENINGBALANCES:    { access: ['ADMIN'] },
  DOCUMENTSTORAGE:    { access: ['ADMIN'] },
  COMPANYDOCS:        { access: ['ADMIN', 'FINANCE_MGR'], write: ['ADMIN'] },
  HRSETUP:            { access: ['ADMIN'], write: ['ADMIN'] },
  EMPLOYEES:          { access: ['ADMIN', 'FINANCE_MGR'], write: ['ADMIN'], sensitive: ['ADMIN'], portal: ['ADMIN'] },
  EMPCHANGE:          { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'], post: ['ADMIN'] },
  LEAVE:              { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'], post: ['ADMIN'], lock: ['ADMIN'], reopen: ['ADMIN'] },
  LEAVEREPORTS:       { access: ['ADMIN', 'FINANCE_MGR'] },
  PAYROLL:            { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'], post: ['ADMIN'], pay: ['ADMIN'] },
  PAYROLLSETUP:       { access: ['ADMIN'], write: ['ADMIN'] },
  PAYROLLLOAN:        { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'], pay: ['ADMIN'] },
  PAYROLLFS:          { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'], post: ['ADMIN'], pay: ['ADMIN'] },
  PAYROLLIP:          { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'], pay: ['ADMIN'] },
  PAYROLLED:          { access: ['ADMIN', 'FINANCE_MGR'], draft: ['ADMIN'] },
  PROVISIONS:         { access: ['ADMIN', 'FINANCE_MGR'] },
  RETAILSALES:        { access: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT', 'VIEWER'], post: ['ADMIN', 'FINANCE_MGR', 'ACCOUNTANT'], write: ['ADMIN'], report: ['ADMIN', 'FINANCE_MGR'], return: ['ADMIN', 'FINANCE_MGR'] },
  NUMBERING:          { access: ['ADMIN'], write: ['ADMIN'] },
  EMPREQUESTS:        { access: ['ADMIN', 'FINANCE_MGR'], handle: ['ADMIN', 'FINANCE_MGR'], setup: ['ADMIN'] },
  CLEARANCE:          { access: ['ADMIN', 'FINANCE_MGR'], manage: ['ADMIN'], setup: ['ADMIN'] },
  DEVELOPER:          { access: ['ADMIN'], write: ['ADMIN'] },
  SUPPORT:            { access: ['ADMIN'] }
};

module.exports = { MODULE_REGISTRY, DEFAULT_PERMISSIONS };
