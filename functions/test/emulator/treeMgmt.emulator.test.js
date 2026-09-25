// TREEMGMT (module tree & navigation) through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

const state = {};

test('tree seeds on first read; registry available', async () => {
  const nodes = await call('u-admin', 'getTreeNodes');
  assert.ok(nodes.length > 100, 'seeded ' + nodes.length);
  const reg = await call('u-admin', 'getModuleRegistry');
  assert.ok(reg.some(m => m.id === 'GRN'));
});

test('add folder + module item, cycle and unknown-module refused', async () => {
  const f = await call('u-admin', 'saveTreeNode', { nodeData: { Text: 'Test Folder' } });
  assert.equal(f.success, true, JSON.stringify(f));
  const i = await call('u-admin', 'saveTreeNode', { nodeData: { Text: 'Goods Receipt', ParentID: f.nodeId, ModuleID: 'grn', AllowedRoles: ['Admin'] } });
  assert.equal(i.success, true, JSON.stringify(i));
  assert.equal((await val('tree/' + i.nodeId)).ModuleID, 'GRN');
  assert.equal((await call('u-admin', 'saveTreeNode', { nodeData: { Text: 'x', ModuleID: 'NOPE' } })).error, 'Unknown module: NOPE');
  assert.equal((await call('u-admin', 'saveTreeNode', { nodeData: { NodeID: f.nodeId, Text: 'Test Folder', ParentID: i.nodeId } })).error, 'Cannot move an item under one of its own descendants.');
  state.f = f.nodeId; state.i = i.nodeId;
});

test('delete: folder with children refused; leaf ok', async () => {
  assert.equal((await call('u-admin', 'deleteTreeNode', { nodeId: state.f })).error, 'This item has sub-items. Delete or move them first.');
  assert.deepEqual(await call('u-admin', 'deleteTreeNode', { nodeId: state.i }), { success: true });
  assert.equal(await val('tree/' + state.i), null);
});

test('move + Viewer refused', async () => {
  const a = await call('u-admin', 'saveTreeNode', { nodeData: { Text: 'Leaf A', ParentID: state.f } });
  assert.deepEqual(await call('u-admin', 'moveTreeNode', { draggedNodeId: a.nodeId, targetNodeId: state.f, position: 'inside' }), { success: true });
  assert.equal((await call('u-viewer', 'saveTreeNode', { nodeData: { Text: 'x' } })).error, 'You do not have permission to modify the module tree.');
});
