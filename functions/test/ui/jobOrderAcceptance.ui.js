// Job Order Request screen with acceptance through Approval Configuration
// (owner, 2026-09-28; docs/modules/JOB_ORDER_ACCEPTANCE.md), in headless
// Chromium against the emulators through the shell's real rpc bridge:
// a Home task opens the line itself; only the current level's approver sees
// Accept / Request Amendment, with a "waiting on level N" note; a line with
// no approval (from before go-live) keeps the old buttons for "post" users.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/jobOrderAcceptance.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, rtdb, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

async function seed() {
  const f = baseFixture();
  f.users['u-appr2'] = { status: 'Active', role: 'Admin', username: 'appr2', fullName: 'Second Approver', AssignedCompanies: ['C1'] };
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.boms = { B1: { ParentItemID: 'FG1', Status: 'Active', EffectiveFrom: '2026-01-01', Components: [{ ComponentItemID: 'I1', Quantity: 2 }] } };
  f.approvalConfigurations = { JOBORDERREQUEST: { Enabled: true, ScopeType: 'Company' } };
  f.approvalLevels = { JOBORDERREQUEST: { C1: { Levels: [
    { LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 },
    { LevelNumber: 2, ApproverUserID: 'u-appr2', ThresholdAmount: 0 }
  ] } } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftJobOrderBatch', { header: { Origin: 'Sales', CompanyID: 'C1', CostCenterID: 'CC1', JODate: '2026-09-10', Description: 'Run',
    Lines: [{ ItemCode: 'FG-001', OrderedQuantity: 5, TargetDate: '2026-10-01' }, { ItemCode: 'FG-001', OrderedQuantity: 2, TargetDate: '2026-10-01' }] } });
  await call('u-admin', 'submitJobOrderBatch', { batchId: s.batchId });
  const ids = Object.entries(await val('jobOrderLines')).filter(([, l]) => l.ParentBatchID === s.batchId)
    .sort(([, a], [, b]) => a.LineNumber - b.LineNumber).map(([id]) => id);
  // The second line as the old code left it: pending with no approval.
  await rtdb.ref('jobOrderLines/' + ids[1] + '/ApprovalInstanceID').remove();
  return { gated: ids[0], legacy: ids[1] };
}

(async () => {
  const ids = await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8142);
  const browser = await chromium.launch();

  // As the shell's Home task does: openModule(id, { OpenEntryId }), after the module has loaded once.
  async function openLine(uid, lineId) {
    const page = await browser.newPage();
    page.__dialogs = [];
    page.on('dialog', d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8142/?module=JOBORDERREQUEST&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(id => openModule('JOBORDERREQUEST', { OpenEntryId: id }), lineId);
    await page.waitForSelector('#jo-line-detail-view:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(300);
    return page;
  }
  const buttons = page => page.evaluate(() => ['jo-accept-btn', 'jo-request-amendment-btn']
    .map(id => !document.getElementById(id).classList.contains('hidden')));

  await check('Home task opens the line; its level-1 approver sees Accept and Request Amendment', async () => {
    const task = (await call('u-approver', 'getPendingApprovalsForUser', {})).find(t => t.ModuleID === 'JOBORDERREQUEST');
    assert.equal(task.DocumentID, ids.gated);
    const page = await openLine('u-approver', task.DocumentID);
    assert.equal(await page.textContent('#jo-line-status-badge'), 'Pending Acceptance');
    assert.deepEqual(await buttons(page), [true, true]);
    assert.equal(await page.textContent('#jo-approval-waiting'), 'Waiting on approval level 1: you');
    assert.deepEqual(page.__dialogs, []);
    await page.close();
  });

  await check('A user with post permission but not the current approver sees no buttons, and who it waits on', async () => {
    for (const uid of ['u-admin', 'u-appr2']) {
      const page = await openLine(uid, ids.gated);
      assert.deepEqual(await buttons(page), [false, false], uid);
      assert.equal(await page.textContent('#jo-approval-waiting'), 'Waiting on approval level 1: Approver', uid);
      await page.close();
    }
  });

  await check('After level 1 accepts, level 2 gets the buttons', async () => {
    await call('u-approver', 'acceptJobOrderLine', { lineId: ids.gated });
    const page = await openLine('u-appr2', ids.gated);
    assert.deepEqual(await buttons(page), [true, true]);
    assert.equal(await page.textContent('#jo-approval-waiting'), 'Waiting on approval level 2: you');
    await page.close();
  });

  await check('A line pending from before go-live keeps the old buttons for post users', async () => {
    const page = await openLine('u-admin', ids.legacy);
    assert.deepEqual(await buttons(page), [true, true]);
    assert.equal(await page.isVisible('#jo-approval-waiting'), false);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
