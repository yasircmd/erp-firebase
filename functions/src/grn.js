const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, COST_CENTER_REQUIRED_TYPES } = require('./glWriting');
const { computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
// Successful save/post/decide/reverse results carry success: true, same as
// the original's return contract — the module's own screen checks
// result.success on every one of these and would otherwise report a
// genuinely successful commit as a failure. Errors still throw (the
// screen's .withFailureHandler shows err.message), rather than the
// original's { success: false, error } — both paths end up displayed.

async function requireDraftAccess(moduleId, role) {
  const can = await moduleHasCapability(moduleId, 'draft', role);
  if (!can) throw new Error('You do not have permission to create or edit entries in ' + moduleId + '.');
}
async function requirePostAccess(moduleId, role) {
  const can = await moduleHasCapability(moduleId, 'post', role);
  if (!can) throw new Error('You do not have permission to post or reverse entries in ' + moduleId + '.');
}

// Ported from resolveGrnClearingAccount_.
async function resolveGrnClearingAccount(companyId) {
  const snap = await rtdb.ref('companies').get();
  const companies = snap.val() || {};
  const company = companies[companyId];
  if (!company) throw new Error('Company not found.');
  if (!company.GrnClearingAccountID) {
    throw new Error('This company has no GRN Clearing Account configured. Set one in Company Master Data before posting a GRN.');
  }
  return company.GrnClearingAccountID;
}

// Ported from updatePOLineReceivedQuantity_. Caller MUST already hold
// the global lock (see lock.js) — same contract the original had with
// LockService, and the SAME reasoning as every other per-line
// progress tracker this session: reads the whole PO, mutates the
// matching line in place, writes the whole Lines array back, since
// Lines is a single embedded array on the PO document, not
// individually addressable nodes.
async function updatePOLineReceivedQuantity(poId, poLineId, receivedQty) {
  if (!poId || !poLineId) return;
  const snap = await rtdb.ref('purchaseOrders/' + poId).get();
  const po = snap.val();
  if (!po || !po.Lines) return;
  const lines = po.Lines.map(l => l.LineID === poLineId
    ? Object.assign({}, l, { ReceivedQuantity: Number(l.ReceivedQuantity || 0) + Number(receivedQty || 0) })
    : l);
  await rtdb.ref('purchaseOrders/' + poId).update({ Lines: lines });
}

// Ported from rollbackPOLineReceivedQuantity_ — the reversal
// counterpart, decrements rather than deletes any tracking.
async function rollbackPOLineReceivedQuantity(poId, poLineId, reversedQty) {
  if (!poId || !poLineId) return;
  const snap = await rtdb.ref('purchaseOrders/' + poId).get();
  const po = snap.val();
  if (!po || !po.Lines) return;
  const lines = po.Lines.map(l => l.LineID === poLineId
    ? Object.assign({}, l, { ReceivedQuantity: Math.max(0, Number(l.ReceivedQuantity || 0) - Number(reversedQty || 0)) })
    : l);
  await rtdb.ref('purchaseOrders/' + poId).update({ Lines: lines });
}

// Non-stock lines (owner, 2026-09-28; docs/modules/GRN_NON_STOCK.md):
// a category (Procurement Setup) instead of an item, no warehouse, no
// stock ledger. Posted Dr the category's GL account · Cr GRN Clearing.
// Kept in their own NonStockLines list, not in Lines: Recalculate Stock
// Ledger, the stock reports, the reversal's stock movement and Purchase
// Return all read every GRN Lines entry as stock.
const round2 = n => Math.round(n * 100) / 100;
const lineValue = l => (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0);
const grnAmount = grn => (grn.Lines || []).reduce((sum, l) => sum + lineValue(l), 0) + (grn.NonStockLines || []).reduce((sum, l) => sum + lineValue(l), 0);

// The category's GL account, checked as the GL entry will check it, so a
// problem shows at save rather than after an approval.
function resolveCategoryAccount(category, coaData, companyId, costCenterId, label) {
  const account = coaData[category.GLAccountID];
  if (!account || account.Status !== 'Active' || account.IsPostable !== true) {
    throw new HttpsError('failed-precondition', label + ': the category ' + (category.Name || '') + ' has no valid GL account — check it in Procurement Setup.');
  }
  if (account.CompanyID && account.CompanyID !== companyId) throw new HttpsError('failed-precondition', label + ': the category\'s GL account belongs to a different Company.');
  if (COST_CENTER_REQUIRED_TYPES.includes(account.AccountType) && !costCenterId) {
    throw new HttpsError('invalid-argument', label + ': select a Cost Center (' + (category.Name || 'this category') + ' posts to an ' + account.AccountType + ' account).');
  }
  return account;
}

// Ported from getEligibleApprovedPOsForGRN.
exports.getEligibleApprovedPOsForGRN = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const canAccess = await moduleHasCapability('GRN', 'access', user.profile.role);
  if (!canAccess) throw new HttpsError('permission-denied', 'You do not have access to Goods Receipt.');

  const companyId = String(request.data && request.data.companyId || '').trim();
  const vendorId = String(request.data && request.data.vendorId || '').trim();
  if (!companyId || !vendorId) return [];

  const snap = await rtdb.ref('purchaseOrders').get();
  const data = snap.val() || {};
  return Object.keys(data)
    .map(id => Object.assign({ POID: id }, data[id]))
    .filter(po => po.Status === 'Approved' && po.CompanyID === companyId && po.VendorID === vendorId)
    .map(po => Object.assign({}, po, {
      Lines: (po.Lines || []).map(l => Object.assign({}, l, {
        RemainingQuantity: Math.max(0, Number(l.Quantity || 0) - Number(l.ReceivedQuantity || 0))
      }))
    }));
});

// Ported from saveGrnDraft.
exports.saveGrnDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireDraftAccess('GRN', user.profile.role);

  const grnData = request.data || {};
  const grnId = String(grnData.GRNID || '').trim();
  const transactionDate = String(grnData.TransactionDate || '').trim();
  if (!transactionDate) throw new HttpsError('invalid-argument', 'Transaction date is required.');
  const description = String(grnData.Description || '').trim();
  if (!description) throw new HttpsError('invalid-argument', 'Description is required.');
  const reference = String(grnData.Reference || '').trim();
  const companyId = String(grnData.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company for this transaction.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const divisionId = String(grnData.DivisionID || '').trim();
  const branchId = String(grnData.BranchID || '').trim();
  const costCenterId = String(grnData.CostCenterID || '').trim();
  const profitCenterId = String(grnData.ProfitCenterID || '').trim();

  const vendorId = String(grnData.VendorID || '').trim();
  if (!vendorId) throw new HttpsError('invalid-argument', 'Select a Vendor for this transaction.');
  const vendorSnap = await rtdb.ref('vendors/' + vendorId).get();
  const vendorData = vendorSnap.val();
  if (!vendorData || vendorData.Status !== 'Active') throw new HttpsError('invalid-argument', 'Unknown or inactive Vendor.');

  const [itemsSnap, uomsSnap, orgUnitsSnap] = await Promise.all([
    rtdb.ref('items').get(), rtdb.ref('uoms').get(), rtdb.ref('orgUnits').get()
  ]);
  const itemsData = itemsSnap.val() || {};
  const uomsData = uomsSnap.val() || {};
  const orgUnitsData = orgUnitsSnap.val() || {};

  // Source POs referenced by any line, cached here rather than
  // fetched per-line — a GRN commonly pulls several lines from the
  // same PO.
  const poCache = {};
  async function loadSourcePO(poId) {
    if (!poCache.hasOwnProperty(poId)) {
      const snap = await rtdb.ref('purchaseOrders/' + poId).get();
      poCache[poId] = snap.val();
    }
    return poCache[poId];
  }

  const rawLines = grnData.Lines || [];
  const lines = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const itemId = String(line.ItemID || '').trim();
    if (!itemId) continue; // skip blank trailing row

    const item = itemsData[itemId];
    if (!item) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': item not found.');
    const warehouseId = String(line.WarehouseID || '').trim();
    if (!warehouseId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': warehouse is required.');
    const wh = orgUnitsData[warehouseId];
    if (!wh || wh.Type !== 'Warehouse') throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': warehouse not found.');

    const enteredUomId = String(line.EnteredUOMID || item.UOMID).trim();
    const enteredQty = Number(line.EnteredQuantity);
    if (!(enteredQty > 0)) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': enter a quantity greater than zero.');

    let baseQty;
    if (enteredUomId === item.UOMID) {
      baseQty = enteredQty;
    } else if (enteredUomId === item.AltUOMID) {
      baseQty = enteredQty * (item.ConversionFactor || 0);
      if (!(baseQty > 0)) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': item has no valid alternate UOM conversion factor set.');
    } else {
      throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': selected UOM is not valid for this item.');
    }

    const enteredUom = uomsData[enteredUomId];
    if (enteredUom && !enteredUom.AllowDecimals && Math.abs(enteredQty - Math.round(enteredQty)) > 0.0001) {
      throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': ' + (enteredUom.Code || 'this unit') + ' does not allow decimal quantities.');
    }

    // PO-sourced line: UnitCost is locked to the PO line's own price,
    // server-side, regardless of whatever the client sends. Over-receipt
    // (quantity beyond what's left on the PO line) is deliberately
    // never checked or blocked here — informational only, on the
    // client's own PO line display.
    const sourcePOId = String(line.SourcePOID || '').trim();
    const sourcePOLineId = String(line.SourcePOLineID || '').trim();
    let unitCost;
    if (sourcePOId && sourcePOLineId) {
      const sourcePO = await loadSourcePO(sourcePOId);
      if (!sourcePO || sourcePO.Status !== 'Approved') throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': the referenced Purchase Order is no longer approved and available for receipt.');
      if (sourcePO.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': the referenced Purchase Order belongs to a different Company.');
      if (sourcePO.VendorID !== vendorId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': the referenced Purchase Order belongs to a different Vendor than this GRN — a GRN can only draw from one Vendor\'s Purchase Orders.');
      const sourcePOLine = (sourcePO.Lines || []).find(l => l.LineID === sourcePOLineId);
      if (!sourcePOLine) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': the referenced Purchase Order line was not found.');
      if (sourcePOLine.ItemCode !== item.ItemCode) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': item does not match the referenced Purchase Order line — a PO-sourced line\'s item cannot be changed independently of its source.');
      unitCost = Number(sourcePOLine.UnitPrice) || 0;
    } else {
      unitCost = Number(line.UnitCost);
    }
    if (!(unitCost > 0)) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': enter a unit cost greater than zero.');

    const lineDescription = String(line.Description || '').trim();
    if (!lineDescription) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': description is required.');

    if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
      throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
    }

    lines.push({
      LineNo: lines.length + 1,
      ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
      WarehouseID: warehouseId,
      EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
      Quantity: Math.round(baseQty * 1e6) / 1e6,
      UnitCost: Math.round(unitCost * 10000) / 10000,
      BatchNumber: String(line.BatchNumber || '').trim(),
      ExpiryDate: String(line.ExpiryDate || '').trim(),
      CostCenterID: String(line.CostCenterID || '').trim(),
      ProfitCenterID: String(line.ProfitCenterID || '').trim(),
      Description: lineDescription,
      SourcePOID: sourcePOId, SourcePOLineID: sourcePOLineId
    });
  }

  const [categoriesSnap, coaSnap] = await Promise.all([rtdb.ref('requisitionCategories').get(), rtdb.ref('coa').get()]);
  const categoriesData = categoriesSnap.val() || {};
  const coaData = coaSnap.val() || {};
  const nonStockLines = [];
  const rawNonStock = grnData.NonStockLines || [];
  for (let idx = 0; idx < rawNonStock.length; idx++) {
    const line = rawNonStock[idx];
    const categoryId = String(line.CategoryID || '').trim();
    if (!categoryId) continue; // blank row
    const label = 'Non-stock line ' + (idx + 1);
    const category = categoriesData[categoryId];
    if (!category || category.Status !== 'Active') throw new HttpsError('invalid-argument', label + ': category not found or inactive.');
    if (category.CompanyID && category.CompanyID !== companyId) throw new HttpsError('invalid-argument', label + ': the category belongs to a different Company.');
    const quantity = Number(line.Quantity);
    if (!(quantity > 0)) throw new HttpsError('invalid-argument', label + ': enter a quantity greater than zero.');

    // Same rules as a PO-sourced stock line: approved PO of this company
    // and vendor, the line's own category, and its price.
    const sourcePOId = String(line.SourcePOID || '').trim();
    const sourcePOLineId = String(line.SourcePOLineID || '').trim();
    let unitCost;
    if (sourcePOId && sourcePOLineId) {
      const sourcePO = await loadSourcePO(sourcePOId);
      if (!sourcePO || sourcePO.Status !== 'Approved') throw new HttpsError('invalid-argument', label + ': the referenced Purchase Order is no longer approved and available for receipt.');
      if (sourcePO.CompanyID !== companyId) throw new HttpsError('invalid-argument', label + ': the referenced Purchase Order belongs to a different Company.');
      if (sourcePO.VendorID !== vendorId) throw new HttpsError('invalid-argument', label + ': the referenced Purchase Order belongs to a different Vendor than this GRN — a GRN can only draw from one Vendor\'s Purchase Orders.');
      const sourcePOLine = (sourcePO.Lines || []).find(l => l.LineID === sourcePOLineId);
      if (!sourcePOLine) throw new HttpsError('invalid-argument', label + ': the referenced Purchase Order line was not found.');
      if (sourcePOLine.CategoryID !== categoryId) throw new HttpsError('invalid-argument', label + ': category does not match the referenced Purchase Order line.');
      unitCost = Number(sourcePOLine.UnitPrice) || 0;
    } else {
      unitCost = Number(line.UnitCost);
    }
    if (!(unitCost > 0)) throw new HttpsError('invalid-argument', label + ': enter a unit cost greater than zero.');
    const lineDescription = String(line.Description || '').trim();
    if (!lineDescription) throw new HttpsError('invalid-argument', label + ': description is required.');
    const lineCostCenter = String(line.CostCenterID || '').trim() || costCenterId;
    resolveCategoryAccount(category, coaData, companyId, lineCostCenter, label);

    nonStockLines.push({
      LineNo: nonStockLines.length + 1,
      CategoryID: categoryId, CategoryName: category.Name || '', CategoryType: category.Type || '',
      Description: lineDescription,
      Quantity: Math.round(quantity * 1e6) / 1e6,
      UnitCost: Math.round(unitCost * 10000) / 10000,
      CostCenterID: lineCostCenter,
      ProfitCenterID: String(line.ProfitCenterID || '').trim() || profitCenterId,
      SourcePOID: sourcePOId, SourcePOLineID: sourcePOLineId
    });
  }

  if (!lines.length && !nonStockLines.length) throw new HttpsError('invalid-argument', 'Enter at least one line.');

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;

  const fields = {
    TransactionType: 'GRN',
    TransactionDate: transactionDate, Description: description, Reference: reference,
    CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
    CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
    VendorID: vendorId, Lines: lines, NonStockLines: nonStockLines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
  };

  if (grnId) {
    const existingSnap = await rtdb.ref('stock/transactions/' + grnId).get();
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'GRN not found.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected GRNs can be edited.');
    await rtdb.ref('stock/transactions/' + grnId).update(fields);
    return { success: true, grnId: grnId };
  }

  const newId = 'GRND-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref('stock/transactions/' + newId).set(Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }));
  return { success: true, grnId: newId };
});

// Ported from postGrn.
exports.postGrn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const grnId = String(request.data && request.data.grnId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await rtdb.ref('stock/transactions/' + grnId).get();
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'GRN not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess('GRN', user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected GRNs can be posted.');
    if (!(existing.Lines || []).length && !(existing.NonStockLines || []).length) throw new HttpsError('failed-precondition', 'This GRN has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount is quantity × unit cost, both user-entered on
    // the GRN's own lines, summed directly — not via
    // computeStockMovement, which also reads the live stock ledger and
    // validates scenarios this always-inbound module never uses. Keeps
    // checking the gate completely free of side effects.
    const previewAmount = grnAmount(existing);

    const scopeKey = await resolveApprovalScopeKeyForDocument('GRN', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance('GRN', grnId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      await rtdb.ref('stock/transactions/' + grnId).update({
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      });
      return { success: true, status: 'PendingApproval' };
    }

    const result = await commitGrnPosting(user, existing, grnId);
    return { success: true, grnId: grnId, grnNumber: result.grnNumber, status: 'Posted' };
  });
});

// Ported from commitGrnPosting_.
async function commitGrnPosting(user, existing, grnId) {
  const itemsSnap = await rtdb.ref('items').get();
  const itemsData = itemsSnap.val() || {};
  const coaSnap = await rtdb.ref('coa').get();
  const coaData = coaSnap.val() || {};

  const clearingAccountId = await resolveGrnClearingAccount(existing.CompanyID);
  const offsetAccount = coaData[clearingAccountId];
  if (!offsetAccount || !offsetAccount.IsPostable) throw new Error('This company\'s configured GRN Clearing Account is no longer valid — check it in Company Master Data.');

  // Every GRN line is inbound.
  const movementLines = (existing.Lines || []).map(l => Object.assign({ Direction: 'In' }, l));
  // A non-stock-only GRN has no stock movement (computeStockMovement refuses an empty list).
  const movement = movementLines.length ? await computeStockMovement(itemsData, coaData, movementLines) : { ledgerUpdates: {}, inventoryGlLines: [] };

  // Non-stock: Dr the category's account, as it is now (re-checked here,
  // since the category may have changed since the GRN was saved).
  const categoriesData = (await rtdb.ref('requisitionCategories').get()).val() || {};
  const nonStockLines = (existing.NonStockLines || []).map((l, idx) => {
    const category = categoriesData[l.CategoryID];
    if (!category) throw new Error('Non-stock line ' + (idx + 1) + ': category not found.');
    const account = resolveCategoryAccount(category, coaData, existing.CompanyID, l.CostCenterID, 'Non-stock line ' + (idx + 1));
    return Object.assign({}, l, { AccountID: category.GLAccountID, AccountCode: account.AccountCode });
  });
  const nonStockGlLines = nonStockLines.map(l => ({
    AccountCode: l.AccountCode, Debit: round2(lineValue(l)), Credit: 0,
    Description: l.Description, CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
  }));

  const totalValue = movement.inventoryGlLines.reduce((sum, l) => sum + l.Debit, 0) + nonStockGlLines.reduce((sum, l) => sum + l.Debit, 0);
  const offsetLine = {
    AccountCode: offsetAccount.AccountCode, Debit: 0, Credit: Math.round(totalValue * 100) / 100,
    Description: existing.Description, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
  };

  const actor = user.profile.username || user.uid;
  const attemptId = await beginCommitAttempt(grnId, actor);

  let glResult;
  try {
    glResult = await writeStockGlEntry(user, 'GRN', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(nonStockGlLines, [offsetLine]),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: grnId });
  } catch (err) {
    await abandonCommitAttempt(grnId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  await finalizeCommitAttempt(grnId, glResult, { Lines: movementLines, NonStockLines: nonStockLines }, actor);

  // PO received-quantity progress only ever updates once the
  // transaction is genuinely, finally committed. Direct (non-PO)
  // lines simply contribute nothing.
  for (const l of movementLines.concat(nonStockLines)) {
    if (l.SourcePOID && l.SourcePOLineID) {
      await updatePOLineReceivedQuantity(l.SourcePOID, l.SourcePOLineID, l.Quantity);
    }
  }

  return { grnNumber: glResult.jvNumber };
}

// Ported from decideGrnApproval.
exports.decideGrnApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePostAccess('GRN', user.profile.role);
  const data = request.data || {};
  const grnId = String(data.grnId || '').trim();
  const levelNumber = data.levelNumber;
  const decision = data.decision;
  const reason = data.reason;

  const existingSnap = await rtdb.ref('stock/transactions/' + grnId).get();
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'GRN not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (existing.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This GRN is not awaiting approval.');
  if (!existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this GRN.');

  const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, levelNumber, decision, reason);

  if (result.status === 'Approved') {
    await withGlobalLock(user.uid, async () => {
      await commitGrnPosting(user, existing, grnId);
    });
  } else if (result.status === 'Rejected') {
    const now = new Date().toISOString();
    await rtdb.ref('stock/transactions/' + grnId).update({
      Status: 'Rejected', RejectionReason: String(reason || '').trim(),
      UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
    });
  }
  return { success: true, status: result.status, selfApproved: result.selfApproved };
});

// Ported from deleteGrnDraft.
exports.deleteGrnDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const grnId = String(request.data && request.data.grnId || '').trim();
  const existingSnap = await rtdb.ref('stock/transactions/' + grnId).get();
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'GRN not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireDraftAccess('GRN', user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft GRNs can be deleted. Posted GRNs must be reversed instead.');
  await rtdb.ref('stock/transactions/' + grnId).set(null);
  return { success: true };
});

// Invoicing state of a posted GRN for its list (owner, 2026-09-28):
// Invoiced (a posted Vendor Invoice matched it: MatchedToInvoiceID), On
// draft invoice (an unposted invoice lists it), or Pending. Nothing for
// drafts, reversed GRNs and reversal entries.
const UNPOSTED_INVOICE = ['Draft', 'PendingApproval', 'Rejected'];
function invoiceStateOf(grn, invoices) {
  if (grn.Status !== 'Posted' || grn.ReversedByGRN || grn.ReversalOfGRN) return { InvoiceStatus: '' };
  if (grn.MatchedToInvoiceID) {
    const inv = invoices[grn.MatchedToInvoiceID] || {};
    return { InvoiceStatus: 'Invoiced', InvoiceID: grn.MatchedToInvoiceID, InvoiceNumber: inv.TransactionNumber || '' };
  }
  const draftId = Object.keys(invoices).find(id => UNPOSTED_INVOICE.includes(invoices[id].Status) &&
    (invoices[id].SourceGRNs || []).some(g => g.GRNID === grn.GRNID));
  if (draftId) return { InvoiceStatus: 'OnDraftInvoice', InvoiceID: draftId, InvoiceNumber: invoices[draftId].TransactionNumber || '', InvoiceDocStatus: invoices[draftId].Status };
  return { InvoiceStatus: 'Pending' };
}

// Ported from getGrnEntries.
exports.getGrnEntries = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const canAccess = await moduleHasCapability('GRN', 'access', user.profile.role);
  if (!canAccess) throw new HttpsError('permission-denied', 'You do not have access to Goods Receipt.');

  const dataSnap = await rtdb.ref('stock/transactions').get();
  const data = dataSnap.val() || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ GRNID: id }, data[id]))
    .filter(e => e.TransactionType === 'GRN')
    .filter(e => userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const limit = request.data && request.data.limit;
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  const invoices = (await rtdb.ref('vendorInvoices').get()).val() || {};
  capped.forEach(e => Object.assign(e, invoiceStateOf(e, invoices)));
  return { entries: capped, total: all.length };
});

// Ported from reverseGrn. computeStockMovement's own negative-stock
// guard naturally protects this: if received stock has already been
// consumed elsewhere by the time someone reverses the receipt, the
// reversal is rejected rather than silently pushing a ledger negative
// — no special-case logic needed, it falls out of the same validation
// every outbound line already gets.
exports.reverseGrn = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const grnId = String(data.grnId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await rtdb.ref('stock/transactions/' + grnId).get();
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'GRN not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess('GRN', user.profile.role);
    if (existing.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only posted GRNs can be reversed.');
    if (existing.ReversedByGRN) throw new HttpsError('failed-precondition', 'This GRN has already been reversed.');
    // PORT FIX (not in Code.gs): a reversal entry is itself a Posted GRN and
    // forcing its lines Out would remove the received stock a second time,
    // same shape as docs/MIGRATION.md deviations #5/#6.
    if (existing.ReversalOfGRN) throw new HttpsError('failed-precondition', 'A reversal entry cannot itself be reversed.');
    // PORT FIX (not in Code.gs): reversing an invoiced GRN left the Vendor
    // Invoice's payable standing against goods that were sent back. Same
    // guard (and wording) as reverseDeliveryNote's Customer Invoice check.
    if (existing.MatchedToInvoiceID) throw new HttpsError('failed-precondition', 'This GRN has already been matched to a Vendor Invoice and cannot be reversed. Reverse the invoice first.');

    const date = String(data.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsSnap = await rtdb.ref('items').get();
    const itemsData = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaData = coaSnap.val() || {};

    // Re-resolves the company's CURRENT clearing account rather than
    // trusting anything stored on the original GRN.
    const clearingAccountId = await resolveGrnClearingAccount(existing.CompanyID);
    const offsetAccount = coaData[clearingAccountId];
    if (!offsetAccount || !offsetAccount.IsPostable) throw new Error('This company\'s configured GRN Clearing Account is no longer valid — check it in Company Master Data.');

    const movementLines = (existing.Lines || []).map(l => Object.assign({}, l, { Direction: 'Out' }));
    const movement = movementLines.length ? await computeStockMovement(itemsData, coaData, movementLines) : { ledgerUpdates: {}, inventoryGlLines: [] };
    // Non-stock: Cr the same account the GRN debited.
    const nonStockLines = existing.NonStockLines || [];
    const nonStockGlLines = nonStockLines.map(l => ({
      AccountCode: l.AccountCode, Debit: 0, Credit: round2(lineValue(l)),
      Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + l.Description, CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    }));

    const totalValue = movement.inventoryGlLines.reduce((sum, l) => sum + l.Credit, 0) + nonStockGlLines.reduce((sum, l) => sum + l.Credit, 0);
    const offsetLine = {
      AccountCode: offsetAccount.AccountCode, Debit: Math.round(totalValue * 100) / 100, Credit: 0,
      Description: 'Reversal of ' + existing.TransactionNumber, CostCenterID: existing.CostCenterID || '', ProfitCenterID: existing.ProfitCenterID || ''
    };

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'GRND-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();

    await rtdb.ref('stock/transactions/' + newId).set({
      TransactionType: 'GRN', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines, NonStockLines: nonStockLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfGRN: grnId, ReversedByGRN: '', VendorID: existing.VendorID || ''
    });

    let glResult;
    try {
      glResult = await writeStockGlEntry(user, 'GRN', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(nonStockGlLines, [offsetLine]),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      await rtdb.ref('stock/transactions/' + newId).set(null);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    // Deliberately patches the ORIGINAL record before finalizing the
    // new reversal to Posted, not after — guarantees a second
    // reversal can never be triggered even if something fails between
    // these two writes.
    await rtdb.ref('stock/transactions/' + grnId).update({ ReversedByGRN: newId });
    await finalizeCommitAttempt(newId, glResult, { Lines: movementLines, NonStockLines: nonStockLines }, actor);

    // Roll back exactly this GRN's own contribution to each PO line it
    // touched.
    for (const l of movementLines.concat(nonStockLines)) {
      if (l.SourcePOID && l.SourcePOLineID) {
        await rollbackPOLineReceivedQuantity(l.SourcePOID, l.SourcePOLineID, l.Quantity);
      }
    }

    return { success: true, grnId: newId, grnNumber: glResult.jvNumber };
  });
});
