// Employee Portal step 3 on a phone and in the ERP (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md, decisions 93, 94, 106-109): HR sets up
// the expense categories (Payroll Setup → Reimbursements); an employee
// claims two bills with a receipt photo, the line manager approves in Team;
// a claim over the monthly limit goes to the approver, who approves part of
// it in Employee Requests; the employee sees the approved amount and the
// reason; a sick leave applied with its certificate attached.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/essClaims.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, call, reset, baseFixture, PROJECT } = require('../emulator/_helpers');
const { portalPage, portalContext, AUTH } = require('./_essPage');
const { todayIn } = require('../../src/recurringSchedule');

const results = [];
function check(name, fn) {
  return fn().then(() => { results.push(['PASS', name]); }, e => {
    results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + (e.stack ? ' @ ' + e.stack.split('\n').filter(l => l.includes('essClaims.ui.js')).map(l => l.trim().replace(/^.*essClaims\.ui\.js:/, '')).join(' < ') : '')]);
  });
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a9b10000000049454e44ae426082', 'hex');
const T = todayIn('Asia/Dubai');
const ago = n => new Date(Date.parse(T) - n * 86400000).toISOString().slice(0, 10);

let ALI, SARA, BEN, TYPE;
(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  f.permissions.EMPREQUESTS = { access: ['Admin'], handle: ['Admin'], setup: ['Admin'] };
  Object.assign(f.coa, {
    'A-TRAVEL': { AccountCode: '6400', AccountName: 'Travel', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FUEL': { AccountCode: '6410', AccountName: 'Fuel', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1', Gender: 'Male' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  BEN = await emp({ FullName: 'Ben Okafor' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI, SARA, BEN] });
  const signIn = async (code, pw) => (await (await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: code.toLowerCase() + '@ess.invalid', password: pw, returnSecureToken: true }) })).json()).localId;
  for (const [code, pw, np] of [['EMP-0001', 'alih0001', 'Sunrise#2026'], ['EMP-0002', 'sara0002', 'Garden#2026'], ['EMP-0003', 'beno0003', 'Harbour#2026']]) await call(await signIn(code, pw), 'essPortal', { action: 'changePassword', newPassword: np });
  TYPE = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  for (const y of [Number(T.slice(0, 4)) - 1, Number(T.slice(0, 4))]) await call('u-admin', 'saveWorkCalendar', { companyId: 'C1', year: y, weekend: [0, 6], holidays: [] });
  await rtdb.ref('approvalConfigurations/REIMBURSEMENT').set({ Enabled: true, ScopeType: 'Global' });
  await rtdb.ref('approvalLevels/REIMBURSEMENT').set({ GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } });
  for (const a of ['list', 'get']) await call('u-admin', 'employeeRequests', { action: a, id: 'x' }).catch(() => {});
  for (const n of ['reimbursementSetup', 'getPayrollSetup', 'getPayElements', 'getAttachments']) await call('u-admin', n, { action: 'list' }).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8190);
  const browser = await chromium.launch();
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const visible = (p, sel) => until(p, s => { const e = document.querySelector(s); return e && e.offsetParent !== null; }, sel);
  const toast = (p, re) => until(p, src => { const t = document.getElementById('ess-toast'); return !t.classList.contains('hidden') && new RegExp(src).test(t.textContent); }, re.source).then(() => p.textContent('#ess-toast'));
  async function portal(code, pw) {
    const ctx = await portalContext(browser);
    const p = await ctx.newPage();
    p.__errors = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    p.on('dialog', d => { p.__errors.push('browser popup: ' + d.message()); d.dismiss().catch(() => {}); });
    await p.goto('http://127.0.0.1:8190/ess.html');
    await visible(p, '#si-code');
    await p.fill('#si-corporate', '100'); await p.fill('#si-code', code); await p.fill('#si-password', pw); await p.click('#si-submit');
    await visible(p, '#home-leave-left');
    return p;
  }
  async function erp(module, uid, answers) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); const a = (answers || []).shift(); if (a === null) d.dismiss(); else d.accept(a); });
    await page.goto('http://127.0.0.1:8190/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  async function bill(p, n, cat, amount, what, date, file) {
    const b = '.rc-bill:nth-child(' + n + ') ';
    await p.selectOption(b + '.rc-cat', { label: cat });
    if (date) await p.fill(b + '.rc-date', date);
    await p.fill(b + '.rc-amount', String(amount));
    await p.fill(b + '.rc-what', what);
    if (file) await p.setInputFiles(b + '.rc-file', { name: file, mimeType: 'image/png', buffer: PNG });
  }

  await check('Payroll Setup → Reimbursements: categories with their expense account, monthly limit and receipt rule, each with its own pay element', async () => {
    const page = await erp('PAYROLLSETUP', 'u-admin');
    await page.click('.ps-tab[data-tab="reimburse"]');
    await page.waitForSelector('#ps-rb-new:not(.hidden)');
    assert.match(await page.textContent('#ps-rb-body'), /No categories yet/);
    for (const [name, gl, limit, receipt] of [['Travel', 'A-TRAVEL', '500', true], ['Fuel', 'A-FUEL', '', false]]) {
      await page.click('#ps-rb-new');
      await page.waitForSelector('#ps-rb-form:not(.hidden)');
      await page.fill('#ps-rb-name', name);
      await page.selectOption('#ps-rb-gl', gl);
      await page.fill('#ps-rb-limit', limit);
      await page[receipt ? 'check' : 'uncheck']('#ps-rb-receipt');
      await page.click('#ps-rb-save');
      await page.waitForFunction(n => document.getElementById('ps-rb-form').classList.contains('hidden') && document.getElementById('ps-rb-body').textContent.includes(n), name, { timeout: 30000 });
    }
    assert.match(await page.textContent('#ps-rb-body'), /Fuel\s*6410 — Fuel\s*none\s*Optional\s*60 days\s*RB02[\s\S]*Travel\s*6400 — Travel\s*500\.00\s*Required\s*60 days\s*RB01/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  let C1;
  await check('a claim on the phone: two bills, a receipt photo, the total as typed; sent to the line manager, who approves it in Team', async () => {
    const p = await portal('EMP-0001', 'Sunrise#2026');
    await p.click('a[href="#requests/claim"]');
    await visible(p, '.rc-bill');
    await p.selectOption('.rc-bill:nth-child(1) .rc-cat', { label: 'Travel' });
    assert.match(await p.textContent('.rc-hint'), /A receipt is required\. Monthly limit 500\.00\. Bills up to 60 days old\./);
    await bill(p, 1, 'Travel', 300, 'Taxi to client', ago(3), 'taxi.png');
    await p.click('#rc-add');
    await bill(p, 2, 'Fuel', '120.50', 'Fuel', ago(2));
    assert.equal(await p.textContent('#rc-total'), '420.50');
    await p.click('#rc-submit');
    assert.match(await toast(p, /RC-/), /RC-\d{4}-0001: sent to your line manager\./);
    await until(p, () => /#requests\/view\//.test(location.hash) && /With manager/.test(document.getElementById('req-body').textContent));
    C1 = await p.evaluate(() => location.hash.split('/')[2]);
    assert.match(await p.textContent('#req-body'), /Expense claim[\s\S]*Travel · \d{2}\/\d{2}\/\d{4}[\s\S]*Taxi to client\s*300\.00[\s\S]*taxi\.png[\s\S]*Fuel[\s\S]*120\.50[\s\S]*Total\s*420\.50/);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'fits the phone');
    const s = await portal('EMP-0002', 'Garden#2026');
    await s.click('#bottom-nav a[data-nav="team"]');
    await visible(s, '.tm-claim');
    assert.match(await s.textContent('#page'), /Expense claims[\s\S]*Ali Hassan[\s\S]*420\.50[\s\S]*Travel[\s\S]*Taxi to client[\s\S]*300\.00/);
    await s.click('.tm-claim[data-decision="Approved"]');
    assert.match(await toast(s, /^Approved/), /Approved: sent on for approval\./);
    assert.deepEqual([p.__errors, s.__errors], [[], []]);
    await p.context().close(); await s.context().close();
  });

  await check('the approver in Employee Requests: the bills, the monthly limit flag; approves part with a reason; the claim is approved for payroll', async () => {
    // Ben (no manager): 600 of travel, over the 500 limit, straight to the approver.
    const b = await portal('EMP-0003', 'Harbour#2026');
    await b.click('a[href="#requests/claim"]');
    await visible(b, '.rc-bill');
    await bill(b, 1, 'Travel', 600, 'Flight', ago(4), 'ticket.png');
    await b.click('#rc-submit');
    assert.match(await toast(b, /RC-/), /sent for approval\./);
    await until(b, () => /With approvers/.test(document.getElementById('req-body').textContent));
    const ben = await b.evaluate(() => location.hash.split('/')[2]);
    const page = await erp('EMPREQUESTS', 'u-approver');
    await page.selectOption('#erq-status', '');
    await page.waitForSelector('#erq-body tr[data-id="' + ben + '"]');
    await page.click('#erq-body tr[data-id="' + ben + '"]');
    await page.waitForSelector('#erq-approval:not(.hidden) #erq-ap-ok');
    assert.match(await page.textContent('#erq-facts'), /Travel\s*Flight\s*600\.00\s*600\.00[\s\S]*over the monthly limit \(500\.00\) by 100\.00/);
    await page.fill('.erq-ap-amt[data-i="0"]', '500');
    await page.fill('.erq-ap-note[data-i="0"]', 'Up to the monthly limit');
    await page.click('#erq-ap-ok');
    await page.waitForFunction(() => /Approved — paid with the/.test(document.getElementById('erq-status-badge').textContent), null, { timeout: 30000 });
    assert.match(await page.textContent('#erq-facts'), /Total\s*600\.00\s*500\.00[\s\S]*In the [A-Z][a-z]{2}-\d{4} payroll/);
    assert.deepEqual(page.__errors, []);
    await page.close();
    await b.reload();
    await until(b, () => /approved 500\.00/.test(document.getElementById('req-body') && document.getElementById('req-body').textContent));
    assert.match(await b.textContent('#req-body'), /Approved — paid with the [A-Z][a-z]{2}-\d{4} payroll[\s\S]*Up to the monthly limit[\s\S]*Approved\s*500\.00/);
    assert.deepEqual(b.__errors, []);
    await b.context().close();
  });

  await check('a sick leave with its certificate attached on the phone: approved at once (no manager, no approval); the document in My leave', async () => {
    const b = await portal('EMP-0003', 'Harbour#2026');
    await b.click('a[href="#leave/apply"]');
    await visible(b, '#lv-type');
    await b.selectOption('#lv-type', TYPE.SICK);
    await b.fill('#lv-from', ago(3)); await b.dispatchEvent('#lv-from', 'change');
    await b.fill('#lv-to', ago(2)); await b.dispatchEvent('#lv-to', 'change');
    await visible(b, '#lv-doc-wrap');
    assert.match(await b.textContent('#lv-preview'), /attach it below/);
    await b.setInputFiles('#lv-doc', { name: 'certificate.png', mimeType: 'image/png', buffer: PNG });
    await b.click('#lv-submit');
    assert.match(await toast(b, /LV-/), /LV-\d{4}-\d{4}: Approved\./);
    await until(b, () => location.hash === '#leave/history' && document.querySelector('.lv-row'));
    await b.click('.lv-row');
    assert.match(await b.textContent('.lv-detail'), /certificate\.png/);
    assert.deepEqual(b.__errors, []);
    await b.context().close();
  });

  await browser.close();
  server.close();
  await app.delete();
  results.forEach(r => console.log(r.join(' — ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
