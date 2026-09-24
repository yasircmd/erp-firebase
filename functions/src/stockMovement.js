const { rtdb } = require('./firebaseAdmin');

function stockLedgerPath(itemId, warehouseId) {
  return 'stock/ledger/' + itemId + '/' + warehouseId;
}

async function getStockLedgerEntry(itemId, warehouseId) {
  const snap = await rtdb.ref(stockLedgerPath(itemId, warehouseId)).get();
  return snap.val() || { Quantity: 0, AvgCost: 0, TotalValue: 0 };
}

// Ported from computeStockMovement_ — identical logic, made async only
// because each ledger lookup is now a network round-trip instead of a
// synchronous UrlFetchApp call. Out lines are still resolved before In
// lines, in that same order, for the same reason the original comment
// gives: a future In line's cost derived from its own Out lines (e.g.
// Production) needs the Out side settled first, and this ordering is
// already correct for that even though nothing uses it yet.
async function computeStockMovement(itemsData, coaData, lines) {
  if (!lines || !lines.length) throw new Error('Enter at least one line.');

  const ledgerUpdates = {};
  function ledgerKey(itemId, warehouseId) { return itemId + '|' + warehouseId; }
  async function currentLedger(itemId, warehouseId) {
    const key = ledgerKey(itemId, warehouseId);
    if (!ledgerUpdates[key]) ledgerUpdates[key] = await getStockLedgerEntry(itemId, warehouseId);
    return ledgerUpdates[key];
  }

  const inventoryGlLines = [];
  const outLines = lines.filter(l => l.Direction === 'Out');
  const inLines = lines.filter(l => l.Direction === 'In');

  for (let idx = 0; idx < outLines.length; idx++) {
    const line = outLines[idx];
    const item = itemsData[line.ItemID];
    if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
    if (!line.WarehouseID) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
    const qty = Number(line.Quantity) || 0;
    if (qty <= 0) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');

    const key = ledgerKey(line.ItemID, line.WarehouseID);
    const ledger = await currentLedger(line.ItemID, line.WarehouseID);
    if (ledger.Quantity < qty - 0.000001) {
      throw new Error('Line ' + (idx + 1) + ': insufficient stock for ' + item.ItemCode + ' at this warehouse — available ' + ledger.Quantity + ', requested ' + qty + '.');
    }

    const unitCost = ledger.AvgCost;
    const lineValue = Math.round(qty * unitCost * 100) / 100;
    const newQty = Math.round((ledger.Quantity - qty) * 1e6) / 1e6;
    const newTotalValue = Math.round((ledger.TotalValue - lineValue) * 100) / 100;
    const newAvgCost = newQty > 0.000001 ? Math.round((newTotalValue / newQty) * 10000) / 10000 : 0;
    ledgerUpdates[key] = { Quantity: newQty, AvgCost: newAvgCost, TotalValue: newQty > 0.000001 ? newTotalValue : 0 };

    line.UnitCost = unitCost;
    line.TotalValue = lineValue;

    const account = coaData[item.InventoryAccountID];
    if (!account) throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' has no valid Inventory account configured.');
    inventoryGlLines.push({
      AccountCode: account.AccountCode, Debit: 0, Credit: lineValue,
      Description: line.Description || (item.ItemCode + ' — ' + item.ItemName),
      CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || ''
    });
  }

  for (let idx = 0; idx < inLines.length; idx++) {
    const line = inLines[idx];
    const item = itemsData[line.ItemID];
    if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
    if (!line.WarehouseID) throw new Error('Line ' + (idx + 1) + ': warehouse is required.');
    const qty = Number(line.Quantity) || 0;
    if (qty <= 0) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');
    const unitCost = Number(line.UnitCost);
    if (!(unitCost > 0)) throw new Error('Line ' + (idx + 1) + ': enter a unit cost greater than zero for ' + item.ItemCode + '.');

    const key = ledgerKey(line.ItemID, line.WarehouseID);
    const ledger = await currentLedger(line.ItemID, line.WarehouseID);
    const lineValue = Math.round(qty * unitCost * 100) / 100;
    const newQty = Math.round((ledger.Quantity + qty) * 1e6) / 1e6;
    const newTotalValue = Math.round((ledger.TotalValue + lineValue) * 100) / 100;
    const newAvgCost = Math.round((newTotalValue / newQty) * 10000) / 10000;
    ledgerUpdates[key] = { Quantity: newQty, AvgCost: newAvgCost, TotalValue: newTotalValue };

    line.UnitCost = unitCost;
    line.TotalValue = lineValue;

    const account = coaData[item.InventoryAccountID];
    if (!account) throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' has no valid Inventory account configured.');
    inventoryGlLines.push({
      AccountCode: account.AccountCode, Debit: lineValue, Credit: 0,
      Description: line.Description || (item.ItemCode + ' — ' + item.ItemName),
      CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || ''
    });
  }

  return { ledgerUpdates: ledgerUpdates, inventoryGlLines: inventoryGlLines };
}

// IMPROVED over the original commitStockLedgerUpdates_, which issued
// one separate .put() REST call per item/warehouse key touched by a
// commit — meaning a multi-line commit's own ledger writes were never
// atomic as a UNIT (distinct from the global lock's own job, which is
// only ever about preventing two DIFFERENT commits from colliding —
// see lock.js's own comment on this exact distinction). If execution
// died between the 3rd and 4th of 5 separate PUT calls, two ledger
// entries would be left unwritten while three were already committed
// — a real gap that existed in the original GAS code, not introduced
// by this port.
//
// This version uses RTDB's own multi-path update() — every ledger key
// touched by this commit lands in ONE request, genuinely atomic as a
// single unit. Same input/output shape as the original, so nothing
// about how callers use this needed to change.
async function commitStockLedgerUpdates(ledgerUpdates) {
  const now = new Date().toISOString();
  const updates = {};
  Object.keys(ledgerUpdates).forEach(key => {
    const parts = key.split('|');
    const itemId = parts[0], warehouseId = parts[1];
    const update = ledgerUpdates[key];
    updates[stockLedgerPath(itemId, warehouseId)] = {
      Quantity: update.Quantity, AvgCost: update.AvgCost, TotalValue: update.TotalValue, UpdatedAt: now
    };
  });
  if (!Object.keys(updates).length) return;
  // rtdb.ref() with no path is the database root — update()'s own
  // keys are then absolute paths (stockLedgerPath's own full strings),
  // not relative to some sub-location, since the keys touched here
  // span arbitrary item/warehouse combinations with no common parent
  // shorter than 'stock/ledger' itself.
  await rtdb.ref().update(updates);
}

module.exports = { stockLedgerPath, getStockLedgerEntry, computeStockMovement, commitStockLedgerUpdates };
