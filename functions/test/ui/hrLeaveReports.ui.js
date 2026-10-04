// HR: Attendance and Leave Register, step 4 (owner, 2026-10-03;
// docs/modules/HR_LEAVE.md): Leave Reports: balances on a date (copied to
// Excel, dates as dd/mm/yyyy), the register for a period, absences, and who
// is away in a month; a reports-only user.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrLeaveReports.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, rtdb } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const tsv = rows => rows.map(r => r.join('\t')).join('\n');

(async () => {
  await reset(baseFixture());
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const g7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  const sara = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Sara Khan', CompanyID: 'C1', JoinDate: '2025-07-01', DesignationID: des, GradeID: g7, Gender: 'Female' } })).employeeId;
  const TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 24 }, { LevelFrom: 5, LevelTo: 99, DaysPerYear: 30 }] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [{ From: '2026-04-15', To: '2026-04-15', Name: 'Company Day' }] });
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '5', '31/01/2026']]) });
  const enter = async (emp, code, from, to) => { const id = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: emp, LeaveTypeID: TYPE[code], FromDate: from, ToDate: to } })).leaveId; await call('u-admin', 'submitLeave', { leaveId: id }); return id; };
  await enter(ali, 'ANNUAL', '2026-03-16', '2026-03-20');
  await enter(ali, 'UNPAID', '2026-04-01', '2026-04-02');
  await enter(ali, 'ABSENT', '2026-04-06', '2026-04-06');
  const saraAnnual = await enter(sara, 'ANNUAL', '2026-03-30', '2026-04-03');
  await call('u-admin', 'recordLeaveReturn', { leaveId: saraAnnual, returnDate: '2026-04-08', confirm: true });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8171);
  const browser = await chromium.launch();
  async function open(uid) {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8171/?module=LEAVEREPORTS&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#lr-type option').length > 1, null, { timeout: 30000 });
    return page;
  }
  const p = await open('u-admin');
  const shown = re => p.waitForFunction(src => new RegExp(src).test(document.getElementById('lr-out').textContent), re.source, { timeout: 15000 });

  await check('balances on a date, copied to Excel with dates as dd/mm/yyyy', async () => {
    await p.fill('#lr-asof', '2026-03-31');
    await p.click('#lr-run');
    await shown(/EMP-0001\s*Ali Hassan\s*G3\s*Annual Leave\s*5\s*4\s*0\s*5\s*0\s*4\s*EMP-0002\s*Sara Khan\s*G7\s*Annual Leave\s*0?\s*22\.5\s*0?\s*2\s*3\s*17\.5/);
    assert.match(await p.textContent('#lr-note'), /Balances on 31\/03\/2026/);
    await p.click('#lr-copy-btn');
    await p.waitForFunction(() => /Copied/.test(document.getElementById('lr-copy-btn').textContent), null, { timeout: 10000 });
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip.split('\n')[0], 'No.\tEmployee\tGrade\tLeave type\tOpening\tAccrued\tAdjusted\tTaken\tBooked\tAvailable');
    assert.equal(clip.split('\n')[1], 'EMP-0001\tAli Hassan\tG3\tAnnual Leave\t5\t4\t0\t5\t0\t4');
  });

  await check('the register for April, then by type; the absences tab with the late return', async () => {
    await p.click('.lr-tab[data-tab="register"]');
    await p.fill('#lr-from', '2026-04-01'); await p.fill('#lr-to', '2026-04-30');
    await p.click('#lr-run');
    await shown(/Sara Khan\s*Annual Leave\s*30\/03\/2026\s*07\/04\/2026\s*08\/04\/2026\s*3\s*0\s*2[\s\S]*Ali Hassan\s*Unpaid Leave[\s\S]*2\s*2\s*0[\s\S]*Absence \(unauthorised\)/);
    await p.selectOption('#lr-type', { label: 'Unpaid Leave' });
    await p.click('#lr-run');
    await p.waitForFunction(() => document.querySelectorAll('#lr-out tbody tr').length === 1 && /Unpaid Leave/.test(document.getElementById('lr-out').textContent), null, { timeout: 15000 });
    await p.click('.lr-tab[data-tab="absences"]');
    await p.click('#lr-run');
    await shown(/Sara Khan\s*Annual Leave[\s\S]*2\s*Late return \(due 06\/04\/2026\)[\s\S]*Ali Hassan\s*Absence[\s\S]*1/);
    assert.equal(await p.$$eval('#lr-out tbody tr', r => r.length), 2);
  });

  await check('who is away in April: leave, absences, the holiday shaded; everyone or only those away', async () => {
    await p.click('.lr-tab[data-tab="calendar"]');
    assert.equal(await p.inputValue('#lr-company'), 'C1', 'the calendar is one company');
    await p.fill('#lr-month', '2026-04');
    await p.click('#lr-run');
    await p.waitForSelector('#lr-out tr[data-emp] .lr-day', { timeout: 15000 });
    const cell = async (emp, d) => p.evaluate(([e, x]) => { const el = document.querySelector('#lr-out tr[data-emp="' + e + '"] .lr-day[data-date="' + x + '"]'); return el ? [el.textContent, el.title, el.className] : null; }, [emp, d]);
    const a1 = await cell(ali, '2026-04-01'), a6 = await cell(ali, '2026-04-06'), s7 = await cell(sara, '2026-04-07');
    assert.deepEqual([a1[0], a1[1]], ['U', 'Unpaid Leave']);
    assert.deepEqual([a6[0], a6[1], /bg-red/.test(a6[2])], ['X', 'Absent', true]);
    assert.deepEqual([s7[0], /bg-red/.test(s7[2])], ['X', true]);
    assert.equal((await cell(sara, '2026-04-01'))[0], 'A', 'annual leave: its first letter');
    assert.equal(await p.getAttribute('#lr-out thead th:nth-child(16)', 'title'), 'Company Day');
    assert.match(await p.textContent('#lr-out tr[data-emp="' + sara + '"]'), /5$/);
    // A third employee with no leave shows only with "everyone".
    await call('u-admin', 'saveEmployee', { employee: { FullName: 'Omar Said', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } });
    await p.click('#lr-run');
    await p.waitForSelector('#lr-out tr[data-emp]', { timeout: 15000 });
    assert.equal(await p.$$eval('#lr-out tr[data-emp]', r => r.length), 2);
    await p.uncheck('#lr-away-only');
    await p.waitForFunction(() => document.querySelectorAll('#lr-out tr[data-emp]').length === 3, null, { timeout: 15000 });
    assert.deepEqual(p.__errors, []);
  });

  await check('a reports-only user (no Leave Register access) sees the reports', async () => {
    await rtdb.ref('permissions/LEAVE/access').set(['Admin']);
    const v = await open('u-viewer');
    await v.fill('#lr-asof', '2026-03-31');
    await v.click('#lr-run');
    await v.waitForFunction(() => /Ali Hassan/.test(document.getElementById('lr-out').textContent), null, { timeout: 15000 });
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
