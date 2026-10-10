// HR Payroll, step 7a on screen (owner, 2026-10-09; docs/modules/HR_PAYROLL.md,
// step 7): the runs searched by company, month and status; the run's
// register on one line per employee, the employee fixed while the elements
// scroll; the Costing (elements, then the employer's provisions and total
// cost) once approved, copied to Excel; Payroll Setup's cut-off day.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollStep7.ui.js
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
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, join) => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', JoinDate: join, CostCenterID: 'CC1' } }).then(r => r.employeeId);
  const ali = await emp('Ali Hassan', '2021-01-01'), ben = await emp('Ben Okafor', '2024-01-01');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const [id, amt] of [[ali, 6000], [ben, 3000]]) await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: els.BASIC, Amount: amt }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const ps = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, ps.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }), leaveSalary: ps.LeaveSalary });
  for (const m of ['2026-06', '2026-07']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });
  const june = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-06' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: june });
  await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' });
  const run = (await call('u-admin', 'getPayrollRun', { runId: june })).run;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8179);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  async function open(module, uid) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8179/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const rows = p => p.$$eval('#pr-runs-body tr[data-id]', t => t.map(r => r.cells[0].textContent + ' ' + r.cells[7].textContent));

  await check('the runs searched by month and status; Clear shows them all', async () => {
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForFunction(() => document.querySelectorAll('#pr-runs-body tr[data-id]').length === 2, null, { timeout: 30000 });
    await p.selectOption('#pr-f-status', 'Posted');
    assert.deepEqual(await rows(p), ['Jun-2026 Posted']);
    await p.selectOption('#pr-f-status', '');
    await p.fill('#pr-f-from', '2026-07');
    await p.dispatchEvent('#pr-f-from', 'change');
    assert.deepEqual(await rows(p), ['Jul-2026 Draft']);
    await p.selectOption('#pr-f-status', 'Posted');
    assert.match(await p.textContent('#pr-runs-body'), /No payroll run matches the filters/);
    await p.click('#pr-f-clear');
    assert.equal((await rows(p)).length, 2);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('the register: one line per employee, the employee fixed while the elements scroll; a draft has no Costing', async () => {
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr:has-text("Jul-2026")');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    const css = await p.$eval('#pr-reg-body tr td:nth-child(2)', td => ({ pos: getComputedStyle(td).position, ws: getComputedStyle(td.closest('table')).whiteSpace }));
    assert.deepEqual(css, { pos: 'sticky', ws: 'nowrap' });
    assert.ok(await p.isHidden('.pr-view[data-view="costing"]'));
    assert.ok(await p.isHidden('.pr-view[data-view="payment"]'));
    assert.ok(await p.isHidden('.pr-view[data-view="glimpact"]'), 'no GL Impact before approval');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the Costing of a posted run: elements, net, the provisions and the total cost per employee; totals; copied to Excel', async () => {
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr:has-text("Jun-2026")');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    await p.click('.pr-view[data-view="costing"]');
    await p.waitForFunction(() => /Total cost/i.test(document.getElementById('pr-reg-head').textContent), null, { timeout: 30000 });
    const head = await p.$$eval('#pr-reg-head th', t => t.map(x => x.textContent));
    assert.deepEqual(head.slice(-3), ['Gratuity', 'Provisions', 'Total cost']);
    assert.ok(await p.isHidden('#pr-inputs-wrap'));
    const prov = run.Provisions;
    assert.ok(prov > 0, 'the run accrued gratuity');
    const foot = await p.$$eval('#pr-reg-foot td', t => t.map(x => x.textContent));
    assert.equal(foot[foot.length - 1], (run.Earnings + prov).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    await p.click('#pr-copy');
    await p.waitForFunction(() => navigator.clipboard.readText().then(t => /Total cost/.test(t)), null, { timeout: 30000 });
    const lines = (await p.evaluate(() => navigator.clipboard.readText())).split('\n');
    assert.equal(lines.length, 4, 'heading, two employees, total');
    assert.deepEqual(lines[0].split('\t').slice(-3), ['Gratuity', 'Provisions', 'Total cost']);
    assert.equal(Number(lines[3].split('\t').pop()), Math.round((run.Earnings + prov) * 100) / 100);
    // Back to the register: its own columns again.
    await p.click('.pr-view[data-view="register"]');
    await p.waitForFunction(() => !/Total cost/i.test(document.getElementById('pr-reg-head').textContent), null, { timeout: 30000 });
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('the GL Impact of a posted run (docs/modules/GL_VIEWS.md): the journal by account and cost center, balanced; copied to Excel; the register back after it', async () => {
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr:has-text("Jun-2026")');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    await p.click('.pr-view[data-view="glimpact"]');
    await p.waitForSelector('#pr-reg-body tr.pr-gl-line', { timeout: 30000 });
    assert.deepEqual(await p.$$eval('#pr-reg-head th', t => t.map(x => x.textContent)), ['Account', 'Name', 'Cost Center', 'Description', 'Debit', 'Credit']);
    assert.match(await p.textContent('#pr-costing-note'), new RegExp('The posted journal ' + run.JVNumber));
    assert.equal(await p.textContent('#pr-gl-debit'), await p.textContent('#pr-gl-credit'));
    const ccs = await p.$$eval('#pr-reg-body tr.pr-gl-line', t => t.map(r => r.cells[2].textContent).filter(Boolean));
    assert.ok(ccs.length && ccs.every(c => / — /.test(c)), 'the salary lines carry their cost center, code and name');
    await p.click('#pr-copy');
    await p.waitForFunction(() => navigator.clipboard.readText().then(t => t.startsWith('Account\tName\tCost Center')), null, { timeout: 30000 });
    const lines = (await p.evaluate(() => navigator.clipboard.readText())).split('\n');
    const tot = lines[lines.length - 1].split('\t');
    assert.deepEqual([tot[3], tot[4] === tot[5]], ['Total', true]);
    await p.click('.pr-view[data-view="register"]');
    await p.waitForFunction(() => !/Cost Center/.test(document.getElementById('pr-reg-head').textContent) && document.querySelector('#pr-reg-head th'), null, { timeout: 30000 });
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('Payroll Setup → Payroll Accounting: the cut-off day saved (blank = month end)', async () => {
    const p = await open('PAYROLLSETUP', 'u-admin');
    await p.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    await p.click('.ps-tab[data-tab="payroll"]');
    await p.waitForSelector('#ps-pc-body tr[data-co="C1"]', { timeout: 30000 });
    assert.equal(await p.inputValue('#ps-pc-body tr[data-co="C1"] .ps-pc-cutoff'), '');
    await p.fill('#ps-pc-body tr[data-co="C1"] .ps-pc-cutoff', '25');
    await p.click('#ps-pc-body tr[data-co="C1"] .ps-pc-save');
    for (let i = 0; i < 40 && (await call('u-admin', 'getPayrollSetup', {})).settings[0].CutOffDay !== 25; i++) await new Promise(ok => setTimeout(ok, 300));
    assert.equal((await call('u-admin', 'getPayrollSetup', {})).settings[0].CutOffDay, 25);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await context.close(); await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
