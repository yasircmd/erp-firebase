// HR Payroll, step 4b: advances and loans on screen (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, decisions 24-27): a loan type in Payroll
// Setup; a loan entered, submitted, paid out; its schedule and an early
// repayment; its balance on the employee record; recovered by the run.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollLoans.ui.js
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
    'A-LOAN': { AccountCode: '1260', AccountName: 'Staff Loans', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } })).employeeId;
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8172/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const loan = async () => (await call('u-admin', 'getLoans', {})).loans[0];

  await check('Payroll Setup → Loans: a loan type with its receivable', async () => {
    const p = await open('PAYROLLSETUP', 'u-admin');
    await p.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    await p.click('.ps-tab[data-tab="loans"]');
    await p.waitForFunction(() => /No loan types yet/.test(document.getElementById('ps-lt-body').textContent), null, { timeout: 15000 });
    await p.click('#ps-lt-new');
    await p.fill('#ps-lt-name', 'Personal loan');
    const offered = await p.$$eval('#ps-lt-gl option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual([offered.includes('A-LOAN'), offered.includes('A-SAL')], [true, false], 'asset accounts only');
    await p.selectOption('#ps-lt-gl', 'A-LOAN');
    await p.click('#ps-lt-save');
    await p.waitForFunction(() => /Personal loan\s*In instalments\s*1260 — Staff Loans/.test(document.getElementById('ps-lt-body').textContent), null, { timeout: 15000 });
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a loan: entered, submitted (no approval set up), paid out; skip a month; an early repayment', async () => {
    const p = await open('PAYROLLLOAN', 'u-admin');
    await p.waitForFunction(() => /No loans or advances yet/.test(document.getElementById('ln-table-body').textContent), null, { timeout: 30000 });
    await p.click('#ln-new-btn');
    await p.selectOption('#ln-employee', ali);
    await p.selectOption('#ln-type', { label: 'Personal loan' });
    await p.fill('#ln-amount', '3000'); await p.fill('#ln-instalment', '500'); await p.fill('#ln-start', '2026-07');
    await p.click('#ln-submit-btn');
    await p.waitForFunction(() => /^LN-0001 — Personal loan, Ali Hassan$/.test(document.getElementById('ln-heading').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#ln-status'), /Approved, to pay out/);
    await p.fill('#ln-pay-date', '2026-07-05');
    await p.selectOption('#ln-pay-account', 'A-BANK');
    await p.click('#ln-pay-btn');
    await p.waitForFunction(() => /Running/.test(document.getElementById('ln-status').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#ln-balance'), /Paid out on 05\/07\/2026 \(journal PLN-.*\)\. Balance: 3,000\.00\./);
    await p.fill('#ln-skips', '2026-08');
    await p.click('#ln-sched-save');
    for (let i = 0; i < 40 && !((await loan()).Skips || []).length; i++) await new Promise(ok => setTimeout(ok, 300));
    assert.deepEqual((await loan()).Skips, ['2026-08']);
    await p.waitForFunction(() => document.getElementById('ln-skips').value === '2026-08', null, { timeout: 15000 });
    await p.fill('#ln-rep-date', '2026-07-20'); await p.fill('#ln-rep-amount', '500'); await p.selectOption('#ln-rep-account', 'A-CASH');
    await p.click('#ln-rep-btn');
    await p.waitForFunction(() => /Balance: 2,500\.00/.test(document.getElementById('ln-balance').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#ln-recs'), /20\/07\/2026\s*Repayment PLN-/);
    assert.match(p.__dialogs[0], /^Pay out 3,000\.00 to Ali Hassan on 2026-07-05\?/);
    await p.click('#ln-back-btn');
    await p.waitForFunction(() => /LN-0001[\s\S]*3,000\.00\s*500\.00\s*Jul-2026\s*2,500\.00\s*Running/.test(document.getElementById('ln-table-body').textContent), null, { timeout: 15000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('recovered by the run; the balance on the employee record', async () => {
    const runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
    const slip = (await call('u-admin', 'getPayrollRun', { runId })).slips[0];
    assert.deepEqual(slip.Lines.filter(l => l.Source === 'Loan').map(l => [l.Name, l.Amount]), [['Loan recovery: Personal loan LN-0001', 500]]);
    const p = await open('EMPLOYEES', 'u-admin');
    await p.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await p.click('#emp-table-body tr:has-text("Ali Hassan")');
    await p.waitForFunction(() => /LN-0001 Personal loan — 2,500\.00 left/.test(document.getElementById('emp-pay-loans').textContent), null, { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
