// Period Closing step 2 on screen (docs/modules/PERIOD_CLOSING.md, decisions
// 125, 140-143): the year's line (open, what is missing; Close the year
// asks first; closed, by whom, the closing entry; Reopen the year asks the
// reason); a closed year's month refusing to reopen; the Trial Balance's
// "Before year-end closing" switch and the financial year as its default
// period. Seeds its own data (it WIPES the emulator database, like the
// suites):
//   node functions/test/ui/yearEnd.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (r && r.success === false) throw new Error(r.error); return r; };

(async () => {
  const f = baseFixture();
  // The default Retained Earnings: the first account under the 320000 group (docs/modules/COA_NUMBERING.md).
  f.coa['A-REG'] = { AccountCode: '320000', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: false };
  f.coa['A-RE'] = { AccountCode: '320001', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'A-REG' };
  await reset(f);
  const post = async (date, lines) => {
    const id = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: 'Sale', CompanyID: 'C1', Lines: lines } })).jvId;
    ok(await call('u-admin', 'postJournalEntry', { jvId: id }));
  };
  await post('2025-03-10', [{ AccountCode: '1100', Debit: 1000, Description: 'x' }, { AccountCode: '4000', Credit: 1000, Description: 'x', CostCenterID: 'CC1' }]);
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2025-12');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8182);
  const browser = await chromium.launch();
  async function open(module, answers) {
    const p = await browser.newPage();
    p.__errors = []; p.__dialogs = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    await onAppDialog(p, d => { p.__dialogs.push(d.type() + ': ' + d.message()); const a = (answers || []).shift(); return a === false ? d.dismiss() : d.accept(typeof a === 'string' ? a : undefined); });
    await p.goto('http://127.0.0.1:8182/?module=' + module + '&uid=u-admin');
    await p.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return p;
  }
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const waitDialogs = async (p, n) => { for (let i = 0; i < 100 && p.__dialogs.length < n; i++) await p.waitForTimeout(100); };

  await check('Period Closing: the year 2025 closes after asking; its month refuses to reopen; the year reopens with a reason', async () => {
    const p = await open('PERIODCLOSE', [false, true, undefined, 'x', undefined, 'Audit adjustment', undefined]);
    await until(p, () => document.querySelectorAll('#pc-grid tr').length === 12);
    await p.click('#pc-prev'); // 2026 → 2025
    await until(p, () => document.getElementById('pc-year').textContent === '2025');
    assert.match(await p.textContent('#pc-year-status'), /Year open/);
    assert.equal(await p.isVisible('#pc-close-year'), true);
    await p.click('#pc-close-year'); // Cancel: nothing happens
    await waitDialogs(p, 1);
    await p.waitForTimeout(800);
    assert.equal((await call('u-admin', 'getPeriodClosing', { companyId: 'C1', year: '2025-01' })).Year.Closed, false);
    assert.equal(p.__dialogs.length, 1);
    p.__dialogs.length = 0;
    await p.click('#pc-close-year');
    await until(p, () => /Year closed/.test(document.getElementById('pc-year-status').textContent));
    assert.match(p.__dialogs[0], /^confirm: Close the financial year 2025\? A Year-End Closing entry dated (2025-12-31|31\/12\/2025) moves every income, cost of sales and expense balance to 320001 — Retained Earnings/);
    assert.match(p.__dialogs[1], /^alert: The year 2025 is closed: closing entry YEC-/);
    assert.match(await p.textContent('#pc-year-status'), /by Admin User[\s\S]*closing entry YEC-/);
    assert.equal(await p.isVisible('#pc-close-year'), false);
    // A month of the closed year: refused, the reason named.
    await p.click('#pc-grid tr[data-month="2025-06"] .pc-reopen');
    await waitDialogs(p, 4);
    assert.match(p.__dialogs[3], /^alert: The financial year 2025 is closed: reopen the year first, then the month\./);
    await p.click('#pc-reopen-year');
    await until(p, () => /Year open/.test(document.getElementById('pc-year-status').textContent));
    assert.match(p.__dialogs[4], /^prompt: Reopen the financial year 2025\? Its closing entry is reversed\./);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Trial Balance: the financial year as the default From; "Before year-end closing" shows the closed year\'s income', async () => {
    ok(await call('u-admin', 'closeFinancialYear', { companyId: 'C1', year: '2025-01' }));
    const p = await open('TRIALBALANCE');
    await until(p, () => document.getElementById('tb-company').value === 'C1');
    await until(p, () => document.getElementById('tb-from-date').value === new Date().getFullYear() + '-01-01');
    await p.fill('#tb-from-date', '2026-01-01'); await p.fill('#tb-to-date', '2026-01-31');
    await p.click('#tb-run-btn');
    await until(p, () => !document.getElementById('tb-results').classList.contains('hidden'));
    const sales = async () => p.$$eval('#tb-table-body tr', rs => (rs.find(r => /\b4000\b/.test(r.textContent)) || {}).textContent || '');
    assert.equal(await sales(), '');
    await p.check('#tb-before-close');
    await p.click('#tb-run-btn');
    await until(p, () => /before year-end closing/.test(document.getElementById('tb-period-label').textContent));
    assert.match(await sales(), /4000[\s\S]*1,000\.00/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
