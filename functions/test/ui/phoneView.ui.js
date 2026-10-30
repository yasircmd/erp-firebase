// The phone view (docs/modules/PHONE_VIEW.md, Q280, Q335-Q337) on the real
// public/index.html, a phone's size, the server stubbed as in home.ui.js:
// Home at the phone's width, nothing wider than the screen; an approval
// opens the card, Approve calls the module's own decide function with what
// the card was given; the Trial Balance's table keeps its first column and
// scrolls, Stock Availability's rows become cards with their headings; a
// data entry screen stays desktop-width with its notice, which closes; on a
// computer nothing changes (an approval opens the document's screen).
//   node functions/test/ui/phoneView.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { routeCdnStyles } = require('./_cdnStyles');
const { onAppDialog } = require('./_appDialogs');

const INDEX = fs.readFileSync(path.join(__dirname, '../../../public/index.html'));
const SDK = {
  'firebase-app.js': 'export function initializeApp() { return {}; }',
  'firebase-auth.js': `
    const auth = { currentUser: { uid: 'u1' } };
    export function getAuth() { return auth; }
    export function onAuthStateChanged(_a, cb) { setTimeout(() => cb(auth.currentUser), 0); }
    export async function signOut() {}
    export async function signInWithEmailAndPassword() {}
    export async function sendPasswordResetEmail() {}
    export async function reauthenticateWithCredential() {}
    export async function updatePassword() {}
    export const EmailAuthProvider = { credential() {} };`,
  'firebase-functions.js': `
    export function getFunctions() { return {}; }
    export function httpsCallable(_i, name) { return async (arg) => ({ data: await window.__stub(name, arg) }); }`
};

function stubs() {
  const tree = [{ depth: 0, text: 'Finance' }, { depth: 1, text: 'Trial Balance', moduleId: 'TRIALBALANCE' }, { depth: 1, text: 'Stock Availability', moduleId: 'STOCKAVAILABILITY' }, { depth: 1, text: 'Journal Entry', moduleId: 'JV' }];
  const TABLE = '<table><thead><tr><th>Account</th><th>Opening</th><th>Debit</th><th>Credit</th><th>Closing</th><th>Type</th><th>Group</th></tr></thead><tbody>' +
    '<tr><td>1000 Cash at bank, a long account name</td><td>10.00</td><td>20.00</td><td>5.00</td><td>25.00</td><td>Asset</td><td>Current assets</td></tr></tbody></table>';
  window.__calls = [];
  window.__pending = [{ InstanceID: 'APR-1', ModuleID: 'PURCHASEORDER', ModuleLabel: 'Purchase Order', DocumentID: 'PO-1', DocumentNumber: 'PO-26-01-000001' }];
  window.__stub = async (name, arg) => {
    window.__calls.push([name, arg]);
    switch (name) {
      case 'restoreSession': return { fullName: 'Example User', roleName: 'Finance Manager', data: tree, theme: 'dark' };
      case 'getMyTree': return tree;
      case 'getPendingApprovalsForUser': return window.__pending;
      case 'getApprovalSummary': return { InstanceID: 'APR-1', ModuleID: 'PURCHASEORDER', ModuleLabel: 'Purchase Order', DocumentID: 'PO-1', DocumentNumber: 'PO-26-01-000001',
        Date: '2026-10-20', Party: 'Example Supplies', Amount: 60, Currency: 'AED', Description: '', Status: 'PendingApproval', SubmittedBy: 'Sample Buyer', SubmittedAt: '2026-10-20T08:00:00Z',
        MyLevel: 1, Levels: [{ LevelNumber: 1, Approver: 'Example User' }], Decisions: [], Lines: [{ Text: 'Paper', Quantity: 10, Amount: 50 }, { Text: 'Pens', Quantity: 4, Amount: 10 }], MoreLines: 0,
        Decide: { fn: 'decidePurchaseOrderApproval', id: '', positional: true } };
      case 'decidePurchaseOrderApproval': window.__decided = arg; window.__pending = []; return { success: true, status: 'Approved' };
      case 'getModuleFragment':
        if (arg.moduleId === 'TRIALBALANCE' || arg.moduleId === 'STOCKAVAILABILITY') {
          // The report draws its table after its data arrives, as the real screens do.
          return { html: '<div id="stub-module"><div id="rep"></div></div><script>window.initModule = () => setTimeout(() => { document.getElementById("rep").innerHTML = ' + JSON.stringify(TABLE) + '; }, 100);<\/script>', canWrite: true };
        }
        return { html: '<div id="stub-module">Module ' + arg.moduleId + '</div>', canWrite: true };
      default: return [];
    }
  };
}

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const PHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(INDEX); }).listen(8179);
  const browser = await chromium.launch();
  async function open(device) {
    const ctx = await browser.newContext(device);
    const page = await ctx.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await page.addInitScript(stubs);
    await page.goto('http://127.0.0.1:8179/');
    await page.waitForSelector('#tree-container li[data-module-id]', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(300);
    return page;
  }
  const phoneView = p => p.evaluate(() => ({ phone: document.documentElement.classList.contains('phone-view'), viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
    notice: document.documentElement.classList.contains('phone-desktop-screen'), wide: document.documentElement.scrollWidth }));
  // Home's tasks are folded until the Tasks button is pressed.
  const showTasks = async p => {
    await p.waitForSelector('#home-pending-approvals-list > div', { state: 'attached', timeout: 15000 });
    if (await p.isHidden('#home-tasks-section')) await p.click('#home-tasks-toggle-btn');
    await p.waitForSelector('#home-pending-approvals-list > div', { timeout: 15000 });
  };
  const openModule = async (p, id) => { await p.evaluate(m => openModule(m), id); await p.waitForSelector('#stub-module', { timeout: 15000 }); };

  await check('a phone: Home at its width, nothing wider; an approval opens the card; Approve decides through the module\'s own function', async () => {
    const p = await open(PHONE);
    const v = await phoneView(p);
    assert.deepEqual([v.phone, v.viewport.startsWith('width=device-width'), v.notice], [true, true, false]);
    assert.ok(v.wide <= 391, 'no wider than the phone: ' + v.wide);
    await showTasks(p);
    await p.click('#home-pending-approvals-list > div');
    await p.waitForSelector('#approval-card:not(.hidden) #ac-approve', { timeout: 15000 });
    const text = (await p.textContent('#approval-card-body')).replace(/\s+/g, ' ');
    assert.match(text, /PO-26-01-000001.*Example Supplies.*AED 60\.00.*Paper × 10.*50\.00.*Level 1: Example User \(you\)/);
    assert.equal(await p.evaluate(() => document.getElementById('stub-module')), null, 'the full screen not opened');
    await p.click('#ac-approve');
    await p.waitForFunction(() => window.__decided, null, { timeout: 15000 });
    assert.deepEqual(await p.evaluate(() => window.__decided), { __positional: ['PO-1', 1, 'Approved', ''] });
    assert.ok(p.__dialogs.includes('Approve PO-26-01-000001?') && p.__dialogs.includes('Approved.'), p.__dialogs.join(' | '));
    await p.waitForFunction(() => document.getElementById('approval-card').classList.contains('hidden'));
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('a phone: the Trial Balance scrolls with its first column fixed; Stock Availability\'s rows are cards; a data entry screen is desktop-width with its notice', async () => {
    const p = await open(PHONE);
    await openModule(p, 'TRIALBALANCE');
    await p.waitForSelector('#rep table', { timeout: 15000 });
    await p.waitForFunction(() => document.querySelector('#rep table').parentElement.classList.contains('phone-scroll'));
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#rep td')).position), 'sticky');
    assert.equal((await phoneView(p)).phone, true);
    await openModule(p, 'STOCKAVAILABILITY');
    await p.waitForSelector('#rep table.phone-cards', { timeout: 15000 });
    assert.deepEqual(await p.$$eval('#rep td', tds => tds.slice(0, 3).map(td => td.getAttribute('data-label'))), ['Account', 'Opening', 'Debit']);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#rep thead')).display), 'none');
    await openModule(p, 'JV');
    const v = await phoneView(p);
    assert.deepEqual([v.phone, v.viewport, v.notice], [false, 'width=1024', true]);
    assert.ok(await p.isVisible('#phone-notice'));
    await p.click('#phone-notice button');
    assert.ok(await p.isHidden('#phone-notice'), 'closed');
    await openModule(p, 'JV');
    assert.equal((await phoneView(p)).notice, false, 'stays closed for the session');
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('a computer: nothing changes; an approval opens the document\'s own screen', async () => {
    const p = await open({ viewport: { width: 1280, height: 900 } });
    const v = await phoneView(p);
    assert.deepEqual([v.phone, v.notice], [false, false]);
    await showTasks(p);
    await p.click('#home-pending-approvals-list > div');
    await p.waitForSelector('#stub-module', { timeout: 15000 });
    assert.ok(await p.isHidden('#approval-card'));
    assert.equal(await p.evaluate(() => window.__calls.some(c => c[0] === 'getApprovalSummary')), false);
    await p.context().close();
  });

  await browser.close(); server.close();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
