// HR Payroll, step 1: the setup (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md): Payroll Setup's Payroll tab. A company's
// daily-rate method (with its worked example) and Salaries Payable; an
// element's GL account with a company's own; an overtime element and its
// worked example; read-only for a user without the write right.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollSetup.ui.js
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
    'A-SALC1': { AccountCode: '6002', AccountName: 'Salaries (Co One)', AccountType: 'Expense', Status: 'Active', IsPostable: true, CompanyID: 'C1' },
    'A-OT': { AccountCode: '6010', AccountName: 'Overtime', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const otId = (await call('u-admin', 'savePayElement', { element: { Code: 'OT', Name: 'Overtime (normal)', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8172/?module=PAYROLLSETUP&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    await page.click('.ps-tab[data-tab="payroll"]');
    await page.waitForSelector('#ps-pc-body tr[data-co="C1"]', { timeout: 30000 });
    return page;
  }
  const settings = async () => (await call('u-admin', 'getPayrollSetup', {}));
  const until = async (fn, what) => { for (let i = 0; i < 40; i++) { if (await fn()) return; await new Promise(ok => setTimeout(ok, 300)); } assert.fail(what); };

  await check('a company: the daily rate by the month\'s days, with the example; Salaries Payable', async () => {
    const p = await open('u-admin');
    const ex = '#ps-pc-body tr[data-co="C1"] .ps-pc-example';
    await p.waitForFunction(s => document.querySelector(s).textContent === '5,000.00 ÷ 30 = 166.67', ex, { timeout: 15000 });
    await p.selectOption('#ps-pc-body tr[data-co="C1"] .ps-pc-method', 'MONTHDAYS');
    await p.waitForFunction(s => /^5,000\.00 ÷ (28|29|30|31) = /.test(document.querySelector(s).textContent), ex, { timeout: 15000 });
    await p.selectOption('#ps-pc-body tr[data-co="C1"] .ps-pc-payable', 'A-SALPAY');
    // Only liabilities are offered.
    const offered = await p.$$eval('#ps-pc-body tr[data-co="C1"] .ps-pc-payable option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual(offered.includes('A-SAL'), false);
    await p.click('#ps-pc-body tr[data-co="C1"] .ps-pc-save');
    await until(async () => (await settings()).settings[0].DailyRateMethod === 'MONTHDAYS', 'the method was not saved');
    assert.deepEqual((await settings()).settings, [{ CompanyID: 'C1', DailyRateMethod: 'MONTHDAYS', PayableAccountID: 'A-SALPAY', ReceivableAccountID: '', HeldAccountID: '', LeaveDeductionGL: 'Ledger', CutOffDay: 0 }]);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('an element\'s GL account: the group\'s (shared only) and the company\'s own; prorated and in gross', async () => {
    const p = await open('u-admin');
    await p.waitForFunction(() => /Basic Salary.*not set/.test(document.getElementById('ps-pe-body').textContent), null, { timeout: 15000 });
    await p.click('#ps-pe-body tr:has-text("Basic Salary")');
    await p.waitForSelector('#ps-pe-form:not(.hidden)');
    const group = await p.$$eval('#ps-pe-gl option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual([group.includes('A-SAL'), group.includes('A-SALC1'), group.includes('A-SALPAY')], [true, false, false], 'the group\'s list: shared expense accounts');
    assert.equal(await p.isChecked('#ps-pe-prorated'), true);
    assert.equal(await p.isHidden('#ps-pe-ot-wrap'), true, 'no overtime for a fixed element');
    await p.selectOption('#ps-pe-gl', 'A-SAL');
    await p.selectOption('.ps-pe-co[data-co="C1"]', 'A-SALC1');
    await p.click('#ps-pe-save');
    await p.waitForFunction(() => /Basic Salary.*6000 — Salaries \(\+1 company\)/.test(document.getElementById('ps-pe-body').textContent), null, { timeout: 15000 });
    const b = (await settings()).elements.find(e => e.Code === 'BASIC');
    assert.deepEqual([b.GLAccountID, b.GLByCompany, b.Prorated, b.InGross], ['A-SAL', { C1: 'A-SALC1' }, true, true]);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('an overtime element: hours on the gross, fixed 30 days, the schedule\'s hours, × 2; the example follows the fields', async () => {
    const p = await open('u-admin');
    await p.click('#ps-pe-body tr:has-text("Overtime (normal)")');
    await p.waitForSelector('#ps-pe-ot-wrap:not(.hidden)');
    await p.check('#ps-pe-isot');
    await p.selectOption('#ps-ot-base', 'Gross');
    await p.selectOption('#ps-ot-daysmode', 'Fixed');
    await p.fill('#ps-ot-days', '30');
    await p.fill('#ps-ot-weight', '2');
    assert.equal(await p.isHidden('#ps-ot-hours'), true, 'the fixed hours only when chosen');
    await p.waitForFunction(() => /8,000\.00 \(gross\) ÷ 30 days ÷ 8 hours × 2 = 66\.67 an hour$/.test(document.getElementById('ps-ot-example').textContent), null, { timeout: 15000 });
    await p.fill('#ps-ot-weight', '0');
    await p.waitForFunction(() => /weightage is more than 0/.test(document.getElementById('ps-ot-example').textContent), null, { timeout: 15000 });
    await p.fill('#ps-ot-weight', '1.5');
    await p.waitForFunction(() => /× 1\.5 = 50\.00 an hour$/.test(document.getElementById('ps-ot-example').textContent), null, { timeout: 15000 });
    await p.selectOption('#ps-pe-gl', 'A-OT');
    await p.click('#ps-pe-save');
    await p.waitForFunction(() => /Overtime \(normal\).*6010 — Overtime.*× 1\.5 on gross/.test(document.getElementById('ps-pe-body').textContent), null, { timeout: 15000 });
    const e = (await settings()).elements.find(x => x.ElementID === otId);
    assert.deepEqual([e.Category, e.Overtime], ['Overtime', { Mode: 'Hours', Base: 'Gross', DaysMode: 'Fixed', HoursMode: 'Schedule', FixedDays: 30, FixedHours: null, Weightage: 1.5 }]);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a user without the write right sees the setup but cannot change it', async () => {
    const p = await open('u-viewer');
    await p.waitForFunction(() => /6000 — Salaries/.test(document.getElementById('ps-pe-body').textContent), null, { timeout: 15000 });
    assert.equal(await p.isDisabled('#ps-pc-body tr[data-co="C1"] .ps-pc-method'), true);
    assert.equal(await p.$('#ps-pc-body .ps-pc-save'), null);
    await p.click('#ps-pe-body tr:has-text("Basic Salary")');
    assert.equal(await p.isHidden('#ps-pe-form'), true);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Leaving Reasons are no longer here: in HR Setup since 2026-10-24', async () => {
    const p = await open('u-admin');
    assert.equal(await p.locator('.ps-tab[data-tab="leaving"]').count(), 0);
    assert.equal(await p.locator('#ps-lr-body').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
