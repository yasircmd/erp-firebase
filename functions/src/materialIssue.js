const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const stockStore = require('./stockStore');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry } = require('./glWriting');
const { getStockLedgerEntry, computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
const { pageOf } = require('./listPaging');
// Gmail-style list paging (owner, 2026-10-02; docs/modules/LIST_PAGING.md).
const LIST_SPEC = { idField: 'MIID', idAlso: ['LinkedJVID'], dateField: 'TransactionDate', equals: ['CompanyID', 'Status'], text: e => `${e.TransactionNumber} ${e.Description}` };

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

// Ported from saveMaterialIssueDraft.
exports.saveMaterialIssueDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireDraftAccess('MATERIALISSUE', user.profile.role);

  const miData = request.data || {};
  const miId = String(miData.MIID || '').trim();
  const transactionDate = String(miData.TransactionDate || '').trim();
  if (!transactionDate) throw new HttpsError('invalid-argument', 'Transaction date is required.');
  const description = String(miData.Description || '').trim();
  if (!description) throw new HttpsError('invalid-argument', 'Description is required.');
  const reference = String(miData.Reference || '').trim();
  // Defaults to 'Issue' since that's ~99% of real usage — Return is
  // always an explicit, manual choice, never inferred.
  const entryType = String(miData.EntryType || 'Issue').trim();
  if (entryType !== 'Issue' && entryType !== 'Return') throw new HttpsError('invalid-argument', 'Select Issue or Return.');
  const companyId = String(miData.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company for this transaction.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const divisionId = String(miData.DivisionID || '').trim();
  const branchId = String(miData.BranchID || '').trim();
  const costCenterId = String(miData.CostCenterID || '').trim();
  const profitCenterId = String(miData.ProfitCenterID || '').trim();

  const [itemsSnap, uomsSnap, orgUnitsSnap] = await Promise.all([
    rtdb.ref('items').get(), rtdb.ref('uoms').get(), rtdb.ref('orgUnits').get()
  ]);
  const itemsData = itemsSnap.val() || {};
  const uomsData = uomsSnap.val() || {};
  const orgUnitsData = orgUnitsSnap.val() || {};

  const rawLines = miData.Lines || [];
  const lines = [];
  rawLines.forEach((line, idx) => {
    const itemId = String(line.ItemID || '').trim();
    if (!itemId) return; // skip blank trailing row

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

    const lineDescription = String(line.Description || '').trim();
    if (!lineDescription) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': description is required.');

    lines.push({
      LineNo: lines.length + 1,
      ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
      WarehouseID: warehouseId,
      EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
      Quantity: Math.round(baseQty * 1e6) / 1e6,
      BatchNumber: String(line.BatchNumber || '').trim(), // reference only, not required even for batch-tracked items — matches original
      CostCenterID: String(line.CostCenterID || '').trim(),
      ProfitCenterID: String(line.ProfitCenterID || '').trim(),
      Description: lineDescription
    });
  });

  if (!lines.length) throw new HttpsError('invalid-argument', 'Enter at least one line.');

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;

  const fields = {
    TransactionType: 'MaterialIssue', EntryType: entryType,
    TransactionDate: transactionDate, Description: description, Reference: reference,
    CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
    CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
    Lines: lines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
  };

  if (miId) {
    const existingSnap = await stockStore.snapTx(miId);
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Material Issue not found.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected Material Issues can be edited.');
    await stockStore.updateTx(miId, fields);
    return { success: true, miId: miId };
  }

  const newId = 'MID-' + randomUUID().split('-')[0].toUpperCase();
  await stockStore.setTx(newId, Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }));
  return { success: true, miId: newId };
});

// Ported from postMaterialIssue.
exports.postMaterialIssue = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const miId = String(request.data && request.data.miId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await stockStore.snapTx(miId);
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Material Issue not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess('MATERIALISSUE', user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected Material Issues can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new HttpsError('failed-precondition', 'This Material Issue has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // Approval amount preview — faithfully ported INCLUDING a quirk
    // present in the original: this always previews as Direction:
    // 'Out', even when EntryType is 'Return'. Numerically this comes
    // out identical either way (both 'Out' and a Return's own 'In'
    // cost at the item's current WAC), but the insufficient-stock
    // guard computeStockMovement's own 'Out' branch applies would
    // incorrectly also apply to a Return's preview — which should
    // never be stock-constrained, since a Return adds stock rather
    // than removing it. Noted here rather than silently corrected:
    // this is a pre-existing behavior from the original Code.gs, not
    // something introduced by this port, and changing it silently
    // during a migration is its own risk.
    const itemsSnap = await rtdb.ref('items').get();
    const itemsDataPreview = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaDataPreview = coaSnap.val() || {};
    const previewLines = existing.Lines.map(l => Object.assign({ Direction: 'Out' }, l));
    await computeStockMovement(itemsDataPreview, coaDataPreview, previewLines);
    const previewAmount = previewLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = await resolveApprovalScopeKeyForDocument('MATERIALISSUE', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance('MATERIALISSUE', miId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      await stockStore.updateTx(miId, {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      });
      return { success: true, status: 'PendingApproval' };
    }

    const result = await commitMaterialIssuePosting(user, existing, miId);
    return { success: true, miId: miId, miNumber: result.miNumber, status: 'Posted' };
  });
});

// Ported from commitMaterialIssuePosting_. Recomputes movement fresh
// against whatever the ledger's WAC actually is AT THIS MOMENT —
// deliberately not reusing postMaterialIssue's own earlier preview.
async function commitMaterialIssuePosting(user, existing, miId) {
  const itemsSnap = await rtdb.ref('items').get();
  const itemsData = itemsSnap.val() || {};
  const coaSnap = await rtdb.ref('coa').get();
  const coaData = coaSnap.val() || {};
  const isReturn = existing.EntryType === 'Return';

  const movementLines = [];
  for (const l of existing.Lines) {
    const line = Object.assign({ Direction: isReturn ? 'In' : 'Out' }, l);
    if (isReturn) {
      const ledger = await getStockLedgerEntry(l.ItemID, l.WarehouseID);
      if (!(ledger.AvgCost > 0)) {
        throw new Error('Line for ' + l.ItemCode + ': cannot post a return — this item has zero current stock, so there is no existing cost to inherit. Use GRN or Production Entry to establish an initial cost basis first.');
      }
      line.UnitCost = ledger.AvgCost;
    }
    movementLines.push(line);
  }
  const movement = await computeStockMovement(itemsData, coaData, movementLines);

  const consumptionGlLines = movementLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = item.ConsumptionAccountID;
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Consumption account for ' + item.ItemCode + ' is not valid — check Item Master.');
    return {
      AccountCode: account.AccountCode,
      Debit: isReturn ? 0 : l.TotalValue, Credit: isReturn ? l.TotalValue : 0,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const actor = user.profile.username || user.uid;
  const attemptId = await beginCommitAttempt(miId, actor);

  let glResult;
  try {
    glResult = await writeStockGlEntry(user, 'MaterialIssue', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(consumptionGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: miId });
  } catch (err) {
    await abandonCommitAttempt(miId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  await finalizeCommitAttempt(miId, glResult, { Lines: movementLines }, actor);

  return { miNumber: glResult.jvNumber };
}

// Ported from decideMaterialIssueApproval.
exports.decideMaterialIssueApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePostAccess('MATERIALISSUE', user.profile.role);
  const data = request.data || {};
  const miId = String(data.miId || '').trim();
  const levelNumber = data.levelNumber;
  const decision = data.decision;
  const reason = data.reason;

  const existingSnap = await stockStore.snapTx(miId);
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'Material Issue not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (existing.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This Material Issue is not awaiting approval.');
  if (!existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this Material Issue.');

  const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, levelNumber, decision, reason);

  if (result.status === 'Approved') {
    await withGlobalLock(user.uid, async () => {
      await commitMaterialIssuePosting(user, existing, miId);
    });
  } else if (result.status === 'Rejected') {
    const now = new Date().toISOString();
    await stockStore.updateTx(miId, {
      Status: 'Rejected', RejectionReason: String(reason || '').trim(),
      UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
    });
  }
  return { success: true, status: result.status, selfApproved: result.selfApproved };
});

// Ported from deleteMaterialIssueDraft.
exports.deleteMaterialIssueDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const miId = String(request.data && request.data.miId || '').trim();
  const existingSnap = await stockStore.snapTx(miId);
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'Material Issue not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireDraftAccess('MATERIALISSUE', user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft Material Issues can be deleted. Posted ones must be reversed instead.');
  await stockStore.deleteTx(miId);
  return { success: true };
});

// Ported from getMaterialIssueEntries.
exports.getMaterialIssueEntries = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const canAccess = await moduleHasCapability('MATERIALISSUE', 'access', user.profile.role);
  if (!canAccess) throw new HttpsError('permission-denied', 'You do not have access to Material Issue.');

  // Only this type's documents (stockStore.js), not every stock transaction.
  const data = await stockStore.queryTx({ TransactionType: 'MaterialIssue' });
  const all = Object.keys(data)
    .map(id => Object.assign({ MIID: id }, data[id]))
    .filter(e => e.TransactionType === 'MaterialIssue')
    .filter(e => userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  // Gmail-style paging and server-side search (docs/modules/LIST_PAGING.md).
  if (request.data && request.data.page) return pageOf(all, request.data.page, LIST_SPEC);

  const limit = request.data && request.data.limit;
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
});

// Ported from reverseMaterialIssue. Flips whichever direction each
// line actually was — Issue (Out) reverses to In at the ORIGINAL
// line's own UnitCost; Return (In) reverses to Out at CURRENT WAC
// (computeStockMovement's own 'Out' logic always resolves current
// WAC, with no override mechanism anywhere in this codebase, for any
// module — consistent with every other Out movement, not a special
// case for this one).
exports.reverseMaterialIssue = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const miId = String(data.miId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await stockStore.snapTx(miId);
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Material Issue not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess('MATERIALISSUE', user.profile.role);
    if (existing.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only posted Material Issues can be reversed.');
    if (existing.ReversedByMI) throw new HttpsError('failed-precondition', 'This Material Issue has already been reversed.');

    const date = String(data.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsSnap = await rtdb.ref('items').get();
    const itemsData = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaData = coaSnap.val() || {};

    const movementLines = existing.Lines.map(l => {
      const reversedDirection = l.Direction === 'In' ? 'Out' : 'In';
      const line = Object.assign({}, l, { Direction: reversedDirection });
      if (reversedDirection === 'In') line.UnitCost = l.UnitCost;
      else delete line.UnitCost;
      return line;
    });
    const movement = await computeStockMovement(itemsData, coaData, movementLines);

    const consumptionGlLines = movementLines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = item.ConsumptionAccountID;
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error('Consumption account for ' + item.ItemCode + ' is not valid — check Item Master.');
      const isReversalOfReturn = l.Direction === 'Out';
      return {
        AccountCode: account.AccountCode,
        Debit: isReversalOfReturn ? l.TotalValue : 0, Credit: isReversalOfReturn ? 0 : l.TotalValue,
        Description: 'Reversal of ' + existing.TransactionNumber,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'MID-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();

    await stockStore.setTx(newId, {
      TransactionType: 'MaterialIssue', EntryType: existing.EntryType === 'Return' ? 'Issue' : 'Return',
      Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfMI: miId, ReversedByMI: ''
    });

    let glResult;
    try {
      glResult = await writeStockGlEntry(user, 'MaterialIssue', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(consumptionGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      await stockStore.deleteTx(newId);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await stockStore.updateTx(miId, { ReversedByMI: newId });
    await finalizeCommitAttempt(newId, glResult, { Lines: movementLines }, actor);

    return { success: true, miId: newId, miNumber: glResult.jvNumber };
  });
});
