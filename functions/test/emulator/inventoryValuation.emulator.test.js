// INVENTORYVALUATION (valuation list for Job-Order-eligible items) through
// its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

test.before(async () => {
  const f = baseFixture();
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.items.FG2 = { ItemCode: 'FG-002', ItemName: 'No BOM', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.boms = { B1: { ParentItemID: 'FG1', Status: 'Active' } };
  await reset(f);
});
test.after(async () => { await app.delete(); });

test('eligible = active FG/SFG with an active BOM', async () => {
  const el = await call('u-admin', 'getEligibleJobOrderItems');
  assert.deepEqual(el.map(i => i.ItemCode), ['FG-001']);
});

test('add, list, deactivate; ineligible item and zero cost refused', async () => {
  const r = await call('u-admin', 'saveInventoryValuationLine', { lineData: { CompanyID: 'C1', ItemCode: 'FG-001', UnitCost: 42, EffectiveFrom: today } });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.match((await call('u-admin', 'saveInventoryValuationLine', { lineData: { CompanyID: 'C1', ItemCode: 'FG-002', UnitCost: 1, EffectiveFrom: today } })).error, /has no active BOM/);
  assert.equal((await call('u-admin', 'saveInventoryValuationLine', { lineData: { CompanyID: 'C1', ItemCode: 'FG-001', UnitCost: 0, EffectiveFrom: today } })).error, 'Unit cost must be greater than zero.');
  const lines = await call('u-admin', 'getInventoryValuationLines', { companyId: 'C1' });
  assert.ok(JSON.stringify(lines).includes('FG-001'));
  assert.deepEqual(await call('u-admin', 'deactivateInventoryValuationLine', { lineId: r.lineId }), { success: true });
  assert.equal((await val('inventoryValuationLines/' + r.lineId)).Status, 'Inactive');
});

test('Viewer cannot modify; other company refused', async () => {
  assert.equal((await call('u-viewer', 'saveInventoryValuationLine', { lineData: { CompanyID: 'C1', ItemCode: 'FG-001', UnitCost: 1, EffectiveFrom: today } })).error, 'You do not have permission to modify Inventory Valuation List.');
  await assert.rejects(call('u-other', 'getInventoryValuationLines', { companyId: 'C1' }), /You do not have access to that company\./);
});
