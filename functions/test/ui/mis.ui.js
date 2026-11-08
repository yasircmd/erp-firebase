// MIS Reports, phase 1 (docs/modules/MIS.md) in the browser, on the
// emulators: the catalogue in the report list, the P&L against the previous
// month with its change and % coloured by whether it is good, the 12-month
// trend with its months shown as Mon-yyyy, a refusal shown in-app. Seeds its
// own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/mis.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const path = require('path');
const { app, call, reset, baseFixture, rtdb, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /mis.ui/.test(l))]); }); }
const ok = r => { if (r.success === false) throw new Error(r.error); return r; };
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
  await jv(M1 + '-05', [['1000', 2000, 0], ['4000', 0, 2000]]);
  await jv(M1 + '-06', [['6000', 500, 0], ['1000', 0, 500]]);
  await jv(M0 + '-01', [['1000', 3000, 0], ['4000', 0, 3000]]);
  await jv(M0 + '-01', [['6000', 400, 0], ['1000', 0, 400]]);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const chartJs = fs.readFileSync(path.join(__dirname, '../../../public/vendor/chart-4.4.4.umd.js'));
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/vendor/chart-4.4.4.umd.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(chartJs); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness);
  }).listen(8220);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await rtdb.ref('permissions/MIS').set({ access: ['Admin', 'Viewer'], design: ['Admin', 'Viewer'], publish: ['Admin'] });
  const T = { timeout: 30000 };
  async function open(uid) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8220/?module=MIS&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForSelector('#mis-body tr[data-key]', T);
    return page;
  }
  const cells = async (p, key) => (await p.locator('#mis-body tr[data-key="' + key + '"] td').allInnerTexts()).map(t => t.trim());
  const show = async (p, type, mode) => {
    await p.selectOption('#mis-type', type); if (mode) await p.selectOption('#mis-mode', mode);
    const before = await p.textContent('#mis-period');
    await p.click('#mis-run');
    await p.waitForFunction(b => document.getElementById('mis-period').textContent !== b || !/Working/.test(document.getElementById('mis-body').textContent), before, T);
    await p.waitForFunction(() => !/Working/.test(document.getElementById('mis-body').textContent), null, T);
  };

  await check('the catalogue; the P&L against last month, the change and % coloured by whether it is good', async () => {
    const p = await open('u-admin');
    const types = await p.locator('#mis-type option').evaluateAll(o => o.map(x => x.value));
    ['kpis', 'profitLoss', 'balanceSheet', 'cashFlow', 'ratios', 'trend', 'stockCover'].forEach(t => assert.ok(types.includes(t), t));
    await show(p, 'profitLoss', 'prevMonth');
    assert.deepEqual(await cells(p, 'revenue'), ['Revenue', '3,000.00', '2,000.00', '1,000.00', '+50.0%']);
    assert.match(await p.locator('#mis-body tr[data-key="revenue"] td').nth(3).getAttribute('class'), /emerald/);
    assert.deepEqual((await cells(p, 'expenses')).slice(1), ['400.00', '500.00', '-100.00', '-20.0%']);
    assert.match(await p.locator('#mis-body tr[data-key="expenses"] td').nth(3).getAttribute('class'), /emerald/, 'expenses down is good');
    assert.match(await p.textContent('#mis-period'), new RegExp(shown(M0)), 'the period shown as Mon-yyyy');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the trend: 12 months shown as Mon-yyyy, the last two with their revenue', async () => {
    const p = await open('u-admin');
    await show(p, 'trend');
    const rows = await p.locator('#mis-body tr').evaluateAll(r => r.map(x => [...x.cells].map(c => c.innerText.trim())));
    assert.equal(rows.length, 12);
    assert.deepEqual(rows.slice(-2).map(r => [r[0], r[1]]), [[shown(M1), '2,000.00'], [shown(M0), '3,000.00']]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a refusal is shown in-app: the Balance Sheet has no budget to compare with', async () => {
    const p = await open('u-admin');
    await p.selectOption('#mis-type', 'balanceSheet'); await p.selectOption('#mis-mode', 'budget');
    await p.click('#mis-run');
    for (let i = 0; i < 100 && !p.__dialogs.length; i++) await p.waitForTimeout(100);
    assert.match(p.__dialogs.join(' | '), /not a budget/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('phase 3: the chart above the table (Mon-yyyy months), hidden on "No chart"; Copy takes the table', async () => {
    const p = await open('u-admin');
    await show(p, 'trend');
    await p.waitForFunction(() => document.getElementById('mis-canvas').dataset.drawn === '1', null, T);
    assert.equal(await p.isVisible('#mis-chart-box'), true);
    const labels = await p.evaluate(() => Chart.getChart(document.getElementById('mis-canvas')).data.labels);
    assert.deepEqual(labels.slice(-2), [shown(M1), shown(M0)]);
    await p.selectOption('#mis-chart', 'none');
    assert.equal(await p.isVisible('#mis-chart-box'), false);
    await p.click('#mis-copy');
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip.split('\n')[0], 'Month\tRevenue\tExpenses\tNet profit');
    assert.equal(clip.split('\n').slice(-1)[0], shown(M0) + '\t3000\t400\t2600');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('phase 3: My reports: Save as (the latest month), reopened with its settings, shared with the Viewer, read-only for them', async () => {
    const p = await open('u-admin');
    await p.selectOption('#mis-type', 'profitLoss'); await p.selectOption('#mis-mode', 'lastYear'); await p.selectOption('#mis-chart', 'line');
    await p.click('#mis-save-as');
    await p.fill('#mis-save-name', 'Monthly P&L');
    await p.click('#mis-save-ok');
    await p.waitForFunction(() => /Saved report: Monthly P&L/.test(document.getElementById('mis-saved-note').textContent), null, T);
    const saved = (await firestore.collection('misReports').get()).docs.map(d => d.data());
    assert.deepEqual(saved.map(r => [r.Name, r.Type, r.Mode, r.Chart, r.Period.kind]), [['Monthly P&L', 'profitLoss', 'lastYear', 'line', 'latest']]);
    // Share with the Viewer role.
    await p.click('#mis-share');
    await p.check('.mis-share-role[value="Viewer"]');
    await p.click('#mis-share-ok');
    for (let i = 0; i < 100 && !((await firestore.collection('misReports').get()).docs[0].data().SharedRoles || []).length; i++) await p.waitForTimeout(100);
    await p.close();
    const v = await open('u-viewer');
    const id = (await firestore.collection('misReports').get()).docs[0].id;
    await v.selectOption('#mis-saved', id);
    await v.waitForFunction(() => /Shared with you by Admin User/.test(document.getElementById('mis-saved-note').textContent), null, T);
    assert.deepEqual([await v.inputValue('#mis-type'), await v.inputValue('#mis-mode'), await v.inputValue('#mis-chart'), await v.inputValue('#mis-month')], ['profitLoss', 'lastYear', 'line', M0]);
    assert.deepEqual([await v.isVisible('#mis-save'), await v.isVisible('#mis-delete'), await v.isVisible('#mis-share'), await v.isVisible('#mis-save-as')], [false, false, false, true]);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await check('phase 3: on a phone the lines are cards, each figure with its column', async () => {
    const p = await open('u-admin');
    await show(p, 'profitLoss', 'prevMonth');
    await p.evaluate(() => document.documentElement.classList.add('phone-view'));
    assert.equal(await p.isVisible('#mis-head tr'), false);
    const cell = p.locator('#mis-body tr[data-key="revenue"] td').nth(1);
    assert.equal(await cell.getAttribute('data-label'), 'This period');
    assert.equal(await cell.evaluate(el => getComputedStyle(el).display), 'flex');
    await p.close();
  });

  await check('phase 4: Build a report: GL lines grouped by account type over 2 months, sorted by a header, a pivot, saved as a built report', async () => {
    const p = await open('u-admin');
    await p.selectOption('#mis-type', '__builder');
    await p.waitForFunction(() => [...document.querySelectorAll('#mb-dataset option')].some(o => o.value === 'gl'), null, T);
    await p.selectOption('#mb-dataset', 'gl');
    await p.fill('#mb-months', '2');
    await p.selectOption('#mb-view', 'group');
    await p.selectOption('#mb-by1', 'accountType');
    await p.selectOption('#mb-a1', 'sum'); await p.selectOption('#mb-m1', 'net');
    await p.click('#mis-run');
    await p.waitForFunction(() => /GL lines/.test(document.getElementById('mis-period').textContent), null, T);
    const rows = () => p.locator('#mis-body tr').evaluateAll(r => r.map(x => [...x.cells].map(c => c.innerText.trim())));
    assert.deepEqual(await rows(), [['Asset', '4,100.00'], ['Expense', '900.00'], ['Revenue', '-5,000.00'], ['Total', '0.00']], 'cash 5,000 in less rent 900 out');
    // Sorted by the total, highest first.
    await p.click('#mis-head th[data-i="1"]');
    await p.waitForFunction(() => /▼/.test(document.getElementById('mis-head').textContent), null, T);
    assert.deepEqual((await rows()).map(r => r[0]), ['Asset', 'Expense', 'Revenue', 'Total']);
    // A filter: revenue only.
    await p.click('#mb-add-filter');
    await p.selectOption('.mb-filter-field', 'accountType'); await p.fill('.mb-filter-value', 'revenue');
    await p.click('#mis-run');
    await p.waitForFunction(() => document.querySelectorAll('#mis-body tr').length === 2, null, T);
    assert.deepEqual(await rows(), [['Revenue', '-5,000.00'], ['Total', '-5,000.00']]);
    // A pivot: account type × month.
    await p.click('.mb-filter-remove');
    await p.selectOption('#mb-view', 'pivot');
    await p.selectOption('#mb-prows', 'accountType'); await p.selectOption('#mb-pcols', 'month'); await p.selectOption('#mb-pa', 'sum'); await p.selectOption('#mb-pm', 'net');
    await p.click('#mis-run');
    await p.waitForFunction(() => document.querySelectorAll('#mis-head th').length === 4, null, T);
    assert.deepEqual(await p.locator('#mis-head th').allInnerTexts(), ['ACCOUNT TYPE', shown(M1).toUpperCase(), shown(M0).toUpperCase(), 'TOTAL']);
    assert.deepEqual((await rows())[2], ['Revenue', '-2,000.00', '-3,000.00', '-5,000.00']);
    // Saved as a built report; reopened.
    await p.click('#mis-save-as'); await p.fill('#mis-save-name', 'GL by type and month'); await p.click('#mis-save-ok');
    await p.waitForFunction(() => /Saved report: GL by type and month/.test(document.getElementById('mis-saved-note').textContent), null, T);
    const saved = (await firestore.collection('misReports').where('Name', '==', 'GL by type and month').get()).docs[0].data();
    assert.deepEqual([saved.Type, saved.Builder.dataset, saved.Builder.months, saved.Builder.spec.view, saved.Builder.spec.pivot.cols], ['builder', 'gl', 2, 'pivot', 'month']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
