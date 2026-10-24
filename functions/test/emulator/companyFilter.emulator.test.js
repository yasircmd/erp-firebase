// The company filter at the top (owner, 2026-10-24; docs/modules/
// UX_ROUND2.md item 19, decision 273): a user chooses among their own
// companies which the screens offer and default to. Saved with the user for
// the next sign-in; a filter, not rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });

test.beforeEach(async () => {
  const f = baseFixture();
  f.users['u-two'] = { status: 'Active', role: 'Viewer', username: 'two', fullName: 'Two Companies', AssignedCompanies: ['C1', 'C2'] };
  await reset(f);
});
const chosen = list => list.filter(c => c.Chosen).map(c => c.CompanyID);

test('all chosen until the user chooses; the choice is kept for the next sign-in', async () => {
  assert.deepEqual(chosen(await call('u-two', 'getActiveCompanies', {})), ['C1', 'C2']);
  assert.deepEqual(await call('u-two', 'saveMyCompanies', { companyIds: ['C2'] }), { companyIds: ['C2'] });
  const list = await call('u-two', 'getActiveCompanies', {});
  assert.deepEqual(list.map(c => c.CompanyID), ['C1', 'C2'], 'still both of them: a filter, not rights');
  assert.deepEqual(chosen(list), ['C2']);
  assert.deepEqual(await val('userPreferences/u-two/Companies'), ['C2']);
  // All again: nothing kept, so a company assigned later is chosen too.
  assert.deepEqual(await call('u-two', 'saveMyCompanies', { companyIds: ['C1', 'C2', 'C1'] }), { companyIds: ['C1', 'C2'] });
  assert.equal(await val('userPreferences/u-two/Companies'), null);
});

test('only the user\'s own companies; a choice no longer theirs falls back to all', async () => {
  await assert.rejects(call('u-viewer', 'saveMyCompanies', { companyIds: ['C2'] }), /Not one of your companies: C2/);
  await call('u-two', 'saveMyCompanies', { companyIds: ['C2'] });
  // C2 unassigned later: the filter keeps nothing that isn't theirs.
  await call('u-admin', 'saveFirebaseUser', { userData: { id: 'u-two', username: 'two', fullName: 'Two Companies', role: 'Viewer', status: 'Active', assignedCompanies: ['C1'] } });
  assert.deepEqual(await call('u-two', 'getActiveCompanies', {}).then(l => l.map(c => [c.CompanyID, c.Chosen])), [['C1', true]]);
});
