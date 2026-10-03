// HR: Employee Changes, step 4 (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md):
// from the employee record to a new change and back; a promotion with a
// % raise on the basic; save, submit for approval; the approver approves
// it and the employee's grade and pay change.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrChanges.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');
const { todayIn } = require('../../src/recurringSchedule');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = todayIn('Asia/Dubai');

(async () => {
  const f = baseFixture();
  f.approvalConfigurations = { EMPCHANGE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { EMPCHANGE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Name: 'Officer', Level: 3, Bands: { C1: { Min: 3000, Mid: 4500, Max: 6000 } } } })).gradeId;
  await call('u-admin', 'saveHrGrade', { grade: { Code: 'G5', Name: 'Senior Officer', Level: 5, Bands: { C1: { Min: 5000, Mid: 7500, Max: 10000 } } } });
  const acc = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Senior Accountant' } });
  const emp = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-03-01', DesignationID: acc, GradeID: g3, CostCenterID: 'CC1' } })).employeeId;
  const els = (await call('u-admin', 'getPayElements', {})).elements;
  const id = code => els.find(e => e.Code === code).ElementID;
  await call('u-admin', 'saveCompensation', { employeeId: emp, compensation: { Lines: [{ ElementID: id('BASIC'), Amount: 5000 }, { ElementID: id('HRA'), Amount: 2000 }] } });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8166);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(page.__answer || '') : d.accept(); });
    await page.goto('http://127.0.0.1:8166/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  let changeId;

  await check('from the employee record: a promotion with a 20% raise on the basic, saved and submitted for approval', async () => {
    const p = await open('EMPLOYEES', 'u-admin');
    await p.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await p.click('#emp-table-body tr:has-text("Ali Hassan")');
    await p.waitForSelector('#emp-change-btn:not(.hidden)', { timeout: 15000 });
    await p.evaluate(() => { window.__moduleReady = false; });
    await p.click('#emp-change-btn');
    await p.waitForFunction(() => window.__moduleReady === true && document.getElementById('ec-entry-view') && !document.getElementById('ec-entry-view').classList.contains('hidden'), null, { timeout: 30000 });
    await p.waitForFunction(() => document.querySelectorAll('.ec-pay-amount').length >= 2, null, { timeout: 15000 });
    assert.match(await p.textContent('#ec-back-chain-label'), /Back to Employees/);
    assert.equal(await p.inputValue('#ec-employee'), emp);
    assert.match(await p.textContent('#ec-sec-job'), /Accountant[\s\S]*G3/);
    await p.selectOption('[data-k="DesignationID"]', { label: 'Senior Accountant' });
    await p.selectOption('[data-k="GradeID"]', { label: 'G5 — Senior Officer' });
    await p.fill('#ec-effective', T);
    await p.fill('#ec-reason', 'Leads the team');
    await p.fill('#ec-pct', '20');
    await p.click('#ec-pct-apply');
    assert.match(await p.textContent('#ec-increase'), /Monthly increase: 1,000\.00 \(14\.29%\)/);
    await p.click('#ec-save-btn');
    await p.waitForFunction(() => /^Draft — Promotion: Ali Hassan/.test(document.getElementById('ec-heading').textContent), null, { timeout: 15000 });
    p.__dialogs.length = 0;
    await p.click('#ec-submit-btn');
    await p.waitForFunction(() => /Pending approval/.test(document.getElementById('ec-status-badge').textContent), null, { timeout: 15000 });
    assert.deepEqual(p.__dialogs, ['Submit this change? It goes for approval (or applies now when no approval is set up).', 'EC-' + T.slice(0, 4) + '-0001 is waiting for approval.']);
    assert.match(await p.textContent('#ec-levels'), /Level 1: waiting/);
    changeId = (await call('u-admin', 'getEmployeeChanges', {})).changes[0].ChangeID;
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the approver approves it: the grade, designation and pay change', async () => {
    const p = await open('EMPCHANGE', 'u-approver');
    await p.waitForSelector('#ec-table-body tr[data-id]', { timeout: 30000 });
    await p.click('#ec-table-body tr[data-id="' + changeId + '"]');
    await p.waitForSelector('#ec-decide:not(.hidden)', { timeout: 15000 });
    assert.match(await p.textContent('#ec-pay-new-total'), /8,000\.00/);
    await p.click('#ec-approve-btn');
    await p.waitForFunction(() => /Approved/.test(document.getElementById('ec-status-badge').textContent), null, { timeout: 15000 });
    assert.equal(await p.isVisible('#ec-decide'), false);
    assert.match(await p.textContent('#ec-levels'), /Level 1: Approved by Approver/);
    const e = (await call('u-admin', 'getEmployee', { employeeId: emp })).employee;
    assert.equal(e.GradeCode, 'G5');
    assert.equal(e.DesignationTitle, 'Senior Accountant');
    assert.equal((await call('u-admin', 'getCompensation', { employeeId: emp })).current.Basic, 6000);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
