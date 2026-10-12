// Stock reports (docs/modules/STOCK_REPORTS.md, decisions 144-147): the
// Expiry / Batch Report through getBatchExpiryReport (first expiry first out,
// a named batch taken from that batch, a transfer keeping batch and expiry, a
// later receipt of a batch taking its recorded expiry, the statuses against
// the "expiring within" window, a reversed receipt dropping out) and the
// Reorder / Low Stock Report through getReorderReport (available = on hand −
// reserved + on order, the shortfall to the level suggested), with a real
// GRN against an approved purchase order, plus access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, today } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = async p => { const r = await p.catch(e => e); return r instanceof Error ? r.message : 'no error: ' + JSON.stringify(r); };
const ln = (item, wh, dir, qty, extra) => Object.assign({ ItemID: item, WarehouseID: wh, Direction: dir, Quantity: qty, UnitCost: 10, TotalValue: qty * 10 }, extra || {});
const tx = (type, date, lines, extra) => Object.assign({ TransactionType: type, Status: 'Posted', CompanyID: 'C1', TransactionDate: date, PostedAt: date + 'T08:00:00Z', Lines: lines }, extra || {});

function fixture() {
  const f = baseFixture();
  f.items.I1.BatchTracked = true;
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Bolts', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' };
  return f;
}

test('expiry / batch: first expiry first out, a named batch, a transfer keeps batch and expiry, a later receipt of a batch takes its expiry', async () => {
  const f = fixture();
  const b = (batch, expiry) => ({ BatchNumber: batch, ExpiryDate: expiry || '' });
  f.stock = {
    transactions: {
      G1: tx('GRN', '2026-01-10', [ln('I1', 'WH1', 'In', 10, b('C', '2027-03-31')), ln('I2', 'WH1', 'In', 3)]), // received first, expires last
      G2: tx('GRN', '2026-02-10', [ln('I1', 'WH1', 'In', 10, b('B', '2026-08-31'))]),
      G3: tx('GRN', '2026-03-10', [ln('I1', 'WH1', 'In', 10, b('A', '2026-06-15'))]),
      M1: tx('MaterialIssue', '2026-04-01', [ln('I1', 'WH1', 'Out', 4)]), // no batch named: the first to expire (A), not the first received (C)
      M2: tx('MaterialIssue', '2026-04-05', [ln('I1', 'WH1', 'Out', 3, b('C'))]), // batch C named
      W1: tx('WarehouseMovement', '2026-04-10', [{ ItemID: 'I1', FromWarehouseID: 'WH1', ToWarehouseID: 'WH2', Quantity: 5, UnitCost: 10, TotalValue: 50, BatchNumber: 'B' }]),
      G4: tx('GRN', '2026-05-01', [ln('I1', 'WH2', 'In', 2, b('B'))]), // batch B again, no expiry entered
      G5: tx('GRN', '2026-05-05', [ln('I1', 'WH1', 'In', 9, b('Z', '2026-05-20'))], { ReversedByGRN: 'R5' }),
      R5: tx('GRN', '2026-05-06', [ln('I1', 'WH1', 'Out', 9, b('Z'))], { ReversalOfGRN: 'G5' }),
      D1: tx('GRN', '2026-05-07', [ln('I1', 'WH1', 'In', 1, b('D', '2026-05-30'))], { Status: 'Draft' }),
      X1: tx('GRN', '2026-05-08', [ln('I1', 'WH1', 'In', 1, b('X', '2026-05-30'))], { CompanyID: 'C2' })
    }
  };
  await reset(f);
  const rep = (asOf, extra) => call('u-admin', 'getBatchExpiryReport', Object.assign({ companyId: 'C1', asOf }, extra || {}));
  const shape = r => r.Rows.map(x => [x.WarehouseID, x.Batch, x.Expiry, x.Qty, x.Value, x.Status]).sort((a, c) => a.join().localeCompare(c.join()));

  const r = await rep('2026-06-30');
  assert.equal(r.WithinDays, 90, 'default window');
  assert.equal(r.Until, '2026-09-28');
  assert.deepEqual(shape(r), [
    ['WH1', 'A', '2026-06-15', 6, 60, 'Expired'],
    ['WH1', 'B', '2026-08-31', 5, 50, 'Expiring'],
    ['WH1', 'C', '2027-03-31', 7, 70, 'OK'],
    ['WH2', 'B', '2026-08-31', 7, 70, 'Expiring']
  ]);
  assert.deepEqual(r.Rows.map(x => x.Expiry), ['2026-06-15', '2026-08-31', '2026-08-31', '2027-03-31'], 'sorted by expiry');
  const wh2 = r.Rows.find(x => x.WarehouseID === 'WH2');
  assert.deepEqual([wh2.Received, wh2.DaysToExpiry, wh2.ItemCode, wh2.Warehouse, wh2.UOM], ['2026-02-10', 62, 'RM-001', 'WH2', 'PCS'], 'the transfer kept the receipt date');
  assert.deepEqual([r.Rows.find(x => x.Batch === 'A').DaysToExpiry, r.Rows.find(x => x.Batch === 'A').Received], [-15, '2026-03-10']);
  assert.deepEqual(r.Totals, { Expired: 60, Expiring: 120, OK: 70, NoExpiry: 0, Value: 250 });

  // A shorter window: batch B is no longer "expiring".
  assert.deepEqual((await rep('2026-06-30', { withinDays: 30 })).Totals, { Expired: 60, Expiring: 0, OK: 190, NoExpiry: 0, Value: 250 });
  // One warehouse; before the batch-C issue and the transfer; the reversed receipt counts only before its reversal.
  assert.deepEqual(shape(await rep('2026-06-30', { warehouseId: 'WH2' })), [['WH2', 'B', '2026-08-31', 7, 70, 'Expiring']]);
  assert.deepEqual(shape(await rep('2026-04-02')).map(x => [x[1], x[3]]), [['A', 6], ['B', 10], ['C', 10]]);
  assert.deepEqual(shape(await rep('2026-05-05')).filter(x => x[1] === 'Z').map(x => [x[3], x[5]]), [[9, 'Expiring']]);
  // Items not batch-tracked only when asked: no expiry date.
  const all = await rep('2026-06-30', { batchTrackedOnly: false });
  assert.deepEqual(all.Rows.filter(x => x.ItemID === 'I2').map(x => [x.Batch, x.Qty, x.Status, x.DaysToExpiry]), [['', 3, 'No expiry date', null]]);
  assert.equal(all.Totals.NoExpiry, 30);
  assert.deepEqual((await rep('2026-06-30', { category: 'FinishedGood' })).Rows, []);
});

test('expiry / batch and reorder: a real GRN against an approved PO; reserved and on order; the shortfall suggested', async () => {
  const f = fixture();
  f.items.I1.ReorderLevel = 20;
  f.items.I3 = { ItemCode: 'RM-003', ItemName: 'Washers', Category: 'Consumable', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ReorderLevel: 5 };
  f.items.I4 = { ItemCode: 'RM-004', ItemName: 'Old part', Category: 'RawMaterial', Status: 'Inactive', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ReorderLevel: 50 };
  f.items.I5 = { ItemCode: 'X-005', ItemName: 'C2 item', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C2', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ReorderLevel: 50 };
  f.purchaseOrders = {
    PO1: { PONumber: 'PO-1', Status: 'Approved', CompanyID: 'C1', VendorID: 'V1', Lines: [{ LineID: 'L1', ItemCode: 'RM-001', Description: 'Steel', Quantity: 10, UnitPrice: 6, WarehouseID: 'WH1' }] },
    PO2: { PONumber: 'PO-2', Status: 'Draft', CompanyID: 'C1', VendorID: 'V1', Lines: [{ LineID: 'L1', ItemCode: 'RM-001', Quantity: 100, UnitPrice: 6, WarehouseID: 'WH1' }] },
    PO3: { PONumber: 'PO-3', Status: 'Approved', CompanyID: 'C2', VendorID: 'V1', Lines: [{ LineID: 'L1', ItemCode: 'RM-001', Quantity: 100, UnitPrice: 6, WarehouseID: 'WH9' }] }
  };
  f.stock = {
    transactions: {
      T1: tx('GRN', '2026-04-01', [ln('I3', 'WH1', 'In', 10)]),
      T2: tx('MaterialIssue', '2026-05-01', [ln('I3', 'WH1', 'Out', 2)])
    },
    ledger: { I3: { WH1: { Quantity: 8, AvgCost: 10, TotalValue: 80 } } },
    reservations: {
      R1: { ItemID: 'I1', WarehouseID: 'WH1', CompanyID: 'C1', Quantity: 3, Status: 'Active', SourceType: 'SalesOrder' },
      R2: { ItemID: 'I1', WarehouseID: 'WH1', CompanyID: 'C1', Quantity: 50, Status: 'Released', SourceType: 'SalesOrder' }
    }
  };
  await reset(f);
  const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', NonStockLines: [],
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 4, UnitCost: 6, Description: 'Steel', SourcePOID: 'PO1', SourcePOLineID: 'L1', BatchNumber: 'LOT-9', ExpiryDate: '2099-01-31' }] });
  assert.equal((await call('u-admin', 'postGrn', { grnId: s.grnId })).status, 'Posted');
  assert.equal((await val('purchaseOrders/PO1')).Lines[0].ReceivedQuantity, 4);

  const be = await call('u-admin', 'getBatchExpiryReport', { companyId: 'C1' });
  assert.equal(be.AsOf, today, 'as at today by default');
  assert.deepEqual(be.Rows.map(x => [x.Batch, x.Expiry, x.Received, x.Qty, x.Value, x.Status]), [['LOT-9', '2099-01-31', today, 4, 24, 'OK']]);

  const ro = extra => call('u-admin', 'getReorderReport', Object.assign({ companyId: 'C1' }, extra || {}));
  const r = await ro();
  // I1: 4 on hand − 3 reserved + 6 still on order = 7 against 20.
  assert.deepEqual(r.Rows.map(x => [x.ItemID, x.OnHand, x.Reserved, x.OnOrder, x.Available, x.ReorderLevel, x.Shortfall, x.Suggested, x.Below, x.LastIn]),
    [['I1', 4, 3, 6, 7, 20, 13, 13, true, today]]);
  assert.equal(r.BelowCount, 1);
  // All items with a level: I3 above it (8 against 5), after the low one; not the inactive item, nor another company's.
  const all = await ro({ onlyBelow: false });
  assert.deepEqual(all.Rows.map(x => [x.ItemID, x.Available, x.Shortfall, x.Below, x.LastIn, x.LastOut]),
    [['I1', 7, 13, true, today, ''], ['I3', 8, 0, false, '2026-04-01', '2026-05-01']]);
  // Another warehouse: nothing there, nothing on order for it.
  assert.deepEqual((await ro({ warehouseId: 'WH2' })).Rows.map(x => [x.ItemID, x.OnHand, x.Reserved, x.OnOrder, x.Shortfall]), [['I1', 0, 0, 0, 20], ['I3', 0, 0, 0, 5]]);
  assert.deepEqual((await ro({ category: 'Consumable', onlyBelow: false })).Rows.map(x => x.ItemID), ['I3']);
  assert.deepEqual(r.Warehouses.map(w => w.ID), ['WH1', 'WH2']);
});

test('access and checks', async () => {
  await reset(fixture());
  assert.match(await err(call('u-admin', 'getBatchExpiryReport', { companyId: '' })), /Select a Company/);
  assert.match(await err(call('u-admin', 'getBatchExpiryReport', { companyId: 'C1', asOf: '30/06/2026' })), /"as at" date/);
  assert.match(await err(call('u-admin', 'getBatchExpiryReport', { companyId: 'C1', withinDays: -1 })), /number of days from 0 to 3650/);
  assert.match(await err(call('u-admin', 'getBatchExpiryReport', { companyId: 'C1', withinDays: 2.5 })), /number of days/);
  assert.match(await err(call('u-other', 'getBatchExpiryReport', { companyId: 'C1' })), /do not have access to that company/);
  assert.match(await err(call('u-other', 'getReorderReport', { companyId: 'C1' })), /do not have access to that company/);
  assert.deepEqual((await call('u-viewer', 'getBatchExpiryReport', { companyId: 'C1' })).Rows, [], 'a Viewer reads it');
  assert.deepEqual((await call('u-viewer', 'getReorderReport', { companyId: 'C1' })).Rows, []);
  await rtdb.ref('permissions/BATCHEXPIRY/access').set(['Admin']);
  assert.match(await err(call('u-viewer', 'getBatchExpiryReport', { companyId: 'C1' })), /do not have access to the Expiry \/ Batch Report/);
  assert.deepEqual((await call('u-viewer', 'getReorderReport', { companyId: 'C1' })).Rows, [], 'its own right');
  await rtdb.ref('permissions/REORDER/access').set(['Admin']);
  assert.match(await err(call('u-viewer', 'getReorderReport', { companyId: 'C1' })), /do not have access to the Reorder \/ Low Stock Report/);
});
