// Period Closing on screen, step 1a (docs/modules/PERIOD_CLOSING.md): the
// month grid of the financial year, the checklist with its findings, close
// (confirmed in the app's own dialog), a blocking item refusing the close,
// the Setup tab, reopen with a reason (the app's prompt), the log, and a
// Viewer seeing it read-only. Seeds its own data (it WIPES the emulator
// database, like the suites):
//   node functions/test/ui/periodClosing.ui.js
// Also (UX_TIER3.md D): accounts that must be zero and steps to tick.
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { if (!r.success) throw new Error(r.error); return r; };

(async () => {
  const f = baseFixture();
  // The default Retained Earnings: the first account under the 320000 group (docs/modules/COA_NUMBERING.md).
  f.coa['A-REG'] = { AccountCode: '320000', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: false };
  f.coa['A-RE'] = { AccountCode: '320001', AccountName: 'Retained Earnings', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'A-REG' };
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  await reset(f);
  const draft = date => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: date, Description: 'Draft payment', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '6100', Amount: 25, Description: 'Freight', CostCenterID: 'CC1' }] } });
  ok(await draft('2026-03-05'));
  ok(await draft('2026-04-02'));

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8180);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  // answers: what to answer the next prompts with (null = Cancel).
  async function open(module, uid, answers) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => {
      page.__dialogs.push(d.type() + ': ' + d.message());
      if (d.type() === 'prompt') { const a = (answers || []).shift(); return a === null ? d.dismiss() : d.accept(a); }
      if (d.type() === 'confirm' && page.__cancelNext) { page.__cancelNext = false; return d.dismiss(); }
      return d.accept();
    });
    await page.goto('http://127.0.0.1:8180/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  // No in-app dialog open, and every call answered.
  const settled = p => until(p, () => { const ok = document.getElementById('app-dialog-ok'); return (!ok || ok.offsetParent === null) && __rpcPendingCount === 0; });
  const statusOf = (p, month) => p.textContent('#pc-grid tr[data-month="' + month + '"] .pc-st');
  const answers = ['', null, 'Late supplier bill'];

  const p = await open('PERIODCLOSE', 'u-admin', answers);
  await check('the grid: the financial year\'s months, ended months open with a checklist, the current one not ended', async () => {
    await until(p, () => document.querySelectorAll('#pc-grid tr').length === 12);
    assert.equal(await p.textContent('#pc-year'), '2026');
    assert.equal(await statusOf(p, '2026-03'), 'Open');
    assert.equal(await p.$$eval('#pc-grid .pc-checklist', b => b.length), Number(new Date().toISOString().slice(5, 7)) - 1);
    assert.match(await p.textContent('#pc-status'), /No month closed yet/);
    assert.match(await p.textContent('#app-title'), /Period Closing/);
  });

  await check('the checklist lists a draft with a link to its module; closing asks first, then the earlier months close too', async () => {
    await p.click('#pc-grid tr[data-month="2026-03"] .pc-checklist');
    await until(p, () => document.querySelectorAll('#pc-check-items .pc-item').length === 11);
    assert.equal(await p.getAttribute('#pc-check-items .pc-item[data-key="drafts"]', 'data-result'), 'Warning');
    assert.match(await p.textContent('#pc-check-items .pc-item[data-key="drafts"]'), /Bank Payment[\s\S]*(2026-03-05|05\/03\/2026)[\s\S]*Draft/);
    assert.equal(await p.getAttribute('#pc-check-items .pc-item[data-key="drafts"] .pc-open', 'data-module'), 'CBT');
    assert.equal(await p.getAttribute('#pc-check-items .pc-item[data-key="trialBalance"]', 'data-result'), 'OK');
    assert.match(await p.textContent('#pc-check-range'), /first close/);
    assert.equal(await p.isDisabled('#pc-close'), false);
    p.__cancelNext = true; // Cancel: nothing closes
    await p.click('#pc-close');
    for (let i = 0; i < 50 && p.__cancelNext; i++) await p.waitForTimeout(100);
    await p.waitForTimeout(800);
    assert.equal(await statusOf(p, '2026-03'), 'Open');
    assert.ok(!(await p.evaluate(() => window.__rpcLog.some(l => l.name === 'closePeriod'))), 'closePeriod called after Cancel');
    p.__dialogs.length = 0;
    await p.click('#pc-close');
    await until(p, () => document.querySelector('#pc-grid tr[data-month="2026-03"] .pc-st').textContent === 'Closed');
    assert.match(p.__dialogs[0], /^confirm: Close (2026-03|Mar-2026) with 1 warning/);
    assert.match(p.__dialogs[1], /^alert: (2026-03|Mar-2026) is closed/);
    assert.equal(await statusOf(p, '2026-01'), 'Closed (before the first close)');
    assert.match(await p.textContent('#pc-grid tr[data-month="2026-03"]'), /Admin User/);
    assert.match(await p.textContent('#pc-status'), /Closed through (2026-03|Mar-2026); next to close: (2026-04|Apr-2026)/);
    assert.equal(await p.$$eval('#pc-grid .pc-checklist', b => b.map(x => x.dataset.month).join()), '2026-04'); // in order
    assert.equal(await p.isHidden('#pc-check'), true);
  });

  await check('Setup: drafts set to Block; April\'s draft then blocks its close', async () => {
    await p.click('.pc-tab[data-tab="setup"]');
    assert.equal(await p.inputValue('#pc-fy'), 'Jan');
    assert.equal(await p.inputValue('#pc-re'), 'A-RE');
    await p.selectOption('.pc-mode[data-key="drafts"]', 'Block');
    await p.click('#pc-save');
    for (let i = 0; i < 100 && !p.__dialogs.includes('alert: Saved.'); i++) await p.waitForTimeout(100);
    assert.ok(p.__dialogs.includes('alert: Saved.'), p.__dialogs.join(' | '));
    await settled(p); // the reload after saving, too
    await p.click('.pc-tab[data-tab="months"]');
    await p.click('#pc-grid tr[data-month="2026-04"] .pc-checklist');
    await until(p, () => document.querySelectorAll('#pc-check-items .pc-item').length === 11);
    assert.equal(await p.getAttribute('#pc-check-items .pc-item[data-key="drafts"]', 'data-result'), 'Blocks');
    assert.match(await p.textContent('#pc-check-range'), /1 blocking/);
    assert.equal(await p.isDisabled('#pc-close'), true);
  });

  await check('reopen: an empty reason refused, Cancel does nothing, a reason reopens it and the later months; the log shows it', async () => {
    await settled(p);
    await p.click('#pc-grid tr[data-month="2026-02"] .pc-reopen');
    for (let i = 0; i < 50 && !p.__dialogs.some(d => /^alert: Enter the reason/.test(d)); i++) await p.waitForTimeout(100);
    assert.ok(p.__dialogs.some(d => /^alert: Enter the reason/.test(d)), p.__dialogs.join(' | '));
    await settled(p);
    await p.click('#pc-grid tr[data-month="2026-02"] .pc-reopen'); // Cancel
    await p.waitForTimeout(300);
    await settled(p);
    assert.equal(await statusOf(p, '2026-02'), 'Closed (before the first close)');
    await p.click('#pc-grid tr[data-month="2026-02"] .pc-reopen');
    await until(p, () => document.querySelector('#pc-grid tr[data-month="2026-02"] .pc-st').textContent === 'Open');
    assert.ok(p.__dialogs.some(d => /^prompt: Reopen (2026-02|Feb-2026)\? The later months, through (2026-03|Mar-2026), reopen too/.test(d)), p.__dialogs.join(' | '));
    assert.deepEqual(await Promise.all(['2026-01', '2026-02', '2026-03'].map(m => statusOf(p, m))), ['Closed (before the first close)', 'Open', 'Open']);
    await p.click('.pc-tab[data-tab="log"]');
    assert.match(await p.textContent('#pc-log-body tr:first-child'), /Reopen[\s\S]*(2026-02|Feb-2026)[\s\S]*(2026-01|Jan-2026)[\s\S]*Admin User[\s\S]*Late supplier bill/);
    assert.equal(await p.$$eval('#pc-log-body tr', r => r.length), 3); // close, setup, reopen
    assert.deepEqual(p.__errors, []);
  });

  await check('Setup (UX_TIER3.md D): an account that must be zero and a step to tick; the step is ticked on the checklist and logged', async () => {
    await settled(p);
    await p.click('.pc-tab[data-tab="setup"]');
    await p.click('#pc-zero-add');
    await p.selectOption('.pc-zero-acc[data-i="0"]', 'A-FRT');
    await p.selectOption('.pc-zero-mode[data-i="0"]', 'Block');
    await p.click('#pc-step-add');
    await p.fill('.pc-step-text[data-i="0"]', 'Bank reconciliation done');
    await p.selectOption('.pc-step-mode[data-i="0"]', 'Block');
    p.__dialogs.length = 0;
    await p.click('#pc-save');
    for (let i = 0; i < 100 && !p.__dialogs.includes('alert: Saved.'); i++) await p.waitForTimeout(100);
    assert.ok(p.__dialogs.includes('alert: Saved.'), p.__dialogs.join(' | '));
    await settled(p);
    assert.equal(await p.inputValue('.pc-zero-acc[data-i="0"]'), 'A-FRT', 'shown again after the reload');
    assert.equal(await p.inputValue('.pc-step-text[data-i="0"]'), 'Bank reconciliation done');
    await p.click('.pc-tab[data-tab="months"]');
    await p.click('#pc-grid tr[data-month="2026-02"] .pc-checklist');
    await until(p, () => document.querySelectorAll('#pc-check-items .pc-item').length === 13);
    assert.equal(await p.getAttribute('#pc-check-items .pc-item[data-key="zero:A-FRT"]', 'data-result'), 'OK');
    const step = '#pc-check-items .pc-item[data-key^="step:"]';
    assert.equal(await p.getAttribute(step, 'data-result'), 'Blocks');
    assert.equal(await p.isDisabled('#pc-close'), true);
    await p.check(step + ' .pc-tick');
    await until(p, s => { const i = document.querySelector(s); return i && i.dataset.result === 'OK'; }, step);
    assert.match(await p.textContent(step), /Ticked by Admin User/);
    assert.equal(await p.isDisabled('#pc-close'), false);
    await settled(p);
    await p.click('.pc-tab[data-tab="log"]');
    assert.match(await p.textContent('#pc-log-body tr:first-child'), /Tick[\s\S]*(2026-02|Feb-2026)[\s\S]*Admin User[\s\S]*Bank reconciliation done/);
    assert.deepEqual(p.__errors, []);
  });
  await p.close();

  await check('a Viewer sees the grid and the checklist, without close, reopen or Setup changes', async () => {
    const v = await open('PERIODCLOSE', 'u-viewer');
    await until(v, () => document.querySelectorAll('#pc-grid tr').length === 12);
    assert.equal(await v.$$eval('#pc-grid .pc-reopen', b => b.length), 0);
    assert.equal((await v.textContent('#pc-grid tr[data-month="2026-02"] .pc-checklist')).trim(), 'Checklist');
    await v.click('#pc-grid tr[data-month="2026-02"] .pc-checklist');
    await until(v, () => document.querySelectorAll('#pc-check-items .pc-item').length === 13);
    assert.equal(await v.isHidden('#pc-close'), true);
    assert.equal(await v.isDisabled('#pc-check-items .pc-tick'), true, 'a Viewer cannot tick a step');
    await v.click('.pc-tab[data-tab="setup"]');
    assert.equal(await v.isDisabled('#pc-save'), true);
    assert.equal(await v.isDisabled('.pc-mode[data-key="drafts"]'), true);
    assert.equal(await v.isHidden('#pc-zero-add'), true);
    assert.equal(await v.isDisabled('.pc-step-text[data-i="0"]'), true);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
