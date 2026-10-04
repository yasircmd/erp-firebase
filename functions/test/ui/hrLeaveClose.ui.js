// HR: Attendance and Leave Register, step 3 (owner, 2026-10-04;
// docs/modules/HR_LEAVE.md): an absence entered and cancelled; Month close
// (lock with its summary and accrual, the next month only, reopen with a
// reason); the year close (carry and lapse); view-only users.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrLeaveClose.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const tsv = rows => rows.map(r => r.join('\t')).join('\n');

(async () => {
  await reset(baseFixture());
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const g7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  await call('u-admin', 'saveEmployee', { employee: { FullName: 'Sara Khan', CompanyID: 'C1', JoinDate: '2025-07-01', DesignationID: des, GradeID: g7, Gender: 'Female' } });
  const TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 24 }, { LevelFrom: 5, LevelTo: 99, DaysPerYear: 30 }] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [] });
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '5', '31/01/2026']]) });
  const unpaid = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: ali, LeaveTypeID: TYPE.UNPAID, FromDate: '2026-02-02', ToDate: '2026-02-08' } })).leaveId;
  await call('u-admin', 'submitLeave', { leaveId: unpaid });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8170);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(page.__answer || '') : d.accept(); });
    await page.goto('http://127.0.0.1:8170/?module=LEAVE&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#lv-table-body tr', { timeout: 30000 });
    return page;
  }
  const p = await open('u-admin');
  const row = m => '#lv-mc-body tr[data-month="' + m + '"]';
  const monthsShown = () => p.waitForSelector('#lv-mc-body tr[data-month]', { timeout: 15000 });

  await check('an absence: shown as unpaid as it is typed, approved at once, cancelled when entered in error', async () => {
    await p.click('#lv-new-btn');
    await p.selectOption('#lv-employee', ali);
    await p.selectOption('#lv-type', { label: 'Absence (unauthorised)' });
    await p.fill('#lv-from', '2026-03-09'); await p.fill('#lv-to', '2026-03-10'); await p.dispatchEvent('#lv-to', 'change');
    await p.waitForFunction(() => /2 days absent\s*2\s*Absent, unpaid/.test(document.getElementById('lv-preview').textContent), null, { timeout: 15000 });
    await p.click('#lv-save-btn');
    await p.waitForFunction(() => /^Draft — Absence \(unauthorised\): Ali Hassan/.test(document.getElementById('lv-heading').textContent), null, { timeout: 15000 });
    await p.click('#lv-submit-btn');
    await p.waitForFunction(() => /Approved/.test(document.getElementById('lv-status-badge').textContent), null, { timeout: 15000 });
    assert.equal(await p.isVisible('#lv-return-wrap'), false, 'no return for an absence');
    assert.equal(await p.isVisible('#lv-cancel-btn'), true, 'an absence is cancelled even after its date');
    p.__answer = 'He was on site';
    await p.click('#lv-cancel-btn');
    await p.waitForFunction(() => /Cancelled/.test(document.getElementById('lv-status-badge').textContent), null, { timeout: 15000 });
    await p.click('#lv-back-btn');
  });

  await check('Month close: lock February with its summary and accrual; then only March; reopen with a reason', async () => {
    await p.click('#lv-months-btn');
    await monthsShown();
    assert.equal(await p.isVisible(row('2026-02') + ' .lv-mc-lock'), true);
    p.__dialogs.length = 0;
    await p.click(row('2026-02') + ' .lv-mc-lock');
    await p.waitForFunction(() => /\(locked\)/.test(document.getElementById('lv-mc-summary-status').textContent), null, { timeout: 15000 });
    assert.deepEqual(p.__dialogs, ['Lock 2026-02? Its summary is taken for payroll and its accrual posted.']);
    const sum = await p.textContent('#lv-mc-summary');
    assert.match(sum, /Ali Hassan\s*EMP-0001\s*7\s*ANNUAL 1\.5/);
    assert.match(sum, /Sara Khan\s*EMP-0002\s*ANNUAL 2\.5/);
    assert.match(await p.textContent(row('2026-02')), /Locked/);
    assert.deepEqual(await p.$$eval('.lv-mc-lock', b => b.map(x => x.closest('tr').dataset.month)), ['2026-03']);
    assert.equal(await p.isVisible(row('2026-02') + ' .lv-mc-reopen'), true);
    p.__answer = 'Late sick note';
    await p.click(row('2026-02') + ' .lv-mc-reopen');
    await p.waitForFunction(() => !document.querySelector('#lv-mc-body tr[data-month="2026-02"] .lv-mc-reopen') && /Open/.test(document.querySelector('#lv-mc-body tr[data-month="2026-02"]').textContent), null, { timeout: 15000 });
    const m = (await call('u-admin', 'getLeaveMonths', { companyId: 'C1' })).months.find(x => x.Month === '2026-02');
    assert.deepEqual(m.History.map(h => [h.Event, h.Note || '']), [['Locked', ''], ['Reopened', 'Late sick note']]);
  });

  await check('the year close: the carry and lapse shown, December locked, then closed once', async () => {
    await p.selectOption('#lv-yc-year', '2025');
    await p.click('#lv-yc-show');
    await p.waitForFunction(() => /Lock December 2025 first/.test(document.getElementById('lv-yc-note').textContent), null, { timeout: 15000 });
    assert.match(await p.textContent('#lv-yc-body'), /Sara Khan\s*Annual Leave\s*15\s*10\s*5/);
    assert.equal(await p.isVisible('#lv-yc-close'), false);
    await p.click(row('2025-12') + ' .lv-mc-lock');
    await p.waitForFunction(() => /Locked/.test(document.querySelector('#lv-mc-body tr[data-month="2025-12"]').textContent), null, { timeout: 15000 });
    await p.click('#lv-yc-show');
    await p.waitForSelector('#lv-yc-close:not(.hidden)', { timeout: 15000 });
    p.__dialogs.length = 0;
    await p.click('#lv-yc-close');
    await p.waitForFunction(() => /^Closed on /.test(document.getElementById('lv-yc-note').textContent) || /^Closed\./.test(document.getElementById('lv-yc-note').textContent), null, { timeout: 15000 });
    assert.deepEqual(p.__dialogs, ['Close the leave year 2025? The balances over each cap lapse. This is done once.']);
    assert.equal(await p.isVisible('#lv-yc-close'), false);
    assert.deepEqual((await call('u-admin', 'getLeaveBalances', { employeeId: (await call('u-admin', 'getLeaveForm', {})).employees[1].EmployeeID, asOf: '2025-12-31' }))
      .balances.find(b => b.Code === 'ANNUAL').Adjustments, -5);
    assert.deepEqual(p.__errors, []);
  });

  await check('a view-only user sees the months, the summaries and the year, changes nothing', async () => {
    const v = await open('u-viewer');
    await v.click('#lv-months-btn');
    await v.waitForSelector('#lv-mc-body tr[data-month]', { timeout: 15000 });
    assert.equal(await v.$$eval('.lv-mc-lock, .lv-mc-reopen', b => b.length), 0);
    await v.click('#lv-mc-body tr[data-month="2025-12"] .lv-mc-view');
    await v.waitForFunction(() => /\(locked\)/.test(document.getElementById('lv-mc-summary-status').textContent), null, { timeout: 15000 });
    await v.selectOption('#lv-yc-year', '2025');
    await v.click('#lv-yc-show');
    await v.waitForFunction(() => /^Closed/.test(document.getElementById('lv-yc-note').textContent), null, { timeout: 15000 });
    assert.equal(await v.isVisible('#lv-yc-close'), false);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
