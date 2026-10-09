// HR Payroll, step 5a: provisions on screen (owner, 2026-10-05;
// docs/modules/HR_PAYROLL.md, decisions 28-33): an employee's own annual
// leave entitlement; Payroll Setup → Provisions (gratuity and leave salary
// per company, an accrual type by grade with an exception); a payslip's
// provisions; Payroll → Provisions, now its own module (step 7c: balances,
// a claim recorded and reversed).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollProvisions.ui.js
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
    'A-FPRO': { AccountCode: '2420', AccountName: 'Air Ticket Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, join) => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', JoinDate: join, CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  const ali = await emp('Ali Hassan', '2021-01-01'), ben = await emp('Ben Okafor', '2026-01-01');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const [id, amt] of [[ali, 6000], [ben, 3000]]) await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: els.BASIC, Amount: amt }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: types.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8173);
  const browser = await chromium.launch();
  async function open(module, uid, answer) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); if (d.type() === 'prompt') d.accept(answer || ''); else d.accept(); });
    await page.goto('http://127.0.0.1:8173/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  let runId = null;

  await check('Employees: an employee\'s own annual leave entitlement (30 calendar days)', async () => {
    const p = await open('EMPLOYEES', 'u-admin');
    await p.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await p.click('#emp-table-body tr:has-text("Ben Okafor")');
    await p.waitForSelector('#emp-leave-own:not(.hidden)', { timeout: 30000 });
    await p.click('#emp-leave-own');
    await p.selectOption('#emp-own-type', types.ANNUAL);
    await p.fill('#emp-own-days', '30'); await p.selectOption('#emp-own-counts', 'Calendar'); await p.fill('#emp-own-reason', 'Contract');
    await p.click('#emp-own-save');
    await p.waitForFunction(() => /Own entitlement — Annual Leave: 30 days a year \(calendar days\)/i.test(document.getElementById('emp-leave-own-text').textContent), null, { timeout: 30000 });
    const own = (await call('u-admin', 'getLeaveBalances', { employeeId: ben })).own;
    assert.deepEqual([own[types.ANNUAL].DaysPerYear, own[types.ANNUAL].Counts], [30, 'Calendar']);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('Payroll Setup → Provisions: gratuity (the UAE rule to start) and leave salary; an air ticket by grade with an exception', async () => {
    const p = await open('PAYROLLSETUP', 'u-admin');
    await p.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    await p.click('.ps-tab[data-tab="provisions"]');
    await p.waitForFunction(() => document.querySelectorAll('#ps-gr-slabs .ps-gr-row').length === 2, null, { timeout: 15000 });
    const slabs = await p.$$eval('#ps-gr-slabs .ps-gr-row', rows => rows.map(r => [...r.querySelectorAll('input')].map(i => i.value)));
    assert.deepEqual(slabs, [['0', '5', '21'], ['5', '', '30']]);
    assert.deepEqual([await p.inputValue('#ps-gr-min'), await p.inputValue('#ps-gr-cap'), await p.inputValue('#ps-gr-starts'), await p.inputValue('#ps-ls-base')], ['1', '2', 'AfterYear', 'Basic']);
    const offered = await p.$$eval('#ps-gr-pro option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual([offered.includes('A-GPRO'), offered.includes('A-GEXP')], [true, false], 'liabilities only for the provision');
    await p.check('#ps-gr-on'); await p.selectOption('#ps-gr-exp', 'A-GEXP'); await p.selectOption('#ps-gr-pro', 'A-GPRO');
    await p.check('#ps-ls-on'); await p.selectOption('#ps-ls-exp', 'A-LEXP'); await p.selectOption('#ps-ls-pro', 'A-LPRO');
    await p.click('#ps-pv-save');
    for (let i = 0; i < 40 && !(await call('u-admin', 'getProvisionSetup', {})).settings[0].Gratuity.Enabled; i++) await new Promise(ok => setTimeout(ok, 300));
    const s = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
    assert.deepEqual([s.Gratuity.Enabled, s.Gratuity.ProvisionAccountID, s.LeaveSalary.Enabled, s.LeaveSalary.ExpenseAccountID], [true, 'A-GPRO', true, 'A-LEXP']);

    await p.click('#ps-at-new');
    await p.fill('#ps-at-name', 'Air ticket'); await p.fill('#ps-at-code', 'FLIGHT');
    await p.selectOption('#ps-at-exp', 'A-FEXP'); await p.selectOption('#ps-at-pro', 'A-FPRO');
    await p.fill('#ps-at-rules .ps-at-v', '2400');
    await p.click('#ps-at-exc-add');
    await p.selectOption('#ps-at-exc .ps-at-emp', ben); await p.fill('#ps-at-exc .ps-at-own', '1200');
    await p.check('#ps-at-leaving');
    await p.click('#ps-at-save');
    await p.waitForFunction(() => /Air ticket\s*FLIGHT\s*levels 1–99: 2,400 a year \(\+1 exception\)\s*Paid/.test(document.getElementById('ps-at-body').textContent), null, { timeout: 15000 });
    assert.ok(await p.isHidden('#ps-at-form'));
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a payslip shows its provisions (the company\'s cost, not paid now)', async () => {
    runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-reg-body tr[data-emp]', { timeout: 30000 });
    await p.click('#pr-reg-body tr:has-text("Ali Hassan")');
    await p.waitForSelector('#pr-slip-prov-wrap:not(.hidden)', { timeout: 15000 });
    const rows = await p.$$eval('#pr-slip-prov tr', t => t.map(r => r.cells[0].textContent));
    assert.deepEqual(rows, ['Gratuity', 'Leave salary', 'Air ticket']);
    assert.match(await p.textContent('#pr-slip-prov'), /Air ticket[\s\S]*200\.00\s*0\.00\s*200\.00/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Payroll → Provisions opens the Provisions module (step 7c): the balances after posting; a claim recorded, then reversed', async () => {
    assert.equal((await call('u-admin', 'submitPayrollRun', { runId })).status, 'Posted');
    const p = await open('PAYROLL', 'u-admin', 'Wrong employee');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-prov-btn');
    await p.waitForFunction(() => document.getElementById('pv-body') && /Ali Hassan/.test(document.getElementById('pv-body').textContent), null, { timeout: 30000 });
    assert.deepEqual(await p.$$eval('#pv-body tr.bg-slate-900\\/60', t => t.map(x => x.textContent)), ['Gratuity', 'Leave salary', 'Air ticket']);
    assert.match(await p.textContent('#pv-body'), /Air ticket[\s\S]*Ben Okafor[\s\S]*100\.00/);
    await p.click('.pv-tab[data-tab="claims"]');
    await p.click('#pv-claim-new');
    await p.selectOption('#pv-claim-emp', ali); await p.selectOption('#pv-claim-type', { label: 'Air ticket' });
    assert.equal(await p.textContent('#pv-claim-balance'), 'Provided so far: 200.00.');
    await p.fill('#pv-claim-date', '2026-08-10'); await p.fill('#pv-claim-amount', '150'); await p.selectOption('#pv-claim-account', 'A-BANK'); await p.fill('#pv-claim-note', 'Ticket home');
    await p.click('#pv-claim-save');
    await p.waitForFunction(() => /10\/08\/2026\s*EMP-0001 · Ali Hassan\s*Air ticket\s*150\.00\s*PPR-/.test(document.getElementById('pv-claims-body').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs[0], /^Claim recorded: journal PPR-/);
    const air = async () => (await call('u-admin', 'getProvisionBalances', { companyId: 'C1' })).employees.find(e => e.EmployeeID === ali).Balances;
    const key = Object.keys(await air()).find(k => k.startsWith('Accrual:'));
    assert.equal((await air())[key], 50);
    await p.click('.pv-claim-rev');
    await p.waitForFunction(() => /reversed by PPR-[\s\S]*Wrong employee/.test(document.getElementById('pv-claims-body').textContent), null, { timeout: 30000 });
    assert.equal((await air())[key], 200);
    assert.equal(await p.locator('.pv-claim-rev').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
