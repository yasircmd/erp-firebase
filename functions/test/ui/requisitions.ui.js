// Purchase Requisition and Inventory Purchase Requisition screens in
// headless Chromium against the emulators, through the shell's real rpc
// bridge: a Rejected requisition's item lines are editable (as its header,
// buttons and "fully editable below" banner already were; Code.gs locked the
// lines), a Submitted one stays read-only, and an edited line saves.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/requisitions.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

async function seed() {
  const f = baseFixture();
  f.requisitionCategories = { RC1: { Name: 'Laptops', Type: 'Direct Expense', GLAccountID: 'A-CONS', Status: 'Active', CompanyID: 'C1' } };
  const levels = { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } };
  f.approvalConfigurations = { PURCHASEREQUISITION: { Enabled: true, ScopeType: 'Global' }, INVENTORYPURCHASEREQUISITION: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASEREQUISITION: levels, INVENTORYPURCHASEREQUISITION: levels };
  await reset(f);
  const prHeader = (d) => ({ PRDate: '2026-09-10', CompanyID: 'C1', CostCenterID: 'CC1', Description: d, Lines: [{ CategoryID: 'RC1', Description: 'Laptop', Quantity: 2, Unit: 'pcs' }] });
  const pr = await call('u-admin', 'saveDraftPurchaseRequisition', { header: prHeader('Rejected one') });
  await call('u-admin', 'submitPurchaseRequisition', { prId: pr.prId });
  await call('u-approver', 'decidePurchaseRequisitionApproval', { prId: pr.prId, levelNumber: 1, decision: 'Rejected', reason: 'Too many' });
  const prSub = await call('u-admin', 'saveDraftPurchaseRequisition', { header: prHeader('Pending one') });
  await call('u-admin', 'submitPurchaseRequisition', { prId: prSub.prId });
  const ipr = await call('u-admin', 'saveDraftInventoryPurchaseRequisition', { header: { IPRDate: '2026-09-10', CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Rejected stock',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Description: 'Sheets', EnteredQuantity: 3 }] } });
  await call('u-admin', 'submitInventoryPurchaseRequisition', { iprId: ipr.iprId });
  await call('u-approver', 'decideInventoryPurchaseRequisitionApproval', { iprId: ipr.iprId, levelNumber: 1, decision: 'Rejected', reason: 'Wrong item' });
  return { prId: pr.prId, prSubId: prSub.prId, iprId: ipr.iprId };
}

(async () => {
  const ids = await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8141);
  const browser = await chromium.launch();

  async function openRecord(module, rowSelector, id) {
    const page = await browser.newPage();
    await onAppDialog(page, d => d.accept());
    await page.goto('http://127.0.0.1:8141/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector(rowSelector + '[data-id="' + id + '"]', { timeout: 30000 });
    await page.click(rowSelector + '[data-id="' + id + '"]');
    await page.waitForTimeout(500);
    return page;
  }
  // Enabled state of the first line's inputs/selects, and whether its remove button exists.
  const firstLine = (page, tbody) => page.$eval(tbody + ' tr', tr => ({
    disabled: [...tr.querySelectorAll('input, select')].map(el => el.disabled),
    removable: Boolean(tr.querySelector('button'))
  }));

  await check('PR: a Rejected requisition\'s item lines are editable, and an edit saves', async () => {
    const page = await openRecord('PURCHASEREQUISITION', '.pr-open-btn', ids.prId);
    assert.equal(await page.isVisible('#pr-rejection-banner'), true);
    const line = await firstLine(page, '#pr-grid-body');
    assert.deepEqual(line.disabled.filter(Boolean), [], 'no line field disabled');
    assert.equal(line.removable, true);
    await page.fill('#pr-grid-body tr:first-child input[data-field="quantity"]', '1');
    await page.click('#pr-save-draft-btn');
    await page.waitForFunction(() => !document.getElementById('pr-list-view').classList.contains('hidden'), null, { timeout: 30000 });
    const rec = await val('purchaseRequisitions/' + ids.prId);
    assert.equal(rec.Lines[0].Quantity, 1);
    assert.equal(rec.Status, 'Rejected', 'still Rejected until resubmitted');
    await page.close();
  });

  await check('PR: a requisition pending approval stays read-only', async () => {
    const page = await openRecord('PURCHASEREQUISITION', '.pr-open-btn', ids.prSubId);
    const line = await firstLine(page, '#pr-grid-body');
    assert.ok(line.disabled.length > 0 && line.disabled.every(Boolean), 'every line field disabled');
    assert.equal(line.removable, false);
    await page.close();
  });

  await check('IPR: a Rejected requisition\'s item lines are editable', async () => {
    const page = await openRecord('INVENTORYPURCHASEREQUISITION', '.ipr-open-btn', ids.iprId);
    assert.equal(await page.isVisible('#ipr-rejection-banner'), true);
    const line = await firstLine(page, '#ipr-grid-body');
    assert.deepEqual(line.disabled.filter(Boolean), [], 'no line field disabled');
    assert.equal(line.removable, true);
    await page.close();
  });

  // As the shell's Home task does: openModule(id, { OpenEntryId }). The header
  // dropdown data is held back so the entry arrives first (the race).
  async function openFromTask(module, documentId, uid) {
    const page = await browser.newPage();
    page.__dialogs = [];
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8141/?module=' + module + '&uid=' + (uid || 'u-admin'));
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    for (const fn of ['getActiveCompanies', 'getActiveOrgUnits']) {
      await page.route('**/' + fn, async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
    }
    await page.evaluate(([m, id]) => openModule(m, { OpenEntryId: id }), [module, documentId]);
    return page;
  }
  const rejectedTasks = await call('u-admin', 'getMyRejectedSubmissions', {});
  const taskFor = moduleId => rejectedTasks.find(t => t.ModuleID === moduleId);

  await check('Home task (rejected PR) opens that requisition, with its company and cost center shown', async () => {
    const task = taskFor('PURCHASEREQUISITION');
    assert.equal(task.DocumentID, ids.prId);
    const page = await openFromTask('PURCHASEREQUISITION', task.DocumentID);
    await page.waitForSelector('#pr-entry-view:not(.hidden)', { timeout: 30000 });
    assert.equal(await page.isVisible('#pr-rejection-banner'), true);
    assert.equal(await page.inputValue('#pr-form-description'), 'Rejected one');
    assert.equal(await page.inputValue('#pr-form-company'), 'C1');
    assert.equal(await page.inputValue('#pr-form-costcenter'), 'CC1');
    assert.deepEqual(page.__dialogs, []);
    await page.close();
  });

  await check('Home task (rejected IPR) opens that requisition, with its company and cost center shown', async () => {
    const task = taskFor('INVENTORYPURCHASEREQUISITION');
    assert.equal(task.DocumentID, ids.iprId);
    const page = await openFromTask('INVENTORYPURCHASEREQUISITION', task.DocumentID);
    await page.waitForSelector('#ipr-entry-view:not(.hidden)', { timeout: 30000 });
    assert.equal(await page.isVisible('#ipr-rejection-banner'), true);
    assert.equal(await page.inputValue('#ipr-form-description'), 'Rejected stock');
    assert.equal(await page.inputValue('#ipr-form-company'), 'C1');
    assert.equal(await page.inputValue('#ipr-form-costcenter'), 'CC1');
    assert.deepEqual(page.__dialogs, []);
    await page.close();
  });

  await check('An unknown requisition from a task says so and stays on the list', async () => {
    const page = await openFromTask('PURCHASEREQUISITION', 'PRQ-NOPE');
    await page.waitForFunction(() => window.__rpcLog.filter(c => c.name === 'getActiveOrgUnits').length >= 2, null, { timeout: 30000 });
    await page.waitForTimeout(1000);
    assert.deepEqual(page.__dialogs, ['That requisition could not be found — it may have been deleted.']);
    assert.equal(await page.isVisible('#pr-list-view'), true);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
