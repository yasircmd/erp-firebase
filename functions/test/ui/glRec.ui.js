// GL Account Reconciliation (docs/modules/RECONCILIATION.md, step R3) in the
// browser, on the emulators: Setup lists two accounts with their methods;
// the month's board; GRN Clearing reconciled by matching a GRN with its
// bill, submitted and locked; an accrual by a schedule that adds up to its
// balance; a Viewer reads only.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/glRec.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /glRec.ui/.test(l))]); }); }
let n = 0;
const post = (date, lines, d) => firestore.collection('journalEntries').add({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: 'JV',
  JVNumber: 'JV-' + (++n), Reference: '', Description: d, Lines: lines.map(([AccountID, Debit, Credit]) => ({ AccountID, Debit, Credit })) });

(async () => {
  const f = baseFixture();
  f.coa['A-ACCR'] = { AccountCode: '2300', AccountName: 'Accrued Expenses', AccountType: 'Liability', Status: 'Active', IsPostable: true };
  f.coa['A-EXP'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  await reset(f);
  await post('2026-10-03', [['A-INV', 500, 0], ['A-CLR', 0, 500]], 'GRN-1');
  await post('2026-10-10', [['A-CLR', 500, 0], ['A-AP', 0, 500]], 'Bill for GRN-1');
  await post('2026-10-20', [['A-INV', 300, 0], ['A-CLR', 0, 300]], 'GRN-2');
  await post('2026-10-31', [['A-EXP', 1200, 0], ['A-ACCR', 0, 1200]], 'Rent accrued');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8198);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(uid) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8198/?module=GLREC&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.fill('#gr-month', '2026-10');
    await page.dispatchEvent('#gr-month', 'change');
    await page.waitForFunction(() => document.querySelectorAll('#gr-setup tr[data-id]').length > 0, null, T);
    return page;
  }
  const until = (p, fn) => p.waitForFunction(fn, null, T).catch(e => { throw new Error(e.message.split('\n')[0] + ' dialogs: ' + p.__dialogs.join(' / ') + ' errors: ' + p.__errors.join(' / ')); });

  await check('Setup lists two accounts; the board; GRN Clearing matched (a GRN with its bill), the rest its balance; submitted and locked', async () => {
    const p = await open('u-admin');
    await p.click('.gr-tab[data-tab="setup"]');
    assert.equal(await p.locator('#gr-setup tr[data-id="A-BANK"]').count(), 0, 'bank accounts are Bank Reconciliation\'s');
    await p.check('#gr-setup tr[data-id="A-CLR"] .gr-pick');
    await p.check('#gr-setup tr[data-id="A-ACCR"] .gr-pick');
    await p.selectOption('#gr-setup tr[data-id="A-ACCR"] .gr-method', 'Schedule');
    await p.click('#gr-setup-save');
    await until(p, () => document.querySelectorAll('#gr-board tr[data-id]').length === 3);
    await p.click('.gr-tab[data-tab="board"]');
    assert.deepEqual((await p.locator('#gr-board tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()),
      ['1100 Bank Bank Reconciliation Not started', '2100 GRN Clearing Match lines Not started', '2300 Accrued Expenses Schedule Not started']);
    await p.click('#gr-board tr[data-id="A-CLR"] .gr-board-open');
    await until(p, () => document.querySelectorAll('#gr-lines tr[data-k]').length === 3);
    assert.equal(await p.textContent('#gr-bal'), '300.00 Cr');
    await p.locator('#gr-lines tr', { hasText: 'GRN-1' }).first().locator('.gr-sel').check();
    await p.locator('#gr-lines tr', { hasText: 'Bill for GRN-1' }).locator('.gr-sel').check();
    assert.match(await p.textContent('#gr-sel'), /they net to nothing/);
    await p.click('#gr-match');
    await until(p, () => document.querySelectorAll('#gr-lines tr[data-k]').length === 1);
    assert.equal(await p.textContent('#gr-exp'), '300.00 Cr');
    assert.equal(await p.textContent('#gr-diff'), '0.00');
    await p.click('#gr-submit');
    await until(p, () => /Reconciled and locked/.test((document.getElementById('gr-banner') || {}).textContent || ''));
    assert.equal(await p.isVisible('#gr-match'), false);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the accrual by a schedule: items added until they make up the balance; submitted', async () => {
    const p = await open('u-admin');
    await p.click('.gr-tab[data-tab="rec"]');
    await p.selectOption('#gr-account', 'A-ACCR');
    await p.click('#gr-open');
    await until(p, () => !document.getElementById('gr-sched-view').classList.contains('hidden'));
    assert.equal(await p.textContent('#gr-bal'), '1,200.00 Cr');
    await p.click('#gr-item-add');
    await p.fill('#gr-items tr[data-i="0"] .gr-it-desc', 'October rent');
    await p.fill('#gr-items tr[data-i="0"] .gr-it-amt', '-1000');
    await p.click('#gr-item-add');
    await p.fill('#gr-items tr[data-i="1"] .gr-it-desc', 'Service charge');
    await p.fill('#gr-items tr[data-i="1"] .gr-it-ref', 'SC-10');
    await p.fill('#gr-items tr[data-i="1"] .gr-it-amt', '-200');
    await p.click('#gr-items-save');
    await until(p, () => document.getElementById('gr-diff').textContent === '0.00');
    assert.equal(await p.textContent('#gr-exp'), '1,200.00 Cr');
    await p.click('#gr-submit');
    await until(p, () => /Reconciled and locked/.test((document.getElementById('gr-banner') || {}).textContent || ''));
    const saved = (await firestore.collection('glRecs').doc('C1__A-ACCR__2026-10').get()).data();
    assert.deepEqual([saved.Status, saved.Items.map(i => [i.Description, i.Reference, i.Amount])], ['Approved', [['October rent', '', -1000], ['Service charge', 'SC-10', -200]]]);
    await p.click('.gr-tab[data-tab="board"]');
    await until(p, () => (document.getElementById('gr-board').innerText.match(/Approved \(locked\)/g) || []).length === 2);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Viewer: the board and a month shown, nothing to change', async () => {
    const p = await open('u-viewer');
    assert.equal(await p.locator('#gr-setup .gr-pick:not([disabled])').count(), 0);
    await p.click('#gr-board tr[data-id="A-CLR"] .gr-board-open');
    await until(p, () => document.getElementById('gr-diff').textContent === '0.00');
    assert.equal(await p.locator('#gr-match:visible, #gr-submit:visible, #gr-reopen:visible, .gr-sel').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
