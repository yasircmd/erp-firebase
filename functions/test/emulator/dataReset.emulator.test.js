// DATARESET through its screen's callables. Stock is built with the real
// posting callables (as u-admin, role 'Admin'); Data Reset itself needs
// the literal role 'ADMIN' (requireAdminRole_), so it runs as u-root.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, today, val, put } = require('./_helpers');

const state = {};
const strip = (ledger) => {
  const out = {};
  Object.keys(ledger || {}).forEach(i => Object.keys(ledger[i]).forEach(w => {
    const e = ledger[i][w];
    out[i + '|' + w] = { Quantity: e.Quantity, AvgCost: e.AvgCost, TotalValue: e.TotalValue };
  }));
  return out;
};
const ledgerNow = async () => strip(await val('stock/ledger'));
const line = (o) => Object.assign({ ItemID: 'I1', EnteredUOMID: 'UOM-PCS', Description: 'x' }, o);

async function grn(qty, cost) {
  const s = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [line({ WarehouseID: 'WH1', EnteredQuantity: qty, UnitCost: cost })] });
  assert.equal((await call('u-admin', 'postGrn', { grnId: s.grnId })).success, true);
  return s.grnId;
}
async function move(from, to, qty) {
  const s = await call('u-admin', 'saveWarehouseMovementDraft', { TransactionDate: today, Description: 'Move', CompanyID: 'C1',
    Lines: [line({ FromWarehouseID: from, ToWarehouseID: to, EnteredQuantity: qty })] });
  assert.equal((await call('u-admin', 'postWarehouseMovement', { moveId: s.moveId })).success, true);
  return s.moveId;
}

test.before(async () => {
  const f = baseFixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.boms = { B1: { ParentItemCode: 'FG-1', ParentItemName: 'Panel', BOMVersion: 1, Status: 'Active' } };
  await reset(f);

  // Drafted FIRST, posted LAST: its CreatedAt precedes the stock it draws on.
  const mi = await call('u-admin', 'saveMaterialIssueDraft', { TransactionDate: today, Description: 'Early draft', CompanyID: 'C1', EntryType: 'Issue', CostCenterID: 'CC1',
    Lines: [line({ WarehouseID: 'WH2', EnteredQuantity: 3, CostCenterID: 'CC1' })] });
  assert.equal(mi.success, true, JSON.stringify(mi));
  state.grnA = await grn(10, 5);
  state.grnB = await grn(10, 8);                 // WH1 20 @ 6.5
  await move('WH1', 'WH2', 4);                   // WH1 16, WH2 4 @ 6.5
  assert.equal((await call('u-admin', 'postMaterialIssue', { miId: mi.miId })).success, true); // WH2 1
  const back = await move('WH2', 'WH1', 1);      // WH2 0, WH1 17
  assert.equal((await call('u-admin', 'reverseWarehouseMovement', { moveId: back, reversalDate: today })).success, true); // WH2 1, WH1 16
  state.live = await ledgerNow();
  assert.equal(state.live['I1|WH2'].Quantity, 1);
  assert.equal(state.live['I1|WH1'].Quantity, 16);
});
test.after(async () => { await app.delete(); });

test('only the literal ADMIN role gets in; the typed phrase is required', async () => {
  await assert.rejects(call('u-admin', 'getDataResetCounts'), /Only Admin users can access Data Reset\./);
  assert.deepEqual(await call('u-admin', 'recalculateStockLedger', { confirmPhrase: 'DELETE' }), { success: false, error: 'Only Admin users can access Data Reset.' });
  assert.deepEqual(await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'delete' }), { success: false, error: 'Type DELETE exactly to confirm.' });
  assert.deepEqual(await call('u-root', 'clearDataCategories', { categoryKeys: ['boms'], confirmPhrase: '' }), { success: false, error: 'Type DELETE exactly to confirm.' });
  assert.ok(await val('boms/B1'), 'nothing cleared');
});

test('recalculateStockLedger rebuilds exactly the live ledger (movements, posting order, reversals)', async () => {
  await put('stock/ledger/I1/WH1', { Quantity: 999, AvgCost: 1, TotalValue: 999 }); // drift to repair
  await put('stock/ledger/IX/WH9', { Quantity: 5, AvgCost: 1, TotalValue: 5 });     // stale key to drop
  const r = await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.count, 6);
  assert.deepEqual(await ledgerNow(), state.live);
});

test('a replay failure changes nothing and names the transaction; the lock is released', async () => {
  await put('stock/transactions/BAD', { TransactionType: 'MaterialIssue', TransactionNumber: 'MI-BAD', Status: 'Posted',
    CreatedAt: '2999-01-01T00:00:00.000Z', PostedAt: '2999-01-01T00:00:00.000Z',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH2', Direction: 'Out', Quantity: 50 }] });
  const r = await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' });
  assert.equal(r.success, false);
  assert.match(r.error, /^MI-BAD: Line 1: insufficient stock .* Nothing was changed\.$/);
  assert.deepEqual(await ledgerNow(), state.live);
  await put('stock/transactions/BAD', null);
  assert.equal((await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' })).success, true);
});

test('Physical Counts posted without adjustment details are refused by name, not dropped', async () => {
  await put('stock/transactions/PC-OLD', { TransactionType: 'PhysicalCount', TransactionNumber: 'PC-26-000009', Status: 'Posted',
    CreatedAt: today, PostedAt: today, Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', CountedQuantity: 10, Variance: -6 }] });
  const r = await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' });
  assert.equal(r.success, false);
  assert.match(r.error, /PC-26-000009\. Nothing was changed\.$/);
  assert.deepEqual(await ledgerNow(), state.live);
  // A clean count (no variance, no Direction) replays as a no-op.
  await put('stock/transactions/PC-OLD/Lines/0/Variance', 0);
  assert.equal((await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' })).success, true);
  assert.deepEqual(await ledgerNow(), state.live);
  await put('stock/transactions/PC-OLD', null);
});

test('getDataResetCounts counts every path of every category', async () => {
  const c = await call('u-root', 'getDataResetCounts');
  assert.equal(Object.keys(c).length, 18 + 29, 'the ported 18, and every module\'s since (docs/modules/DATA_RESET.md)');
  // New development: Opening Balances (docs/modules/OPENING_BALANCES.md).
  assert.deepEqual([c.openingBalanceBatches.label, c.openingBalanceBatches.group, c.openingBalanceBatches.count], ['Opening Balance Batches', 'transactional', 0]);
  // New development: Recurring Journal Entries (docs/modules/RECURRING_JOURNAL.md).
  assert.deepEqual([c.recurringJournals.label, c.recurringJournals.group, c.recurringJournals.count], ['Recurring Journal Entries', 'transactional', 0]);
  // New development: PDC cheques (docs/modules/PDC.md).
  assert.deepEqual([c.pdcCheques.label, c.pdcCheques.group, c.pdcCheques.count], ['PDC Received & Issued', 'transactional', 0]);
  // New development: Fixed Assets (docs/modules/FIXED_ASSETS.md).
  assert.deepEqual([c.fixedAssets.label, c.fixedAssets.group, c.fixedAssets.count], ['Fixed Assets', 'transactional', 0]);
  assert.deepEqual([c.fixedAssetSetup.label, c.fixedAssetSetup.group], ['Fixed Asset Configuration', 'master']);
  const tx = Object.keys(await val('stock/transactions')).length;
  const stockKeys = tx + Object.keys(await val('stock/ledger')).length + Object.keys(await val('stock/counters')).length;
  assert.equal(c.stockData.count, stockKeys);
  const jvs = (await firestore.collection('journalEntries').get()).size;
  assert.equal(c.glEntries.count, jvs + Object.keys(await val('gl/counters') || {}).length);
  assert.equal(c.boms.count, 1);
  assert.deepEqual([c.boms.group, c.items.group], ['transactional', 'master']);
});

test('getCategoryRecords lists summaries', async () => {
  const recs = await call('u-root', 'getCategoryRecords', { categoryKey: 'stockData' });
  assert.equal(recs.length, 6);
  assert.ok(recs.some(r => r.id === state.grnA && /\[GRN, Posted\]$/.test(r.summary)));
  await assert.rejects(call('u-root', 'getCategoryRecords', { categoryKey: 'users' }), /Unknown or unsupported category\./);
});

test('clearSelectedRecords keeps a stock transaction and its GL entry together, from either side', async () => {
  const jvA = (await val('stock/transactions/' + state.grnA)).LinkedJVID;
  const jvB = (await val('stock/transactions/' + state.grnB)).LinkedJVID;
  const r1 = await call('u-root', 'clearSelectedRecords', { categoryKey: 'stockData', recordIds: [state.grnA], confirmPhrase: 'DELETE' });
  assert.deepEqual(r1, { success: true, count: 1, linkedCleared: 1 });
  assert.equal(await val('stock/transactions/' + state.grnA), null);
  assert.equal((await firestore.collection('journalEntries').doc(jvA).get()).exists, false);

  const r2 = await call('u-root', 'clearSelectedRecords', { categoryKey: 'glEntries', recordIds: [jvB], confirmPhrase: 'DELETE' });
  assert.deepEqual(r2, { success: true, count: 1, linkedCleared: 1 });
  assert.equal(await val('stock/transactions/' + state.grnB), null);
  assert.equal((await firestore.collection('journalEntries').doc(jvB).get()).exists, false);

  assert.deepEqual(await call('u-root', 'clearSelectedRecords', { categoryKey: 'stockData', recordIds: [], confirmPhrase: 'DELETE' }),
    { success: false, error: 'Select at least one record to delete.' });
});

test('lifetime audit counters: read, then reset only those two', async () => {
  await rtdb.ref('gl/transactionRefCounter').set(42); // TXN- comes from JV/CBT, none posted here
  assert.deepEqual(await call('u-root', 'getLifetimeAuditCounterValues'), { txn: 42, stk: 6 });
  assert.deepEqual(await call('u-root', 'resetLifetimeAuditCounters', { confirmPhrase: 'DELETE' }), { success: true });
  assert.deepEqual(await call('u-root', 'getLifetimeAuditCounterValues'), { txn: 0, stk: 0 });
  assert.ok(await val('stock/transactions'), 'transactions untouched');
});

test('clearDataCategories wipes RTDB and Firestore paths of the chosen categories only', async () => {
  assert.deepEqual(await call('u-root', 'clearDataCategories', { categoryKeys: ['boms', 'nope'], confirmPhrase: 'DELETE' }),
    { success: false, error: 'Unknown category: nope' });
  assert.ok(await val('boms/B1'));
  const r = await call('u-root', 'clearDataCategories', { categoryKeys: ['glEntries', 'boms'], confirmPhrase: 'DELETE' });
  assert.deepEqual(r, { success: true, cleared: ['GL Journal Entries', 'Bill of Materials'] });
  assert.equal((await firestore.collection('journalEntries').get()).size, 0);
  assert.equal(await val('gl/counters'), null);
  assert.equal(await val('boms'), null);
  assert.ok(await val('stock/transactions'), 'other categories untouched');
  assert.ok(await val('items/I1'));
});
