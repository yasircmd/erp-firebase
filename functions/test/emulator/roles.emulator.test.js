// ROLES (roles + permission matrix) through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

test('roles: list, create, rename; delete refused while assigned', async () => {
  const roles = await call('u-admin', 'getRoles');
  assert.ok(roles.some(r => r.RoleID === 'Admin'));
  const r = await call('u-admin', 'saveRole', { roleData: { Name: 'Storekeeper', Description: 'Stores' } });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal((await call('u-admin', 'saveRole', { roleData: { RoleID: r.roleId, Name: 'Store Keeper' } })).success, true);
  assert.equal((await val('roles/' + r.roleId)).Name, 'Store Keeper');
  assert.equal((await call('u-admin', 'deleteRole', { roleId: 'Viewer' })).error, 'This role is assigned to one or more users. Reassign them first.');
  assert.deepEqual(await call('u-admin', 'deleteRole', { roleId: r.roleId }), { success: true });
  assert.equal(await val('roles/' + r.roleId), null);
});

test('permission matrix: read, save, lock-out protection', async () => {
  const m = await call('u-admin', 'getModulePermissionsMatrix');
  assert.ok(m.modules.length > 40);
  assert.deepEqual(m.permissions.UOM.write, ['Admin']);
  const next = JSON.parse(JSON.stringify(m.permissions));
  next.UOM.write = ['Admin', 'Viewer'];
  assert.deepEqual(await call('u-admin', 'saveAllModulePermissions', { allPermissions: next }), { success: true });
  assert.deepEqual((await val('permissions/UOM')).write, ['Admin', 'Viewer']);
  const lockout = JSON.parse(JSON.stringify(next)); lockout.ROLES.write = [];
  assert.equal((await call('u-admin', 'saveAllModulePermissions', { allPermissions: lockout })).error,
    'At least one role must keep write access to ROLES to avoid locking everyone out.');
  assert.deepEqual((await val('permissions/ROLES')).write, ['Admin'], 'unchanged');
});

test('Viewer cannot manage roles', async () => {
  assert.equal((await call('u-viewer', 'saveRole', { roleData: { Name: 'x' } })).error, 'You do not have permission to manage roles.');
});
