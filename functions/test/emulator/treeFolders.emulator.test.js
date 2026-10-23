// A menu item opens a module or holds sub-items, never both (bug, owner,
// 2026-10-23): a top-level folder linked to Support (not Corporate 100's)
// dropped out of the menu with everything under it, Tree Management too, so
// it could not be undone. Tree Management refuses it now, and the menu keeps
// such a folder (with what is under it) when the data already has one.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rtdb, reset, baseFixture, call } = require('./_helpers');

test.after(async () => { await Promise.all(require('firebase-admin').apps.map(a => a.delete())); });

const node = (Text, ParentID, Order, ModuleID) => ({ Text, ParentID, Order, ModuleID: ModuleID || '', AllowedRoles: ['Admin'] });
const TREE = { F1: node('SYSTEM ADMIN', '', 0), N1: node('Tree Management', 'F1', 1, 'TREEMGMT'), N2: node('Roles', 'F1', 2, 'ROLES'), N3: node('Journal Entry', '', 3, 'JV') };
const save = nodeData => call('u-admin', 'saveTreeNode', { nodeData });
const menu = async () => (await call('u-admin', 'getMyTree', {})).map(t => t.depth + ' ' + t.text + (t.moduleId ? ' [' + t.moduleId + ']' : ''));

test.beforeEach(async () => { const f = baseFixture(); f.tree = TREE; await reset(f); });

test('a folder cannot be linked to a module, nor a module item given sub-items', async () => {
  let r = await save({ NodeID: 'F1', Text: 'SYSTEM ADMIN', ParentID: '', ModuleID: 'SUPPORT', AllowedRoles: ['Admin'] });
  assert.equal(r.success, false);
  assert.match(r.error, /has sub-items, so it is a folder: it cannot open a module/);
  assert.equal((await rtdb.ref('tree/F1/ModuleID').get()).val(), '', 'unchanged');
  r = await save({ Text: 'Under a module', ParentID: 'N3', ModuleID: '', AllowedRoles: ['Admin'] });
  assert.equal(r.success, false);
  assert.match(r.error, /"Journal Entry" opens a module, so it cannot hold sub-items/);
  // Moving an item under a module item: refused the same way.
  r = await save({ NodeID: 'N2', Text: 'Roles', ParentID: 'N3', ModuleID: 'ROLES', AllowedRoles: ['Admin'] });
  assert.match(r.error, /opens a module, so it cannot hold sub-items/);
  // What still works: a module on an item without sub-items; a sub-item under a folder.
  assert.equal((await save({ NodeID: 'N2', Text: 'Roles', ParentID: 'F1', ModuleID: 'COA', AllowedRoles: ['Admin'] })).success, true);
  assert.equal((await save({ Text: 'Users', ParentID: 'F1', ModuleID: 'USERMGMT', AllowedRoles: ['Admin'] })).success, true);
});

test('a folder already linked to a module stays in the menu with what is under it, and can be put right', async () => {
  // The live data: the folder linked to Support, which Corporate 100 does not have.
  await rtdb.ref('tree/F1/ModuleID').set('SUPPORT');
  assert.deepEqual(await menu(), ['0 SYSTEM ADMIN', '1 Tree Management [TREEMGMT]', '1 Roles [ROLES]', '0 Journal Entry [JV]'], 'Tree Management is reachable');
  // Put right in Tree Management: the folder's module taken off.
  assert.equal((await save({ NodeID: 'F1', Text: 'SYSTEM ADMIN', ParentID: '', ModuleID: '', AllowedRoles: ['Admin'] })).success, true);
  assert.equal((await rtdb.ref('tree/F1/ModuleID').get()).val(), '');
  // A leaf naming a module the corporate does not have is still left out.
  await rtdb.ref('tree/N4').set(node('Support', '', 4, 'SUPPORT'));
  assert.equal((await menu()).some(t => /Support/.test(t)), false);
});
