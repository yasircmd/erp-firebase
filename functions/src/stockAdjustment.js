const { randomUUID } = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry } = require('./glWriting');
const { getStockLedgerEntry, computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { beginCommitAttempt, abandonCommitAttempt, finalizeCommitAttempt } = require('./commitAttempt');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { allocateAvailableStockToShortfalls } = require('./reservations');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
const MOVABLE_ORG_UNIT_TYPES = ['Warehouse', 'Rack'];

async function requireDraftAccess(moduleHasCapability, moduleId, role) {
  const can = await moduleHasCapability(moduleId, 'draft', role);
  if (!can) throw new Error('You do not have permission to create or edit entries in ' + moduleId + '.');
}
async function requirePostAccess(moduleHasCapability, moduleId, role) {
  const can = await moduleHasCapability(moduleId, 'post', role);
  if (!can) throw new Error('You do not have permission to post or reverse entries in ' + moduleId + '.');
}

// Ported from saveStockAdjustmentDraft.
exports.saveStockAdjustmentDraft = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireDraftAccess(moduleHasCapability, 'STOCKADJUSTMENT', user.profile.role);

  const adjData = request.data || {};
  const adjId = String(adjData.AdjustmentID || '').trim();
  const transactionDate = String(adjData.TransactionDate || '').trim();
  if (!transactionDate) throw new HttpsError('invalid-argument', 'Transaction date is required.');
  const description = String(adjData.Description || '').trim();
  if (!description) throw new HttpsError('invalid-argument', 'Description is required.');
  const reference = String(adjData.Reference || '').trim();
  const companyId = String(adjData.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company for this transaction.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const divisionId = String(adjData.DivisionID || '').trim();
  const branchId = String(adjData.BranchID || '').trim();
  const costCenterId = String(adjData.CostCenterID || '').trim();
  const profitCenterId = String(adjData.ProfitCenterID || '').trim();

  const [itemsSnap, uomsSnap, orgUnitsSnap] = await Promise.all([
    rtdb.ref('items').get(), rtdb.ref('uoms').get(), rtdb.ref('orgUnits').get()
  ]);
  const itemsData = itemsSnap.val() || {};
  const uomsData = uomsSnap.val() || {};
  const orgUnitsData = orgUnitsSnap.val() || {};

  const rawLines = adjData.Lines || [];
  const lines = [];
  rawLines.forEach((line, idx) => {
    const itemId = String(line.ItemID || '').trim();
    if (!itemId) return; // skip blank trailing row

    const item = itemsData[itemId];
    if (!item) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': item not found.');
    const warehouseId = String(line.WarehouseID || '').trim();
    if (!warehouseId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': warehouse is required.');
    const wh = orgUnitsData[warehouseId];
    if (!wh || MOVABLE_ORG_UNIT_TYPES.indexOf(wh.Type) === -1) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': warehouse not found.');

    const direction = String(line.AdjustmentDirection || '').trim();
    if (direction !== 'Increase' && direction !== 'Decrease') throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': select Increase or Decrease.');

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

    if (item.BatchTracked && !String(line.BatchNumber || '').trim()) {
      throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': batch number is required for ' + item.ItemCode + '.');
    }

    lines.push({
      LineNo: lines.length + 1,
      ItemID: itemId, ItemCode: item.ItemCode, ItemName: item.ItemName,
      WarehouseID: warehouseId, AdjustmentDirection: direction,
      EnteredUOMID: enteredUomId, EnteredQuantity: enteredQty,
      Quantity: Math.round(baseQty * 1e6) / 1e6,
      BatchNumber: String(line.BatchNumber || '').trim(),
      CostCenterID: String(line.CostCenterID || '').trim(),
      ProfitCenterID: String(line.ProfitCenterID || '').trim(),
      Description: lineDescription
    });
  });

  if (!lines.length) throw new HttpsError('invalid-argument', 'Enter at least one line.');

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;

  const fields = {
    TransactionType: 'StockAdjustment',
    TransactionDate: transactionDate, Description: description, Reference: reference,
    CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
    CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
    Lines: lines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
  };

  if (adjId) {
    const existingSnap = await rtdb.ref('stock/transactions/' + adjId).get();
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Stock Adjustment not found.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected Stock Adjustments can be edited.');
    await rtdb.ref('stock/transactions/' + adjId).update(fields);
    return { adjId: adjId };
  }

  const newId = 'ADJD-' + randomUUID().split('-')[0].toUpperCase();
  await rtdb.ref('stock/transactions/' + newId).set(Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }));
  return { adjId: newId };
});

// Ported from buildStockAdjustmentMovementLines_.
async function buildStockAdjustmentMovementLines(existingLines) {
  const result = [];
  for (let idx = 0; idx < existingLines.length; idx++) {
    const l = existingLines[idx];
    const direction = l.AdjustmentDirection === 'Increase' ? 'In' : 'Out';
    const line = Object.assign({ Direction: direction }, l);
    if (direction === 'In') {
      const ledger = await getStockLedgerEntry(l.ItemID, l.WarehouseID);
      if (!(ledger.AvgCost > 0)) {
        throw new Error('Line ' + (idx + 1) + ' (' + l.ItemCode + '): cannot post an increase — this item has zero current stock, so there is no existing cost to inherit. Use GRN or Production Entry to establish an initial cost basis first.');
      }
      line.UnitCost = ledger.AvgCost;
    }
    result.push(line);
  }
  return result;
}

// Ported from commitStockAdjustmentPosting_ — the core commit, now
// running inside withGlobalLock (see lock.js) rather than between a
// manual LockService.getScriptLock()/releaseLock() pair, and writing
// its ledger updates in one atomic multi-path call (see
// stockMovement.js's own comment on that specific improvement) rather
// than one separate call per key. Everything else — the commit-attempt
// marker sequence, the GL line construction, the ordering guarantees —
// is unchanged.
async function commitStockAdjustmentPosting(user, existing, adjId) {
  const itemsSnap = await rtdb.ref('items').get();
  const itemsData = itemsSnap.val() || {};
  const coaSnap = await rtdb.ref('coa').get();
  const coaData = coaSnap.val() || {};

  const movementLines = await buildStockAdjustmentMovementLines(existing.Lines);
  const movement = await computeStockMovement(itemsData, coaData, movementLines);

  const offsetGlLines = movementLines.map(l => {
    const item = itemsData[l.ItemID];
    const accountId = item.WriteOffAccountID || item.ConsumptionAccountID;
    const account = coaData[accountId];
    if (!account || !account.IsPostable) throw new Error('Write-off account for ' + item.ItemCode + ' is not valid — check Item Master.');
    const isDecrease = l.Direction === 'Out';
    return {
      AccountCode: account.AccountCode,
      Debit: isDecrease ? l.TotalValue : 0, Credit: isDecrease ? 0 : l.TotalValue,
      Description: l.Description || existing.Description,
      CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
    };
  });

  const actor = user.profile.username || user.uid;
  const attemptId = await beginCommitAttempt(adjId, actor);

  let glResult;
  try {
    glResult = await writeStockGlEntry(user, 'StockAdjustment', existing.TransactionDate, existing.Description, existing.Reference,
      movement.inventoryGlLines.concat(offsetGlLines),
      { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
      { CommitAttemptID: attemptId, SourceTransactionID: adjId });
  } catch (err) {
    await abandonCommitAttempt(adjId, existing.Status, actor);
    throw err;
  }

  // A GL entry genuinely exists from here on — no more reverting.
  await commitStockLedgerUpdates(movement.ledgerUpdates);
  await finalizeCommitAttempt(adjId, glResult, { Lines: movementLines }, actor);

  // Sales Order allocation only ever runs once the transaction is
  // genuinely, finally committed — same reasoning as the original: if
  // the GL or ledger write failed above, execution never reaches here
  // at all. Previously disclosed as NOT ported in this file — now
  // closed (see reservations.js).
  for (const l of movementLines) {
    if (l.Direction === 'In') {
      await allocateAvailableStockToShortfalls(actor, l.ItemID, l.ItemCode, l.WarehouseID, existing.CompanyID, Number(l.Quantity) || 0, glResult.jvNumber);
    }
  }

  return { adjNumber: glResult.jvNumber };
}

// Ported from postStockAdjustment.
exports.postStockAdjustment = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const adjId = String(request.data && request.data.adjId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await rtdb.ref('stock/transactions/' + adjId).get();
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Stock Adjustment not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess(moduleHasCapability, 'STOCKADJUSTMENT', user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected Stock Adjustments can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new HttpsError('failed-precondition', 'This Stock Adjustment has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const itemsSnap = await rtdb.ref('items').get();
    const itemsDataPreview = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaDataPreview = coaSnap.val() || {};
    const previewMovementLines = await buildStockAdjustmentMovementLines(existing.Lines);
    await computeStockMovement(itemsDataPreview, coaDataPreview, previewMovementLines.map(l => Object.assign({}, l)));
    const previewAmount = previewMovementLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = await resolveApprovalScopeKeyForDocument('STOCKADJUSTMENT', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance('STOCKADJUSTMENT', adjId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      await rtdb.ref('stock/transactions/' + adjId).update({
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      });
      return { status: 'PendingApproval' };
    }

    const result = await commitStockAdjustmentPosting(user, existing, adjId);
    return { adjId: adjId, adjNumber: result.adjNumber, status: 'Posted' };
  });
});

// Ported from decideStockAdjustmentApproval.
exports.decideStockAdjustmentApproval = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePostAccess(moduleHasCapability, 'STOCKADJUSTMENT', user.profile.role);
  const data = request.data || {};
  const adjId = String(data.adjId || '').trim();
  const levelNumber = data.levelNumber;
  const decision = data.decision;
  const reason = data.reason;

  const existingSnap = await rtdb.ref('stock/transactions/' + adjId).get();
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'Stock Adjustment not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (existing.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This Stock Adjustment is not awaiting approval.');
  if (!existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this Stock Adjustment.');

  const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, levelNumber, decision, reason);

  if (result.status === 'Approved') {
    await withGlobalLock(user.uid, async () => {
      await commitStockAdjustmentPosting(user, existing, adjId);
    });
  } else if (result.status === 'Rejected') {
    const now = new Date().toISOString();
    await rtdb.ref('stock/transactions/' + adjId).update({
      Status: 'Rejected', RejectionReason: String(reason || '').trim(),
      UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
    });
  }
  return { status: result.status, selfApproved: result.selfApproved };
});

// Ported from deleteStockAdjustmentDraft.
exports.deleteStockAdjustmentDraft = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const adjId = String(request.data && request.data.adjId || '').trim();
  const existingSnap = await rtdb.ref('stock/transactions/' + adjId).get();
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'Stock Adjustment not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireDraftAccess(moduleHasCapability, 'STOCKADJUSTMENT', user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft Stock Adjustments can be deleted. Posted ones must be reversed instead.');
  await rtdb.ref('stock/transactions/' + adjId).set(null);
  return { success: true };
});

// Ported from getStockAdjustmentEntries.
exports.getStockAdjustmentEntries = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const canAccess = await moduleHasCapability('STOCKADJUSTMENT', 'access', user.profile.role);
  if (!canAccess) throw new HttpsError('permission-denied', 'You do not have access to Stock Adjustment.');

  const dataSnap = await rtdb.ref('stock/transactions').get();
  const data = dataSnap.val() || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ AdjustmentID: id }, data[id]))
    .filter(e => e.TransactionType === 'StockAdjustment')
    .filter(e => userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  const limit = request.data && request.data.limit;
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
});

// Ported from reverseStockAdjustment.
exports.reverseStockAdjustment = onCall(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const adjId = String(data.adjId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await rtdb.ref('stock/transactions/' + adjId).get();
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Stock Adjustment not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess(moduleHasCapability, 'STOCKADJUSTMENT', user.profile.role);
    if (existing.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only posted Stock Adjustments can be reversed.');
    if (existing.ReversedByAdjustment) throw new HttpsError('failed-precondition', 'This Stock Adjustment has already been reversed.');

    const date = String(data.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsSnap = await rtdb.ref('items').get();
    const itemsData = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaData = coaSnap.val() || {};

    const swappedLines = existing.Lines.map(l => Object.assign({}, l, {
      AdjustmentDirection: l.AdjustmentDirection === 'Increase' ? 'Decrease' : 'Increase'
    }));

    const movementLines = [];
    for (let idx = 0; idx < swappedLines.length; idx++) {
      const l = swappedLines[idx];
      const direction = l.AdjustmentDirection === 'Increase' ? 'In' : 'Out';
      // Same ordering note as the original: Object.assign here must
      // put the freshly-computed direction LAST, overriding l's own
      // stale, already-committed Direction field from the original
      // commit — merging it first would silently reapply the ORIGINAL
      // direction instead of the flipped one this reversal needs.
      const line = Object.assign({}, l, { Direction: direction });
      if (direction === 'In') {
        const ledger = await getStockLedgerEntry(l.ItemID, l.WarehouseID);
        if (!(ledger.AvgCost > 0)) {
          throw new Error('Line ' + (idx + 1) + ' (' + l.ItemCode + '): cannot reverse — this item now has zero current stock, so there is no existing cost to inherit for putting it back.');
        }
        line.UnitCost = ledger.AvgCost;
      }
      movementLines.push(line);
    }

    const movement = await computeStockMovement(itemsData, coaData, movementLines);

    const offsetGlLines = movementLines.map(l => {
      const item = itemsData[l.ItemID];
      const accountId = item.WriteOffAccountID || item.ConsumptionAccountID;
      const account = coaData[accountId];
      if (!account || !account.IsPostable) throw new Error('Write-off account for ' + item.ItemCode + ' is not valid — check Item Master.');
      const isDecrease = l.Direction === 'Out';
      return {
        AccountCode: account.AccountCode,
        Debit: isDecrease ? l.TotalValue : 0, Credit: isDecrease ? 0 : l.TotalValue,
        Description: 'Reversal of ' + existing.TransactionNumber,
        CostCenterID: l.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || ''
      };
    });

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'ADJD-' + randomUUID().split('-')[0].toUpperCase();
    const attemptId = randomUUID();

    await rtdb.ref('stock/transactions/' + newId).set({
      TransactionType: 'StockAdjustment', Status: 'Committing', CommitAttemptID: attemptId, CommitAttemptStartedAt: now,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber,
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: movementLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor,
      ReversalOfAdjustment: adjId, ReversedByAdjustment: ''
    });

    let glResult;
    try {
      glResult = await writeStockGlEntry(user, 'StockAdjustment', date,
        'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description, existing.TransactionNumber,
        movement.inventoryGlLines.concat(offsetGlLines),
        { CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID, CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID },
        { CommitAttemptID: attemptId, SourceTransactionID: newId });
    } catch (err) {
      await rtdb.ref('stock/transactions/' + newId).set(null);
      throw err;
    }

    // A GL entry genuinely exists from here on — no more reverting.
    await commitStockLedgerUpdates(movement.ledgerUpdates);
    await rtdb.ref('stock/transactions/' + adjId).update({ ReversedByAdjustment: newId });
    await finalizeCommitAttempt(newId, glResult, { Lines: movementLines }, actor);

    return { adjId: newId, adjNumber: glResult.jvNumber };
  });
});
