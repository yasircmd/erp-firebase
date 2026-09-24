// BOM through its screen's callables: save/validate, one Active BOM per
// parent (old version kept as Inactive), circular-recipe rejection,
// deactivate/reactivate (the screen's dynamic [fn](...) call), access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  const item = (code, name, category, company) => ({ ItemCode: code, ItemName: name, Category: category, Status: 'Active', CompanyID: company || 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' });
  Object.assign(f.items, {
    FG1: item('FG-001', 'Panel', 'FinishedGood'),
    SF1: item('SF-001', 'Frame', 'SemiFinishedGood'),
    SF2: item('SF-002', 'Bracket', 'SemiFinishedGood'),
    CN1: item('CN-001', 'Glue', 'Consumable'),
    SC1: item('SC-001', 'Offcut', 'Scrap'),
    X2: item('RM-900', 'Other Co Sheet', 'RawMaterial', 'C2')
  });
  return f;
}
test.after(async () => { await app.delete(); });

const save = (bom, uid) => call(uid || 'u-admin', 'saveBom', { bomData: bom });
const boms = async () => (await call('u-admin', 'getBoms', {})).sort((a, b) => a.EffectiveFrom.localeCompare(b.EffectiveFrom));

test('saves a BOM with normalized components; a new Active version retires the old one', async () => {
  await reset(fixture());
  const r = await save({ ParentItemID: 'FG1', BOMVersion: '1.0', EffectiveFrom: '2026-01-01',
    Components: [{ ComponentItemID: 'I1', Quantity: 2, ScrapPercent: 10 }, { ComponentItemID: 'CN1', Quantity: 0.25 }, { ComponentItemID: '' }] });
  assert.deepEqual(r, { success: true });
  let all = await boms();
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].Components.map(c => [c.ComponentItemCode, c.Quantity, c.ScrapPercent, c.UOMID]),
    [['RM-001', 2, 10, 'UOM-PCS'], ['CN-001', 0.25, 0, 'UOM-PCS']]);
  assert.equal(all[0].Status, 'Active');
  assert.equal(all[0].ParentItemCode, 'FG-001');

  assert.deepEqual(await save({ ParentItemID: 'FG1', BOMVersion: '2.0', EffectiveFrom: '2026-06-01', Components: [{ ComponentItemID: 'I1', Quantity: 3 }] }), { success: true });
  all = await boms();
  assert.deepEqual(all.map(b => [b.BOMVersion, b.Status]), [['1.0', 'Inactive'], ['2.0', 'Active']]);
});

test('rejects a circular recipe, however deep', async () => {
  await reset(fixture());
  assert.equal((await save({ ParentItemID: 'SF1', Components: [{ ComponentItemID: 'SF2', Quantity: 1 }] })).success, true);
  assert.equal((await save({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'SF1', Quantity: 1 }] })).success, true);
  const loop = await save({ ParentItemID: 'SF2', Components: [{ ComponentItemID: 'SF1', Quantity: 1 }] });
  assert.deepEqual(loop, { success: false, error: 'This would create a circular BOM: SF-001\'s own recipe eventually consumes SF-002 again.' });
  // An Inactive BOM is never exploded by production, so it is allowed.
  assert.equal((await save({ ParentItemID: 'SF2', Status: 'Inactive', Components: [{ ComponentItemID: 'SF1', Quantity: 1 }] })).success, true);
  assert.equal((await boms()).length, 3);
});

test('validation', async () => {
  await reset(fixture());
  const err = async (bom) => (await save(bom)).error;
  assert.equal(await err({ Components: [] }), 'Select a parent item.');
  assert.equal(await err({ ParentItemID: 'I1', Components: [{ ComponentItemID: 'CN1', Quantity: 1 }] }), 'Parent item must be a Finished Good or Semi-Finished Good.');
  assert.match(await err({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'SC1', Quantity: 1 }] }), /must be Raw Material, Semi-Finished Good, or Consumable/);
  assert.match(await err({ ParentItemID: 'SF1', Components: [{ ComponentItemID: 'SF1', Quantity: 1 }] }), /cannot be a component of its own BOM/);
  assert.match(await err({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'X2', Quantity: 1 }] }), /belongs to a different company/);
  assert.match(await err({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'I1', Quantity: 0 }] }), /greater than zero/);
  assert.match(await err({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'I1', Quantity: 1, ScrapPercent: 100 }] }), /scrap % must be between 0 and 100/);
  assert.equal(await err({ ParentItemID: 'FG1', Components: [{ ComponentItemID: '' }] }), 'Add at least one component.');
  assert.equal(await val('boms'), null, 'nothing saved');
});

test('deactivate / reactivate via the screen\'s positional call; reactivation re-applies the one-Active rule', async () => {
  await reset(fixture());
  await save({ ParentItemID: 'FG1', BOMVersion: '1.0', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 2 }] });
  await save({ ParentItemID: 'FG1', BOMVersion: '2.0', EffectiveFrom: '2026-06-01', Components: [{ ComponentItemID: 'I1', Quantity: 3 }] });
  const [v1, v2] = await boms();

  assert.deepEqual(await call('u-admin', 'reactivateBom', { __positional: [v1.BOMID] }), { success: true });
  assert.deepEqual((await boms()).map(b => [b.BOMVersion, b.Status]), [['1.0', 'Active'], ['2.0', 'Inactive']]);
  assert.equal((await boms())[0].EffectiveFrom, '2026-01-01', 'effective date kept');

  assert.deepEqual(await call('u-admin', 'deactivateBom', { __positional: [v1.BOMID] }), { success: true });
  assert.deepEqual((await boms()).map(b => b.Status), ['Inactive', 'Inactive']);
  assert.deepEqual(await call('u-admin', 'deactivateBom', { bomId: 'NOPE' }), { success: false, error: 'BOM not found.' });
  assert.equal(v2.Status, 'Active');
});

test('access: Viewer can list but not write', async () => {
  await reset(fixture());
  const denied = { success: false, error: 'You do not have permission to modify Bill of Materials.' };
  assert.deepEqual(await save({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'I1', Quantity: 1 }] }, 'u-viewer'), denied);
  await save({ ParentItemID: 'FG1', Components: [{ ComponentItemID: 'I1', Quantity: 1 }] });
  const [b] = await boms();
  assert.deepEqual(await call('u-viewer', 'deactivateBom', { bomId: b.BOMID }), denied);
  assert.equal((await call('u-viewer', 'getBoms', {})).length, 1);
});
