// HR Payroll, step 7b on screen (owner, 2026-10-09; docs/modules/HR_PAYROLL.md,
// step 7, points 4-5): Earnings & Deductions entered before the run (the
// form, the hours or amount by element, Interim only for an earning by
// amount, the supporting documents section, a paste from Excel); the run
// shows them read-only, links back, and says when they changed; locked
// once the run is posted; an Interim entry offered by Interim Payroll.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/earningsDeductions.ui.js
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
    'A-BON': { AccountCode: '6050', AccountName: 'Bonus', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-OT': { AccountCode: '6060', AccountName: 'Overtime', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = name => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  const ali = await emp('Ali Hassan'); await emp('Sara Khan');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const code of ['BASIC']) await call('u-admin', 'savePayElementPayroll', { elementId: els[code], glAccountId: 'A-SAL', prorated: true, inGross: true });
  for (const code of ['BONUS', 'COMM']) await call('u-admin', 'savePayElementPayroll', { elementId: els[code], glAccountId: 'A-BON', inGross: true });
  const ot = (await call('u-admin', 'savePayElement', { element: { Code: 'OT', Name: 'Overtime', Kind: 'Earning', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'savePayElementPayroll', { elementId: ot, glAccountId: 'A-OT', inGross: true, category: 'Overtime', overtime: { Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Schedule', Weightage: 1.25 } });
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [], hoursPerDay: 10 });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8180);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8180/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const rowsOf = p => p.$$eval('#ed-body tr[data-id]', t => t.map(r => [...r.cells].slice(1, 7).map(c => c.textContent).join('|')));
  let runId = null;

  await check('Earnings & Deductions: an entry by the form (hours for overtime, no Interim for it), its supporting documents; rows pasted from Excel', async () => {
    const p = await open('PAYROLLED', 'u-admin');
    await p.fill('#ed-month', '2026-07');
    await p.dispatchEvent('#ed-month', 'change');
    await p.waitForFunction(() => /No run for this month yet/.test(document.getElementById('ed-run-note').textContent), null, { timeout: 30000 });
    await p.click('#ed-add');
    await p.selectOption('#ed-emp', { label: 'EMP-0001 · Ali Hassan' });
    await p.selectOption('#ed-el', { label: 'OT · Overtime' });
    assert.ok(await p.isVisible('#ed-hours'));
    assert.ok(await p.isHidden('#ed-amount-wrap'));
    assert.ok(await p.$eval('#ed-payby option[value="Interim"]', o => o.disabled), 'overtime is paid with the salary');
    await p.fill('#ed-hours', '10');
    await p.fill('#ed-note', 'July weekends');
    await p.click('#ed-save');
    await p.waitForFunction(() => document.querySelectorAll('#ed-body tr[data-id]').length === 1, null, { timeout: 30000 });
    // Saved: the entry stays open, with its supporting documents below it.
    await p.waitForFunction(() => /Ali Hassan — Overtime/.test(document.getElementById('ed-entry-heading').textContent), null, { timeout: 30000 });
    assert.ok(await p.isVisible('section.supdocs[data-module="PAYROLLED"]'));
    await p.click('#ed-close');
    await p.click('#ed-paste-btn');
    await p.fill('#ed-paste', 'Employee\tCode\tAmount\nEMP-0001\tBONUS\t1500\tQ2 target\nEMP-0002\tCOMM\t800\tDeal 42\tInterim');
    await p.click('#ed-paste-save');
    await p.waitForFunction(() => document.querySelectorAll('#ed-body tr[data-id]').length === 3, null, { timeout: 30000 });
    assert.deepEqual(await rowsOf(p), ['Ali Hassan|BONUS · Bonus||1,500.00|Q2 target|The run', 'Ali Hassan|OT · Overtime|10||July weekends|The run', 'Sara Khan|COMM · Commission||800.00|Deal 42|Interim Payroll']);
    assert.deepEqual(p.__dialogs, ['2 entries added.']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the run shows them read-only, opens Earnings & Deductions on its company and month, and says when they changed', async () => {
    runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    assert.equal(await p.locator('#pr-in-body tr').count(), 2, 'the run\'s two (the commission goes by Interim Payroll)');
    assert.ok(await p.$$eval('#pr-in-body input, #pr-in-body select', x => x.every(i => i.disabled)));
    assert.ok(await p.isHidden('#pr-in-actions'));
    assert.ok(await p.isHidden('#pr-ed-changed'));
    // Changed in Earnings & Deductions: the run says so.
    const e = (await call('u-admin', 'getEarningsDeductions', { companyId: 'C1', month: '2026-07' })).entries.find(x => x.Code === 'BONUS');
    await call('u-admin', 'saveEarningsDeductions', { companyId: 'C1', month: '2026-07', entry: { EntryID: e.EntryID, EmployeeID: e.EmployeeID, Code: 'BONUS', Amount: 2000 } });
    await p.evaluate(id => openModule('PAYROLL', { RunID: id }), runId);
    await p.waitForFunction(() => !document.getElementById('pr-ed-changed').classList.contains('hidden'), null, { timeout: 30000 });
    await p.click('#pr-ed-open');
    await p.waitForFunction(() => document.getElementById('ed-month') && document.getElementById('ed-month').value === '2026-07' && document.querySelectorAll('#ed-body tr[data-id]').length === 3, null, { timeout: 30000 });
    assert.equal(await p.inputValue('#ed-company'), 'C1');
    assert.match(await p.textContent('#ed-run-note'), /run is a draft: recalculate it after a change/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('posted: the run\'s entries locked (read-only form, no paste); the Interim one still open and offered by Interim Payroll', async () => {
    await call('u-admin', 'recalculatePayrollRun', { runId });
    await call('u-admin', 'submitPayrollRun', { runId });
    const p = await open('PAYROLLED', 'u-admin');
    await p.fill('#ed-month', '2026-07');
    await p.dispatchEvent('#ed-month', 'change');
    await p.waitForFunction(() => /can no longer change/.test(document.getElementById('ed-run-note').textContent), null, { timeout: 30000 });
    assert.ok(await p.isHidden('#ed-paste-btn'));
    await p.click('#ed-body tr:has-text("BONUS")');
    await p.waitForSelector('#ed-entry-view:not(.hidden)', { timeout: 30000 });
    assert.ok(await p.isDisabled('#ed-amount'));
    assert.ok(await p.isHidden('#ed-save'));
    assert.match(await p.textContent('#ed-entry-state'), /Posted with the run/);
    await p.click('#ed-body tr:has-text("COMM")');
    await p.waitForFunction(() => /Sara Khan — Commission/.test(document.getElementById('ed-entry-heading').textContent), null, { timeout: 30000 });
    assert.ok(await p.isVisible('#ed-save'));
    assert.deepEqual(p.__errors, []);
    await p.close();
    const c = await call('u-admin', 'getInterimBatch', { companyId: 'C1' });
    assert.deepEqual(c.candidates.map(i => [i.Kind, i.What, i.Amount]), [['Payment', 'Commission — Deal 42', 800]]);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
