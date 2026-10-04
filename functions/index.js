// Every ported function gets exported from here. As more of Code.gs
// gets ported, this file just grows — one require + one re-export per
// function, grouped by the same module boundaries as the functions/src
// folder structure (stock/, gl/, invoices/, shared/, per the earlier
// scaffold plan).

const { getModuleFragment } = require('./src/getModuleFragment');
const { completeLogin, restoreSession, getMyTree } = require('./src/session');
const { getMyFavorites, toggleFavorite } = require('./src/favorites');
const { getPendingApprovalsForUser, getMyRejectedSubmissions, getMyDraftsForUser } = require('./src/homeTasks');
const { getActiveCompanies } = require('./src/companies');
const {
  saveStockAdjustmentDraft, postStockAdjustment, decideStockAdjustmentApproval,
  deleteStockAdjustmentDraft, getStockAdjustmentEntries, reverseStockAdjustment
} = require('./src/stockAdjustment');
const {
  saveMaterialIssueDraft, postMaterialIssue, decideMaterialIssueApproval,
  deleteMaterialIssueDraft, getMaterialIssueEntries, reverseMaterialIssue
} = require('./src/materialIssue');
const {
  getEligibleApprovedPOsForGRN, saveGrnDraft, postGrn, decideGrnApproval,
  deleteGrnDraft, getGrnEntries, reverseGrn
} = require('./src/grn');
const {
  saveWarehouseMovementDraft, postWarehouseMovement, decideWarehouseMovementApproval,
  deleteWarehouseMovementDraft, getWarehouseMovementEntries, reverseWarehouseMovement
} = require('./src/warehouseMovement');
const {
  getModulePermissionsForUser, getActiveItems, getActiveUOMs, getActiveOrgUnits, getActiveVendors,
  getStockLedgerEntryPublic, getMyPendingApprovalLevel, getJournalEntryDetail, updatePostedDescription
} = require('./src/masterData');
const {
  getJournalEntries, getCbtEntries, saveJournalDraft, saveCbtDraft, deleteJournalDraft,
  postJournalEntry, decideJournalEntryApproval, reverseJournalEntry, getPartyAccounts, getPartyOpenItems
} = require('./src/journal');
const {
  getVendorInvoiceEntries, getCustomerInvoiceEntries, requestReverseVendorInvoice, decideVendorInvoiceReversalApproval,
  requestReverseCustomerInvoice, decideCustomerInvoiceReversalApproval
} = require('./src/invoiceAllocations');
const {
  getReturnableVendorInvoices, savePurchaseReturnDraft, postPurchaseReturn, decidePurchaseReturnApproval,
  deletePurchaseReturnDraft, getPurchaseReturnEntries, reversePurchaseReturn
} = require('./src/purchaseReturn');
const {
  getReturnableCustomerInvoices, saveSalesReturnDraft, postSalesReturn, decideSalesReturnApproval,
  deleteSalesReturnDraft, getSalesReturnEntries, reverseSalesReturn
} = require('./src/salesReturn');
const { getPartyStatement } = require('./src/partyStatement');
const { getTrialBalancePeriod } = require('./src/trialBalance');
const {
  getPdcSetup, getPdcOpenItems, savePdcDraft, deletePdcDraft, postPdc, decidePdcApproval,
  clearPdcs, bouncePdc, cancelPdc, undoPdcClearing, getPdcEntries, getPdcsDueForUser
} = require('./src/pdc');
// Fixed Assets, phase 1 (docs/modules/FIXED_ASSETS.md).
const faConfig = require('./src/fixedAssetsConfig');
const faMaster = require('./src/fixedAssetsMaster');
const faPostings = require('./src/fixedAssetsPostings');
const faDepreciation = require('./src/fixedAssetsDepreciation');
const faRetirement = require('./src/fixedAssetsRetirement');
// Recurring Journal Entries (docs/modules/RECURRING_JOURNAL.md).
const recurringJournal = require('./src/recurringJournal');

exports.getModuleFragment = getModuleFragment;
exports.completeLogin = completeLogin;
exports.restoreSession = restoreSession;
exports.getMyTree = getMyTree;
exports.getMyFavorites = getMyFavorites;
exports.toggleFavorite = toggleFavorite;
exports.getPendingApprovalsForUser = getPendingApprovalsForUser;
exports.getMyRejectedSubmissions = getMyRejectedSubmissions;
exports.getMyDraftsForUser = getMyDraftsForUser;
exports.getActiveCompanies = getActiveCompanies;
exports.saveStockAdjustmentDraft = saveStockAdjustmentDraft;
exports.postStockAdjustment = postStockAdjustment;
exports.decideStockAdjustmentApproval = decideStockAdjustmentApproval;
exports.deleteStockAdjustmentDraft = deleteStockAdjustmentDraft;
exports.getStockAdjustmentEntries = getStockAdjustmentEntries;
exports.reverseStockAdjustment = reverseStockAdjustment;
exports.saveMaterialIssueDraft = saveMaterialIssueDraft;
exports.postMaterialIssue = postMaterialIssue;
exports.decideMaterialIssueApproval = decideMaterialIssueApproval;
exports.deleteMaterialIssueDraft = deleteMaterialIssueDraft;
exports.getMaterialIssueEntries = getMaterialIssueEntries;
exports.reverseMaterialIssue = reverseMaterialIssue;
exports.getEligibleApprovedPOsForGRN = getEligibleApprovedPOsForGRN;
exports.saveGrnDraft = saveGrnDraft;
exports.postGrn = postGrn;
exports.decideGrnApproval = decideGrnApproval;
exports.deleteGrnDraft = deleteGrnDraft;
exports.getGrnEntries = getGrnEntries;
exports.reverseGrn = reverseGrn;
exports.saveWarehouseMovementDraft = saveWarehouseMovementDraft;
exports.postWarehouseMovement = postWarehouseMovement;
exports.decideWarehouseMovementApproval = decideWarehouseMovementApproval;
exports.deleteWarehouseMovementDraft = deleteWarehouseMovementDraft;
exports.getWarehouseMovementEntries = getWarehouseMovementEntries;
exports.reverseWarehouseMovement = reverseWarehouseMovement;
exports.getModulePermissionsForUser = getModulePermissionsForUser;
exports.getActiveItems = getActiveItems;
exports.getActiveUOMs = getActiveUOMs;
exports.getActiveOrgUnits = getActiveOrgUnits;
exports.getActiveVendors = getActiveVendors;
exports.getStockLedgerEntryPublic = getStockLedgerEntryPublic;
exports.getMyPendingApprovalLevel = getMyPendingApprovalLevel;
exports.getJournalEntryDetail = getJournalEntryDetail;
exports.updatePostedDescription = updatePostedDescription;
exports.getJournalEntries = getJournalEntries;
exports.getCbtEntries = getCbtEntries;
exports.saveJournalDraft = saveJournalDraft;
exports.saveCbtDraft = saveCbtDraft;
exports.deleteJournalDraft = deleteJournalDraft;
exports.postJournalEntry = postJournalEntry;
exports.decideJournalEntryApproval = decideJournalEntryApproval;
exports.reverseJournalEntry = reverseJournalEntry;
exports.getPartyAccounts = getPartyAccounts;
exports.getPartyOpenItems = getPartyOpenItems;
exports.getVendorInvoiceEntries = getVendorInvoiceEntries;
exports.getCustomerInvoiceEntries = getCustomerInvoiceEntries;
exports.requestReverseVendorInvoice = requestReverseVendorInvoice;
exports.decideVendorInvoiceReversalApproval = decideVendorInvoiceReversalApproval;
exports.requestReverseCustomerInvoice = requestReverseCustomerInvoice;
exports.decideCustomerInvoiceReversalApproval = decideCustomerInvoiceReversalApproval;
exports.getReturnableVendorInvoices = getReturnableVendorInvoices;
exports.savePurchaseReturnDraft = savePurchaseReturnDraft;
exports.postPurchaseReturn = postPurchaseReturn;
exports.decidePurchaseReturnApproval = decidePurchaseReturnApproval;
exports.deletePurchaseReturnDraft = deletePurchaseReturnDraft;
exports.getPurchaseReturnEntries = getPurchaseReturnEntries;
exports.reversePurchaseReturn = reversePurchaseReturn;
exports.getReturnableCustomerInvoices = getReturnableCustomerInvoices;
exports.saveSalesReturnDraft = saveSalesReturnDraft;
exports.postSalesReturn = postSalesReturn;
exports.decideSalesReturnApproval = decideSalesReturnApproval;
exports.deleteSalesReturnDraft = deleteSalesReturnDraft;
exports.getSalesReturnEntries = getSalesReturnEntries;
exports.reverseSalesReturn = reverseSalesReturn;
exports.getPartyStatement = getPartyStatement;
exports.getTrialBalancePeriod = getTrialBalancePeriod;
exports.getPdcSetup = getPdcSetup;
exports.getPdcOpenItems = getPdcOpenItems;
exports.savePdcDraft = savePdcDraft;
exports.deletePdcDraft = deletePdcDraft;
exports.postPdc = postPdc;
exports.decidePdcApproval = decidePdcApproval;
exports.clearPdcs = clearPdcs;
exports.bouncePdc = bouncePdc;
exports.cancelPdc = cancelPdc;
exports.undoPdcClearing = undoPdcClearing;
exports.getPdcEntries = getPdcEntries;
exports.getPdcsDueForUser = getPdcsDueForUser;
for (const [name, fn] of Object.entries(Object.assign({}, faConfig, faMaster, faPostings, faDepreciation, faRetirement, recurringJournal))) {
  if (fn && fn.__endpoint) exports[name] = fn; // callables only, not helpers
}

// Every remaining Code.gs module, ported mechanically (see
// tools/legacy-port/generate.js): one callable per function a ported
// screen calls, named exactly as in Code.gs.
Object.assign(exports, require('./src/legacy/callables'));

// Follow-up teams (docs/modules/APPROVAL_ROUTING.md).
const { getFollowUpTeams, saveFollowUpTeam, getMyFollowUpTasksForUser } = require('./src/followUps');
exports.getFollowUpTeams = getFollowUpTeams;
exports.saveFollowUpTeam = saveFollowUpTeam;
exports.getMyFollowUpTasksForUser = getMyFollowUpTasksForUser;

// Approval delegation (docs/modules/APPROVAL_DELEGATION.md).
const { getDelegationCandidates, delegateApproval, delegateApprovalsOf } = require('./src/approvalDelegation');
exports.getDelegationCandidates = getDelegationCandidates;
exports.delegateApproval = delegateApproval;
exports.delegateApprovalsOf = delegateApprovalsOf;

// Master Data Import from Excel (docs/modules/MASTER_IMPORT.md).
const { getMasterImportSpecs, checkMasterImport, runMasterImport } = require('./src/masterImport');
exports.getMasterImportSpecs = getMasterImportSpecs;
exports.checkMasterImport = checkMasterImport;
exports.runMasterImport = runMasterImport;
// Opening Balances (docs/modules/OPENING_BALANCES.md).
const { getOpeningBalanceSetup, saveOpeningBalanceSettings, checkOpeningBalances, postOpeningBalances, reverseOpeningBalanceBatch } = require('./src/openingBalances');
exports.getOpeningBalanceSetup = getOpeningBalanceSetup;
exports.saveOpeningBalanceSettings = saveOpeningBalanceSettings;
exports.checkOpeningBalances = checkOpeningBalances;
exports.postOpeningBalances = postOpeningBalances;
exports.reverseOpeningBalanceBatch = reverseOpeningBalanceBatch;
// Supporting documents on entries (docs/modules/ATTACHMENTS.md).
const attachments = require('./src/attachments');
['getAttachments', 'uploadAttachment', 'openAttachment', 'removeAttachment', 'getAttachmentCounts',
  'getDocumentStorage', 'saveDocumentStorageClient', 'startDriveConnect', 'driveOAuthCallback',
  'testDocumentStorage', 'disconnectDocumentStorage', 'useTestDocumentStorage'].forEach(n => { exports[n] = attachments[n]; });
// Company Documents: legal documents, contracts, licences (docs/modules/COMPANY_DOCUMENTS.md).
const companyDocuments = require('./src/companyDocuments');
['getCompanyDocuments', 'getCompanyDocument', 'saveCompanyDocument', 'renewCompanyDocument', 'removeCompanyDocument',
  'saveCompanyDocumentCategory', 'getPartyDocumentCounts', 'getDocumentsExpiringForUser'].forEach(n => { exports[n] = companyDocuments[n]; });
// HR: Employee Records (docs/modules/HR_EMPLOYEES.md).
const hrSetup = require('./src/hrSetup');
['getHrSetup', 'saveHrGrade', 'saveHrDesignation', 'saveHrField', 'saveHrDocumentType', 'saveHrWorkSchedule'].forEach(n => { exports[n] = hrSetup[n]; });
const hrEmployees = require('./src/hrEmployees');
['getEmployees', 'getEmployee', 'saveEmployee', 'replaceManager'].forEach(n => { exports[n] = hrEmployees[n]; });
const hrDocuments = require('./src/hrDocuments');
['getEmployeeDocuments', 'saveEmployeeDocument', 'renewEmployeeDocument', 'removeEmployeeDocument',
  'getEmployeeDocumentsExpiringForUser'].forEach(n => { exports[n] = hrDocuments[n]; });
const hrPay = require('./src/hrPay');
['getPayElements', 'savePayElement', 'getCompensation', 'saveCompensation'].forEach(n => { exports[n] = hrPay[n]; });
// HR Payroll (docs/modules/HR_PAYROLL.md).
const payrollSetup = require('./src/payrollSetup');
['getPayrollSetup', 'savePayrollCompany', 'savePayElementPayroll', 'previewPayrollFormula'].forEach(n => { exports[n] = payrollSetup[n]; });
const payrollRun = require('./src/payrollRun');
['getPayrollRuns', 'createPayrollRun', 'getPayrollRun', 'savePayrollInputs', 'recalculatePayrollRun', 'deletePayrollRun'].forEach(n => { exports[n] = payrollRun[n]; });
const hrChanges = require('./src/hrChanges');
['getEmployeeChanges', 'getEmployeeChange', 'saveEmployeeChange', 'deleteEmployeeChange', 'submitEmployeeChange',
  'decideEmployeeChangeApproval', 'getEmployeeChangeStart'].forEach(n => { exports[n] = hrChanges[n]; });
// HR: Attendance and Leave Register (docs/modules/HR_LEAVE.md).
const hrLeaveSetup = require('./src/hrLeaveSetup');
['getLeaveSetup', 'saveLeaveType', 'saveLeaveEntitlements', 'saveLeavePayRules', 'getWorkCalendar', 'saveWorkCalendar'].forEach(n => { exports[n] = hrLeaveSetup[n]; });
const hrLeave = require('./src/hrLeave');
['getLeaves', 'getLeaveForm', 'getLeave', 'previewLeave', 'saveLeave', 'deleteLeave', 'submitLeave', 'decideLeaveApproval', 'cancelLeave',
  'recordLeaveReturn', 'getLeaveBalances', 'adjustLeaveBalance'].forEach(n => { exports[n] = hrLeave[n]; });
const hrLeaveClose = require('./src/hrLeaveClose');
['getLeaveMonths', 'getLeaveMonthSummary', 'lockLeaveMonth', 'reopenLeaveMonth', 'closeLeaveYear'].forEach(n => { exports[n] = hrLeaveClose[n]; });
const hrLeaveReports = require('./src/hrLeaveReports');
['getLeaveReportTypes', 'getLeaveBalanceReport', 'getLeaveRegisterReport', 'getLeaveCalendar', 'getLeaveTasksForUser'].forEach(n => { exports[n] = hrLeaveReports[n]; });
