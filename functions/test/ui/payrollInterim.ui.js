// HR Payroll, step 5c: interim payroll on screen (owner, 2026-10-06;
// docs/modules/HR_PAYROLL.md, decisions 40-43): a leaver's settlement with
// the months no run paid (one left to its run, then paid here again), an
// input; submitted and posted. A batch of the settlement and an advance:
// saved, approved, the bank file, marked paid, the payment reversed: kept as Reversed.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollInterim.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LOAN': { AccountCode: '1260', AccountName: 'Staff Loans', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, x) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', CostCenterID: 'CC1',
    JoinDate: '2025-01-01', IBAN: 'AE070331234567890123456', WpsPersonID: '10000000000001', BankRoutingCode: '803320101' }, x) }).then(r => r.employeeId);
  const dan = await emp('Dan Leaver', { Status: 'On notice', LeavingDate: '2026-09-10', LeavingReason: 'Personal reasons' });
  const eve = await emp('Eve Stays', { IBAN: 'AE460331234567890000001' });
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: dan, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }, { ElementID: els.HRA, Amount: 3000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: eve, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 4000 }] } });
  for (const id of [els.BASIC, els.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BONUS, glAccountId: 'A-SAL' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const s0 = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s0.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s0.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-06' });
  const june = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-06' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: june });
  const lt = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Salary advance', Kind: 'Advance', GLAccountID: 'A-LOAN' } })).loanTypeId;
  const adv = (await call('u-admin', 'saveLoan', { loan: { EmployeeID: eve, LoanTypeID: lt, Amount: 1500, StartMonth: '2026-11' } })).loanId;
  await call('u-admin', 'submitLoan', { loanId: adv });
  const starter = (await call('u-admin', 'getPaymentFormats', {})).starter;
  await call('u-admin', 'savePaymentFormat', { format: Object.assign({}, starter, { CompanyID: 'C1', Bank: 'ENBD', Values: { EmployerID: '0000123456789', BankCode: '803320101', Currency: 'AED', Reference: '' } }) });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8175);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(page.__answer || undefined); });
    await page.goto('http://127.0.0.1:8175/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const month = (p, m) => p.textContent('#fs-months tr[data-month="' + m + '"]');
  let p;

  await check('the settlement: July, August and September to the leaving date; July left to its run and back; a bonus for September; submitted and posted', async () => {
    p = await open('PAYROLLFS', 'u-admin');
    await p.waitForFunction(() => /No final settlements yet/.test(document.getElementById('fs-table-body').textContent), null, { timeout: 30000 });
    await p.click('#fs-new-btn');
    await p.selectOption('#fs-new-emp', dan);
    await p.click('#fs-new-go');
    await p.waitForFunction(() => document.querySelectorAll('#fs-months tr').length === 3, null, { timeout: 30000 });
    assert.match(await month(p, '2026-07'), /^Jul-2026 in this settlementnot made9,000\.000\.009,000\.00$/);
    assert.match(await month(p, '2026-09'), /^Sep-2026 here \(the leaving month\)not made3,000\.000\.003,000\.00$/);
    assert.ok(await p.isDisabled('#fs-months tr[data-month="2026-09"] .fs-m-pay') === false);
    await p.click('#fs-save-btn');
    await p.waitForFunction(() => /Draft/.test(document.getElementById('fs-status').textContent), null, { timeout: 30000 });
    // July to its run: saved at once, not paid here.
    await p.uncheck('#fs-months tr[data-month="2026-07"] .fs-m-pay');
    await p.waitForFunction(() => /by its payroll run/.test(document.querySelector('#fs-months tr[data-month="2026-07"]').textContent), null, { timeout: 30000 });
    assert.match(await month(p, '2026-07'), /^Jul-2026 by its payroll runnot made$/);
    await p.check('#fs-months tr[data-month="2026-07"] .fs-m-pay');
    await p.waitForFunction(() => /in this settlement/.test(document.querySelector('#fs-months tr[data-month="2026-07"]').textContent), null, { timeout: 30000 });
    // The leaving month stays ticked.
    await p.click('#fs-months tr[data-month="2026-09"] .fs-m-pay');
    assert.ok(await p.isChecked('#fs-months tr[data-month="2026-09"] .fs-m-pay'));
    await p.click('#fs-input-add');
    await p.selectOption('#fs-inputs .fs-i-month', '2026-09');
    await p.selectOption('#fs-inputs .fs-i-el', els.BONUS);
    await p.fill('#fs-inputs .fs-i-val', '1000'); await p.fill('#fs-inputs .fs-i-note', 'Handover');
    await p.click('#fs-save-btn');
    await p.waitForFunction(() => /4,000\.00$/.test(document.querySelector('#fs-months tr[data-month="2026-09"]').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#fs-lines'), /Sep-2026 · Bonus/);
    await p.click('#fs-submit-btn');
    await p.waitForFunction(() => /Posted: journal FS-/.test(document.getElementById('fs-state-note').textContent), null, { timeout: 30000 });
    assert.ok(await p.isDisabled('#fs-months tr[data-month="2026-07"] .fs-m-pay'));
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a batch: the settlement and the advance picked, saved, submitted (approved: none set up), the bank file', async () => {
    p = await open('PAYROLLIP', 'u-admin');
    await p.waitForFunction(() => /No interim payroll yet/.test(document.getElementById('ip-table-body').textContent), null, { timeout: 30000 });
    await p.click('#ip-new-btn');
    await p.waitForFunction(() => document.querySelectorAll('#ip-items tr').length === 2, null, { timeout: 30000 });
    assert.match(await p.textContent('#ip-items'), /FS-0001EMP-0001 · Dan LeaverFinal settlement \(left 10\/09\/2026\)/);
    assert.match(await p.textContent('#ip-items'), /LN-0001EMP-0002 · Eve StaysSalary advance.*1,500\.00/);
    assert.match(await p.textContent('#ip-foot'), /0 payments0\.00/);
    await p.check('#ip-items tr[data-key^="Settlement:"] .ip-pick');
    await p.check('#ip-items tr[data-key^="Loan:"] .ip-pick');
    assert.match(await p.textContent('#ip-foot'), /2 payments/);
    await p.click('#ip-save-btn');
    await p.waitForFunction(() => /Interim payroll IP-0001/.test(document.getElementById('ip-heading').textContent), null, { timeout: 30000 });
    assert.equal(await p.$$eval('#ip-items .ip-pick:checked', x => x.length), 2);
    await p.click('#ip-submit-btn');
    await p.waitForFunction(() => /Approved, waiting to pay/.test(document.getElementById('ip-status').textContent), null, { timeout: 30000 });
    assert.ok(await p.isHidden('#ip-save-btn'));
    assert.match(await p.textContent('#ip-items'), /AE070331234567890123456/);
    // The plan (step 6): Eve's advance in cash; saved at once, two groups.
    await p.selectOption('#ip-items tr[data-key^="Loan:"] .ip-w-way', 'Cash');
    await p.waitForFunction(() => [...document.querySelectorAll('#ip-groups tr')].map(r => r.cells[0].textContent).join() === 'Bank file,Cash', null, { timeout: 30000 });
    await p.click('#ip-groups tr[data-way="BankFile"] .ip-g-file');
    await p.waitForFunction(() => window.__lastPaymentFile, null, { timeout: 30000 });
    assert.equal(await p.evaluate(() => window.__lastPaymentFile.count), 1);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
  });

  await check('each group marked paid, each payment its own journal; the loan screen says it is paid out there; the payments reversed: the batch Reversed, kept with its note, no Delete (step 7, point 6)', async () => {
    await p.click('#ip-groups tr[data-way="BankFile"] .ip-g-pay');
    await p.waitForFunction(() => /P1: .* Bank file from 1100/.test(document.getElementById('ip-made').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs.shift(), /^Mark 1 paid by bank file from 1100/);
    assert.ok(await p.isHidden('#ip-pay-done'), 'paid in part');
    await p.click('#ip-groups tr[data-way="Cash"] .ip-g-pay');
    await p.waitForFunction(() => /Paid in full: PAYP-\S+, PLN-\S+\./.test(document.getElementById('ip-pay-done').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs.shift(), /^Mark 1 paid by cash from 1000/);
    assert.match(await p.textContent('#ip-items'), /PAYP-/);
    const ln = await open('PAYROLLLOAN', 'u-admin');
    await ln.waitForSelector('#ln-table-body tr[data-id]', { timeout: 30000 });
    await ln.click('#ln-table-body tr[data-id]');
    await ln.waitForFunction(() => /In interim payroll IP-0001: it is paid out, and its payout reversed, there\./.test(document.getElementById('ln-batch').textContent), null, { timeout: 30000 });
    assert.ok(await ln.isVisible('#ln-batch'), 'the note shows');
    assert.ok(await ln.isHidden('#ln-reverse-payout'));
    assert.deepEqual(ln.__errors, []);
    await ln.close();
    p.__answer = 'Wrong account';
    await p.click('#ip-made li[data-pay="P2"] .ip-p-rev');
    await p.waitForFunction(() => /reversed: Wrong account/.test(document.getElementById('ip-made').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs.shift(), /Reverse payment P2 of IP-0001/);
    assert.match(await p.textContent('#ip-status'), /Approved/);
    await p.click('#ip-made li[data-pay="P1"] .ip-p-rev');
    await p.waitForFunction(() => /^Reversed/.test(document.getElementById('ip-status').textContent), null, { timeout: 30000 });
    p.__dialogs.shift();
    p.__answer = undefined;
    assert.match(await p.textContent('#ip-state-note'), /Reversed by .* Wrong account|Reversed by .*: .*Kept for its history/);
    assert.ok(await p.isHidden('#ip-delete-btn'));
    assert.ok(await p.isHidden('#ip-submit-btn'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
