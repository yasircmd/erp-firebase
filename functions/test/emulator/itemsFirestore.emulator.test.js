// The items in Firestore (owner, 2026-11-14; docs/modules/ITEMS_FIRESTORE.md,
// step 3a, QI6, QI8): saved through the old path into Firestore with their
// search fields; the inventory-account summary kept on every write; the
// move: copy (the newer edit wins), check, finish (export, then delete).
const test = require('node:test');
const assert = require('node:assert/strict');
const { call, reset, baseFixture, rtdb, firestore, val } = require('./_helpers');
const itemStore = require('../../src/itemStore');
const M = require('../../src/itemMigration');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });
const good = { ItemName: 'Hex Bolt M8 Zinc', Category: 'RawMaterial', UOMID: 'UOM-PCS', CompanyID: 'C1', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
const accounts = async () => Object.fromEntries((await firestore.collection('itemAccounts').get()).docs.map(d => [d.id, d.data().Count]));

test('an item saved through the old path is in Firestore, with its search fields; not in the Realtime Database', async () => {
  await reset(baseFixture());
  const r = await call('u-admin', 'saveItem', { itemData: Object.assign({ UserCode: 'BLT-08' }, good) });
  assert.equal(r.success, true, JSON.stringify(r));
  const doc = (await firestore.doc('items/' + r.itemId).get()).data();
  assert.equal(doc.ItemName, 'Hex Bolt M8 Zinc');
  assert.ok(doc._q.Words.includes('bolt') && doc._q.Words.includes('blt'), 'its words, the user code\'s too');
  assert.ok(doc._q.Grams.includes('olt') && doc._q.Grams.includes('inc'), 'inside words (QI2)');
  assert.equal(doc._q.CodeLower, doc.ItemCode.toLowerCase());
  assert.equal(doc._q.UserCodeLower, 'blt-08');
  assert.equal((await rtdb.ref('items/' + r.itemId).get()).val(), null, 'nothing in the Realtime Database');
  assert.equal((await val('items/' + r.itemId)).ItemName, 'Hex Bolt M8 Zinc', 'the old path answers from Firestore');
  assert.deepEqual(Object.keys(await itemStore.byCodeIgnoringCase('blt-08')), [r.itemId]);
});

test('the inventory-account summary follows every item write: create, change of account, delete', async () => {
  const f = baseFixture();
  f.coa['A-INV2'] = { AccountCode: '1310', AccountName: 'Inventory 2', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  delete f.items;
  await reset(f);
  const a = await call('u-admin', 'saveItem', { itemData: good });
  const b = await call('u-admin', 'saveItem', { itemData: Object.assign({}, good, { ItemName: 'Washer' }) });
  assert.deepEqual(await accounts(), { 'C1_A-INV': 2 });
  assert.deepEqual(await itemStore.inventoryAccounts('C1'), { 'A-INV': true });
  await call('u-admin', 'saveItem', { itemData: Object.assign({}, good, { ItemID: b.itemId, ItemName: 'Washer', InventoryAccountID: 'A-INV2' }) });
  assert.deepEqual(await accounts(), { 'C1_A-INV': 1, 'C1_A-INV2': 1 });
  await itemStore.store.remove(a.itemId);
  assert.deepEqual(await itemStore.inventoryAccounts('C1'), { 'A-INV2': true }, 'an account no item uses is gone');
  assert.deepEqual(await itemStore.inventoryAccounts('C2'), {}, 'another company\'s: none');
});

test('the move: copy (the newer edit wins), check, finish (exported, then deleted)', async () => {
  await reset(Object.assign(baseFixture(), { items: {} }));
  // The old items, as they are in the Realtime Database before the deploy.
  const old = {
    I1: Object.assign({}, good, { ItemCode: 'RM-001', ItemName: 'Old one', UpdatedAt: '2026-11-01T00:00:00.000Z' }),
    I2: Object.assign({}, good, { ItemCode: 'RM-002', ItemName: 'Edited in RTDB later', UpdatedAt: '2026-11-10T00:00:00.000Z' }),
    I3: Object.assign({}, good, { ItemCode: 'RM-003', ItemName: 'Old in RTDB', UpdatedAt: '2026-11-01T00:00:00.000Z' })
  };
  await rtdb.ref('items').set(old);
  // Firestore already has I2 older, and I3 edited after the deploy (newer).
  await itemStore.store.putMany({ I2: Object.assign({}, old.I2, { ItemName: 'Stale', UpdatedAt: '2026-11-02T00:00:00.000Z' }), I3: Object.assign({}, old.I3, { ItemName: 'Edited in Firestore', UpdatedAt: '2026-11-12T00:00:00.000Z' }) });
  const c1 = await M.check();
  assert.equal(c1.ok, false);
  assert.deepEqual([c1.missing, c1.differing], [['I1'], ['I2']]);
  const r = await M.copy();
  assert.deepEqual([r.old, r.copied, r.keptNewer], [3, 2, 1]);
  assert.equal((await itemStore.byIds(['I2'])).I2.ItemName, 'Edited in RTDB later', 'the old copy\'s newer edit');
  assert.equal((await itemStore.byIds(['I3'])).I3.ItemName, 'Edited in Firestore', 'Firestore\'s newer edit kept');
  assert.deepEqual(await accounts(), { 'C1_A-INV': 3 }, 'the summary rebuilt');
  assert.equal((await M.check()).ok, true);
  const done = await M.finish();
  assert.equal(done.finished, true);
  assert.match(done.exported, /^item-exports\/100\/.+\.json$/);
  assert.equal((await rtdb.ref('items').get()).val(), null, 'deleted from the Realtime Database');
  const [file] = await require('../../src/firebaseAdmin').firm.bucket().file(done.exported).download();
  assert.deepEqual(Object.keys(JSON.parse(file.toString())).sort(), ['I1', 'I2', 'I3'], 'the export holds every old item');
  assert.equal(Object.keys(await itemStore.all()).length, 3, 'the items stay in Firestore');
});

test('finish refuses while the check fails; Client Management runs the move, Developer write only', async () => {
  await reset(Object.assign(baseFixture(), { items: {} }));
  await rtdb.ref('items').set({ I1: Object.assign({}, good, { ItemCode: 'RM-001' }) });
  const no = await M.finish();
  assert.deepEqual([no.finished, no.missingCount], [false, 1]);
  assert.notEqual((await rtdb.ref('items').get()).val(), null, 'nothing deleted');
  await assert.rejects(call('u-viewer', 'moveDeveloperItems', { CorporateID: '100', action: 'copy' }), /permission to change the corporates/);
  const r = await call('u-admin', 'moveDeveloperItems', { CorporateID: '100', action: 'copy' });
  assert.deepEqual([r.CorporateID, r.action, r.copied], ['100', 'copy', 1]);
  assert.equal((await call('u-admin', 'moveDeveloperItems', { CorporateID: '100', action: 'check' })).ok, true);
});
