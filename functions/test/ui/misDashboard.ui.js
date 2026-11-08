// MIS Dashboard, phase 2 (docs/modules/MIS.md, Q439-Q442) in the browser, on
// the emulators: the starter tiles drawn from real postings (a key figure
// with its change, a Chart.js chart with its months as Mon-yyyy, a top list,
// a gauge); Edit: a tile added, one removed, saved as the user's own; Reset
// back; a role's default made and seen by that role's user; Show on Home
// draws the same tiles there. Seeds its own data (it WIPES the emulator
// database): node functions/test/ui/misDashboard.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, rtdb, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /misDashboard.ui/.test(l))]); }); }
const ok = r => { if (r.success === false) throw new Error(r.error); return r; };
const T = { timeout: 30000 };
const NOW = new Date();
const M0 = NOW.toISOString().slice(0, 7);
const M1 = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shown = m => MON[Number(m.slice(5, 7)) - 1] + '-' + m.slice(0, 4);
async function jv(date, lines) {
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: 'MIS UI', CompanyID: 'C1', Lines: lines.map(([a, d, c]) => ({ AccountCode: a, Debit: d, Credit: c, Description: 'x', CostCenterID: 'CC1' })) } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
}

(async () => {
  const f = baseFixture();
  f.coa['A-RENT'] = { AccountCode: '6000', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  await reset(f);
  await rtdb.ref('permissions/MISDASHBOARD').set({ access: ['Admin', 'Viewer'] });
  await rtdb.ref('permissions/MIS').set({ access: ['Admin', 'Viewer'], design: ['Admin'], publish: ['Admin'] });
  await jv(M1 + '-05', [['1000', 2000, 0], ['4000', 0, 2000]]);
  await jv(M0 + '-01', [['1000', 3000, 0], ['4000', 0, 3000]]);
  await jv(M0 + '-01', [['6000', 400, 0], ['1000', 0, 400]]);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const chartJs = fs.readFileSync(path.join(__dirname, '../../../public/vendor/chart-4.4.4.umd.js'));
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/vendor/chart-4.4.4.umd.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(chartJs); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness);
  }).listen(8222);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8222/?module=MISDASHBOARD&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => { const t = document.querySelectorAll('#misd-grid .mis-tile'); return t.length > 0 && [...t].every(x => x.dataset.ready); }, null, T);
    return page;
  }
  const tile = (p, i) => p.locator('#misd-grid .mis-tile').nth(i);

  await check('the starter dashboard: a key figure with its change, a chart with its months as Mon-yyyy, a top list, a gauge', async () => {
    const p = await open('u-admin');
    assert.equal(await p.locator('#misd-grid .mis-tile').count(), 7);
    assert.match(await p.textContent('#misd-source'), /starter dashboard/);
    const sales = (await tile(p, 0).innerText()).replace(/\s+/g, ' ');
    assert.match(sales, /SALES 3,000\.00 \+1,000\.00 \(\+50\.0%\)/);
    assert.match(await tile(p, 0).locator('.mis-body > div').nth(1).getAttribute('class'), /emerald/);
    await p.waitForFunction(() => document.querySelector('.mis-tile[data-kind="chart"] canvas').dataset.drawn === '1', null, T);
    const labels = await p.evaluate(() => Chart.getChart(document.querySelector('.mis-tile[data-kind="chart"] canvas')).data.labels);
    assert.equal(labels.length, 12);
    assert.deepEqual(labels.slice(-2), [shown(M1), shown(M0)]);
    assert.match(await tile(p, 6).innerText(), /No figure for this period/, 'no liabilities yet: no current ratio');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Edit: a key figure added, a tile removed; saved as mine; Reset back to the starter', async () => {
    const p = await open('u-admin');
    await p.click('#misd-edit');
    await p.waitForSelector('#misd-editbar:not(.hidden)', T);
    await p.selectOption('#misd-kind', 'kpi');
    await p.selectOption('#misd-type', 'kpis');
    const figures = () => p.waitForFunction(() => !document.getElementById('misd-key').dataset.loading && document.getElementById('misd-key').options.length > 1, null, T);
    await figures();
    await p.selectOption('#misd-key', 'expenses');
    await p.fill('#misd-title', 'Spending');
    await p.click('#misd-add');
    // A gauge: bank and cash, good between 1,000 and 5,000.
    await p.selectOption('#misd-kind', 'gauge');
    await p.selectOption('#misd-type', 'kpis');
    await figures();
    await p.selectOption('#misd-key', 'bank');
    await p.fill('#misd-low', '1000'); await p.fill('#misd-high', '5000');
    await p.click('#misd-add');
    await p.click('#misd-grid .mis-tile >> nth=1 >> .mis-remove'); // Net profit out
    await p.click('#misd-save');
    for (let i = 0; i < 100 && !(await firestore.collection('misDashboards').doc('u-admin').get()).exists; i++) await p.waitForTimeout(100);
    const saved = (await firestore.collection('misDashboards').doc('u-admin').get()).data().Tiles;
    assert.deepEqual(saved.map(t => t.title), ['Sales', 'Bank and cash', 'Receivables', '12-month trend', 'Largest receivables', 'Current ratio', 'Spending', 'Bank and cash']);
    assert.deepEqual([saved[7].kind, saved[7].low, saved[7].high], ['gauge', 1000, 5000]);
    await p.waitForFunction(() => /Your dashboard\./.test(document.getElementById('misd-source').textContent), null, T);
    await p.waitForFunction(() => [...document.querySelectorAll('#misd-grid .mis-tile')].every(x => x.dataset.ready), null, T);
    assert.match((await tile(p, 6).innerText()).replace(/\s+/g, ' '), /SPENDING 400\.00/);
    assert.match((await tile(p, 7).innerText()).replace(/\s+/g, ' '), /4,600\.00 Good: 1,000\.00 to 5,000\.00$/);
    await p.click('#misd-reset');
    await p.waitForFunction(() => /starter dashboard/.test(document.getElementById('misd-source').textContent), null, T);
    assert.equal(await p.locator('#misd-grid .mis-tile').count(), 7);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a role\'s default: made by the admin, seen by the Viewer, who cannot edit', async () => {
    const p = await open('u-admin');
    await p.click('#misd-edit');
    await p.click('#misd-grid .mis-tile >> nth=0 >> .mis-remove');
    await p.selectOption('#misd-role', 'Viewer');
    await p.click('#misd-role-save');
    for (let i = 0; i < 100 && !(await firestore.collection('misRoleDashboards').doc('Viewer').get()).exists; i++) await p.waitForTimeout(100);
    await p.close();
    const v = await open('u-viewer');
    assert.match(await v.textContent('#misd-source'), /Your role's dashboard/);
    assert.equal(await v.locator('#misd-grid .mis-tile').count(), 6);
    assert.equal(await v.isVisible('#misd-edit'), false);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await check('Show on Home: off by default; ticked, Home draws the same tiles', async () => {
    const p = await open('u-viewer');
    assert.equal(await p.isChecked('#misd-home'), false);
    await p.check('#misd-home');
    for (let i = 0; i < 100 && !((await firestore.collection('misDashboards').doc('u-viewer').get()).data() || {}).ShowOnHome; i++) await p.waitForTimeout(100);
    // Home's block, as the shell has it.
    await p.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div id="home-mis" class="hidden"><select id="home-mis-company"></select><button id="home-mis-open"></button><div id="home-mis-grid"></div></div>'); return misTiles.home(); });
    await p.waitForFunction(() => !document.getElementById('home-mis').classList.contains('hidden') && document.querySelectorAll('#home-mis-grid .mis-tile[data-ready]').length === 6, null, T);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a built report (phase 4) as a chart tile: its rows drawn', async () => {
    const r = await call('u-admin', 'saveMisReport', { name: 'GL by type', type: 'builder', companyId: 'C1', chart: 'bar', period: { kind: 'latest' },
      builder: { dataset: 'gl', months: 2, spec: { view: 'group', groupBy: ['accountType'], measures: [{ field: 'net', agg: 'sum' }] } } });
    ok(await call('u-admin', 'saveMisDashboard', { tiles: [{ kind: 'chart', type: 'saved:' + r.id, chart: 'bar', title: 'GL by type' }, { kind: 'top', type: 'saved:' + r.id, title: 'Top types' }] }));
    const p = await open('u-admin');
    await p.waitForFunction(() => { const c = document.querySelector('.mis-tile[data-kind="chart"] canvas'); return c && c.dataset.drawn === '1'; }, null, T);
    const labels = await p.evaluate(() => Chart.getChart(document.querySelector('.mis-tile[data-kind="chart"] canvas')).data.labels);
    assert.deepEqual(labels, ['Asset', 'Expense', 'Revenue']);
    assert.match((await tile(p, 1).innerText()).replace(/\s+/g, ' '), /Asset 4,600\.00 Expense 400\.00 Revenue -5,000\.00/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
