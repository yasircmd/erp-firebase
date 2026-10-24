// HR Payroll, step 0: work schedules (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md): HR Setup's Work Schedules tab and the
// company's hours a day; a new employee on a schedule (locked after
// creation, shown with its history); a Transfer to another schedule.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrSchedules.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } });
  await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Driver' } });
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
  let empId;

  await check('HR Setup: a six-day schedule (Friday off, 9 hours); the company\'s hours a day', async () => {
    const p = await open('HRSETUP', 'u-admin');
    await p.waitForSelector('#hs-grades-body tr', { timeout: 30000 });
    await p.click('.hs-tab[data-tab="schedules"]');
    assert.match(await p.textContent('#hs-ws-body'), /everyone follows their company's Working Calendar/);
    await p.click('#hs-ws-new');
    await p.fill('#hs-ws-name', 'Six-day (Friday off)');
    await p.fill('#hs-ws-hours', '9');
    await p.uncheck('.hs-ws-wd[value="0"]'); await p.uncheck('.hs-ws-wd[value="6"]'); await p.check('.hs-ws-wd[value="5"]');
    await p.click('#hs-ws-save');
    await p.waitForFunction(() => /Six-day \(Friday off\)\s*Friday\s*9\s*In use/.test(document.getElementById('hs-ws-body').textContent), null, { timeout: 15000 });
    await p.click('.hs-tab[data-tab="calendar"]');
    await p.waitForFunction(() => document.getElementById('hs-cal-hours').value === '8', null, { timeout: 15000 });
    await p.fill('#hs-cal-hours', '8.5');
    await p.click('#hs-cal-save');
    for (let i = 0; i < 30 && (await call('u-admin', 'getWorkCalendar', { companyId: 'C1', year: new Date().getFullYear() })).hoursPerDay !== 8.5; i++) await new Promise(ok => setTimeout(ok, 300));
    assert.equal((await call('u-admin', 'getWorkCalendar', { companyId: 'C1', year: new Date().getFullYear() })).hoursPerDay, 8.5);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('HR Setup → Leaving Reasons (moved from Payroll Setup, 2026-10-24): the defaults by type; a new one added', async () => {
    const p = await open('HRSETUP', 'u-admin');
    await p.waitForSelector('#hs-grades-body tr', { timeout: 30000 });
    await p.click('.hs-tab[data-tab="leaving"]');
    await p.waitForFunction(() => document.querySelectorAll('#hs-lr-body tr[data-id]').length === 12, null, { timeout: 30000 });
    assert.ok(await p.isHidden('#hs-pane-schedules'), 'one tab at a time');
    await p.click('#hs-lr-new');
    await p.fill('#hs-lr-name', 'Career change');
    await p.selectOption('#hs-lr-type', 'Resignation');
    await p.click('#hs-lr-save');
    await p.waitForFunction(() => /Career change\s*Resignation\s*In use/.test(document.getElementById('hs-lr-body').textContent), null, { timeout: 15000 });
    assert.ok((await call('u-admin', 'leavingReasonSetup', { action: 'list' })).reasons.some(r => r.Name === 'Career change' && r.Type === 'Resignation'));
    // The form closes with the other HR Setup forms.
    await p.click('#hs-lr-body tr[data-id]');
    await p.click('.hs-tab[data-tab="grades"]');
    assert.ok(await p.isHidden('#hs-lr-form'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a new employee on the schedule; locked after creation', async () => {
    const p = await open('EMPLOYEES', 'u-admin');
    await p.waitForFunction(() => !document.getElementById('emp-new-btn').classList.contains('hidden'), null, { timeout: 30000 });
    await p.click('#emp-new-btn');
    await p.fill('[data-k="FullName"]', 'Ahmed Rafi');
    await p.fill('[data-k="JoinDate"]', '2025-01-01');
    await p.selectOption('#emp-form-designation', { label: 'Driver' });
    await p.selectOption('#emp-form-grade', { label: 'G3' });
    assert.equal(await p.inputValue('#emp-form-schedule'), '', 'the company calendar to start');
    await p.selectOption('#emp-form-schedule', { label: 'Six-day (Friday off)' });
    await p.click('#emp-save-btn');
    await p.waitForFunction(() => /Ahmed Rafi$/.test(document.getElementById('emp-heading').textContent), null, { timeout: 15000 });
    assert.equal(await p.isDisabled('#emp-form-schedule'), true);
    empId = (await call('u-admin', 'getEmployees', {})).employees[0].EmployeeID;
    assert.equal((await call('u-admin', 'getEmployee', { employeeId: empId })).employee.ScheduleName, 'Six-day (Friday off)');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Transfer moves the employee to the company calendar from a date; the record shows both', async () => {
    const p = await open('EMPCHANGE', 'u-admin');
    await p.evaluate(id => { window.__pendingModuleParams = { NewForEmployee: id }; }, empId);
    await p.evaluate(() => { window.__moduleReady = false; openModule('EMPCHANGE', window.__pendingModuleParams); });
    await p.waitForFunction(() => window.__moduleReady === true && !document.getElementById('ec-entry-view').classList.contains('hidden'), null, { timeout: 30000 });
    await p.selectOption('#ec-type', 'Transfer');
    await p.waitForFunction(() => /Six-day \(Friday off\)/.test(document.querySelector('[data-now="ScheduleID"]').textContent), null, { timeout: 15000 });
    await p.selectOption('#ec-after-schedule', '');
    await p.fill('#ec-effective', '2026-04-01');
    await p.click('#ec-save-btn');
    await p.waitForFunction(() => /^Draft — Transfer/.test(document.getElementById('ec-heading').textContent), null, { timeout: 15000 });
    await p.click('#ec-submit-btn');
    await p.waitForFunction(() => /Approved/.test(document.getElementById('ec-status-badge').textContent), null, { timeout: 15000 });
    await p.close();
    const e = await open('EMPLOYEES', 'u-admin');
    await e.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await e.click('#emp-table-body tr:has-text("Ahmed Rafi")');
    await e.waitForFunction(() => /from 01\/01\/2025: Six-day \(Friday off\) · from 01\/04\/2026: Company working calendar/.test(document.getElementById('emp-schedule-history').textContent), null, { timeout: 15000 });
    assert.equal(await e.inputValue('#emp-form-schedule'), '');
    assert.deepEqual(e.__errors, []);
    await e.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
