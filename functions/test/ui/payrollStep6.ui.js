// HR Payroll, step 6 on screen (owner, 2026-10-06; docs/modules/
// HR_PAYROLL.md, decisions 44-48): Payroll Setup's "Payroll Accounting"
// tab and its leave-deductions choice; a sick leave without a certificate
// approved only on the approver's confirmation, then highlighted in the
// register; a payroll journal opened from the GL in its own module.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollStep6.ui.js
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
    'A-ADV': { AccountCode: '1270', AccountName: 'Advances', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1' } })).employeeId;
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await rtdb.ref('approvalConfigurations/LEAVE').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/LEAVE/GLOBAL').set({ Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] });
  const sick = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: ali, LeaveTypeID: types.SICK, FromDate: '2026-08-10', ToDate: '2026-08-11' } })).leaveId;
  await call('u-admin', 'submitLeave', { leaveId: sick });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  const runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId });
  const runJv = (await call('u-admin', 'getPayrollRun', { runId })).run.JVID;
  const lt = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Salary advance', Kind: 'Advance', GLAccountID: 'A-ADV' } })).loanTypeId;
  const loan = (await call('u-admin', 'saveLoan', { loan: { EmployeeID: ali, LoanTypeID: lt, Amount: 500, StartMonth: '2026-09' } })).loanId;
  await call('u-admin', 'submitLoan', { loanId: loan });
  await call('u-admin', 'payOutLoan', { loanId: loan, date: '2026-08-05', accountId: 'A-CASH' });
  const loanJv = (await call('u-admin', 'getLoan', { loanId: loan })).loan.PayoutJVID;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8176);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8176/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }

  await check('Payroll Setup: the "Payroll Accounting" tab; a company\'s leave deductions pro rata on the earnings', async () => {
    const p = await open('PAYROLLSETUP', 'u-admin');
    await p.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    assert.equal((await p.textContent('.ps-tab[data-tab="payroll"]')).trim(), 'Payroll Accounting');
    await p.click('.ps-tab[data-tab="payroll"]');
    await p.waitForSelector('#ps-pc-body tr[data-co="C1"]', { timeout: 30000 });
    assert.equal(await p.inputValue('#ps-pc-body tr[data-co="C1"] .ps-pc-leavegl'), 'Ledger');
    await p.selectOption('#ps-pc-body tr[data-co="C1"] .ps-pc-leavegl', 'ProRata');
    await p.click('#ps-pc-body tr[data-co="C1"] .ps-pc-save');
    for (let i = 0; i < 40 && (await call('u-admin', 'getPayrollSetup', {})).settings[0].LeaveDeductionGL !== 'ProRata'; i++) await new Promise(ok => setTimeout(ok, 300));
    assert.equal((await call('u-admin', 'getPayrollSetup', {})).settings[0].LeaveDeductionGL, 'ProRata');
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a sick leave without a certificate: the approver is told, confirms accepting it without; then "No document (accepted)" in the register and its filter', async () => {
    const p = await open('LEAVE', 'u-approver');
    await p.waitForSelector('#lv-table-body tr[data-id]', { timeout: 30000 });
    assert.match(await p.textContent('#lv-table-body'), /No document/);
    await p.click('#lv-table-body tr[data-id="' + sick + '"]');
    await p.waitForSelector('#lv-doc-note:not(.hidden)', { timeout: 30000 });
    assert.match(await p.textContent('#lv-doc-note'), /No supporting document attached: the approver decides whether to accept the leave without it\./);
    await p.click('#lv-approve-btn');
    await p.waitForFunction(() => /accepted without it by Approver/.test(document.getElementById('lv-doc-note').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs[0], /^No supporting document \(e\.g\. a medical certificate\) is attached\. Approve, accepting the leave without it\?/);
    await p.click('#lv-back-btn').catch(() => p.evaluate(() => document.getElementById('lv-back-btn') && document.getElementById('lv-back-btn').click()));
    await p.waitForSelector('#lv-list-view:not(.hidden)', { timeout: 30000 });
    await p.selectOption('#lv-status-filter', 'nodoc');
    await p.waitForFunction(() => document.querySelectorAll('#lv-table-body tr[data-id]').length === 1, null, { timeout: 30000 });
    assert.match(await p.textContent('#lv-table-body'), /No document \(accepted\)/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('from the GL: a run\'s journal opens the run; a loan\'s opens the loan, even when sent to Payroll', async () => {
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.evaluate(jv => openModule('PAYROLL', { OpenEntryId: jv }), runJv);
    await p.waitForFunction(() => /2026-07|Jul-2026/.test(document.getElementById('pr-heading').textContent) && !document.getElementById('pr-run-view').classList.contains('hidden'), null, { timeout: 30000 });
    await p.evaluate(jv => openModule('PAYROLL', { OpenEntryId: jv }), loanJv);
    await p.waitForFunction(() => document.getElementById('ln-heading') && /LN-0001/.test(document.getElementById('ln-heading').textContent), null, { timeout: 30000 });
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
