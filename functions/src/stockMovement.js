const stockStore = require('./stockStore');

// The running balances are in Firestore (stockStore.js, stockLedger); the
// RTDB path is still the name the ported code and the tests use for them.
function stockLedgerPath(itemId, warehouseId) {
  return 'stock/ledger/' + itemId + '/' + warehouseId;
}

async function getStockLedgerEntry(itemId, warehouseId) {
  return (await stockStore.getLedgerEntry(itemId, warehouseId)) || { Quantity: 0, AvgCost: 0, TotalValue: 0 };
}

// Ported from computeStockMovement_ — identical logic, made async only
// because each ledger lookup is now a network round-trip instead of a
// synchronous UrlFetchApp call. Out lines are still resolved before In
// lines, in that same order, for the same reason the original comment
// gives: a future In line's cost derived from its own Out lines (e.g.
// Production) needs the Out side settled first, and this ordering is
// already correct for that even though nothing uses it yet.
//
// readLedger (optional, port addition): where a starting balance comes
// from, defaulting to the live RTDB ledger. Data Reset's ledger rebuild
// passes an in-memory reader so it can replay every transaction without
// touching the stored ledger until the whole replay has succeeded.
async function computeStockMovement(itemsData, coaData, lines, readLedger) {
  if (!lines || !lines.length) throw new Error('Enter at least one line.');

  const readEntry = readLedger || getStockLedgerEntry;
  const ledgerUpdates = {};
  function ledgerKey(itemId, warehouseId) { return itemId + '|' + warehouseId; }
  async function currentLedger(itemId, warehouseId) {
    const key = ledgerKey(itemId, warehouseId);
    if (!ledgerUpdates[key]) ledgerUpdates[key] = await readEntry(itemId, warehouseId);
    return ledgerUpdates[key];
  }

  const inventoryGlLines = [];
  // A value-only line (TAX_ENGINE.md, Q323: input tax that can't be
  // reclaimed, added to the goods' cost) changes a balance's value, not its
  // quantity: In adds TotalValue, Out takes it back. The stock must be on hand.
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line.ValueOnly) continue;
    const item = itemsData[line.ItemID];
    if (!item) throw new Error('Line ' + (idx + 1) + ': item not found.');
    const value = Math.round((Number(line.TotalValue) || 0) * 100) / 100;
    if (!(value > 0)) throw new Error('Line ' + (idx + 1) + ': a value-only line needs a value greater than zero.');
    const key = ledgerKey(line.ItemID, line.WarehouseID);
    const ledger = await currentLedger(line.ItemID, line.WarehouseID);
    if (!(ledger.Quantity > 0.000001)) throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' has no stock left at this warehouse to carry the value.');
    const sign = line.Direction === 'Out' ? -1 : 1;
    const newTotalValue = Math.max(0, Math.round((ledger.TotalValue + sign * value) * 100) / 100);
    ledgerUpdates[key] = { Quantity: ledger.Quantity, AvgCost: Math.round((newTotalValue / ledger.Quantity) * 10000) / 10000, TotalValue: newTotalValue };
    line.Quantity = 0; line.UnitCost = 0; line.TotalValue = value;
    const account = coaData[item.InventoryAccountID];
    if (!account) throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' has no valid Inventory account configured.');
    inventoryGlLines.push({
      AccountCode: account.AccountCode, Debit: sign > 0 ? value : 0, Credit: sign > 0 ? 0 : value,
      Description: line.Description || (item.ItemCode + ' — ' + item.ItemName),
      CostCenterID: line.CostCenterID || '', ProfitCenterID: line.ProfitCenterID || ''
    });
  }
  const outLines = lines.filter(l => l.Direction === 'Out' && !l.ValueOnly);
  const inLines = lines.filter(l => l.Direction === 'In' && !l.ValueOnly);

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

    // AtCost (new development, docs/modules/OPENING_BALANCES.md): taking
    // back an opening stock batch removes it at its own cost, not at the
    // average, so a corrected batch leaves the cost as if it had never been
    // posted. The last of the stock takes the whole remaining value with it.
    // Every other Out line goes at the average, as before.
    const unitCost = line.AtCost ? Number(line.UnitCost) : ledger.AvgCost;
    const newQty = Math.round((ledger.Quantity - qty) * 1e6) / 1e6;
    const lineValue = line.AtCost && newQty <= 0.000001 ? Math.round(ledger.TotalValue * 100) / 100 : Math.round(qty * unitCost * 100) / 100;
    if (line.AtCost && lineValue > ledger.TotalValue + 0.005) {
      throw new Error('Line ' + (idx + 1) + ': ' + item.ItemCode + ' at this warehouse is now worth ' + ledger.TotalValue + ', less than the ' + lineValue + ' to take out at its original cost.');
    }
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
//
// In Firestore (TRANSACTIONS_FIRESTORE.md, T1) the same holds: every
// balance this commit touches is written in one batch, all or none.
async function commitStockLedgerUpdates(ledgerUpdates) {
  const now = new Date().toISOString();
  const entries = {};
  Object.keys(ledgerUpdates).forEach(key => {
    const update = ledgerUpdates[key];
    entries[key] = { Quantity: update.Quantity, AvgCost: update.AvgCost, TotalValue: update.TotalValue, UpdatedAt: now };
  });
  await stockStore.setLedgerEntries(entries);
}

module.exports = { stockLedgerPath, getStockLedgerEntry, computeStockMovement, commitStockLedgerUpdates };
