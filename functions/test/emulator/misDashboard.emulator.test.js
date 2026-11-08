// MIS Dashboard, phase 2 (owner, 2026-11-08; docs/modules/MIS.md, Q439-Q442):
// a new user sees the starter set; a role's default (MIS publish) replaces
// it; one's own (MIS design) replaces that, Reset goes back to the role's;
// the Home choice, off by default, is one's own and kept on Reset; every
// tile is checked (kind, report, figure, the gauge's band, at most 24).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb, firestore } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const get = uid => call(uid, 'getMisDashboard', {});
const kpi = (key, extra) => Object.assign({ kind: 'kpi', type: 'kpis', key, mode: 'prevMonth', title: key }, extra || {});

test('the starter set, the role default, one\'s own, Reset, the Home choice and the checks', async () => {
  const f = baseFixture();
  await reset(f);
  await rtdb.ref('permissions/MISDASHBOARD').set({ access: ['Admin', 'Viewer'] });
  await rtdb.ref('permissions/MIS').set({ access: ['Admin', 'Viewer'], design: ['Admin'], publish: ['Admin'] });

  // A new user: the starter set; Home off.
  let v = await get('u-viewer');
  assert.equal(v.source, 'starter');
  assert.deepEqual(v.tiles.map(t => t.kind), ['kpi', 'kpi', 'kpi', 'kpi', 'chart', 'top', 'gauge']);
  assert.deepEqual([v.showOnHome, v.rights.design, v.rights.publish, v.roles], [false, false, false, undefined]);
  assert.equal((await call('u-viewer', 'getMisHomeChoice', {})).showOnHome, false);

  // The Viewer may not change their tiles nor a role's; may choose Home.
  assert.match(await refused(call('u-viewer', 'saveMisDashboard', { tiles: [kpi('sales')] })), /MIS: design/);
  assert.match(await refused(call('u-viewer', 'saveMisRoleDashboard', { role: 'Viewer', tiles: [kpi('sales')] })), /MIS: publish/);
  ok(await call('u-viewer', 'saveMisDashboard', { showOnHome: true }));
  assert.equal((await call('u-viewer', 'getMisHomeChoice', {})).showOnHome, true);
  assert.equal((await get('u-viewer')).source, 'starter', 'the Home choice alone is not a dashboard');

  // The admin publishes the Viewer role's default: the Viewer sees it.
  const a = await get('u-admin');
  assert.ok(a.rights.publish && a.roles.some(r => r.id === 'Viewer'));
  assert.match(await refused(call('u-admin', 'saveMisRoleDashboard', { role: 'Nobody', tiles: [] })), /Choose a role/);
  ok(await call('u-admin', 'saveMisRoleDashboard', { role: 'Viewer', tiles: [kpi('sales'), { kind: 'chart', type: 'salesByRep', chart: 'line', title: 'Reps' }] }));
  v = await get('u-viewer');
  assert.deepEqual([v.source, v.tiles.length, v.tiles[1].chart, v.tiles[1].mode, v.hasRoleDefault], ['role', 2, 'line', 'prevMonth', true]);

  // The admin's own; Reset goes back to the Admin role's (none): the starter set; Home kept.
  ok(await call('u-admin', 'saveMisDashboard', { tiles: [kpi('netProfit'), { kind: 'gauge', type: 'ratios', key: 'current', low: 1, high: 2 }, { kind: 'top', type: 'receivables' }], showOnHome: true }));
  let mine = await get('u-admin');
  assert.deepEqual([mine.source, mine.tiles.map(t => t.kind), mine.showOnHome], ['mine', ['kpi', 'gauge', 'top'], true]);
  ok(await call('u-admin', 'resetMisDashboard', {}));
  mine = await get('u-admin');
  assert.deepEqual([mine.source, mine.showOnHome], ['starter', true]);

  // A role's default removed.
  ok(await call('u-admin', 'saveMisRoleDashboard', { role: 'Viewer', tiles: null }));
  assert.equal((await get('u-viewer')).source, 'starter');

  // The checks.
  const save = tiles => refused(call('u-admin', 'saveMisDashboard', { tiles }));
  assert.match(await save([{ kind: 'pie', type: 'kpis' }]), /^Tile 1: choose a key figure/);
  assert.match(await save([kpi('sales'), { kind: 'chart', type: 'nope' }]), /^Tile 2: unknown report/);
  assert.match(await save([{ kind: 'kpi', type: 'kpis' }]), /choose the figure/);
  assert.match(await save([{ kind: 'gauge', type: 'ratios', key: 'current', low: 3, high: 2 }]), /low under its high/);
  assert.match(await save(Array.from({ length: 25 }, () => kpi('sales'))), /at most 24 tiles/);
  ok(await call('u-admin', 'saveMisDashboard', { tiles: [kpi('sales', { id: 'x' }), kpi('bank', { id: 'x' })] }));
  const ids = (await firestore.collection('misDashboards').doc('u-admin').get()).data().Tiles.map(t => t.id);
  assert.equal(new Set(ids).size, 2, 'tile ids made unique');

  // No access to the dashboard: refused; Home quietly off.
  await rtdb.ref('permissions/MISDASHBOARD').set({ access: ['Admin'] });
  assert.match(await refused(get('u-viewer')), /access to the MIS Dashboard/);
  assert.equal((await call('u-viewer', 'getMisHomeChoice', {})).showOnHome, false);
});
