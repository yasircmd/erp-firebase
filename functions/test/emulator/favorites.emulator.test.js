// Favourites (owner, 2026-10-24; docs/modules/UX_ROUND2.md item 16, decision
// 270): up to 5 per role, set in Roles & Permissions; a user with no
// favourites of their own gets their role's, only the modules they may
// open; the first change makes the list theirs, and nobody's own choice is
// overwritten.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });

test.beforeEach(async () => {
  const f = baseFixture();
  // Viewer may not open GRN.
  f.permissions.GRN.access = ['Admin'];
  f.userFavorites = { 'u-other': [{ moduleId: 'JV', label: 'Journal Entry' }] };
  await reset(f);
});
const ids = list => list.map(f => f.moduleId);

test('a role\'s defaults: set with the right, at most 5, known modules only', async () => {
  const saved = await call('u-admin', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: ['JV', 'GRN', 'JV', 'CBT'] });
  assert.deepEqual(ids(saved.favorites), ['JV', 'GRN', 'CBT'], 'each once, in the order chosen');
  assert.match(saved.favorites[0].label, /Journal Entry/, 'the module\'s own label');
  assert.deepEqual(ids((await call('u-admin', 'getRoleFavorites', {})).Viewer), ['JV', 'GRN', 'CBT']);
  await assert.rejects(call('u-admin', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: ['JV', 'GRN', 'CBT', 'PDCISSUED', 'PDCRECEIVED', 'GLREPORT'] }), /At most 5/);
  await assert.rejects(call('u-admin', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: ['NOPE'] }), /Unknown module: NOPE/);
  await assert.rejects(call('u-admin', 'saveRoleFavorites', { roleId: 'Pilot', moduleIds: [] }), /Role not found/);
  await assert.rejects(call('u-viewer', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: ['JV'] }), /permission to change Roles/);
  // None: the role has no defaults.
  await call('u-admin', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: [] });
  assert.equal(await val('roleFavorites/Viewer'), null);
});

test('a user with none of their own gets the role\'s, only what they may open; the first change makes them theirs', async () => {
  await call('u-admin', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: ['JV', 'GRN', 'CBT'] });
  assert.deepEqual(ids(await call('u-viewer', 'getMyFavorites', {})), ['JV', 'CBT'], 'not GRN: the Viewer may not open it');
  // Removing one: the rest become the user's own.
  const r = await call('u-viewer', 'toggleFavorite', { moduleId: 'JV', moduleLabel: 'Journal Entry' });
  assert.deepEqual(ids(r.favorites), ['CBT']);
  assert.deepEqual(ids(await val('userFavorites/u-viewer')), ['CBT']);
  // Removing the last: their own list is empty, the role's don't come back.
  await call('u-viewer', 'toggleFavorite', { moduleId: 'CBT', moduleLabel: 'Cash & Bank' });
  assert.deepEqual(await call('u-viewer', 'getMyFavorites', {}), []);
  // A later change of the role's defaults doesn't touch them either.
  await call('u-admin', 'saveRoleFavorites', { roleId: 'Viewer', moduleIds: ['GLREPORT'] });
  assert.deepEqual(await call('u-viewer', 'getMyFavorites', {}), []);
});

test('a user who has their own keeps them', async () => {
  await call('u-admin', 'saveRoleFavorites', { roleId: 'Admin', moduleIds: ['CBT', 'GRN'] });
  assert.deepEqual(ids(await call('u-other', 'getMyFavorites', {})), ['JV'], 'their own, not the role\'s');
  assert.deepEqual(ids(await call('u-admin', 'getMyFavorites', {})), ['CBT', 'GRN'], 'none of their own: the role\'s');
});
