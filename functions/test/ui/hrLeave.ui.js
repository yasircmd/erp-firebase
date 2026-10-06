// HR: Attendance and Leave Register, step 2 (owner, 2026-10-03;
// docs/modules/HR_LEAVE.md): from the employee's leave card to a new leave;
// the days, pay and balance shown as it is typed; submit, approve; the
// return (early); the excess over the balance split off as unpaid; the
// certificate rule; the list's filters; an adjustment; view-only users.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrLeave.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const PDF = Buffer.from('%PDF-1.4\n% certificate\n').toString('base64');

(async () => {
  const f = baseFixture();
  f.approvalConfigurations = { LEAVE: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { LEAVE: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const g7 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G7', Level: 7 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g3, Gender: 'Male' } })).employeeId;
  const sara = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Sara Khan', CompanyID: 'C1', JoinDate: '2025-07-01', DesignationID: des, GradeID: g7, Gender: 'Female' } })).employeeId;
  const TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: TYPE.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 4, DaysPerYear: 24 }, { LevelFrom: 5, LevelTo: 99, DaysPerYear: 30 }] });
  await call('u-admin', 'saveLeavePayRules', { leaveTypeId: TYPE.ANNUAL, rows: [{ LevelFrom: 1, LevelTo: 4, Pay: 'Basic', Percent: 100 }, { LevelFrom: 5, LevelTo: 99, Pay: 'Full', Percent: 100 }] });
  await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: 2026, weekend: [0, 6], holidays: [{ From: '2026-03-19', To: '2026-03-20', Name: 'Eid' }] });
  await call('u-admin', 'runMasterImport', { master: 'LEAVEBAL', text: tsv([['Employee', 'Leave Type', 'Days', 'Balance Date'], ['EMP-0001', 'ANNUAL', '5', '31/01/2026']]) });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8169);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(page.__answer || '') : d.accept(); });
    await page.goto('http://127.0.0.1:8169/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const typeIn = async (p, from, to) => { await p.fill('#lv-from', from); await p.fill('#lv-to', to); await p.dispatchEvent('#lv-to', 'change'); };
  const previewIs = (p, re) => p.waitForFunction(src => new RegExp(src).test(document.getElementById('lv-preview').textContent) && !document.getElementById('lv-preview').classList.contains('hidden'), re.source, { timeout: 15000 });
  let first;

  await check('from the employee\'s leave card: a new annual leave, its days, pay and balance as typed; a day off refused; saved and submitted', async () => {
    const p = await open('EMPLOYEES', 'u-admin');
    await p.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await p.click('#emp-table-body tr:has-text("Ali Hassan")');
    await p.waitForSelector('#emp-leave-wrap:not(.hidden)', { timeout: 15000 });
    const card = (await call('u-admin', 'getLeaveBalances', { employeeId: ali })).balances.find(b => b.Code === 'ANNUAL');
    assert.match(await p.textContent('#emp-leave-bal'), new RegExp('Annual Leave\\s*5\\s*' + card.Accrued + '\\s*0\\s*0\\s*0\\s*' + card.Available));
    await p.evaluate(() => { window.__moduleReady = false; });
    await p.click('#emp-leave-new');
    await p.waitForFunction(() => window.__moduleReady === true && !document.getElementById('lv-entry-view').classList.contains('hidden'), null, { timeout: 30000 });
    assert.match(await p.textContent('#lv-back-chain-label'), /Back to Employees/);
    assert.equal(await p.inputValue('#lv-employee'), ali);
    await p.selectOption('#lv-type', { label: 'Annual Leave' });
    await typeIn(p, '2026-03-21', '2026-03-24');
    await p.waitForFunction(() => /starts on a day off/.test(document.getElementById('lv-error').textContent), null, { timeout: 15000 });
    await typeIn(p, '2026-03-16', '2026-03-24');
    await previewIs(p, /5 days of leave\s*5\s*Annual Leave — Basic only\s*Balance on the first day: 8\.03 → after this leave: 3\.03/);
    assert.equal(await p.textContent('#lv-error'), '');
    await p.fill('#lv-reason', 'Family visit');
    await p.click('#lv-save-btn');
    await p.waitForFunction(() => /^Draft — Annual Leave: Ali Hassan/.test(document.getElementById('lv-heading').textContent), null, { timeout: 15000 });
    p.__dialogs.length = 0;
    await p.click('#lv-submit-btn');
    await p.waitForFunction(() => /Pending approval/.test(document.getElementById('lv-status-badge').textContent), null, { timeout: 15000 });
    assert.deepEqual(p.__dialogs, ['Submit this leave? It goes for approval (or is approved now when no approval is set up).', 'LV-2026-0001 is waiting for approval.']);
    first = (await call('u-admin', 'getLeaves', {})).leaves[0].LeaveID;
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the approver approves; HR records an early return and the unused days go back', async () => {
    const p = await open('LEAVE', 'u-approver');
    await p.waitForSelector('#lv-table-body tr[data-id]', { timeout: 30000 });
    await p.click('#lv-table-body tr[data-id="' + first + '"]');
    await p.waitForSelector('#lv-decide:not(.hidden)', { timeout: 15000 });
    await p.click('#lv-approve-btn');
    await p.waitForFunction(() => /Approved/.test(document.getElementById('lv-status-badge').textContent), null, { timeout: 15000 });
    await p.close();
    const h = await open('LEAVE', 'u-admin');
    await h.waitForSelector('#lv-table-body tr[data-id]', { timeout: 30000 });
    await h.click('#lv-table-body tr[data-id="' + first + '"]');
    await h.waitForSelector('#lv-return-form:not(.hidden)', { timeout: 15000 });
    assert.match(await h.textContent('#lv-return-info'), /Due back on 25\/03\/2026\. HR confirms the return/);
    assert.equal(await h.isVisible('#lv-cancel-btn'), false, 'started leave is not cancelled');
    await h.fill('#lv-return-date', '2026-03-23');
    h.__dialogs.length = 0;
    await h.click('#lv-return-btn');
    await h.waitForFunction(() => /Back at work on 23\/03\/2026: early/.test(document.getElementById('lv-return-info').textContent), null, { timeout: 15000 });
    assert.deepEqual(h.__dialogs, ['Back early on 2026-03-23: 2 days go back to the balance. Record it?']);
    assert.match(await h.textContent('#lv-preview'), /3 days of leave\s*3\s*Annual Leave — Basic only/);
    assert.equal((await call('u-admin', 'getLeaveBalances', { employeeId: ali, asOf: '2026-03-31' })).balances.find(b => b.Code === 'ANNUAL').Taken, 3);
    assert.deepEqual(h.__errors, []);
    await h.close();
  });

  await check('over the balance: the excess shown as unpaid before saving; sick leave expects its certificate (step 6: submitted without it, the approver decides)', async () => {
    const p = await open('LEAVE', 'u-admin');
    await p.click('#lv-new-btn');
    await p.selectOption('#lv-employee', ali);
    await p.selectOption('#lv-type', { label: 'Annual Leave' });
    await typeIn(p, '2026-04-06', '2026-04-17');
    // 9.4 earned by 6 Apr, 3 taken: 6 annual, 4 unpaid.
    await previewIs(p, /10 days of leave\s*6\s*Annual Leave — Basic only\s*4\s*Unpaid \(over the balance\)\s*Balance on the first day: 6\.4 → after this leave: 0\.4\s*4 days over the balance \(6\.4\) will be unpaid\./);
    await p.click('#lv-back-btn');
    await p.click('#lv-new-btn');
    await p.selectOption('#lv-employee', sara);
    await p.selectOption('#lv-type', { label: 'Sick Leave' });
    await typeIn(p, '2026-02-01', '2026-02-20');
    await previewIs(p, /20 days of leave\s*15\s*Sick Leave — Full salary\s*5\s*Sick Leave — Full salary at 50%[\s\S]*supporting document \(e\.g\. a medical certificate\) is expected: attach it below\. Without it, whoever approves decides whether to accept the leave\./);
    await p.click('#lv-save-btn');
    await p.waitForFunction(() => /^Draft — Sick Leave: Sara Khan/.test(document.getElementById('lv-heading').textContent), null, { timeout: 15000 });
    await p.click('#lv-submit-btn');
    await p.waitForFunction(() => /Pending approval/.test(document.getElementById('lv-status-badge').textContent), null, { timeout: 15000 });
    await p.waitForSelector('#lv-doc-note:not(.hidden)', { timeout: 15000 });
    assert.match(await p.textContent('#lv-doc-note'), /No supporting document attached: the approver decides whether to accept the leave without it\./);
    // Attached afterwards: the note goes.
    const sick = (await call('u-admin', 'getLeaves', {})).leaves.find(l => l.EmployeeID === sara).LeaveID;
    await call('u-admin', 'uploadAttachment', { module: 'LEAVE', docId: sick, fileName: 'certificate.pdf', data: PDF });
    assert.equal((await call('u-admin', 'getLeave', { leaveId: sick })).leave.DocumentMissing, false);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the list: on leave in a month, returns still to record; the employee card shows the leave and takes an adjustment', async () => {
    const id = (await call('u-admin', 'saveLeave', { leave: { EmployeeID: sara, LeaveTypeID: TYPE.ANNUAL, FromDate: '2026-05-04', ToDate: '2026-05-08' } })).leaveId;
    await call('u-admin', 'submitLeave', { leaveId: id });
    await call('u-approver', 'decideLeaveApproval', { leaveId: id, levelNumber: 1, decision: 'Approved' });
    const p = await open('LEAVE', 'u-admin');
    await p.waitForSelector('#lv-table-body tr[data-id]', { timeout: 30000 });
    await p.selectOption('#lv-status-filter', 'return');
    assert.deepEqual(await p.$$eval('#lv-table-body tr[data-id]', r => r.map(x => x.dataset.id)), [id]);
    assert.match(await p.textContent('#lv-table-body'), /Sara Khan[\s\S]*Annual Leave[\s\S]*Approved · return to record/);
    await p.selectOption('#lv-status-filter', '');
    await p.fill('#lv-month-filter', '2026-02');
    await p.dispatchEvent('#lv-month-filter', 'change');
    assert.match(await p.textContent('#lv-table-body'), /^\s*DRAFT|Sick Leave/);
    assert.equal(await p.$$eval('#lv-table-body tr[data-id]', r => r.length), 1);
    await p.close();
    const e = await open('EMPLOYEES', 'u-admin');
    await e.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await e.click('#emp-table-body tr:has-text("Ali Hassan")');
    await e.waitForSelector('#emp-leave-wrap:not(.hidden)', { timeout: 15000 });
    assert.match(await e.textContent('#emp-leave-list'), /LV-2026-0001 — Annual Leave\s*16\/03\/2026 – 22\/03\/2026 · 3 · Approved/);
    const before = (await call('u-admin', 'getLeaveBalances', { employeeId: ali })).balances.find(b => b.Code === 'ANNUAL').Available;
    await e.click('#emp-leave-adjust');
    await e.fill('#emp-adj-days', '1.5');
    await e.fill('#emp-adj-reason', 'Worked on a holiday');
    await e.click('#emp-adj-save');
    await e.waitForFunction(n => document.getElementById('emp-leave-bal').textContent.trim().endsWith(String(n)), Math.round((before + 1.5) * 100) / 100, { timeout: 15000 });
    assert.deepEqual(e.__errors, []);
    await e.close();
  });

  await check('a view-only user: sees the register and the card, changes nothing', async () => {
    const v = await open('LEAVE', 'u-viewer');
    await v.waitForSelector('#lv-table-body tr[data-id]', { timeout: 30000 });
    assert.equal(await v.isVisible('#lv-new-btn'), false);
    await v.click('#lv-table-body tr[data-id="' + first + '"]');
    await v.waitForSelector('#lv-entry-view:not(.hidden)', { timeout: 15000 });
    for (const b of ['#lv-save-btn', '#lv-submit-btn', '#lv-cancel-btn', '#lv-return-form']) assert.equal(await v.isVisible(b), false, b);
    assert.equal(await v.isDisabled('#lv-from'), true);
    await v.close();
    const e = await open('EMPLOYEES', 'u-viewer');
    await e.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await e.click('#emp-table-body tr:has-text("Ali Hassan")');
    await e.waitForSelector('#emp-leave-wrap:not(.hidden)', { timeout: 15000 });
    assert.equal(await e.isVisible('#emp-leave-new'), false);
    assert.equal(await e.isVisible('#emp-leave-adjust'), false);
    assert.deepEqual(e.__errors, []);
    await e.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
