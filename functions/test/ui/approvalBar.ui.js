// UX batch 4, item 10 (owner, 2026-11-13; docs/modules/UX4.md): approvals at
// the foot of every entry, through the shell's APPROVAL BAR.
//  - The reported case: an Inventory Purchase Requisition opened from a Home
//    task (openModule with OpenEntryId, as openHomeTaskDocument does) while
//    the screen's rights are still loading. The screen used to show its
//    banner only if its own canPost had already arrived, so a slow rights
//    answer lost Approve and Reject for good. Here the rights answer is held
//    back 2.5 seconds; the bar must still come, with the level and who
//    decides next, and approving through it must work.
//  - Each of the 23 entry screens: its banner is the last thing in its entry
//    view (above the supporting documents, which follow the view).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/approvalBar.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, (e.message + ' @' + ((e.stack || '').match(/approvalBar.ui.js:(\d+)/) || [])[1]).replace(/\s+/g, ' ').slice(0, 400)]); }); }
const T = { timeout: 30000 };
const SCREENS = fs.readdirSync(path.join(__dirname, '../../../screens')).filter(f => /approvalBar\.show/.test(fs.readFileSync(path.join(__dirname, '../../../screens', f), 'utf8'))).map(f => f.slice(0, -5));

(async () => {
  const f = baseFixture();
  f.approvalConfigurations = { INVENTORYPURCHASEREQUISITION: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { INVENTORYPURCHASEREQUISITION: { GLOBAL: { Levels: [
    { LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }, { LevelNumber: 2, ApproverUserID: 'u-admin', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftInventoryPurchaseRequisition', { header: { IPRDate: '2026-11-10', CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Restock',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Description: 'Sheets', EnteredQuantity: 3 }] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await call('u-admin', 'submitInventoryPurchaseRequisition', { iprId: s.iprId })).status, 'PendingApproval');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(harness); }).listen(8232);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message + ' ' + String(e.stack).split('\n').slice(1, 3).join(' ')));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8232/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, T);
    return page;
  }

  await check('IPR opened from a task while its rights are slow: Approve and Reject come, with the level and who is next; approving works', async () => {
    const p = await open('INVENTORYPURCHASEREQUISITION', 'u-approver');
    await p.waitForLoadState('networkidle');
    // The rights answer held back, as on a slow line; then the entry opened as a Home task opens it.
    await p.route('**/getModulePermissionsForUser', async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
    await p.evaluate(id => { window.__moduleReady = false; openModule('INVENTORYPURCHASEREQUISITION', { OpenEntryId: id }); }, s.iprId);
    await p.waitForSelector('#ipr-entry-view:not(.hidden)', T);
    await p.waitForSelector('#ipr-my-approval-banner:not(.hidden)', { timeout: 15000 });
    assert.equal(await p.textContent('#ipr-my-approval-banner .approval-bar-info'), 'Level 1 of 2. Then: Admin User (level 2).');
    assert.equal(await p.evaluate(() => { const b = document.getElementById('ipr-my-approval-banner'); return b.parentElement.id + '|' + (b.parentElement.lastElementChild === b); }), 'ipr-entry-view|true');
    await p.click('#ipr-approve-btn');
    for (let i = 0; i < 100; i++) { const inst = await val('inventoryPurchaseRequisitions/' + s.iprId); if (inst && inst.Status === 'PendingApproval' && p.__dialogs.length) break; await p.waitForTimeout(100); }
    await p.waitForSelector('#ipr-list-view:not(.hidden)', T);
    const pending = (await call('u-admin', 'getPendingApprovalsForUser', {})).find(x => x.DocumentID === s.iprId);
    assert.ok(pending, 'level 2 now waits on the admin');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the next approver gets the bar too, the last level said; someone else gets none', async () => {
    const p = await open('INVENTORYPURCHASEREQUISITION', 'u-admin');
    await p.evaluate(id => { window.__moduleReady = false; openModule('INVENTORYPURCHASEREQUISITION', { OpenEntryId: id }); }, s.iprId);
    await p.waitForSelector('#ipr-my-approval-banner:not(.hidden)', T);
    assert.equal(await p.textContent('#ipr-my-approval-banner .approval-bar-info'), 'Level 2 of 2. Yours is the last level.');
    await p.close();
    const q = await open('INVENTORYPURCHASEREQUISITION', 'u-approver');
    await q.evaluate(id => { window.__moduleReady = false; openModule('INVENTORYPURCHASEREQUISITION', { OpenEntryId: id }); }, s.iprId);
    await q.waitForSelector('#ipr-entry-view:not(.hidden)', T);
    await q.waitForTimeout(1500);
    assert.equal(await q.isVisible('#ipr-my-approval-banner'), false, 'level 1 is decided');
    await q.close();
  });

  await check('every entry screen with approvals (' + SCREENS.length + '): the bar is the last thing in its entry view', async () => {
    assert.ok(SCREENS.length >= 23, SCREENS.join(','));
    const wrong = [];
    for (const m of SCREENS) {
      const p = await open(m, 'u-admin');
      const r = await p.evaluate(() => {
        const b = document.querySelector('#module-container [id$="approval-banner"]');
        if (!b) return 'no banner';
        approvalBar.show(b, { instanceId: '' });
        const v = b.parentElement;
        return /-view$/.test(v.id) && v.lastElementChild === b && b.classList.contains('hidden') ? '' : 'in #' + v.id + (v.lastElementChild === b ? '' : ', not last');
      });
      if (r) wrong.push(m + ': ' + r);
      if (p.__errors.length) wrong.push(m + ': ' + p.__errors.join('; '));
      await p.close();
    }
    assert.deepEqual(wrong, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : results.length + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
