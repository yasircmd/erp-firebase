// MIS "My reports", phase 3 (owner, 2026-11-08; docs/modules/MIS.md,
// Q443-Q445): saved with MIS design, private; shared with roles by MIS
// publish and seen by them read-only; the month kept fixed or the latest;
// only the owner changes, shares or deletes; the checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const save = (uid, d) => call(uid, 'saveMisReport', Object.assign({ name: 'Monthly P&L', type: 'profitLoss', companyId: 'C1', mode: 'prevMonth', chart: 'bar', period: { kind: 'latest' } }, d || {}));
const list = uid => call(uid, 'getMyMisReports', {});

test('saved, shared with a role, read-only for it; fixed or latest month; the checks', async () => {
  await reset(baseFixture());
  await rtdb.ref('permissions/MIS').set({ access: ['Admin', 'Viewer'], design: ['Admin', 'Viewer'], publish: ['Admin'] });

  const a = ok(await save('u-admin'));
  const b = ok(await save('u-admin', { name: 'Audit: Sep BS', type: 'balanceSheet', period: { kind: 'fixed', month: '2026-09' }, chart: 'none' }));
  let mine = await list('u-admin');
  assert.deepEqual(mine.mine.map(r => [r.name, r.period.kind, r.period.month, r.chart]), [['Audit: Sep BS', 'fixed', '2026-09', 'none'], ['Monthly P&L', 'latest', undefined, 'bar']]);
  assert.ok(mine.rights.publish && mine.roles.some(r => r.id === 'Viewer'));

  // The Viewer sees nothing until it is shared with the Viewer role; then read-only.
  assert.deepEqual((await list('u-viewer')).shared, []);
  assert.match(await refused(call('u-viewer', 'shareMisReport', { id: a.id, roles: ['Viewer'] })), /MIS: publish/);
  ok(await call('u-admin', 'shareMisReport', { id: a.id, roles: ['Viewer', 'Viewer'] }));
  const v = await list('u-viewer');
  assert.deepEqual([v.shared.map(r => r.name), v.shared[0].owner, v.mine.length], [['Monthly P&L'], 'Admin User', 0]);
  assert.match(await refused(save('u-viewer', { id: a.id, name: 'Mine now' })), /Only its owner/);
  assert.match(await refused(call('u-viewer', 'deleteMisReport', { id: a.id })), /Only its owner/);
  assert.match(await refused(call('u-admin', 'shareMisReport', { id: a.id, roles: ['Nobody'] })), /Unknown role/);

  // The owner renames and changes it; makes it private again; deletes the other.
  ok(await save('u-admin', { id: a.id, name: 'P&L vs budget', mode: 'budget', chart: 'line' }));
  mine = await list('u-admin');
  const pl = mine.mine.find(r => r.id === a.id);
  assert.deepEqual([pl.name, pl.mode, pl.chart, pl.sharedRoles], ['P&L vs budget', 'budget', 'line', ['Viewer']], 'sharing kept on a change');
  ok(await call('u-admin', 'shareMisReport', { id: a.id, roles: [] }));
  assert.deepEqual((await list('u-viewer')).shared, []);
  ok(await call('u-admin', 'deleteMisReport', { id: b.id }));
  assert.match(await refused(call('u-admin', 'deleteMisReport', { id: b.id })), /no longer exists/);

  // The checks.
  assert.match(await refused(save('u-admin', { name: ' ' })), /Give the report a name/);
  assert.match(await refused(save('u-admin', { type: 'nope' })), /Unknown report/);
  assert.match(await refused(save('u-admin', { companyId: 'C2' })), /access to that company/);
  assert.match(await refused(save('u-admin', { period: { kind: 'fixed', month: '2026-13' } })), /Choose the month/);
  await rtdb.ref('permissions/MIS/design').set(['Admin']);
  assert.match(await refused(save('u-viewer', { name: 'x' })), /MIS: design/);
});
