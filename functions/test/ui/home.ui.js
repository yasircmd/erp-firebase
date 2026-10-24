// Drives the Home screen of the real public/index.html in headless
// Chromium. No emulators needed: the three Firebase SDK modules are
// replaced with stubs (a signed-in user, and callables answered from the
// in-memory data below), so this checks the shell's own behaviour:
// the user name cut to a fixed width, the theme switch in the user menu,
// Configure Favourites (every star shown, ends on opening a module or a
// refresh), module search, the company name in the title, the Expand/Collapse icon, and the light-mode
// row highlight and dividers.
//   node functions/test/ui/home.ui.js
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

// Stub server data, set up in the page before its scripts run.
function stubs() {
  const tree = [
    { depth: 0, text: 'Accounts Payable' },
    { depth: 1, text: 'Purchasing' },
    { depth: 2, text: 'Purchase Order', moduleId: 'PURCHASEORDER' },
    { depth: 2, text: 'Purchase Return / Debit Note', moduleId: 'PURCHASERETURN' },
    { depth: 1, text: 'Vendor Invoice', moduleId: 'VENDORINVOICE' },
    { depth: 0, text: 'Accounts Receivable' },
    { depth: 1, text: 'Customer Invoice', moduleId: 'CUSTOMERINVOICE' },
    { depth: 1, text: 'Sales Return / Credit Note', moduleId: 'SALESRETURN' }
  ];
  let favorites = [{ moduleId: 'VENDORINVOICE', label: 'Vendor Invoice' }];
  window.__calls = [];
  window.__stub = async (name, arg) => {
    window.__calls.push(name);
    switch (name) {
      case 'restoreSession': return { fullName: 'Muhammad Yasir Abdul Rahman Al Long Surname', roleName: 'Administrator', data: tree };
      case 'getMyTree': return tree;
      case 'getMyFavorites': return favorites;
      case 'toggleFavorite':
        favorites = favorites.some(f => f.moduleId === arg.moduleId)
          ? favorites.filter(f => f.moduleId !== arg.moduleId)
          : favorites.concat([{ moduleId: arg.moduleId, label: arg.moduleLabel }]);
        return { favorites };
      case 'getActiveCompanies': return window.__companies || [];
      case 'getRecurringJournalsDueForUser': return window.__recurringDue || [];
      case 'getMyDraftsForUser': return window.__drafts || [];
      case 'getMyFollowUpTasksForUser': return window.__followUps || [];
      case 'getMyRejectedSubmissions': return window.__rejected || [];
      case 'closeRejectedSubmission': window.__closed = arg; window.__rejected = []; return { success: true };
      // A screen whose list answers late, and whose handler needs its own
      // elements (as PDC's did when the user went Back while it loaded).
      case 'getModuleFragment': return arg.moduleId === 'SLOWSCREEN'
        ? { html: '<div id="stub-module"><span id="slow-out"></span></div><script>window.initModule = () => rpc.withSuccessHandler(r => { document.getElementById("slow-out").textContent = r; })' +
          '.withFailureHandler(e => appAlert(e.message)).slowList(); <\/script>', canWrite: true }
        : { html: '<div id="stub-module">Module ' + arg.moduleId + '</div>', canWrite: true };
      case 'slowList': await new Promise(r => setTimeout(r, window.__slowMs || 0)); if (window.__slowFails) throw new Error('Nothing to list.'); return 'loaded';
      default: return [];
    }
  };
}

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(INDEX); }).listen(8131);
  const browser = await chromium.launch();

  async function open(theme, companies) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => {
      const file = route.request().url().split('/').pop();
      route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[file] });
    });
    await page.addInitScript(stubs);
    if (theme) await page.addInitScript(t => localStorage.setItem('erp-theme', t), theme);
    if (companies) await page.addInitScript(c => { window.__companies = c; }, companies);
    await page.goto('http://127.0.0.1:8131/');
    await page.waitForSelector('#tree-container li[data-module-id]', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(300);
    return page;
  }
  const visibleModules = page => page.$$eval('#tree-container li[data-module-id]', lis => lis.filter(li => li.checkVisibility()).map(li => li.getAttribute('data-module-id')));
  const visibleStars = page => page.$$eval('.fav-star-btn', bs => bs.filter(b => b.checkVisibility()).length);
  const menu = async (page, id) => { await page.click('#user-menu-btn'); await page.click(id); };

  await check('user name: fixed width with ellipsis, full name in the tooltip', async () => {
    const page = await open();
    const box = await page.locator('#user-info-name').boundingBox();
    assert.ok(box.width <= 8 * 16 + 1, 'name width ' + box.width);
    assert.equal(await page.$eval('#user-info-name', el => getComputedStyle(el).textOverflow), 'ellipsis');
    assert.equal(await page.getAttribute('#user-menu-btn', 'title'), 'Muhammad Yasir Abdul Rahman Al Long Surname · Administrator');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('theme: switched from the user menu, which is hidden inside a module', async () => {
    const page = await open();
    assert.equal(await page.locator('#user-menu-panel #theme-toggle-btn').count(), 1);
    assert.equal(await page.textContent('#theme-toggle-label'), 'Light mode');
    await menu(page, '#theme-toggle-btn');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(await page.textContent('#theme-toggle-label'), 'Dark mode');
    assert.equal(await page.evaluate(() => localStorage.getItem('erp-theme')), 'light');
    await page.click('#toggle-expand-btn');
    await page.click('#tree-container li[data-module-id="CUSTOMERINVOICE"]');
    await page.waitForSelector('#stub-module');
    assert.ok(await page.isHidden('#user-menu'));
    assert.ok(await page.isHidden('#theme-toggle-btn'));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Configure Favourites: all expanded, every star shown; star toggles; ends on Done, opening a module, refresh and reload', async () => {
    const page = await open();
    await page.click('#toggle-expand-btn');
    assert.equal(await visibleStars(page), 0, 'no stars outside the mode');
    await page.hover('#tree-container li[data-module-id="VENDORINVOICE"]');
    assert.equal(await visibleStars(page), 0, 'hovering no longer shows a star');

    await menu(page, '#fav-config-btn');
    assert.equal(await visibleStars(page), 5);
    assert.deepEqual(await visibleModules(page), ['PURCHASEORDER', 'PURCHASERETURN', 'VENDORINVOICE', 'CUSTOMERINVOICE', 'SALESRETURN']);
    assert.ok(await page.isVisible('#fav-config-banner'));
    assert.match(await page.getAttribute('[data-favorite-module-id="VENDORINVOICE"] i', 'class'), /fa-solid fa-star/);
    await page.click('[data-favorite-module-id="SALESRETURN"]');
    await page.waitForFunction(() => document.querySelectorAll('#favorites-list button').length === 2);
    assert.match(await page.getAttribute('[data-favorite-module-id="SALESRETURN"] i', 'class'), /fa-solid fa-star/);
    assert.ok(await page.isHidden('#stub-module'), 'a star click does not open the module');
    assert.equal(await visibleStars(page), 5, 'still in the mode after a change');

    await page.click('#fav-config-done-btn');
    assert.equal(await visibleStars(page), 0);
    assert.ok(await page.isHidden('#fav-config-banner'));

    await menu(page, '#fav-config-btn');
    await page.click('#tree-container li[data-module-id="PURCHASEORDER"] span');
    await page.waitForSelector('#stub-module');
    await page.click('#back-to-tree-btn');
    assert.equal(await visibleStars(page), 0, 'ends on entering a module');

    await menu(page, '#fav-config-btn');
    await menu(page, '#refresh-btn');
    await page.waitForTimeout(300);
    assert.equal(await visibleStars(page), 0, 'ends on Refresh');

    await menu(page, '#fav-config-btn');
    await page.reload();
    await page.waitForSelector('#tree-container li[data-module-id]', { state: 'attached' });
    assert.equal(await visibleStars(page), 0, 'ends on a page reload');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('module search: filters modules, folder names match their contents, Enter opens a single match, Esc restores', async () => {
    const page = await open();
    await page.fill('#module-search', 'return');
    assert.deepEqual(await visibleModules(page), ['PURCHASERETURN', 'SALESRETURN']);
    await page.fill('#module-search', 'purchasing');
    assert.deepEqual(await visibleModules(page), ['PURCHASEORDER', 'PURCHASERETURN']);
    await page.fill('#module-search', 'zzz');
    assert.deepEqual(await visibleModules(page), []);
    assert.ok(await page.isVisible('#module-search-empty'));
    await page.fill('#module-search', 'customer inv');
    await page.press('#module-search', 'Escape');
    assert.equal(await page.inputValue('#module-search'), '');
    assert.deepEqual(await visibleModules(page), [], 'tree back to all collapsed');
    assert.ok(await page.isHidden('#module-search-empty'));
    await page.fill('#module-search', 'customer inv');
    await page.press('#module-search', 'Enter');
    await page.waitForSelector('#stub-module');
    assert.match(await page.textContent('#stub-module'), /CUSTOMERINVOICE/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Expand/Collapse is one icon button', async () => {
    const page = await open();
    assert.equal((await page.textContent('#toggle-expand-btn')).trim(), '');
    assert.equal(await page.getAttribute('#toggle-expand-btn', 'title'), 'Expand all');
    await page.click('#toggle-expand-btn');
    assert.equal((await visibleModules(page)).length, 5);
    assert.equal(await page.getAttribute('#toggle-expand-btn', 'title'), 'Collapse all');
    assert.equal(await page.locator('#toggle-expand-btn i.fa-angles-up').count(), 1);
    await page.click('#toggle-expand-btn');
    assert.equal((await visibleModules(page)).length, 0);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('light mode: a hovered tree row is highlighted, as in dark mode', async () => {
    for (const theme of ['light', 'dark']) {
      const page = await open(theme);
      const summary = page.locator('#tree-container summary').first();
      // Compared with the tree's own background, which is what the row
      // shows through when it isn't hovered.
      const treeBg = await page.$eval('#tree-container > ul', el => getComputedStyle(el).backgroundColor);
      await summary.hover();
      await page.waitForTimeout(100);
      const hovered = await summary.evaluate(el => getComputedStyle(el).backgroundColor);
      assert.ok(hovered !== treeBg && hovered !== 'rgba(0, 0, 0, 0)', theme + ': no hover highlight (' + hovered + ' on ' + treeBg + ')');
      if (theme === 'light') {
        // Row dividers use the light border colour, not the dark theme's.
        const divider = await page.$eval('#tree-container > ul > li + li', el => getComputedStyle(el).borderTopColor);
        assert.equal(divider, 'rgb(226, 232, 240)');
      }
      await page.close();
    }
  });

  await check('title: a one-company user sees their company; otherwise the main (01) company', async () => {
    const title = page => page.textContent('#app-title').then(t => t.trim());
    let page = await open(null, [{ CompanyID: 'C7', LegalName: 'Solo Trading LLC', CompanyRefCode: '07' }]);
    await page.waitForFunction(() => /Solo/.test(document.getElementById('app-title').textContent));
    assert.equal(await title(page), 'ERP Module Hierarchy Tree - Solo Trading LLC');
    await page.click('#toggle-expand-btn');
    await page.click('#tree-container li[data-module-id="CUSTOMERINVOICE"]');
    await page.waitForSelector('#stub-module');
    await page.click('#back-to-tree-btn');
    assert.equal(await title(page), 'ERP Module Hierarchy Tree - Solo Trading LLC', 'restored on returning from a module');
    assert.deepEqual(page.__errors, []);
    await page.close();

    page = await open(null, [{ CompanyID: 'C2', LegalName: 'Second Co', CompanyRefCode: '02' }, { CompanyID: 'C1', LegalName: 'Main Co', CompanyRefCode: '01' }]);
    await page.waitForFunction(() => /Main Co/.test(document.getElementById('app-title').textContent));
    assert.equal(await title(page), 'ERP Module Hierarchy Tree - Main Co');
    await page.close();

    page = await open();
    await page.waitForTimeout(300);
    assert.equal(await title(page), 'ERP Module Hierarchy Tree');
    // A company assigned to the user in a module shows on returning to Home,
    // without a reload (onboarding dry run, 2026-10-23).
    await page.click('#toggle-expand-btn');
    await page.click('#tree-container li[data-module-id="CUSTOMERINVOICE"]');
    await page.waitForSelector('#stub-module');
    await page.evaluate(() => { window.__companies = [{ CompanyID: 'C9', LegalName: 'New Client Co', CompanyRefCode: '01' }]; });
    await page.click('#back-to-tree-btn');
    await page.waitForFunction(() => /New Client Co/.test(document.getElementById('app-title').textContent));
    assert.equal(await title(page), 'ERP Module Hierarchy Tree - New Client Co');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('copyright: on Home (and the login page), not inside a module', async () => {
    const page = await open();
    const hidden = () => page.$eval('#app-copyright', el => el.classList.contains('hidden'));
    assert.match(await page.textContent('#app-copyright'), /^© \d{4} Yasir AV\. All rights reserved\.$/);
    assert.equal(await hidden(), false, 'Home');
    await page.click('#toggle-expand-btn');
    await page.click('#tree-container li[data-module-id="CUSTOMERINVOICE"]');
    await page.waitForSelector('#stub-module');
    assert.equal(await hidden(), true, 'inside a module');
    await page.click('#back-to-tree-btn');
    assert.equal(await hidden(), false, 'back on Home');
    // Signing out from inside a module lands on the login page with it.
    await page.click('#tree-container li[data-module-id="CUSTOMERINVOICE"]');
    await page.waitForSelector('#stub-module');
    await page.evaluate(() => showTreeNav()); // what signing out runs first
    assert.equal(await hidden(), false, 'login page');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('tasks: recurring journal entries due to post, counted and opened (docs/modules/RECURRING_JOURNAL.md)', async () => {
    let page = await open();
    assert.ok(await page.isHidden('#home-recurring-due-block'), 'nothing due, no block');
    await page.close();
    const context = await browser.newContext();
    page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await page.addInitScript(stubs);
    await page.addInitScript(() => { window.__recurringDue = [{ ModuleID: 'RECURRINGJV', ModuleLabel: 'Recurring Journal Entries', DocumentID: 'RJ-1', DocumentNumber: 'RJT-26-01-000001', Description: 'Rent {MONTH}', DueCount: 2, FailedCount: 1, OldestDueDate: '2026-08-01' }]; });
    await page.goto('http://127.0.0.1:8131/');
    await page.waitForSelector('#home-recurring-due-block:not(.hidden)', { state: 'attached', timeout: 30000 });
    assert.equal((await page.textContent('#home-tasks-count')).trim(), '(1)');
    const row = await page.textContent('#home-recurring-due-list');
    assert.match(row, /RJT-26-01-000001.*Rent \{MONTH\}.*2 due since 01\/08\/2026.*1 failed/s);
    await page.evaluate(() => toggleHomeTasksSection());
    await page.click('#home-recurring-due-list > div');
    await page.waitForSelector('#stub-module');
    assert.match(await page.textContent('#stub-module'), /Module RECURRINGJV/);
    assert.deepEqual(page.__errors, []);
    await context.close();
  });

  await check('tasks: my drafts, counted, with the module, description and date, and opened on the draft (docs/modules/DRAFT_TASKS.md)', async () => {
    let page = await open();
    assert.ok(await page.isHidden('#home-drafts-block'), 'no drafts, no block');
    await page.close();
    const context = await browser.newContext();
    page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await page.addInitScript(stubs);
    await page.addInitScript(() => {
      window.__recurringDue = [{ ModuleID: 'RECURRINGJV', ModuleLabel: 'Recurring Journal Entries', DocumentID: 'RJ-1', DocumentNumber: 'RJT-1', Description: 'Rent', DueCount: 1, FailedCount: 0, OldestDueDate: '2026-08-01' }];
      window.__drafts = [
        { ModuleID: 'PURCHASEORDER', ModuleLabel: 'Purchase Order', DocumentID: 'PO-AB12', Description: 'Steel <b>for</b> May', DocumentDate: '2026-09-20', SavedAt: '2026-09-28T10:00:00Z' },
        { ModuleID: 'GRN', ModuleLabel: 'Goods Receipt (GRN)', DocumentID: 'GRN-X', Description: '', DocumentDate: '', SavedAt: '' }
      ];
      const open = () => { const o = window.openModule; window.openModule = (m, p) => { window.__opened = [m, p && p.OpenEntryId]; return o(m, p); }; };
      document.addEventListener('DOMContentLoaded', () => setTimeout(open, 0));
    });
    await page.goto('http://127.0.0.1:8131/');
    await page.waitForSelector('#home-drafts-block:not(.hidden)', { state: 'attached', timeout: 30000 });
    assert.equal((await page.textContent('#home-tasks-count')).trim(), '(3)', 'drafts counted with the other tasks');
    const rows = await page.$$eval('#home-drafts-list > div', ds => ds.map(d => d.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^Purchase Order Steel <b>for<\/b> May · 20\/09\/2026 saved /, 'escaped, with the date and when it was saved');
    assert.equal(rows[1], 'Goods Receipt (GRN) (no description)');
    await page.evaluate(() => toggleHomeTasksSection());
    await page.click('#home-drafts-list > div >> nth=0');
    await page.waitForSelector('#stub-module');
    assert.match(await page.textContent('#stub-module'), /Module PURCHASEORDER/);
    assert.deepEqual(await page.evaluate(() => window.__opened), ['PURCHASEORDER', 'PO-AB12']);
    assert.deepEqual(page.__errors, []);
    await context.close();
  });

  await check('tasks: ready for you to act on, counted and opened on the document (docs/modules/APPROVAL_ROUTING.md)', async () => {
    let page = await open();
    assert.ok(await page.isHidden('#home-followup-block'), 'nothing ready, no block');
    await page.close();
    const context = await browser.newContext();
    page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await page.addInitScript(stubs);
    await page.addInitScript(() => {
      window.__drafts = [{ ModuleID: 'GRN', ModuleLabel: 'Goods Receipt (GRN)', DocumentID: 'G1', Description: 'x', DocumentDate: '', SavedAt: '' }];
      window.__followUps = [
        { ModuleID: 'JOBORDERREQUEST', ModuleLabel: 'Job Order Request', DocumentID: 'JOL-1', DocumentNumber: 'JO-26-1-1', Description: 'FG-001 × 5', DocumentDate: '2026-10-01' },
        { ModuleID: 'PURCHASEREQUISITION', ModuleLabel: 'Purchase Requisition', DocumentID: 'PRQ-1', DocumentNumber: 'PR-26-01', Description: '<i>Paper</i>', DocumentDate: '2026-09-10' }
      ];
      document.addEventListener('DOMContentLoaded', () => setTimeout(() => { const o = window.openModule; window.openModule = (m, p) => { window.__opened = [m, p && p.OpenEntryId]; return o(m, p); }; }, 0));
    });
    await page.goto('http://127.0.0.1:8131/');
    await page.waitForSelector('#home-followup-block:not(.hidden)', { state: 'attached', timeout: 30000 });
    assert.equal((await page.textContent('#home-tasks-count')).trim(), '(3)', 'counted with the other tasks');
    const rows = await page.$$eval('#home-followup-list > div', ds => ds.map(d => d.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(rows, ['JO-26-1-1 Job Order Request · FG-001 × 5 01/10/2026', 'PR-26-01 Purchase Requisition · <i>Paper</i> 10/09/2026']);
    await page.evaluate(() => toggleHomeTasksSection());
    await page.click('#home-followup-list > div >> nth=1');
    await page.waitForSelector('#stub-module');
    assert.deepEqual(await page.evaluate(() => window.__opened), ['PURCHASEREQUISITION', 'PRQ-1']);
    assert.deepEqual(page.__errors, []);
    await context.close();
  });

  await check('tasks: a rejection can be closed without resubmitting, after a confirmation, and leaves the list (UX_ROUND2.md item 3)', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    const asked = [];
    let answer = false;
    await onAppDialog(page, d => { asked.push(d.message()); return answer ? d.accept() : d.dismiss(); });
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await page.addInitScript(stubs);
    await page.addInitScript(() => {
      window.__rejected = [{ InstanceID: 'APR-1', ModuleID: 'GRN', ModuleLabel: 'Goods Receipt (GRN)', DocumentID: 'GRN-X', DocumentNumber: 'GRN-0001', RejectionReason: 'Wrong qty' }];
      const open = () => { const o = window.openModule; window.openModule = (m, p) => { window.__opened = [m, p && p.OpenEntryId]; return o(m, p); }; };
      document.addEventListener('DOMContentLoaded', () => setTimeout(open, 0));
    });
    await page.goto('http://127.0.0.1:8131/');
    await page.waitForSelector('#home-rejected-block:not(.hidden)', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => toggleHomeTasksSection());
    await page.click('#home-rejected-list .home-rejected-close');
    await page.waitForTimeout(300);
    assert.match(asked[0] || '', /Close GRN-0001 without resubmitting it\?/);
    assert.equal(await page.evaluate(() => window.__closed), undefined, 'Cancel closes nothing');
    assert.equal(await page.evaluate(() => window.__opened), undefined, 'Close does not open the document');
    answer = true;
    await page.click('#home-rejected-list .home-rejected-close');
    await page.waitForSelector('#home-rejected-block.hidden', { state: 'attached', timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.__closed), { InstanceID: 'APR-1' });
    assert.equal(await page.evaluate(() => window.__opened), undefined);
    assert.deepEqual(page.__errors, []);
    await context.close();
  });

  await check('leaving a screen while it loads: its late answer is dropped, no error shown; staying, it arrives (UX_ROUND2.md item 1)', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    const shown = [];
    await onAppDialog(page, d => { shown.push(d.message()); return d.accept(); });
    await routeCdnStyles(page);
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK[route.request().url().split('/').pop()] }));
    await page.addInitScript(stubs);
    await page.goto('http://127.0.0.1:8131/');
    await page.waitForSelector('#tree-container li[data-module-id]', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(300); // as open(): the sign-in's own Home rendering done
    // Staying: the answer reaches the screen.
    await page.evaluate(() => { window.__slowMs = 300; openModule('SLOWSCREEN'); });
    await page.waitForFunction(() => (document.getElementById('slow-out') || {}).textContent === 'loaded', null, { timeout: 5000 });
    // Leaving before it answers, by Back, then by opening another module.
    for (const leave of ['back', 'other']) {
      for (const fails of [false, true]) {
        await page.evaluate(f => { window.__slowMs = 600; window.__slowFails = f; }, fails);
        if (await page.isVisible('#back-to-tree-btn')) await page.click('#back-to-tree-btn');
        await page.waitForSelector('#tree-view-container:not(.hidden)');
        await page.evaluate(() => openModule('SLOWSCREEN'));
        await page.waitForSelector('#slow-out', { state: 'attached' });
        if (leave === 'back') await page.click('#back-to-tree-btn');
        else await page.evaluate(() => openModule('CUSTOMERINVOICE'));
        await page.waitForTimeout(900);
      }
    }
    assert.deepEqual(shown, [], 'no message from a screen already left');
    assert.deepEqual(page.__errors, []);
    // Home's own calls are answered whatever happens (its tasks, favourites).
    assert.ok(await page.evaluate(() => window.__calls.includes('getMyFavorites')));
    await context.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
})();
