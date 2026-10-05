// HR Payroll, step 5b: the final settlement on screen (owner, 2026-10-05;
// docs/modules/HR_PAYROLL.md, decisions 29, 34, 36-39): a leaver's
// settlement worked out, notice pay and another line added, an amount
// changed by hand with a reason; waiting for the leaving month's run;
// submitted and posted; the bank file; paid.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollSettlement.ui.js
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
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-FEXP': { AccountCode: '6120', AccountName: 'Air Ticket Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FPRO': { AccountCode: '2420', AccountName: 'Air Ticket Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-NOT': { AccountCode: '6200', AccountName: 'Notice Pay', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-OTH': { AccountCode: '4900', AccountName: 'Other Income', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', JoinDate: '2021-01-01', CostCenterID: 'CC1',
    Status: 'Left', LeavingDate: '2026-07-15', LeavingReason: 'Resigned', IBAN: 'AE070331234567890123456', WpsPersonID: '10000000000001', BankRoutingCode: '803320101' } })).employeeId;
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  const notice = (await call('u-admin', 'savePayElement', { element: { Code: 'NOTICE', Name: 'Notice pay', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  const damage = (await call('u-admin', 'savePayElement', { element: { Code: 'DAMAGE', Name: 'Damaged equipment', Kind: 'Deduction', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }, { ElementID: els.HRA, Amount: 3000 }] } });
  for (const id of [els.BASIC, els.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: notice, glAccountId: 'A-NOT' });
  await call('u-admin', 'savePayElementPayroll', { elementId: damage, glAccountId: 'A-OTH' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const s0 = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s0.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s0.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  await call('u-admin', 'saveAccrualType', { accrualType: { Name: 'Air ticket', Code: 'FLIGHT', Basis: 'Fixed', PaidAtLeaving: true, ExpenseAccountID: 'A-FEXP', ProvisionAccountID: 'A-FPRO', Rules: [{ LevelFrom: 1, LevelTo: 99, Value: 2400 }] } });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: types.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
  const starter = (await call('u-admin', 'getPaymentFormats', {})).starter;
  await call('u-admin', 'savePaymentFormat', { format: Object.assign({}, starter, { CompanyID: 'C1', Bank: 'ENBD', Values: { EmployerID: '0000123456789', BankCode: '803320101', Currency: 'AED', Reference: '' } }) });
  const run = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8174);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8174/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const rowText = (p, key) => p.textContent('#fs-lines tr[data-key="' + key + '"]');
  let p;

  await check('a leaver\'s settlement worked out; notice pay and a deduction added; waiting for the leaving month\'s run', async () => {
    p = await open('PAYROLLFS', 'u-admin');
    await p.waitForFunction(() => /No final settlements yet/.test(document.getElementById('fs-table-body').textContent), null, { timeout: 30000 });
    await p.click('#fs-new-btn');
    await p.selectOption('#fs-new-emp', ali);
    await p.click('#fs-new-go');
    await p.waitForFunction(() => /Ali Hassan/.test(document.getElementById('fs-heading').textContent), null, { timeout: 30000 });
    assert.deepEqual(await p.$$eval('#fs-lines tr', t => t.map(r => r.cells[0].textContent)), ['Gratuity', 'Leave salary (unused leave)']);
    assert.ok(await p.isVisible('#fs-run-note'), 'the note shows');
    assert.match(await p.textContent('#fs-run-note'), /not posted yet/);
    assert.match(await p.textContent('#fs-info'), /basic 6,000\.00, gross 9,000\.00/);
    await p.fill('#fs-notice-days', '10');
    await p.selectOption('#fs-notice-el', notice);
    await p.click('#fs-other-add');
    await p.selectOption('#fs-others .fs-o-el', damage);
    await p.fill('#fs-others .fs-o-amt', '500'); await p.fill('#fs-others .fs-o-note', 'Laptop screen');
    await p.click('#fs-save-btn');
    await p.waitForFunction(() => document.querySelector('#fs-lines tr[data-key="Notice"]'), null, { timeout: 30000 });
    assert.match(await rowText(p, 'Notice'), /Notice pay \(in lieu\)10 days × 9,000\.00 ÷ 30 = 300\.00 \(gross\)3,000\.00/);
    assert.match(await rowText(p, 'Other1'), /Damaged equipmentLaptop screen500\.00/);
    assert.match(await p.textContent('#fs-status'), /Draft/);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
  });

  await check('an amount changed by hand needs a reason (gratuity 0, dismissal); then back to the rule', async () => {
    const own = '#fs-lines tr[data-key="Gratuity"] .fs-own', why = '#fs-lines tr[data-key="Gratuity"] .fs-own-reason';
    await p.fill(own, '0');
    await p.click('#fs-save-btn');
    for (let i = 0; i < 40 && !p.__dialogs.length; i++) await new Promise(ok => setTimeout(ok, 250));
    assert.match(p.__dialogs.shift() || '', /reason for changing an amount/);
    await p.fill(why, 'Dismissed for cause');
    await p.click('#fs-save-btn');
    await p.waitForFunction(() => /changed by hand from .*: Dismissed for cause/.test(document.querySelector('#fs-lines tr[data-key="Gratuity"]').textContent), null, { timeout: 30000 });
    await p.fill('#fs-lines tr[data-key="Gratuity"] .fs-own', '');
    await p.click('#fs-save-btn');
    await p.waitForFunction(() => !/changed by hand/.test(document.querySelector('#fs-lines tr[data-key="Gratuity"]').textContent), null, { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
  });

  await check('after the run is posted: submitted and posted (no approval set up); the air ticket paid at leaving', async () => {
    assert.equal((await call('u-admin', 'submitPayrollRun', { runId: run })).status, 'Posted');
    await p.click('#fs-back-btn');
    await p.waitForSelector('#fs-table-body tr[data-id]', { timeout: 30000 });
    await p.click('#fs-table-body tr[data-id]');
    await p.waitForFunction(() => document.querySelector('#fs-lines tr[data-key^="Accrual:"]'), null, { timeout: 30000 });
    assert.ok(await p.isHidden('#fs-run-note'));
    await p.click('#fs-submit-btn');
    await p.waitForFunction(() => /Posted: journal FS-/.test(document.getElementById('fs-state-note').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#fs-heading'), /^FS-0001 — Ali Hassan$/);
    assert.ok(await p.isHidden('#fs-save-btn'));
    assert.ok(await p.isVisible('#fs-reverse-btn'));
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
  });

  await check('paid: the bank file, then Mark paid; the reversal waits for the payment', async () => {
    await p.waitForSelector('#fs-pay-form:not(.hidden)', { timeout: 30000 });
    assert.match(await p.textContent('#fs-pay-payee'), /By bank: .*AE070331234567890123456/);
    await p.fill('#fs-pay-date', '2026-07-20');
    await p.click('#fs-pay-file');
    await p.waitForFunction(() => window.__lastPaymentFile, null, { timeout: 30000 });
    assert.equal(await p.evaluate(() => window.__lastPaymentFile.count), 1);
    await p.selectOption('#fs-pay-account', 'A-BANK');
    await p.click('#fs-pay-mark');
    await p.waitForFunction(() => /Paid on 20\/07\/2026: journal PAYP-/.test(document.getElementById('fs-pay-done').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs[0], /^Mark FS-0001 paid \(.*\) on 2026-07-20\?/);
    assert.ok(await p.isHidden('#fs-reverse-btn'), 'reverse the payment first');
    assert.ok(await p.isVisible('#fs-pay-reverse'));
    await p.click('#fs-back-btn');
    await p.waitForFunction(() => /FS-0001[\s\S]*Ali Hassan[\s\S]*Paid/.test(document.getElementById('fs-table-body').textContent), null, { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
