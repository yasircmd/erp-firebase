// PHYSICALCOUNT through its screen's callables: draft, post (variance
// recomputed against the CURRENT ledger, never the draft-time snapshot),
// clean count, surplus valuation, approval gate, reversal, access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.coa['A-WO'] = { AccountCode: '5200', AccountName: 'Stock Write-off', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.items.I1.WriteOffAccountID = 'A-WO';
  f.items.I2 = { ItemCode: 'RM-002', ItemName: 'Bolt', Category: 'RawMaterial', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.stock = { ledger: {
    I1: { WH1: { Quantity: 10, AvgCost: 5, TotalValue: 50 }, WH2: { Quantity: 4, AvgCost: 5, TotalValue: 20 } }
  } };
  return f;
}
test.after(async () => { await app.delete(); });

const ledger = async (i, w) => { const l = (await val('stock/ledger/' + i + '/' + w)) || {}; return [l.Quantity || 0, l.AvgCost || 0, l.TotalValue || 0]; };
const line = (o) => Object.assign({ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', Description: 'Count', CostCenterID: 'CC1' }, o);
const draft = (lines, extra) => call('u-admin', 'savePhysicalCountDraft', {
  pcData: Object.assign({ TransactionDate: D, Description: 'Cycle count', CompanyID: 'C1', Lines: lines }, extra || {})
});
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId }))
  .Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

test('shortfall: variance vs CURRENT ledger (not the draft snapshot) posts Out + write-off GL; clean line kept for audit', async () => {
  await reset(fixture());
  const s = await draft([line({ CountedQuantity: 7, SystemQuantity: 10 }), line({ WarehouseID: 'WH2', CountedQuantity: 4, SystemQuantity: 4 })]);
  assert.equal(s.success, true, s.error);
  assert.match(s.pcId, /^PCD-/);
  // Stock moves after the count was entered: the snapshot (10) is now stale.
  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 12, AvgCost: 5, TotalValue: 60 });

  const p = await call('u-admin', 'postPhysicalCount', { pcId: s.pcId });
  assert.equal(p.success, true, p.error);
  assert.equal(p.status, 'Posted');
  assert.equal(p.cleanCount, false);
  assert.deepEqual(await ledger('I1', 'WH1'), [7, 5, 35], 'adjusted by 12-7=5, not by the stale 10-7=3');
  assert.deepEqual(await ledger('I1', 'WH2'), [4, 5, 20]);

  const rec = await val('stock/transactions/' + s.pcId);
  assert.equal(rec.Status, 'Posted');
  assert.deepEqual(rec.Lines.map(l => [l.WarehouseID, l.SystemQuantity, l.SystemQuantityAtPosting, l.Variance]),
    [['WH1', 10, 12, -5], ['WH2', 4, 4, 0]]);
  assert.deepEqual(await jvLines(rec.LinkedJVID), [['1300', 0, 25], ['5200', 25, 0]]);
});

test('surplus is valued at current average cost; surplus with no cost basis is refused', async () => {
  await reset(fixture());
  const s = await draft([line({ CountedQuantity: 13 })]);
  const p = await call('u-admin', 'postPhysicalCount', { pcId: s.pcId });
  assert.equal(p.success, true, p.error);
  assert.deepEqual(await ledger('I1', 'WH1'), [13, 5, 65]);
  assert.deepEqual(await jvLines((await val('stock/transactions/' + s.pcId)).LinkedJVID), [['1300', 15, 0], ['5200', 0, 15]]);

  const z = await draft([line({ ItemID: 'I2', CountedQuantity: 3 })]);
  const zp = await call('u-admin', 'postPhysicalCount', { pcId: z.pcId });
  assert.equal(zp.success, false);
  assert.match(zp.error, /no existing cost to value the surplus/);
  assert.equal((await val('stock/transactions/' + z.pcId)).Status, 'Draft', 'nothing posted');
});

test('clean count posts with a PC voucher and no GL entry; it cannot be reversed', async () => {
  await reset(fixture());
  const s = await draft([line({ CountedQuantity: 10 })]);
  const p = await call('u-admin', 'postPhysicalCount', { pcId: s.pcId });
  assert.equal(p.success, true, p.error);
  assert.equal(p.cleanCount, true);
  assert.match(p.pcNumber, /PC/);
  const rec = await val('stock/transactions/' + s.pcId);
  assert.equal(rec.Status, 'Posted');
  assert.equal(rec.LinkedJVID, undefined);
  assert.deepEqual(await ledger('I1', 'WH1'), [10, 5, 50]);
  const r = await call('u-admin', 'reversePhysicalCount', { pcId: s.pcId, reversalDate: D });
  assert.deepEqual(r, { success: false, error: 'This was a clean count with no adjustment — there is nothing to reverse.' });
});

test('reversal restores the ledger with a mirror GL entry, once only', async () => {
  await reset(fixture());
  const s = await draft([line({ CountedQuantity: 6 })]);
  await call('u-admin', 'postPhysicalCount', { pcId: s.pcId });
  assert.deepEqual(await ledger('I1', 'WH1'), [6, 5, 30]);

  const r = await call('u-admin', 'reversePhysicalCount', { pcId: s.pcId, reversalDate: D });
  assert.equal(r.success, true, r.error);
  assert.deepEqual(await ledger('I1', 'WH1'), [10, 5, 50]);
  const rev = await val('stock/transactions/' + r.pcId);
  assert.equal(rev.Status, 'Posted');
  assert.equal(rev.ReversalOfCount, s.pcId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1300', 20, 0], ['5200', 0, 20]]);
  assert.equal((await val('stock/transactions/' + s.pcId)).ReversedByCount, r.pcId);

  const again = await call('u-admin', 'reversePhysicalCount', { pcId: s.pcId, reversalDate: D });
  assert.deepEqual(again, { success: false, error: 'This Physical Count has already been reversed.' });
});

test('a reversal entry cannot itself be reversed (Code.gs re-applied it: 10 -> 6 -> 10 -> 14)', async () => {
  await reset(fixture());
  const s = await draft([line({ CountedQuantity: 6 })]);
  await call('u-admin', 'postPhysicalCount', { pcId: s.pcId });
  const r = await call('u-admin', 'reversePhysicalCount', { pcId: s.pcId, reversalDate: D });
  assert.deepEqual(await ledger('I1', 'WH1'), [10, 5, 50]);
  const rr = await call('u-admin', 'reversePhysicalCount', { pcId: r.pcId, reversalDate: D });
  assert.deepEqual(rr, { success: false, error: 'A reversal entry cannot itself be reversed.' });
  assert.deepEqual(await ledger('I1', 'WH1'), [10, 5, 50], 'ledger untouched');
});

test('approval gate: nothing moves until approved; variance recomputed at approval time', async () => {
  const f = fixture();
  f.approvalConfigurations = { PHYSICALCOUNT: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PHYSICALCOUNT: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await draft([line({ CountedQuantity: 8 })]);
  const p = await call('u-admin', 'postPhysicalCount', { pcId: s.pcId });
  assert.deepEqual(p, { success: true, status: 'PendingApproval' });
  assert.deepEqual(await ledger('I1', 'WH1'), [10, 5, 50], 'nothing moves before approval');

  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 11, AvgCost: 5, TotalValue: 55 });
  const d = await call('u-approver', 'decidePhysicalCountApproval', { pcId: s.pcId, levelNumber: 1, decision: 'Approved', reason: '' });
  assert.equal(d.success, true, d.error);
  assert.equal(d.status, 'Approved');
  assert.deepEqual(await ledger('I1', 'WH1'), [8, 5, 40]);
  assert.equal((await val('stock/transactions/' + s.pcId)).Lines[0].Variance, -3);
});

test('validation, delete, list and access checks', async () => {
  await reset(fixture());
  assert.match((await draft([line({ CountedQuantity: -1 })])).error, /counted quantity of zero or more/);
  assert.match((await draft([line({ CountedQuantity: 1, Description: '' })])).error, /description is required/);
  assert.match((await draft([line({ CountedQuantity: 1, WarehouseID: 'CC1' })])).error, /location not found/);
  assert.match((await draft([])).error, /at least one line/);

  const viewer = await call('u-viewer', 'savePhysicalCountDraft', { pcData: { TransactionDate: D, Description: 'x', CompanyID: 'C1', Lines: [line({ CountedQuantity: 1 })] } });
  assert.equal(viewer.success, false);
  const other = await call('u-other', 'savePhysicalCountDraft', { pcData: { TransactionDate: D, Description: 'x', CompanyID: 'C1', Lines: [line({ CountedQuantity: 1 })] } });
  assert.deepEqual(other, { success: false, error: 'You do not have access to that company.' });

  const s = await draft([line({ CountedQuantity: 9 })]);
  const list = await call('u-admin', 'getPhysicalCountEntries', { limit: 'all' });
  assert.deepEqual(list.entries.map(e => e.CountID), [s.pcId]);
  assert.equal((await call('u-other', 'getPhysicalCountEntries', {})).total, 0, 'other company sees nothing');
  assert.equal((await call('u-viewer', 'postPhysicalCount', { pcId: s.pcId })).success, false);

  assert.deepEqual(await call('u-admin', 'deletePhysicalCountDraft', { pcId: s.pcId }), { success: true });
  assert.equal(await val('stock/transactions/' + s.pcId), null);
  assert.deepEqual(await ledger('I1', 'WH1'), [10, 5, 50]);
});
