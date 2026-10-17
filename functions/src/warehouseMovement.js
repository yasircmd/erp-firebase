const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const stockStore = require('./stockStore');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, assignStockVoucherNumbering } = require('./glWriting');
const { computeStockMovement, commitStockLedgerUpdates } = require('./stockMovement');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { allocateAvailableStockToShortfalls } = require('./reservations');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
const { pageOf } = require('./listPaging');
// Gmail-style list paging (owner, 2026-10-02; docs/modules/LIST_PAGING.md).
const LIST_SPEC = { idField: 'MoveID', idAlso: ['LinkedJVID'], dateField: 'TransactionDate', equals: ['CompanyID', 'Status'], text: e => `${e.TransactionNumber} ${e.Description}` };

// Successful save/post/decide/reverse results carry success: true, same as
// the original's return contract — the module's own screen checks
// result.success on every one of these and would otherwise report a
// genuinely successful commit as a failure. Errors still throw (the
// screen's .withFailureHandler shows err.message), rather than the
// original's { success: false, error } — both paths end up displayed.
const MOVABLE_ORG_UNIT_TYPES = ['Warehouse', 'Rack'];

async function requireDraftAccess(moduleId, role) {
  const can = await moduleHasCapability(moduleId, 'draft', role);
  if (!can) throw new Error('You do not have permission to create or edit entries in ' + moduleId + '.');
}
async function requirePostAccess(moduleId, role) {
  const can = await moduleHasCapability(moduleId, 'post', role);
  if (!can) throw new Error('You do not have permission to post or reverse entries in ' + moduleId + '.');
}

// Ported from saveWarehouseMovementDraft.
exports.saveWarehouseMovementDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireDraftAccess('WAREHOUSEMOVEMENT', user.profile.role);

  const moveData = request.data || {};
  const moveId = String(moveData.MoveID || '').trim();
  const transactionDate = String(moveData.TransactionDate || '').trim();
  if (!transactionDate) throw new HttpsError('invalid-argument', 'Transaction date is required.');
  const description = String(moveData.Description || '').trim();
  if (!description) throw new HttpsError('invalid-argument', 'Description is required.');
  const reference = String(moveData.Reference || '').trim();
  const companyId = String(moveData.CompanyID || '').trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company for this transaction.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const divisionId = String(moveData.DivisionID || '').trim();
  const branchId = String(moveData.BranchID || '').trim();
  const costCenterId = String(moveData.CostCenterID || '').trim();
  const profitCenterId = String(moveData.ProfitCenterID || '').trim();

  const [itemsSnap, uomsSnap, orgUnitsSnap] = await Promise.all([
    rtdb.ref('items').get(), rtdb.ref('uoms').get(), rtdb.ref('orgUnits').get()
  ]);
  const itemsData = itemsSnap.val() || {};
  const uomsData = uomsSnap.val() || {};
  const orgUnitsData = orgUnitsSnap.val() || {};

  const rawLines = moveData.Lines || [];
  const lines = [];
  rawLines.forEach((line, idx) => {
    const itemId = String(line.ItemID || '').trim();
    if (!itemId) return; // skip blank trailing row

    const item = itemsData[itemId];
    if (!item) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': item not found.');

    const fromWarehouseId = String(line.FromWarehouseID || '').trim();
    const toWarehouseId = String(line.ToWarehouseID || '').trim();
    if (!fromWarehouseId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': From location is required.');
    if (!toWarehouseId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': To location is required.');
    if (fromWarehouseId === toWarehouseId) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': From and To locations must be different.');
    const fromWh = orgUnitsData[fromWarehouseId];
    const toWh = orgUnitsData[toWarehouseId];
    if (!fromWh || MOVABLE_ORG_UNIT_TYPES.indexOf(fromWh.Type) === -1) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': From location not found.');
    if (!toWh || MOVABLE_ORG_UNIT_TYPES.indexOf(toWh.Type) === -1) throw new HttpsError('invalid-argument', 'Line ' + (idx + 1) + ': To location not found.');

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
      FromWarehouseID: fromWarehouseId, ToWarehouseID: toWarehouseId,
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
    TransactionType: 'WarehouseMovement',
    TransactionDate: transactionDate, Description: description, Reference: reference,
    CompanyID: companyId, DivisionID: divisionId, BranchID: branchId,
    CostCenterID: costCenterId, ProfitCenterID: profitCenterId,
    Lines: lines, Status: 'Draft', UpdatedAt: now, UpdatedBy: actor
  };

  if (moveId) {
    const existingSnap = await stockStore.snapTx(moveId);
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Warehouse Movement not found.');
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected Warehouse Movements can be edited.');
    await stockStore.updateTx(moveId, fields);
    return { success: true, moveId: moveId };
  }

  const newId = 'WMD-' + randomUUID().split('-')[0].toUpperCase();
  await stockStore.setTx(newId, Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor }));
  return { success: true, moveId: newId };
});

// Ported from postWarehouseMovement.
exports.postWarehouseMovement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const moveId = String(request.data && request.data.moveId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await stockStore.snapTx(moveId);
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Warehouse Movement not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess('WAREHOUSEMOVEMENT', user.profile.role);
    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new HttpsError('failed-precondition', 'Only draft or rejected Warehouse Movements can be posted.');
    if (!existing.Lines || !existing.Lines.length) throw new HttpsError('failed-precondition', 'This Warehouse Movement has no lines.');

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    // No GL entry exists for a Warehouse Movement — moving stock
    // between locations within the same company doesn't change total
    // inventory value — but a gate still needs a meaningful amount to
    // check against: the value of goods being moved, from the SAME
    // read-only preview the actual commit will redo. Nothing here
    // writes anything.
    const itemsSnap = await rtdb.ref('items').get();
    const itemsDataPreview = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaDataPreview = coaSnap.val() || {};
    const previewOutLines = existing.Lines.map(l => Object.assign({ Direction: 'Out', WarehouseID: l.FromWarehouseID }, l));
    await computeStockMovement(itemsDataPreview, coaDataPreview, previewOutLines);
    const previewAmount = previewOutLines.reduce((sum, l) => sum + (Number(l.TotalValue) || 0), 0);

    const scopeKey = await resolveApprovalScopeKeyForDocument('WAREHOUSEMOVEMENT', {
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID,
      BranchID: existing.BranchID, CostCenterID: existing.CostCenterID
    });
    const approval = await beginApprovalInstance('WAREHOUSEMOVEMENT', moveId, '', scopeKey, previewAmount, user.uid);

    if (approval.required) {
      // Nothing physical happens yet — no stock ledger change, no
      // Sales Order allocation — until this is actually approved.
      await stockStore.updateTx(moveId, {
        Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId,
        RejectionReason: '', SubmittedAt: now, SubmittedBy: actor, UpdatedAt: now, UpdatedBy: actor
      });
      return { success: true, status: 'PendingApproval' };
    }

    const result = await commitWarehouseMovementPosting(user, existing, moveId);
    return { success: true, moveId: moveId, moveNumber: result.moveNumber, status: 'Posted' };
  });
});

// Ported from commitWarehouseMovementPosting_. No GL entry, so no
// commit-attempt marker sequence either — that pattern exists
// specifically to guard against a Firestore GL write and an RTDB
// ledger write disagreeing, and there's no GL write here at all to
// disagree with. The only write is the stock ledger update itself
// (RTDB-only, already atomic as a unit via commitStockLedgerUpdates)
// plus the transaction record's own status patch.
async function commitWarehouseMovementPosting(user, existing, moveId) {
  const itemsSnap = await rtdb.ref('items').get();
  const itemsData = itemsSnap.val() || {};
  const coaSnap = await rtdb.ref('coa').get();
  const coaData = coaSnap.val() || {};

  const outLines = existing.Lines.map(l => Object.assign({ Direction: 'Out', WarehouseID: l.FromWarehouseID }, l));
  const outMovement = await computeStockMovement(itemsData, coaData, outLines);

  // The In line's own cost is explicitly carried over from the
  // matching Out line's own resolved UnitCost, not independently
  // computed — this is a transfer, not two unrelated movements, and
  // the value shouldn't change just because it changed location.
  const inLines = existing.Lines.map((l, idx) => Object.assign({}, l, {
    Direction: 'In', WarehouseID: l.ToWarehouseID, UnitCost: outLines[idx].UnitCost
  }));
  const inMovement = await computeStockMovement(itemsData, coaData, inLines);

  // NOTE: a pre-existing quirk, faithfully preserved, not corrected
  // here — these two ledgerUpdates objects are computed independently
  // (each from the same starting database state, not chained), so if
  // the same item ever appears in a Warehouse Movement moving in
  // OPPOSITE directions between the same two warehouses within one
  // transaction, the later Object.assign below would silently let the
  // In side's computation overwrite the Out side's contribution to
  // that shared ledger key. A genuine edge case, present in the
  // original Code.gs exactly this way.
  const combinedLedgerUpdates = Object.assign({}, outMovement.ledgerUpdates, inMovement.ledgerUpdates);
  // Numbered (and the period lock checked) before the ledger moves, so a
  // movement refused for a closed month moves no stock (docs/modules/PERIOD_CLOSING.md, step 1b).
  const numbering = await assignStockVoucherNumbering('WarehouseMovement', existing.TransactionDate, existing.CompanyID);
  await commitStockLedgerUpdates(combinedLedgerUpdates);

  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  await stockStore.updateTx(moveId, {
    Status: 'Posted', TransactionNumber: numbering.voucherNumber, TransactionRef: numbering.transactionRef,
    Lines: outLines.map(l => Object.assign({}, l, { UnitCost: l.UnitCost, TotalValue: l.TotalValue })),
    PostedAt: now, PostedBy: actor, UpdatedAt: now, UpdatedBy: actor
  });

  for (const l of inLines) {
    await allocateAvailableStockToShortfalls(actor, l.ItemID, l.ItemCode, l.ToWarehouseID, existing.CompanyID, Number(l.Quantity) || 0, numbering.voucherNumber);
  }

  return { moveNumber: numbering.voucherNumber };
}

// Ported from decideWarehouseMovementApproval.
exports.decideWarehouseMovementApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePostAccess('WAREHOUSEMOVEMENT', user.profile.role);
  const data = request.data || {};
  const moveId = String(data.moveId || '').trim();
  const levelNumber = data.levelNumber;
  const decision = data.decision;
  const reason = data.reason;

  const existingSnap = await stockStore.snapTx(moveId);
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'Warehouse Movement not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (existing.Status !== 'PendingApproval') throw new HttpsError('failed-precondition', 'This Warehouse Movement is not awaiting approval.');
  if (!existing.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'No approval record found for this Warehouse Movement.');

  const result = await recordApprovalDecision(user, existing.ApprovalInstanceID, levelNumber, decision, reason);

  if (result.status === 'Approved') {
    await withGlobalLock(user.uid, async () => {
      await commitWarehouseMovementPosting(user, existing, moveId);
    });
  } else if (result.status === 'Rejected') {
    const now = new Date().toISOString();
    await stockStore.updateTx(moveId, {
      Status: 'Rejected', RejectionReason: String(reason || '').trim(),
      UpdatedAt: now, UpdatedBy: user.profile.username || user.uid
    });
  }
  return { success: true, status: result.status, selfApproved: result.selfApproved };
});

// Ported from deleteWarehouseMovementDraft.
exports.deleteWarehouseMovementDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const moveId = String(request.data && request.data.moveId || '').trim();
  const existingSnap = await stockStore.snapTx(moveId);
  const existing = existingSnap.val();
  if (!existing) throw new HttpsError('not-found', 'Warehouse Movement not found.');
  if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await requireDraftAccess('WAREHOUSEMOVEMENT', user.profile.role);
  if (existing.Status !== 'Draft') throw new HttpsError('failed-precondition', 'Only draft Warehouse Movements can be deleted. Posted ones must be reversed instead.');
  await stockStore.deleteTx(moveId);
  return { success: true };
});

// Ported from getWarehouseMovementEntries.
exports.getWarehouseMovementEntries = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const canAccess = await moduleHasCapability('WAREHOUSEMOVEMENT', 'access', user.profile.role);
  if (!canAccess) throw new HttpsError('permission-denied', 'You do not have access to Warehouse Movement.');

  // Only this type's documents (stockStore.js), not every stock transaction.
  const data = await stockStore.queryTx({ TransactionType: 'WarehouseMovement' });
  const all = Object.keys(data)
    .map(id => Object.assign({ MoveID: id }, data[id]))
    .filter(e => e.TransactionType === 'WarehouseMovement')
    .filter(e => userCanAccessCompany(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));

  // Gmail-style paging and server-side search (docs/modules/LIST_PAGING.md).
  if (request.data && request.data.page) return pageOf(all, request.data.page, LIST_SPEC);

  const limit = request.data && request.data.limit;
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
});

// Ported from reverseWarehouseMovement — swaps From/To and moves it
// back. Same negative-stock guard as everywhere else: if the
// destination no longer has enough (moved again, issued, sold), the
// reversal is rejected. No GL entry here either, same as the original
// post.
exports.reverseWarehouseMovement = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const data = request.data || {};
  const moveId = String(data.moveId || '').trim();

  return withGlobalLock(user.uid, async () => {
    const existingSnap = await stockStore.snapTx(moveId);
    const existing = existingSnap.val();
    if (!existing) throw new HttpsError('not-found', 'Warehouse Movement not found.');
    if (!userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    await requirePostAccess('WAREHOUSEMOVEMENT', user.profile.role);
    if (existing.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only posted Warehouse Movements can be reversed.');
    if (existing.ReversedByWarehouseMovement) throw new HttpsError('failed-precondition', 'This Warehouse Movement has already been reversed.');

    const date = String(data.reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const itemsSnap = await rtdb.ref('items').get();
    const itemsData = itemsSnap.val() || {};
    const coaSnap = await rtdb.ref('coa').get();
    const coaData = coaSnap.val() || {};

    const swappedLines = existing.Lines.map(l => Object.assign({}, l, { FromWarehouseID: l.ToWarehouseID, ToWarehouseID: l.FromWarehouseID }));

    // FIX, not a faithful port of this exact line: the original
    // Code.gs puts the override object FIRST here
    // (Object.assign({ Direction: 'Out', WarehouseID: l.FromWarehouseID }, l))
    // — but existing.Lines, on an ALREADY-POSTED document, already
    // carries stale Direction/WarehouseID fields baked in from the
    // original commit (commitWarehouseMovementPosting persists
    // outLines, including those exact fields, back into storage). With
    // the override first, l's own stale WarehouseID silently wins over
    // the intended swapped value — the reversal's own "Out" side ends
    // up still targeting the ORIGINAL source warehouse, never the
    // actual destination, so the destination's stock is never reduced
    // even though the transaction record claims success. This exact
    // code exists in the current production Code.gs too, so this is
    // very likely broken in the live system today, not something this
    // port introduced. Unlike the other faithfully-preserved quirks
    // elsewhere in this migration, this one corrupts data rather than
    // just computing something in an odd but numerically-identical
    // way — worth fixing, not preserving, and flagging clearly rather
    // than silently carrying a known data-integrity bug forward.
    const outLines = swappedLines.map(l => Object.assign({}, l, { Direction: 'Out', WarehouseID: l.FromWarehouseID }));
    const outMovement = await computeStockMovement(itemsData, coaData, outLines);

    const inLines = swappedLines.map((l, idx) => Object.assign({}, l, {
      Direction: 'In', WarehouseID: l.ToWarehouseID, UnitCost: outLines[idx].UnitCost
    }));
    const inMovement = await computeStockMovement(itemsData, coaData, inLines);

    const combinedLedgerUpdates = Object.assign({}, outMovement.ledgerUpdates, inMovement.ledgerUpdates);
    // Numbered (and the reversal's date checked against the period lock) before the ledger moves.
    const numbering = await assignStockVoucherNumbering('WarehouseMovement', date, existing.CompanyID);
    await commitStockLedgerUpdates(combinedLedgerUpdates);

    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;
    const newId = 'WMD-' + randomUUID().split('-')[0].toUpperCase();

    await stockStore.setTx(newId, {
      TransactionType: 'WarehouseMovement', TransactionNumber: numbering.voucherNumber, TransactionRef: numbering.transactionRef,
      TransactionDate: date, Description: 'Reversal of ' + existing.TransactionNumber + ' — ' + existing.Description,
      Reference: existing.TransactionNumber, Status: 'Posted',
      CompanyID: existing.CompanyID, DivisionID: existing.DivisionID, BranchID: existing.BranchID,
      CostCenterID: existing.CostCenterID, ProfitCenterID: existing.ProfitCenterID,
      Lines: outLines,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor, PostedAt: now, PostedBy: actor,
      ReversalOfWarehouseMovement: moveId, ReversedByWarehouseMovement: ''
    });

    await stockStore.updateTx(moveId, { ReversedByWarehouseMovement: newId });

    return { success: true, moveId: newId, moveNumber: numbering.voucherNumber };
  });
});
