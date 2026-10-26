// The Employee Portal on a phone (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md): HR switches access on in Employees and
// prints the welcome slip; the employee signs in with the code and the
// default password (the Auth emulator, for real), must choose a new one,
// sees Home, applies for leave with the days counted live, follows it; the
// line manager approves or rejects in Team (the badge); payslips open and
// download; an ERP user linked to an employee needs no second sign-in; the
// layout fits a phone and a desktop; light and dark.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/essPortal.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, PROJECT } = require('../emulator/_helpers');
const { portalPage, portalContext, AUTH } = require('./_essPage');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + (e.stack ? ' @ ' + e.stack.split('\n').filter(l => l.includes('essPortal.ui.js')).map(l => l.trim().replace(/^.*essPortal\.ui\.js:/, '')).join(' < ') : '')]); }); }

let ALI, SARA, TYPE, AUG;
(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan', Gender: 'Male' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  await call('u-admin', 'saveLeavePayRules', { leaveTypeId: TYPE.ANNUAL, rows: [{ LevelFrom: 1, LevelTo: 99, Pay: 'Basic', Percent: 100 }] });
  for (const y of [2026, 2027]) await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: y, weekend: [0, 6], holidays: [] });
  // A posted August payroll for the payslips.
  const EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 6000 }, { ElementID: EL.HRA, Amount: 1500 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: SARA, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 9000 }] } });
  for (const id of [EL.BASIC, EL.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-08' });
  AUG = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-08' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: AUG });
  // Sara's account is on and changed already (Ali's is switched on in the test, through Employees).
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [SARA] });
  const saraUid = (await (await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'emp-0002@ess.invalid', password: 'sara0002', returnSecureToken: true }) })).json()).localId;
  await call(saraUid, 'essPortal', { action: 'changePassword', newPassword: 'Garden#2026' });
  for (const a of ['home', 'leaveForm', 'previewLeave', 'leaves', 'balances', 'team', 'payslips', 'payslip']) await call(saraUid, 'essPortal', { action: a, leave: {}, runId: 'x' }).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/ess.html') ? ess : harness);
  }).listen(8188);
  const browser = await chromium.launch();
  async function portal(opts, query) {
    const ctx = await portalContext(browser, opts);
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('browser popup: ' + d.message()); d.dismiss().catch(() => {}); });
    await page.goto('http://127.0.0.1:8188/ess.html' + (query || ''));
    return page;
  }
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const visible = (p, sel) => until(p, s => { const e = document.querySelector(s); return e && e.offsetParent !== null; }, sel);
  const dialogText = async p => { await visible(p, '#ess-dialog-ok'); return p.textContent('#ess-dialog-message'); };
  const answer = async (p, ok, text) => {
    await visible(p, '#ess-dialog-ok');
    if (text !== undefined) await p.fill('#ess-dialog-input', text);
    await p.click(ok ? '#ess-dialog-ok' : '#ess-dialog-cancel');
    await until(p, () => document.getElementById('ess-dialog').classList.contains('hidden'));
  };
  // The toast once it says what is expected (an earlier one may still show).
  const toast = (p, re) => until(p, src => { const t = document.getElementById('ess-toast'); return !t.classList.contains('hidden') && new RegExp(src).test(t.textContent); }, re.source).then(() => p.textContent('#ess-toast'));
  const fits = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const signIn = async (p, code, pw) => { await visible(p, '#si-code');
    for (let i = 0; i < 20; i++) { await p.fill('#si-corporate', '100'); await p.fill('#si-code', code); await p.fill('#si-password', pw); await p.waitForTimeout(100); if (await p.evaluate(v => ['si-corporate', 'si-code', 'si-password'].every((id, k) => document.getElementById(id).value.toUpperCase() === v[k].toUpperCase()), ['100', code, pw])) break; } /* the page focuses the code 50 ms after showing it: typing before then can land in the wrong field */ await p.click('#si-submit'); };

  await check('Employees: HR switches the portal on for an employee, the default password shown and the welcome slip printed; the list shows it', async () => {
    const page = await browser.newPage();
    page.__errors = []; const dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => { window.print = () => { window.__printed = document.getElementById('emp-print-document').innerText; }; });
    await page.goto('http://127.0.0.1:8188/?module=EMPLOYEES&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#emp-table-body tr[data-doc-id]');
    assert.match(await page.textContent('#emp-table-body tr[data-doc-id="' + SARA + '"] .emp-portal-cell'), /^On$/);
    assert.match(await page.textContent('#emp-table-body tr[data-doc-id="' + ALI + '"] .emp-portal-cell'), /—/);
    await page.click('#emp-table-body tr[data-doc-id="' + ALI + '"]');
    await visible(page, '#emp-portal-on');
    assert.match(await page.textContent('#emp-portal-status'), /No portal access yet/);
    await page.click('#emp-portal-on');
    await until(page, () => window.__printed);
    assert.match(dialogs.join(' | '), /The portal is on for 1 employee\.[\s\S]*Print the welcome slip now\?/);
    const slip = await page.evaluate(() => window.__printed);
    assert.match(slip, /Employee Portal — welcome, Ali Hassan/);
    assert.match(slip, /EMP-0001/);
    assert.match(slip, /alih0001/);
    assert.match(slip, /\/ess\.html/);
    await until(page, () => /waiting for the first sign-in/.test(document.getElementById('emp-portal-status').textContent));
    assert.ok(await page.isVisible('#emp-portal-slip') && await page.isVisible('#emp-portal-reset') && await page.isVisible('#emp-portal-off'));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  let ALI_LEAVE_DAYS;
  await check('sign in on a phone: a wrong password told plainly; the default must be changed first (the rules ticked live); then Home', async () => {
    const p = await portal();
    await signIn(p, 'emp-0001', 'nope');
    await until(p, () => !document.getElementById('si-error').classList.contains('hidden'));
    assert.equal(await p.textContent('#si-error'), 'Wrong Employee Code or password.');
    await signIn(p, 'emp-0001', 'alih0001');
    await visible(p, '#cp-new');
    assert.equal(await p.textContent('#cp-name'), 'Ali');
    await p.fill('#cp-new', 'emp-0001xyz');
    assert.equal(await p.getAttribute('#cp-rules li[data-rule="code"]', 'class'), 'text-slate-500 dark:text-slate-400');
    await p.fill('#cp-new', 'Sunrise#2026');
    await p.fill('#cp-again', 'Sunrise#2026');
    assert.match(await p.getAttribute('#cp-rules li[data-rule="same"]', 'class'), /emerald/);
    await p.click('#cp-submit');
    await visible(p, '#home-leave-left');
    assert.equal(await p.textContent('#page-title'), 'Hello, Ali');
    assert.equal(await p.textContent('#home-net'), '7,500.00');
    ALI_LEAVE_DAYS = Number(await p.textContent('#home-leave-left'));
    assert.ok(ALI_LEAVE_DAYS > 0);
    assert.ok(await p.isVisible('#bottom-nav') && !(await p.isVisible('aside')), 'the bottom bar on a phone');
    assert.deepEqual(await p.$$eval('#bottom-nav a', a => a.map(x => x.textContent.trim())), ['Home', 'Leave', 'Pay', 'Requests', 'Me'], 'no Team: Ali manages no one');
    assert.ok(await fits(p), 'no sideways scrolling');
    // The old password no longer works; the new one does.
    await p.click('#bottom-nav a[data-nav="me"]');
    await visible(p, '#me-signout');
    await p.click('#me-signout');
    await signIn(p, 'EMP-0001', 'alih0001');
    await until(p, () => /Wrong Employee Code/.test(document.getElementById('si-error').textContent));
    await signIn(p, 'EMP-0001', 'Sunrise#2026');
    await visible(p, '#home-leave-left');
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('apply for leave: the days and the balance counted live; sent to the line manager; followed in My leave with its timeline', async () => {
    const p = await portal();
    await signIn(p, 'EMP-0001', 'Sunrise#2026');
    await visible(p, '#home-leave-left');
    await p.click('a[href="#leave/apply"]');
    await visible(p, '#lv-type');
    assert.match(await p.textContent('#lv-submit'), /Send to Sara/);
    await p.selectOption('#lv-type', TYPE.ANNUAL);
    await p.fill('#lv-from', '2026-11-02');
    await p.dispatchEvent('#lv-from', 'change');
    await p.fill('#lv-to', '2026-11-06');
    await p.dispatchEvent('#lv-to', 'change');
    await until(p, () => /5 days/.test(document.getElementById('lv-preview').textContent));
    const prev = await p.textContent('#lv-preview');
    assert.match(prev, /back on 09\/11\/2026/, 'dates shown dd/mm/yyyy');
    assert.match(prev, new RegExp('Balance: [\\d.]+ → '));
    await p.click('#lv-submit');
    assert.match(await toast(p, /LV-2026/), /LV-2026-0001: Sent to Sara Khan for approval\./);
    await until(p, () => location.hash === '#leave/history' && document.querySelector('.lv-row'));
    assert.match(await p.textContent('.lv-row'), /Annual Leave\s*LV-2026-0001[\s\S]*02\/11\/2026 – 06\/11\/2026 · 5 days[\s\S]*With manager/);
    await p.click('.lv-row');
    assert.match(await p.textContent('.lv-detail'), /Applied in the portal\s*Ali Hassan/);
    assert.equal(await p.textContent('.lv-cancel'), 'Withdraw this request');
    // Balances: the pending days shown apart.
    await p.click('a[data-tab="balances"]');
    await visible(p, '.bal-available[data-code="ANNUAL"]');
    assert.match(await p.textContent('#leave-body'), /Pending approval\s*5/);
    assert.ok(await fits(p));
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('the line manager: Team with its badge; approves one; rejects one with the reason, which the employee sees', async () => {
    const a = await portal();
    await signIn(a, 'EMP-0001', 'Sunrise#2026');
    await visible(a, '#home-leave-left');
    // A second request, to be rejected.
    await a.evaluate(t => window.__ess.call('essPortal', { action: 'applyLeave', leave: { LeaveTypeID: t, FromDate: '2026-12-07', ToDate: '2026-12-07' } }), TYPE.ANNUAL);
    // Ali is also away today (approved leave): Sara sees it in the portal, not on ERP Home (owner, 2026-10-10).
    const T = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const awayRef = await firestore.collection('leaveRequests').add({ Status: 'Approved', Kind: 'Leave', EmployeeID: ALI, EmployeeNo: 'EMP-0001', EmployeeName: 'Ali Hassan', LeaveTypeName: 'Annual Leave',
      LeaveNumber: 'LV-UI-AWAY', FromDate: T, ToDate: T, ExpectedReturn: '2099-01-05', CompanyID: 'C1', Lines: [{ Date: T, Fraction: 1, Code: 'AL' }] });
    const s = await portal();
    await signIn(s, 'EMP-0002', 'Garden#2026');
    await visible(s, '#home-team');
    assert.match(await s.textContent('#home-team-away'), /1 of your team away today/);
    assert.match(await s.textContent('#home-team'), /2 team requests waiting for you/);
    assert.equal(await s.textContent('#bottom-nav a[data-nav="team"] .ess-team-badge'), '2');
    await s.click('#bottom-nav a[data-nav="team"]');
    await until(s, () => document.querySelectorAll('.tm-decide').length === 4);
    const first = await s.textContent('#page .ess-card');
    assert.match(first, /Ali Hassan\s*EMP-0001[\s\S]*Annual Leave · 5 days[\s\S]*02\/11\/2026 – 06\/11\/2026[\s\S]*Balance: [\d.]+ → [\d.]+ days[\s\S]*Approved when you approve/);
    await s.click('.tm-decide[data-decision="Approved"]');
    assert.equal(await toast(s, /^Approved/), 'Approved.');
    await until(s, () => document.querySelectorAll('.tm-decide').length === 2);
    await s.click('.tm-decide[data-decision="Rejected"]');
    assert.match(await dialogText(s), /The reason is shown to Ali/);
    await s.click('#ess-dialog-ok'); // no reason: not accepted
    assert.ok(await s.isVisible('#ess-dialog-input'));
    await answer(s, true, 'Year-end closing');
    assert.equal(await toast(s, /^Rejected/), 'Rejected.');
    await until(s, () => !document.querySelector('.tm-decide') && /Recently decided/.test(document.getElementById('page').textContent));
    assert.match(await s.textContent('#tm-away'), /Ali Hassan\s*EMP-0001[\s\S]*Annual Leave[\s\S]*Back 05\/01\/2099/);
    await awayRef.delete(); // only for this check
    assert.equal(await s.textContent('#bottom-nav a[data-nav="team"] .ess-team-badge'), '');
    // Ali sees both.
    await a.click('#bottom-nav a[data-nav="leave"]');
    await a.click('a[data-tab="history"]');
    await until(a, () => document.querySelectorAll('.lv-row').length === 2);
    const rows = await a.$$eval('.lv-row', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
    assert.match(rows.join(' | '), /07\/12\/2026 · 1 day\s*Rejected/);
    assert.match(rows.join(' | '), /5 days\s*Approved/);
    await a.click('.lv-row >> nth=0');
    assert.match(await a.textContent('.lv-detail >> nth=0'), /Year-end closing/);
    // Approved and ahead: cancelled with a reason, asked in the page.
    await a.click('.lv-row >> nth=1');
    await a.click('.lv-cancel');
    assert.match(await dialogText(a), /Why are you cancelling it\?/);
    await answer(a, false);
    assert.deepEqual([a.__errors, s.__errors], [[], []]);
    await a.context().close(); await s.context().close();
  });

  await check('payslips: the month card (Sep-2026 style), the full payslip, Download PDF prints it alone', async () => {
    const p = await portal();
    await signIn(p, 'EMP-0001', 'Sunrise#2026');
    await visible(p, '#home-leave-left');
    await p.evaluate(() => { window.print = () => { window.__printed = document.getElementById('ess-print').innerText; window.__printTitle = document.title; }; });
    await p.click('#bottom-nav a[data-nav="pay"]');
    await visible(p, '.ps-open');
    assert.match(await p.textContent('#page'), /Aug-2026[\s\S]*Earnings 7,500\.00 · Deductions 0\.00[\s\S]*7,500\.00\s*Not yet paid/);
    await p.click('.ps-open');
    await visible(p, '#slip-pdf');
    const slip = await p.textContent('#slip-body');
    assert.match(slip, /Test Co One[\s\S]*Payslip — Aug-2026[\s\S]*EMP-0001 · Ali Hassan[\s\S]*Basic Salary[\s\S]*6,000\.00[\s\S]*Total earnings7,500\.00[\s\S]*Net pay7,500\.00/);
    assert.match(slip, /Leave balance at 31\/08\/2026[\s\S]*Annual Leave/);
    // The Payroll screen's own payslip (owner, 2026-10-10): its layout, with the How column.
    assert.equal(await p.locator('#slip-body .payslip-doc').count(), 1);
    assert.match(slip, /EarningsHowAmount/);
    await p.click('#slip-pdf');
    await until(p, () => window.__printed);
    assert.match(await p.evaluate(() => window.__printed), /Payslip — Aug-2026/);
    assert.equal(await p.evaluate(() => window.__printTitle), 'Payslip Aug-2026 EMP-0001');
    await until(p, () => document.title === 'Employee Portal');
    assert.ok(await fits(p));
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('an ERP user linked to an employee: straight in, no second sign-in; Back to the ERP instead of a password; on a desktop the side menu; dark mode', async () => {
    await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: SARA })).employee, { UserUID: 'u-approver' }) });
    const p = await portal({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, '?uid=u-approver');
    await visible(p, '#home-leave-left');
    assert.equal(await p.textContent('#page-title'), 'Hello, Sara');
    assert.ok(await p.isVisible('aside') && !(await p.isVisible('#bottom-nav')), 'the side menu on a desktop');
    assert.deepEqual(await p.$$eval('#side-nav a', a => a.map(x => x.textContent.trim())), ['Home', 'Leave', 'Pay', 'Requests', 'Team', 'Me']);
    await p.click('#side-nav a[data-nav="me"]');
    await visible(p, '#me-theme');
    assert.ok(await p.isVisible('a[href="/"]') && !(await p.$('#me-pw')) && !(await p.$('#me-signout')));
    const dark = await p.evaluate(() => document.documentElement.classList.contains('dark'));
    await p.click('#me-theme');
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('dark')), !dark);
    // An ERP user who is not linked is told why.
    const q = await portal({}, '?uid=u-viewer');
    await until(q, () => /not linked to an employee record/.test(document.getElementById('si-error').textContent));
    assert.deepEqual([p.__errors, q.__errors], [[], []]);
    await p.context().close(); await q.context().close();
  });

  await check('switched off by HR: signed out and refused with a plain message', async () => {
    await call('u-admin', 'manageEssAccounts', { action: 'disable', employeeIds: [ALI] });
    const p = await portal();
    await signIn(p, 'EMP-0001', 'Sunrise#2026');
    await until(p, () => /switched off/.test(document.getElementById('si-error').textContent));
    assert.equal(await p.textContent('#si-error'), 'Your portal access is switched off. Please contact HR.');
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await browser.close();
  server.close();
  await app.delete();
  results.forEach(r => console.log(r.join(' — ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
