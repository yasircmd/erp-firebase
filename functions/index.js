// Every ported function gets exported from here. As more of Code.gs
// gets ported, this file just grows — one require + one re-export per
// function, grouped by the same module boundaries as the functions/src
// folder structure (stock/, gl/, invoices/, shared/, per the earlier
// scaffold plan).

const { getModuleFragment } = require('./src/getModuleFragment');
const { completeLogin, restoreSession, getMyTree } = require('./src/session');
const { getMyFavorites, toggleFavorite } = require('./src/favorites');
const { getPendingApprovalsForUser, getMyRejectedSubmissions } = require('./src/homeTasks');
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

exports.getModuleFragment = getModuleFragment;
exports.completeLogin = completeLogin;
exports.restoreSession = restoreSession;
exports.getMyTree = getMyTree;
exports.getMyFavorites = getMyFavorites;
exports.toggleFavorite = toggleFavorite;
exports.getPendingApprovalsForUser = getPendingApprovalsForUser;
exports.getMyRejectedSubmissions = getMyRejectedSubmissions;
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
