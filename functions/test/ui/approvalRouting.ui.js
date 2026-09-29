// Approval routing (docs/modules/APPROVAL_ROUTING.md): Approval
// Configuration lists CBT's four voucher types, and a Follow-up team section
// (Job Order Request, PR, IPR) saves the ticked users per scope; the
// follow-up tasks open their document.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/approvalRouting.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const D = '2026-09-10';

async function seed() {
  const f = baseFixture();
  f.users['u-buyer'] = { status: 'Active', role: 'Admin', username: 'buyer', fullName: 'Bea Buyer', AssignedCompanies: ['C1'] };
  f.coa['A-EXP'] = { AccountCode: '6000', AccountName: 'Office Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.requisitionCategories = { RC1: { Name: 'Stationery', Type: 'Direct Expense', GLAccountID: 'A-EXP', Status: 'Active', CompanyID: 'C1' } };
  f.approvalConfigurations = { CBT: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' },
    PURCHASEREQUISITION: { Enabled: false, ScopeType: 'CostCenter', GateType: 'Flat' },
    JOBORDERREQUEST: { Enabled: false, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { CBT: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  f.items.FG1 = { ItemCode: 'FG-001', ItemName: 'Panel', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', ConsumptionAccountID: 'A-CONS' };
  f.jobOrderBatches = { B1: { Origin: 'Sales', CompanyID: 'C1', CostCenterID: 'CC1', Status: 'Submitted', BatchNumber: 'JOB-26-1', JODate: D, Description: 'Panels' } };
  f.jobOrderLines = { L1: { ParentBatchID: 'B1', LineNumber: 1, SubJONumber: 'JO-26-1-1', ItemCode: 'FG-001', OrderedQuantity: 5, TargetDate: '2026-10-01',
    Status: 'Accepted', AcceptedAt: '2026-09-20T00:00:00Z', CreatedAt: '2026-09-20T00:00:00Z' } };
  await reset(f);
  const s = await call('u-admin', 'saveDraftPurchaseRequisition', { header: { PRDate: D, CompanyID: 'C1', CostCenterID: 'CC1', Description: 'Paper for the office',
    Lines: [{ CategoryID: 'RC1', Description: 'Paper', Quantity: 10, Unit: 'box' }] } });
  assert.equal(s.success, true, s.error);
  assert.equal((await call('u-admin', 'submitPurchaseRequisition', { prId: s.prId })).status, 'Submitted');
  return s.prId;
}

(async () => {
  const prId = await seed();
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8146);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8146/?module=' + module + '&uid=' + (uid || 'u-admin'));
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const configure = (page, id) => page.click('.ac-configure-btn[data-id="' + id + '"]');

  await check('Approval Configuration: CBT is four entries, each with today\'s CBT setup', async () => {
    const page = await open('APPROVALCONFIG');
    const rows = await page.$$eval('#ac-module-table-body tr', trs => trs.map(tr => [...tr.querySelectorAll('td')].slice(0, 3).map(td => td.textContent.trim())));
    const cbt = rows.filter(r => r[0].startsWith('Cash & Bank'));
    assert.deepEqual(cbt, [['Cash & Bank — Cash Receipt', 'Enabled', 'Global'], ['Cash & Bank — Bank Receipt', 'Enabled', 'Global'],
      ['Cash & Bank — Cash Payment', 'Enabled', 'Global'], ['Cash & Bank — Bank Payment', 'Enabled', 'Global']]);
    await configure(page, 'CBT_BANKPAYMENT');
    await page.waitForSelector('#ac-levels-block:not(.hidden)');
    await page.waitForTimeout(500);
    assert.equal(await page.inputValue('#ac-levels-body select[data-field="approver"]'), 'u-approver');
    assert.ok(await page.isHidden('#ac-followup-block'), 'no follow-up team for CBT');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Follow-up team: ticked users saved for the chosen scope, shown again on reopening', async () => {
    let page = await open('APPROVALCONFIG');
    await configure(page, 'PURCHASEREQUISITION');
    assert.ok(await page.isHidden('#ac-followup-block'), 'hidden until a scope is chosen');
    await page.selectOption('#ac-scope-picker', 'CC1');
    await page.waitForSelector('#ac-followup-block:not(.hidden)');
    assert.equal(await page.textContent('#ac-followup-team'), 'Procurement');
    await page.check('.ac-followup-user[value="u-buyer"]');
    await page.click('#ac-followup-save-btn');
    await page.waitForSelector('#ac-followup-saved:not(.hidden)');
    assert.deepEqual(await val('approvalFollowUps/PURCHASEREQUISITION/CC1/UserIDs'), ['u-buyer']);
    await page.close();

    page = await open('APPROVALCONFIG');
    await configure(page, 'PURCHASEREQUISITION');
    await page.selectOption('#ac-scope-picker', 'CC1');
    await page.waitForSelector('#ac-followup-block:not(.hidden)');
    await page.waitForTimeout(500);
    assert.deepEqual(await page.$$eval('.ac-followup-user:checked', cs => cs.map(c => c.value)), ['u-buyer']);
    // The saved team arrives late: a tick made before it must not be lost.
    await page.route('**/getFollowUpTeams', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
    await configure(page, 'JOBORDERREQUEST');
    await page.waitForSelector('#ac-followup-block:not(.hidden)', { timeout: 5000 });
    assert.equal(await page.textContent('#ac-followup-team'), 'Production', 'Global scope: no picker, straight to the team');
    await page.check('.ac-followup-user[value="u-admin"]');
    await page.click('#ac-followup-save-btn');
    await page.waitForSelector('#ac-followup-saved:not(.hidden)');
    assert.deepEqual(await val('approvalFollowUps/JOBORDERREQUEST/GLOBAL/UserIDs'), ['u-admin'], 'the tick survived the saved team arriving');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  const tasks = uid => call(uid, 'getMyFollowUpTasksForUser', {});
  await check('the team\'s tasks open the requisition and the Job Order line', async () => {
    const [pr] = await tasks('u-buyer');
    assert.deepEqual([pr.ModuleID, pr.DocumentID], ['PURCHASEREQUISITION', prId]);
    let page = await open('PURCHASEREQUISITION', 'u-buyer');
    await page.evaluate(id => openModule('PURCHASEREQUISITION', { OpenEntryId: id }), pr.DocumentID);
    await page.waitForSelector('#pr-entry-view:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(1000);
    assert.equal(await page.inputValue('#pr-form-description'), 'Paper for the office');
    assert.deepEqual(page.__dialogs, []);
    await page.close();

    const [jo] = await tasks('u-admin');
    assert.deepEqual([jo.ModuleID, jo.DocumentID], ['JOBORDERREQUEST', 'L1']);
    page = await open('JOBORDERREQUEST');
    await page.evaluate(id => openModule('JOBORDERREQUEST', { OpenEntryId: id }), jo.DocumentID);
    await page.waitForSelector('#jo-line-detail-view:not(.hidden)', { timeout: 30000 });
    assert.match(await page.textContent('#jo-line-detail-view'), /JO-26-1-1/);
    assert.deepEqual(page.__dialogs, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
