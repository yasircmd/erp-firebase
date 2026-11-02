// Chart of Accounts, the Tree view tab (owner, 2026-11-02, Q375-Q378;
// docs/modules/COA_TREE.md): by account type, each heading with the accounts
// under it in code order; opens to the headings; the screen's filters apply,
// a heading kept for a match shown greyed; the code opens the edit form for
// those who may edit, plain text for a Viewer; Expand all / Collapse all.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/coaTree.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + ' @ ' + String(e.stack).split('\n').find(l => /coaTree.ui/.test(l))]); }); }

(async () => {
  const f = baseFixture();
  const acc = (AccountCode, AccountName, AccountType, IsPostable, ParentAccountID, extra) =>
    Object.assign({ AccountCode, AccountName, AccountType, IsPostable, Status: 'Active', ParentAccountID: ParentAccountID || '' }, extra || {});
  f.coa = {
    'H-A': acc('100000', 'Assets', 'Asset', false),
    'H-CB': acc('110000', 'Cash and bank', 'Asset', false, 'H-A', { OwnCashBank: 'Bank', CashBank: 'Bank' }),
    'A-CASH': acc('110001', 'Cash in hand', 'Asset', true, 'H-CB'),
    'A-BANK': acc('110002', 'Bank current', 'Asset', true, 'H-CB', { Currency: 'USD' }),
    'A-OLD': acc('110009', 'Old bank', 'Asset', true, 'H-CB', { Status: 'Inactive' }),
    'H-REC': acc('120000', 'Receivables', 'Asset', false, 'H-A'),
    'A-AR': acc('120001', 'Trade receivables', 'Asset', true, 'H-REC'),
    'H-L': acc('200000', 'Liabilities', 'Liability', false),
    'A-AP': acc('200001', 'Trade payables', 'Liability', true, 'H-L'),
    'A-EXP': acc('6100', 'Rent', 'Expense', true) // no heading above it: at its type's top
  };
  await reset(f);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8199);
  const browser = await chromium.launch();
  const T = { timeout: 30000 };
  async function open(uid) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8199/?module=COA&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    await page.waitForFunction(() => document.querySelectorAll('#coa-table-body tr').length > 5, null, T);
    await page.click('.coa-tab[data-tab="tree"]');
    return page;
  }
  // The lines shown (not inside a closed heading), each as its text.
  // The app seeds its standard headings too (130000 Accounts Receivable ...,
  // some under this test's own classes, so Liabilities opens: it has headings):
  // kept to this test's accounts and the type lines.
  const mine = Object.values(f.coa).map(a => a.AccountCode);
  const visible = p => p.$$eval('#coa-tree li', lis => lis.filter(li => !li.closest('.coa-tree-children.hidden')).map(li => li.firstElementChild.innerText.replace(/\s+/g, ' ').trim()))
    .then(ls => ls.filter(l => /^[A-Z]+( \d|$)/.test(l) || mine.includes(l.split(' ')[0])));
  const dimmed = p => p.$$eval('#coa-tree li.coa-tree-node > div.opacity-50', ds => ds.map(d => d.closest('li').dataset.id));

  await check('by type, headings in code order, open to the headings; the list hidden; the code opens the edit form', async () => {
    const p = await open('u-admin');
    assert.ok(await p.isHidden('#coa-list-view') && await p.isVisible('#coa-tree-view'));
    assert.deepEqual(await visible(p), [
      'ASSET 3 accounts', '100000 Assets HEADER 3 accounts', '110000 Cash and bank HEADER BANK 2 accounts', '120000 Receivables HEADER 1 account',
      'LIABILITY 1 account', '200000 Liabilities HEADER 1 account', '200001 Trade payables POSTABLE', 'EQUITY', 'REVENUE', 'COGS',
      'EXPENSE 1 account', '6100 Rent POSTABLE']);
    await p.click('#coa-tree li[data-id="H-CB"] .coa-tree-toggle');
    assert.deepEqual((await visible(p)).slice(3, 5), ['110001 Cash in hand POSTABLE', '110002 Bank current POSTABLE USD']);
    await p.click('#coa-tree li[data-id="A-BANK"] .coa-tree-edit');
    await p.waitForSelector('#coa-modal:not(.hidden)', T);
    assert.equal(await p.inputValue('#coa-form-name'), 'Bank current');
    await p.click('#coa-modal-cancel');
    await p.click('.coa-tab[data-tab="list"]');
    assert.ok(await p.isVisible('#coa-list-view') && await p.isHidden('#coa-tree-view'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the filters apply: a search keeps the headings above a match (greyed), all open; Inactive shown when chosen', async () => {
    const p = await open('u-admin');
    await p.fill('#coa-search-input', 'bank current');
    await p.waitForFunction(() => document.querySelectorAll('#coa-tree li.coa-tree-node').length === 3, null, T);
    assert.deepEqual(await visible(p), ['ASSET 1 account', '100000 Assets HEADER 1 account', '110000 Cash and bank HEADER BANK 1 account', '110002 Bank current POSTABLE USD']);
    assert.deepEqual(await dimmed(p), ['H-A', 'H-CB']);
    await p.fill('#coa-search-input', '');
    await p.dispatchEvent('#coa-search-input', 'input');
    await p.selectOption('#coa-status-filter', '');
    await p.click('#coa-tree li[data-id="H-CB"] .coa-tree-toggle');
    assert.ok((await visible(p)).includes('110009 Old bank POSTABLE INACTIVE'));
    await p.selectOption('#coa-type-filter', 'Liability');
    assert.deepEqual(await visible(p), ['LIABILITY 1 account', '200000 Liabilities HEADER 1 account', '200001 Trade payables POSTABLE']);
    await p.fill('#coa-search-input', 'no such account');
    assert.equal(await p.textContent('#coa-tree'), 'No accounts found.');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Collapse all shows the types only; Expand all every account', async () => {
    const p = await open('u-admin');
    await p.click('#coa-tree-collapse');
    assert.deepEqual(await visible(p), ['ASSET 3 accounts', 'LIABILITY 1 account', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE 1 account']);
    await p.click('#coa-tree-expand');
    assert.equal((await visible(p)).length, 15);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Viewer: the codes plain text, nothing to open', async () => {
    const p = await open('u-viewer');
    await p.waitForSelector('#coa-tree li[data-id="H-A"]', T);
    assert.equal(await p.locator('.coa-tree-edit').count(), 0);
    assert.equal(await p.locator('#coa-tree li[data-id="H-A"] .font-mono').first().textContent(), '100000');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
