// JOBORDERREQUEST through its screen's callables: batch draft (whole line
// set replaced on each save), submit fan-out numbering, the per-line state
// machine for Sales and Production origins, live produced quantity
// (reversals net out), Sales Order shortfall picker, access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val, put } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  const item = (code, name, category, company) => ({ ItemCode: code, ItemName: name, Category: category, Status: 'Active', CompanyID: company || 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' });
  Object.assign(f.items, {
    FG1: item('FG-001', 'Panel', 'FinishedGood'),
    FG2: item('FG-002', 'Door', 'FinishedGood'),
    FG3: item('FG-003', 'No-recipe Gate', 'FinishedGood')
  });
  f.boms = {
    B1: { ParentItemID: 'FG1', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 2 }] },
    B2: { ParentItemID: 'FG2', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 3 }] }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const saveBatch = (header, uid) => call(uid || 'u-admin', 'saveDraftJobOrderBatch', { header: Object.assign({ CompanyID: 'C1', CostCenterID: 'CC1', JODate: D, Description: 'Run' }, header) });
const lines = async (batchId) => Object.entries((await val('jobOrderLines')) || {})
  .filter(([, l]) => l.ParentBatchID === batchId).map(([id, l]) => Object.assign({ LineID: id }, l))
  .sort((a, b) => a.LineNumber - b.LineNumber);
const act = (fn, data, uid) => call(uid || 'u-admin', fn, data);

test('draft: validation; re-save replaces the whole line set; submit numbers the batch and its lines', async () => {
  await reset(fixture());
  const err = async (h) => (await saveBatch(h)).error;
  assert.equal(await err({ Origin: 'Production', CostCenterID: '' }), 'Select a Cost Center.');
  assert.equal(await err({ Origin: 'Production', CostCenterID: 'WH1' }), 'Unknown Cost Center.');
  assert.equal(await err({ Origin: 'Other' }), 'Select Sales or Production as the origin.');
  assert.match(await err({ Origin: 'Production', Lines: [{ ItemCode: 'FG-003', OrderedQuantity: 1 }] }), /no active BOM/);
  assert.match(await err({ Origin: 'Production', Lines: [{ ItemCode: 'RM-001', OrderedQuantity: 1 }] }), /only Finished Goods or Semi-Finished Goods/);
  assert.match(await err({ Origin: 'Production', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 0 }] }), /quantity must be greater than zero/);
  assert.match(await err({ Origin: 'Sales', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 1 }] }), /Target Date is required/);
  assert.equal(await err({ Origin: 'Production', CompanyID: 'C2' }), 'You do not have access to that company.');

  const s = await saveBatch({ Origin: 'Production', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 5 }, { ItemCode: 'FG-002', OrderedQuantity: 3 }, { ItemCode: '' }] });
  assert.equal(s.success, true, s.error);
  let ls = await lines(s.batchId);
  assert.deepEqual(ls.map(l => [l.LineNumber, l.ItemCode, l.OrderedQuantity, l.Status]), [[1, 'FG-001', 5, 'Draft'], [2, 'FG-002', 3, 'Draft']]);

  // Re-save keeps line 1 (by LineID, new qty), drops line 2.
  const again = await saveBatch({ BatchID: s.batchId, Origin: 'Production', Lines: [{ LineID: ls[0].LineID, ItemCode: 'FG-001', OrderedQuantity: 6 }] });
  assert.equal(again.success, true, again.error);
  ls = await lines(s.batchId);
  assert.deepEqual(ls.map(l => [l.LineID, l.OrderedQuantity]), [[ls[0].LineID, 6]]);

  await saveBatch({ BatchID: s.batchId, Origin: 'Production', Lines: [{ LineID: ls[0].LineID, ItemCode: 'FG-001', OrderedQuantity: 6 }, { ItemCode: 'FG-002', OrderedQuantity: 2 }] });
  const sub = await act('submitJobOrderBatch', { batchId: s.batchId });
  assert.deepEqual(sub, { success: true, batchNumber: 'JOB-26-01-000001' });
  assert.deepEqual((await lines(s.batchId)).map(l => [l.SubJONumber, l.Status]), [['JOB-26-01-000001/01', 'Open'], ['JOB-26-01-000001/02', 'Open']]);
  assert.equal((await val('jobOrderBatches/' + s.batchId)).Status, 'Submitted');
  assert.equal((await saveBatch({ BatchID: s.batchId, Origin: 'Production' })).error, 'Only a Draft batch can be edited.');
  assert.equal((await act('deleteDraftJobOrderBatch', { batchId: s.batchId })).error, 'Only a Draft batch can be deleted.');
  assert.equal((await act('submitJobOrderBatch', { batchId: s.batchId })).error, 'Only a Draft batch can be submitted.');
});

test('Sales line: amend -> revise -> accept -> stop request -> stopped; withdraw only before acceptance', async () => {
  await reset(fixture());
  const s = await saveBatch({ Origin: 'Sales', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 5, TargetDate: '2026-10-01' }, { ItemCode: 'FG-002', OrderedQuantity: 1, TargetDate: '2026-10-01' }] });
  await act('submitJobOrderBatch', { batchId: s.batchId });
  const [a, b] = await lines(s.batchId);
  assert.equal(a.Status, 'Pending Acceptance');

  assert.equal((await act('requestJobOrderLineAmendment', { lineId: a.LineID, proposedQuantity: 4, proposedDate: '2026-10-15', note: '' })).error, 'Explain what you\'d like changed.');
  assert.deepEqual(await act('requestJobOrderLineAmendment', { lineId: a.LineID, proposedQuantity: 4, proposedDate: '2026-10-15', note: 'Only 4 possible' }), { success: true });
  assert.equal((await val('jobOrderLines/' + a.LineID)).Status, 'Amendment Requested');
  assert.equal((await act('acceptJobOrderLine', { lineId: a.LineID })).error, 'Only a line Pending Acceptance can be accepted.');

  assert.deepEqual(await act('reviseAndResubmitJobOrderLine', { lineId: a.LineID, revisedQuantity: 4, revisedDate: '2026-10-15' }), { success: true });
  let l = await val('jobOrderLines/' + a.LineID);
  assert.deepEqual([l.Status, l.OrderedQuantity, l.TargetDate, l.AmendmentNote], ['Pending Acceptance', 4, '2026-10-15', undefined]);

  assert.deepEqual(await act('acceptJobOrderLine', { lineId: a.LineID }), { success: true });
  assert.equal((await act('withdrawJobOrderLine', { lineId: a.LineID })).error, 'Only a not-yet-accepted line can be withdrawn — once Accepted, request a Stop instead.');
  assert.equal((await act('cancelDirectJobOrderLine', { lineId: a.LineID })).error, 'Only a Production-direct line can be self-cancelled this way — a Sales-triggered one needs a Stop request instead.');
  assert.deepEqual(await act('requestJobOrderLineStop', { lineId: a.LineID, note: 'Customer cancelled' }), { success: true });
  assert.deepEqual(await act('acceptJobOrderLineStop', { lineId: a.LineID }), { success: true });
  l = await val('jobOrderLines/' + a.LineID);
  assert.deepEqual([l.Status, l.StopRequestNote, l.StoppedBy], ['Stopped', 'Customer cancelled', 'admin']);

  assert.deepEqual(await act('withdrawJobOrderLine', { lineId: b.LineID }), { success: true });
  assert.equal((await val('jobOrderLines/' + b.LineID)).Status, 'Cancelled');
});

test('Production line: cancel directly; stop requests are Sales-only', async () => {
  await reset(fixture());
  const s = await saveBatch({ Origin: 'Production', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 5 }] });
  await act('submitJobOrderBatch', { batchId: s.batchId });
  const [a] = await lines(s.batchId);
  assert.equal((await act('requestJobOrderLineStop', { lineId: a.LineID, note: 'x' })).error, 'Only a Sales-triggered line can have a stop requested.');
  assert.equal((await act('acceptJobOrderLine', { lineId: a.LineID })).error, 'Only a line Pending Acceptance can be accepted.');
  assert.deepEqual(await act('cancelDirectJobOrderLine', { lineId: a.LineID }), { success: true });
  assert.equal((await act('cancelDirectJobOrderLine', { lineId: a.LineID })).error, 'Only an Open or In Progress line can be cancelled.');
});

test('lists: produced quantity is summed live from Production postings, reversals netted; company-scoped', async () => {
  await reset(fixture());
  const s = await saveBatch({ Origin: 'Production', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 10 }] });
  await act('submitJobOrderBatch', { batchId: s.batchId });
  const [a] = await lines(s.batchId);
  await put('stock/transactions', {
    P1: { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', Lines: [{ ItemCode: 'FG-001', JobOrderLineID: a.LineID, Direction: 'In', Quantity: 7 }] },
    P2: { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', Lines: [{ ItemCode: 'FG-001', JobOrderLineID: a.LineID, Direction: 'In', Quantity: 2 }] },
    P2R: { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', ReversalOfProduction: 'P2', Lines: [{ ItemCode: 'FG-001', JobOrderLineID: a.LineID, Direction: 'Out', Quantity: 2 }] },
    PD: { TransactionType: 'Production', Status: 'Draft', CompanyID: 'C1', Lines: [{ ItemCode: 'FG-001', JobOrderLineID: a.LineID, Direction: 'In', Quantity: 50 }] },
    PX: { TransactionType: 'Production', Status: 'Posted', CompanyID: 'C1', Lines: [{ ItemCode: 'FG-001', JobOrderLineID: 'OTHER', Direction: 'In', Quantity: 50 }] }
  });
  const batches = await act('getJobOrderBatches', { limit: 50 });
  assert.equal(batches.total, 1);
  assert.equal(batches.entries[0].Lines[0].ProducedQuantity, 7);
  const flat = await act('getJobOrderLinesFlat', {});
  assert.deepEqual(flat.entries.map(l => [l.SubJONumber, l.Origin, l.ProducedQuantity]), [['JOB-26-01-000001/01', 'Production', 7]]);
  assert.equal((await act('getJobOrderBatches', {}, 'u-other')).total, 0);
  assert.equal((await act('getJobOrderLinesFlat', {}, 'u-other')).total, 0);
});

test('Sales Order shortfall picker: ordered minus active reservations, open orders of that company only', async () => {
  const f = fixture();
  f.salesOrders = {
    SO1: { SONumber: 'SO-1', CompanyID: 'C1', Status: 'Partially Reserved', ConfirmedAt: '2026-09-01', Lines: [{ LineID: 'L1', ItemCode: 'FG-001', WarehouseID: 'WH1', OrderedQuantity: 10 }, { LineID: 'L2', ItemCode: 'FG-002', WarehouseID: 'WH1', OrderedQuantity: 5 }] },
    SO2: { SONumber: 'SO-2', CompanyID: 'C1', Status: 'Draft', Lines: [{ LineID: 'L1', ItemCode: 'FG-001', WarehouseID: 'WH1', OrderedQuantity: 9 }] },
    SO3: { SONumber: 'SO-3', CompanyID: 'C1', Status: 'Reserved', Lines: [{ LineID: 'L1', ItemCode: 'FG-001', WarehouseID: 'WH1', OrderedQuantity: 2 }] },
    SO9: { SONumber: 'SO-9', CompanyID: 'C2', Status: 'Partially Reserved', Lines: [{ LineID: 'L1', ItemCode: 'FG-001', WarehouseID: 'WH1', OrderedQuantity: 9 }] }
  };
  f.stock = { reservations: {
    R1: { SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'L1', Status: 'Active', Quantity: 4 },
    R2: { SourceType: 'SalesOrder', SourceID: 'SO1', SourceLineID: 'L1', Status: 'Released', Quantity: 3 },
    R3: { SourceType: 'SalesOrder', SourceID: 'SO3', SourceLineID: 'L1', Status: 'Active', Quantity: 2 }
  } };
  await reset(f);
  const opts = await act('getSalesOrderLineShortfallOptions', { itemCode: 'FG-001', companyId: 'C1' });
  assert.deepEqual(opts, [{ SOID: 'SO1', SONumber: 'SO-1', SOLineID: 'L1', WarehouseID: 'WH1', ShortfallQuantity: 6, ConfirmedAt: '2026-09-01' }]);
  assert.deepEqual(await act('getSalesOrderLineShortfallOptions', { itemCode: 'FG-001', companyId: '' }), []);

  // A Sales line keeps the chosen links.
  const s = await saveBatch({ Origin: 'Sales', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 6, TargetDate: '2026-10-01', LinkedSalesOrderLines: [{ SOID: 'SO1', SOLineID: 'L1', SONumber: 'SO-1' }, { SOID: '', SOLineID: 'x' }] }] });
  assert.deepEqual((await lines(s.batchId))[0].LinkedSalesOrderLines, [{ SOID: 'SO1', SOLineID: 'L1', SONumber: 'SO-1' }]);
});

test('access: Viewer cannot draft or act; delete removes a draft batch and its lines', async () => {
  await reset(fixture());
  assert.equal((await saveBatch({ Origin: 'Production', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 1 }] }, 'u-viewer')).success, false);
  const s = await saveBatch({ Origin: 'Production', Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 1 }] });
  assert.equal((await act('submitJobOrderBatch', { batchId: s.batchId }, 'u-viewer')).success, false);
  assert.equal((await act('submitJobOrderBatch', { batchId: s.batchId }, 'u-other')).success, false);
  assert.equal((await act('deleteDraftJobOrderBatch', { batchId: s.batchId }, 'u-viewer')).success, false);
  assert.deepEqual(await act('deleteDraftJobOrderBatch', { batchId: s.batchId }), { success: true });
  assert.equal(await val('jobOrderBatches/' + s.batchId), null);
  assert.deepEqual(await lines(s.batchId), []);
});
