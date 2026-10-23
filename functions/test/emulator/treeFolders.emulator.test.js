// A menu item opens a module or holds sub-items, never both, and a
// top-level item (an area of the menu) opens none (bug, owner, 2026-10-23): a top-level folder linked to Support (not Corporate 100's)
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
  assert.match(r.error, /A top-level item is an area of the menu: it cannot open a module/);
  assert.equal((await rtdb.ref('tree/F1/ModuleID').get()).val(), '', 'unchanged');
  // A folder below the top level: refused for its sub-items.
  await rtdb.ref('tree/F2').set(node('Settings', 'F1', 5));
  await rtdb.ref('tree/N6').set(node('Numbering', 'F2', 6, 'NUMBERING'));
  r = await save({ NodeID: 'F2', Text: 'Settings', ParentID: 'F1', ModuleID: 'COA', AllowedRoles: ['Admin'] });
  assert.match(r.error, /has sub-items, so it is a folder: it cannot open a module/);
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

test('a top-level item opens no module, whether saved or dragged there; nothing goes under a module item by dragging', async () => {
  let r = await save({ Text: 'Mistake', ParentID: '', ModuleID: 'JV', AllowedRoles: ['Admin'] });
  assert.equal(r.success, false);
  assert.match(r.error, /A top-level item is an area of the menu: it cannot open a module/);
  r = await save({ NodeID: 'N1', Text: 'Tree Management', ParentID: '', ModuleID: 'TREEMGMT', AllowedRoles: ['Admin'] });
  assert.match(r.error, /top-level item is an area/, 'moving a module item to the top level');
  // Dragging: a module item dropped beside a top-level item would go to the top level.
  r = await call('u-admin', 'moveTreeNode', { draggedNodeId: 'N2', targetNodeId: 'F1', position: 'after' });
  assert.equal(r.success, false);
  assert.match(r.error, /"Roles" opens a module, so it cannot go to the top level/);
  assert.equal((await rtdb.ref('tree/N2/ParentID').get()).val(), 'F1', 'not moved');
  // The data already has a module item at the top level (N3): a sibling dropped beside it is fine,
  // but nothing can be dropped under a module item (only by bad data).
  await rtdb.ref('tree/N5').set(node('Under JV', 'N3', 5));
  r = await call('u-admin', 'moveTreeNode', { draggedNodeId: 'N1', targetNodeId: 'N5', position: 'before' });
  assert.match(r.error, /"Journal Entry" opens a module, so it cannot hold sub-items/);
  // Still fine: a top-level area with no module; a folder dragged beside another.
  assert.equal((await save({ Text: 'REPORTS', ParentID: '', ModuleID: '', AllowedRoles: ['Admin'] })).success, true);
  assert.deepEqual(await call('u-admin', 'moveTreeNode', { draggedNodeId: 'F1', targetNodeId: 'N3', position: 'after' }), { success: true });
  // The top-level module item already there can be put right: Linked Module None.
  assert.equal((await save({ NodeID: 'N3', Text: 'Journal Entry', ParentID: '', ModuleID: '', AllowedRoles: ['Admin'] })).success, true);
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
