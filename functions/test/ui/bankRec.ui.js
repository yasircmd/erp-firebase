// Bank Reconciliation (docs/modules/RECONCILIATION.md, step R1) in the
// browser, on the emulators: a month opened for the bank account; the
// statement's balances typed and its lines pasted from Excel; the suggested
// match accepted; two ERP lines matched by hand to one bank line; a deposit
// marked cleared; the difference reaching nothing; Copy; a Viewer reads only.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/bankRec.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /bankRec.ui/.test(l))]); }); }
let n = 0;
const post = async (date, lines, extra) => (await firestore.collection('journalEntries').add(Object.assign({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: 'Bank Payment',
  JVNumber: 'CBT-' + (++n), Reference: '', Description: 'Entry ' + n, Lines: lines.map(([AccountID, Debit, Credit]) => ({ AccountID, Debit, Credit })) }, extra || {}))).id;

(async () => {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  await reset(f);
  await post('2026-10-01', [['A-BANK', 5000, 0], ['A-EQ', 0, 5000]], { VoucherType: 'JV', Description: 'Capital' });
  await post('2026-10-02', [['A-EXP', 1250, 0], ['A-BANK', 0, 1250]], { Reference: '100045', Description: 'Rent' });
  await post('2026-10-08', [['A-EXP', 400, 0], ['A-BANK', 0, 400]], { Description: 'Supplies A' });
  await post('2026-10-08', [['A-EXP', 600, 0], ['A-BANK', 0, 600]], { Description: 'Supplies B' });
  await post('2026-10-30', [['A-EXP', 700, 0], ['A-BANK', 0, 700]], { Description: 'Late cheque' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8197);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const T = { timeout: 30000 };
  async function open(uid) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = []; page.__answers = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? page.__answers.shift() : undefined); });
    await page.goto('http://127.0.0.1:8197/?module=BANKREC&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => document.querySelectorAll('#br-account option[value="A-BANK"]').length === 1, null, T);
    await page.fill('#br-month', '2026-10');
    await page.click('#br-open');
    await page.waitForSelector('#br-view:not(.hidden)', T);
    return page;
  }
  const report = async p => (await p.locator('#br-report tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  const glRow = (p, text) => p.locator('#br-gl tr', { hasText: text });
  const busy = p => p.waitForTimeout(300).then(() => p.waitForLoadState('networkidle'));

  await check('a month reconciled: balances, the statement pasted, the suggestion accepted, two lines to one by hand, a deposit cleared; the difference nothing', async () => {
    const p = await open('u-admin');
    assert.equal(await p.locator('#br-gl tr[data-k]').count(), 5);
    await p.fill('#br-st-open', '0');
    await p.fill('#br-st-close', '2,050');
    await p.click('#br-save-bal');
    await p.waitForFunction(() => /2,050\.00/.test(document.getElementById('br-report').innerText), null, T);
    await p.click('#br-paste-wrap summary');
    await p.fill('#br-paste', 'Date\tDescription\tReference\tDebit\tCredit\n04/10/2026\tCHQ 100045\t\t1,250.00\t\n09/10/2026\tTwo payments\t\t1000\t');
    await p.click('#br-paste-add');
    await p.waitForFunction(() => document.querySelectorAll('#br-st tr[data-s]').length === 2, null, T);
    assert.match(await p.textContent('#br-suggest-text'), /^1 match suggested .*1 by reference or cheque number/);
    await p.click('#br-accept');
    await p.waitForFunction(() => document.querySelectorAll('#br-st tr[data-s]').length === 1, null, T); // only what is not cleared
    // The two supplies against the one bank line.
    await glRow(p, 'Supplies A').locator('.br-sel-gl').check();
    await glRow(p, 'Supplies B').locator('.br-sel-gl').check();
    await p.locator('#br-st tr[data-s] .br-sel-st').check();
    assert.match(await p.textContent('#br-sel'), /they agree/);
    await p.click('#br-match');
    await p.waitForFunction(() => document.querySelectorAll('#br-st tr[data-s]').length === 0, null, T);
    // The capital deposit, cleared by hand.
    await glRow(p, 'Capital').locator('.br-sel-gl').check();
    await p.click('#br-tick');
    await p.waitForFunction(() => document.querySelectorAll('#br-gl tr[data-k]').length === 1, null, T);
    assert.match(await p.textContent('#br-gl'), /Late cheque/);
    const r = await report(p);
    assert.deepEqual(r.slice(0, 6), ['Balance per the ERP at 31/10/2026 2,050.00', 'add: payments not yet presented 700.00', 'less: deposits not yet credited 0.00',
      'Balance per the bank 2,750.00', 'The statement\'s closing balance 2,050.00', 'Difference -700.00']);
    // The closing balance corrected: nothing left.
    await p.fill('#br-st-close', '2750');
    await p.click('#br-save-bal');
    await p.waitForFunction(() => /Difference\s+0\.00/.test(document.getElementById('br-report').innerText), null, T);
    // Undoing a match brings its lines back.
    await p.uncheck('#br-open-only');
    await p.locator('#br-gl .br-unmatch').first().click();
    await p.waitForFunction(() => document.getElementById('br-suggest') && !document.getElementById('br-suggest').classList.contains('hidden'), null, T);
    await p.click('#br-accept');
    await busy(p);
    await p.click('#br-copy');
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /^Bank reconciliation\t1100 Bank\tOct-2026\nBalance per the ERP\t2050\n/);
    assert.match(clip, /Difference\t0\n/);
    assert.match(clip, /\t30\/10\/2026\tCBT-5\tLate cheque\t-700/);
    const saved = (await firestore.collection('bankRecs').doc('C1__A-BANK__2026-10').get()).data();
    assert.deepEqual([saved.Status, saved.Matches.length, saved.Ticked.length, saved.StatementClosing], ['Draft', 2, 1, 2750]);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Viewer: the reconciliation shown, nothing to change', async () => {
    const p = await open('u-viewer');
    await p.waitForFunction(() => /Difference\s+0\.00/.test(document.getElementById('br-report').innerText), null, T);
    assert.equal(await p.locator('.br-sel-gl, .br-sel-st, #br-match:visible, #br-save-bal:visible, #br-delete:visible').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('R2: October submitted and locked; November: the cheque presented, a bank charge posted from its line and matched; submitted; reopened with a reason', async () => {
    const p = await open('u-admin');
    p.__answers = ['6100 CC1', 'Statement corrected']; // the expense needs a cost centre (its own rule)
    await p.click('#br-submit');
    await p.waitForSelector('#br-banner:not(.hidden)', T);
    assert.match(await p.textContent('#br-banner'), /Reconciled and locked/);
    assert.equal(await p.isVisible('#br-match'), false, 'locked: nothing to change');
    // November.
    await p.fill('#br-month', '2026-11');
    await p.click('#br-open');
    await p.waitForFunction(() => /2026-11|Nov-2026/.test(document.getElementById('br-title').textContent), null, T);
    await p.fill('#br-st-close', '2035');
    await p.click('#br-save-bal');
    await busy(p);
    await p.click('#br-paste-wrap summary');
    await p.fill('#br-paste', '03/11/2026\tCHQ\t\t700\t\n05/11/2026\tBank charges\t\t15\t');
    await p.click('#br-paste-add');
    await p.waitForFunction(() => document.querySelectorAll('#br-st tr[data-s]').length === 2, null, T);
    await p.click('#br-accept');
    await p.waitForFunction(() => document.querySelectorAll('#br-st tr[data-s]').length === 1, null, T);
    await p.click('#br-st .br-post');
    for (let i = 0; i < 160 && !p.__dialogs.some(m => /^Posted|Unable|Cannot|permission|No cost|not found|Entry /i.test(m)); i++) await p.waitForTimeout(250);
    if (!p.__dialogs.some(m => /and matched/.test(m))) throw new Error('dialogs: ' + p.__dialogs.slice(-1).join(' | '));
    await p.waitForFunction(() => document.querySelectorAll('#br-st tr[data-s]').length === 0, null, T);
    assert.ok(p.__dialogs.some(m => /^Posted BP-|^Posted .* and matched\.$/.test(m)), p.__dialogs.join(' | '));
    await p.waitForFunction(() => /Difference\s+0\.00/.test(document.getElementById('br-report').innerText), null, T);
    await p.click('#br-submit');
    await p.waitForFunction(() => /Reconciled and locked/.test((document.getElementById('br-banner') || {}).textContent || ''), null, T);
    // Reopened: back to a draft, the reason kept.
    await p.click('#br-reopen');
    await p.waitForFunction(() => !document.getElementById('br-submit').classList.contains('hidden'), null, T);
    const nov = (await firestore.collection('bankRecs').doc('C1__A-BANK__2026-11').get()).data();
    assert.deepEqual([nov.Status, nov.History[nov.History.length - 1].Note], ['Draft', 'Statement corrected']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
