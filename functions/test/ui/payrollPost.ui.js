// HR Payroll, step 3: the Payroll screen's submit, approval, posting,
// payslips and reversal (owner, 2026-10-04; docs/modules/HR_PAYROLL.md,
// decisions 16-19); Payroll Setup → Payroll's Recoverable from employees.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollPost.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01',
    CostCenterID: 'CC1', BankName: 'ENBD', IBAN: 'AE070331234567890123456' } })).employeeId;
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  const runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  async function open(module, uid, answers) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept((answers || []).shift()); });
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.goto('http://127.0.0.1:8172/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  async function openRun(uid, answers) {
    const p = await open('PAYROLL', uid, answers);
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    return p;
  }
  const status = async () => (await call('u-admin', 'getPayrollRun', { runId })).run;

  await check('Payroll Setup → Payroll Accounting: a company\'s Recoverable from employees (asset accounts only)', async () => {
    const p = await open('PAYROLLSETUP', 'u-admin');
    await p.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    await p.click('.ps-tab[data-tab="payroll"]');
    await p.waitForSelector('#ps-pc-body tr[data-co="C1"]', { timeout: 30000 });
    const offered = await p.$$eval('#ps-pc-body tr[data-co="C1"] .ps-pc-receivable option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual([offered.includes('A-REC'), offered.includes('A-SALPAY')], [true, false]);
    await p.selectOption('#ps-pc-body tr[data-co="C1"] .ps-pc-receivable', 'A-REC');
    await p.click('#ps-pc-body tr[data-co="C1"] .ps-pc-save');
    for (let i = 0; i < 40 && (await call('u-admin', 'getPayrollSetup', {})).settings[0].ReceivableAccountID !== 'A-REC'; i++) await new Promise(ok => setTimeout(ok, 300));
    assert.deepEqual((await call('u-admin', 'getPayrollSetup', {})).settings[0], { CompanyID: 'C1', DailyRateMethod: 'DIV30', PayableAccountID: 'A-SALPAY', ReceivableAccountID: 'A-REC', LeaveDeductionGL: 'Ledger' });
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('approval: submitted, the approver rejects with a reason (back to draft); submitted again and approved, the run posts', async () => {
    await rtdb.ref('approvalConfigurations/PAYROLL').set({ Enabled: true, ScopeType: 'Global' });
    await rtdb.ref('approvalLevels/PAYROLL/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
    let p = await openRun('u-admin');
    await p.click('#pr-submit');
    await p.waitForFunction(() => /Pending approval/.test(document.getElementById('pr-status').textContent), null, { timeout: 30000 });
    assert.equal(await p.isHidden('#pr-decide'), true, 'not the approver');
    assert.match(await p.textContent('#pr-levels'), /Level 1: waiting/);
    await p.close();
    p = await openRun('u-approver', ['Check the basic']);
    await p.waitForSelector('#pr-decide:not(.hidden)');
    await p.click('#pr-reject');
    await p.waitForFunction(() => /Rejected: Check the basic/.test(document.getElementById('pr-state-note').textContent), null, { timeout: 30000 });
    assert.deepEqual(p.__dialogs, ['Reason for rejecting:']);
    await p.close();
    p = await openRun('u-admin');
    await p.click('#pr-submit');
    await p.waitForFunction(() => /Pending approval/.test(document.getElementById('pr-status').textContent), null, { timeout: 30000 });
    await p.close();
    p = await openRun('u-approver');
    await p.click('#pr-approve');
    await p.waitForFunction(() => /^Posted$/.test(document.getElementById('pr-status').textContent), null, { timeout: 30000 });
    const run = await status();
    assert.match(await p.textContent('#pr-state-note'), new RegExp('Posted: journal ' + run.JVNumber));
    assert.match(await p.textContent('#pr-history'), /Posted by .*Approved by .*Submitted by .*Rejected by .*Submitted by/);
    assert.deepEqual(p.__errors, []);
    await p.close();
    await rtdb.ref('approvalConfigurations/PAYROLL').remove();
  });

  await check('payslips: all, or one, printed one per page: the month, the employee, net, the year to date, leave', async () => {
    const p = await openRun('u-admin');
    await p.click('#pr-print-all');
    await p.waitForFunction(() => window.__printed === 1, null, { timeout: 30000 });
    const doc = await p.textContent('#pr-print-document');
    assert.match(doc, /Test Co One/);
    assert.match(doc, /Payslip — Jul-2026/);
    assert.match(doc, /EMP-0001 · Ali Hassan/);
    assert.match(doc, /ENBD · AE07 •••• 3456/);
    assert.match(doc, /Net pay\s*6,000\.00/);
    assert.match(doc, /Year to date.*2026\s*6,000\.00\s*0\.00\s*6,000\.00/);
    assert.equal(await p.locator('#pr-print-document .pr-ps').count(), 1);
    await p.click('#pr-reg-body tr[data-emp]');
    await p.click('#pr-slip-print');
    await p.waitForFunction(() => window.__printed === 2, null, { timeout: 30000 });
    assert.equal(await p.isVisible('#pr-print-document'), false, 'shown only when printing');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('reversal: the reason asked; a mirror journal; the run back to draft', async () => {
    const before = await status();
    const p = await openRun('u-admin', ['Wrong month']);
    await p.click('#pr-reverse');
    await p.waitForFunction(() => /^Draft$/.test(document.getElementById('pr-status').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs[0], new RegExp('^Reverse ' + before.JVNumber + ' and take the run back to draft'));
    assert.match(await p.textContent('#pr-history'), new RegExp('Reversed by .*\\(' + before.JVNumber + ', reversed by PAY-'));
    assert.equal(await p.isVisible('#pr-submit'), true);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
