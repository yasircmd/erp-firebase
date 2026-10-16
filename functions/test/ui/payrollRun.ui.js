// HR Payroll, step 2: the Payroll screen (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md): create a run for a locked month; the
// register and a payslip with how each line was worked out; inputs typed
// and pasted from Excel; read-only without the draft right; delete.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollRun.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const fx = baseFixture();
  fx.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  await reset(fx);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, extra) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male' }, extra) }).then(r => r.employeeId);
  const ali = await emp('Ali Hassan', { JoinDate: '2024-01-01', IBAN: 'AE070331234567890123456' });
  const sara = await emp('Sara Khan', { JoinDate: '2026-07-15', Gender: 'Female' });
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }, { ElementID: els.HRA, Amount: 3000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: sara, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  const ot = (await call('u-admin', 'savePayElement', { element: { Code: 'OT', Name: 'Overtime', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'savePayElementPayroll', { elementId: ot, category: 'Overtime', overtime: { Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Schedule', Weightage: 1.25 } });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  const lid = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: ali, LeaveTypeID: types.UNPAID, FromDate: '2026-07-13', ToDate: '2026-07-13' } })).leaveId;
  await call('u-admin', 'submitLeave', { leaveId: lid });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8172/?module=PAYROLL&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#pr-runs-body tr', { timeout: 30000 });
    return page;
  }
  const runOf = async () => (await call('u-admin', 'getPayrollRuns', {})).runs[0];
  const slip = async (empId) => (await call('u-admin', 'getPayrollRun', { runId: (await runOf()).RunID })).slips.find(s => s.EmployeeID === empId);
  const amt = (s, code) => { const l = s.Lines.find(x => x.Code === code); return l ? l.Amount : undefined; };

  await check('a new run for July: the register, totals and warnings; a payslip shows how each line was worked out', async () => {
    const p = await open('u-admin');
    assert.match(await p.textContent('#pr-runs-body'), /No payroll runs yet/);
    await p.click('#pr-new-btn');
    await p.selectOption('#pr-new-company', 'C1');
    await p.fill('#pr-new-month', '2026-07');
    await p.click('#pr-new-create');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    assert.match(await p.textContent('#pr-heading'), /Test Co One \(01\) · (2026-07|Jul-2026)/, 'the company by name, not only its code (owner, 2026-10-10)');
    assert.equal(await p.$eval('#pr-new-company option[value="C1"]', o => o.textContent), 'Test Co One (01)');
    assert.equal(await p.locator('#pr-reg-body tr').count(), 2);
    // Ali: 9,000 less one unpaid day (300); Sara joined on 15 July: 6,000 − 14 × 200.
    assert.match(await p.textContent('#pr-reg-body tr[data-emp="' + ali + '"]'), /6,000\.00\s*3,000\.00\s*300\.00\s*9,000\.00\s*300\.00\s*8,700\.00/);
    assert.match(await p.textContent('#pr-reg-body tr[data-emp="' + sara + '"]'), /3,200\.00/);
    assert.equal(await p.locator('#pr-reg-body tr[data-emp="' + sara + '"] .fa-triangle-exclamation').count(), 1, 'no IBAN');
    assert.match(await p.textContent('#pr-totals'), /Net pay\s*11,900\.00/);
    await p.click('#pr-reg-body tr[data-emp="' + ali + '"]');
    await p.waitForSelector('#pr-slip:not(.hidden)');
    assert.match(await p.textContent('#pr-slip-body'), /Unpaid leave\s*1 day × 300\.00 = 300\.00/);
    assert.match(await p.textContent('#pr-slip-foot'), /Net pay\s*8,700\.00/);
    await p.click('#pr-reg-body tr[data-emp="' + sara + '"]');
    assert.match(await p.textContent('#pr-slip-body'), /6,000\.00 a month − 14 days before joining × 200\.00 = 3,200\.00/);
    assert.match(await p.textContent('#pr-slip-warnings'), /No bank account/);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('inputs (step 7b): entered in Earnings & Deductions, shown read-only in the run; changed, the run asks to recalculate; recalculated, it pays them', async () => {
    const p = await open('u-admin');
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    assert.ok(await p.isHidden('#pr-in-actions'), 'no adding or pasting in the run');
    assert.ok(await p.isVisible('#pr-ed-none'));
    const aliNo = (await slip(ali)).EmployeeNo;
    await call('u-admin', 'saveEarningsDeductions', { companyId: 'C1', month: '2026-07', rows: [{ EmployeeNo: aliNo, Code: 'OT', Hours: 10, Note: 'July weekends' }, { EmployeeID: sara, ElementID: els.BONUS, Amount: 500 }] });
    await p.click('#pr-back');
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForFunction(() => !document.getElementById('pr-ed-changed').classList.contains('hidden'), null, { timeout: 30000 });
    await p.click('#pr-recalc');
    await p.waitForFunction(() => /OT/.test(document.getElementById('pr-reg-head').textContent), null, { timeout: 30000 });
    // 6,000 ÷ 30 ÷ 8 hours × 1.25 = 31.25 an hour.
    assert.deepEqual([amt(await slip(ali), 'OT'), amt(await slip(sara), 'BONUS')], [312.5, 500]);
    assert.match(await p.textContent('#pr-totals'), /Net pay\s*12,712\.50/);
    assert.equal(await p.locator('#pr-in-body .pr-in-row').count(), 2, 'the run\'s inputs, read-only');
    assert.ok(await p.$$eval('#pr-in-body input, #pr-in-body select', x => x.every(i => i.disabled)));
    assert.ok(await p.isHidden('#pr-ed-changed'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a cost centre for this run only (PAYROLL_COST_SPLIT.md): a split typed as codes and %, a reason; back to the employee\'s', async () => {
    const p = await open('u-admin');
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    await p.click('#pr-reg-body tr[data-emp="' + ali + '"]');
    await p.waitForSelector('#pr-cc-change:not(.hidden)', { timeout: 20000 });
    await p.click('#pr-cc-change');
    await p.selectOption('#pr-cc-select', 'CC1');
    await p.fill('#pr-cc-split', 'CC1 60, NOPE 40');
    await p.click('#pr-cc-save');
    for (let i = 0; i < 50 && !p.__dialogs.length; i++) await p.waitForTimeout(100);
    assert.match(p.__dialogs.pop() || '', /"NOPE 40" is not a cost center code/);
    await p.fill('#pr-cc-split', 'CC1 60, CC2 40');
    await p.fill('#pr-cc-reason', 'Shared with the office in July');
    await p.click('#pr-cc-save');
    await p.waitForFunction(() => /changed for this run by Admin User: Shared with the office/.test(document.getElementById('pr-slip-cc').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#pr-slip-cc'), /CC1 — Workshop · split CC1 60, CC2 40/);
    assert.deepEqual((await slip(ali)).CostSplit.map(x => [x.CostCenterID, x.Percent]), [['CC1', 60], ['CC2', 40]]);
    await p.click('#pr-cc-change');
    await p.click('#pr-cc-clear');
    await p.waitForFunction(() => !/changed for this run/.test(document.getElementById('pr-slip-cc').textContent), null, { timeout: 30000 });
    assert.equal((await slip(ali)).CostOverride, null);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('without the draft right: the run is read-only', async () => {
    const p = await open('u-viewer');
    assert.equal(await p.isHidden('#pr-new-btn'), true);
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    assert.deepEqual([await p.isHidden('#pr-recalc'), await p.isHidden('#pr-delete'), await p.isHidden('#pr-in-actions')], [true, true, true]);
    assert.equal(await p.isDisabled('#pr-in-body .pr-in-emp >> nth=0'), true);
    assert.match(await p.textContent('#pr-totals'), /12,712\.50/, 'Payroll access is enough to see the amounts');
    await p.click('#pr-reg-body tr[data-emp="' + ali + '"]');
    await p.waitForFunction(() => /Cost center:/.test(document.getElementById('pr-slip-cc').textContent), null, { timeout: 20000 });
    assert.ok(await p.isHidden('#pr-cc-change'), 'no changing the cost centre');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('deleting the draft run', async () => {
    const p = await open('u-admin');
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    await p.click('#pr-delete');
    await p.waitForFunction(() => /No payroll runs yet/.test(document.getElementById('pr-runs-body').textContent), null, { timeout: 30000 });
    assert.deepEqual(p.__dialogs, ['Delete this payroll run and its inputs?']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
