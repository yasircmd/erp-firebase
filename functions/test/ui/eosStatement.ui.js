// The end-of-service statement in the Employee Portal (owner, 2026-10-16;
// docs/modules/EOS_STATEMENT.md, decision 183): once the final settlement is
// paid, My payslips shows it first; it opens as the payslip does, with the
// dates shown dd/mm/yyyy and no pay query; before it is paid, nothing.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/eosStatement.ui.js
const http = require('http');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');
const { portalPage, portalContext } = require('./_essPage');
const { todayIn } = require('../../src/recurringSchedule');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = todayIn('Asia/Dubai');
const shown = d => d.split('-').reverse().join('/');

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  f.currencies = { CUR1: { Code: 'AED', Name: 'UAE Dirham', IsDefault: true, Status: 'Active' } };
  await reset(f);
  // No clearance here: these checks are the settlement's own (docs/modules/LEAVER_CLEARANCE.md).
  await call('u-admin', 'saveClearanceSetup', { companyId: 'C1', mode: 'InOrder', steps: [] });
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Storekeeper' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', CostCenterID: 'CC1',
    JoinDate: '2022-02-01', Status: 'Left', LeavingDate: T, LeavingReason: 'Relocation', UserUID: 'u-viewer', IBAN: 'AE070331234567890123456' } })).employeeId;
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 3650 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const s0 = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s0.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s0.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  const fs = (await call('u-admin', 'saveSettlement', { employeeId: ali })).settlementId;
  await call('u-admin', 'submitSettlement', { settlementId: fs });

  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(ess); }).listen(8191);
  const browser = await chromium.launch();
  async function portal() {
    const ctx = await portalContext(browser);
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('browser popup: ' + d.message()); d.dismiss().catch(() => {}); });
    await page.goto('http://127.0.0.1:8191/ess.html?uid=u-viewer#pay');
    return page;
  }
  const until = (p, fn) => p.waitForFunction(fn, null, { timeout: 30000 });

  await check('posted but not paid: no statement in My payslips', async () => {
    const p = await portal();
    await until(p, () => /No payslips yet/.test((document.getElementById('pay-body') || {}).textContent || ''));
    assert.equal(await p.$('#eos-open'), null);
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('paid: the statement first in My payslips; it opens with the dates shown dd/mm/yyyy and no pay query', async () => {
    await call('u-admin', 'markSettlementPaid', { settlementId: fs, paymentDate: T, accountId: 'A-BANK' });
    const p = await portal();
    await p.waitForSelector('#eos-open', { timeout: 30000 });
    assert.match(await p.textContent('#pay-body'), new RegExp('End-of-service statement\\s*FS-0001 · paid ' + shown(T).replace(/\//g, '\\/')));
    await p.click('#eos-open');
    await p.waitForSelector('#slip-view:not(.hidden) .eos-doc', { timeout: 30000 });
    assert.equal(await p.textContent('#slip-title'), 'End-of-service statement');
    const t = await p.textContent('#slip-body');
    assert.match(t, /End-of-Service Settlement Statement[\s\S]*Ali Hassan[\s\S]*Storekeeper[\s\S]*01\/02\/2022[\s\S]*Amount in words: AED /);
    assert.ok(t.includes('Paid on ' + shown(T)), 'dates as dd/mm/yyyy');
    assert.doesNotMatch(t, /DRAFT/);
    assert.ok(await p.isHidden('#slip-query'), 'no pay query on the statement');
    assert.ok(await p.isVisible('#slip-pdf'));
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
