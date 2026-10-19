// Employee Portal step 2 on a phone and in the ERP (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md, decisions 96-105): a payroll query raised
// from the payslip ("Something wrong?") with a line ticked and a photo; HR
// answers in Employee Requests (a reply, an internal note, resolve); the
// employee sees the reply (badge), the outcome and may reopen; an advance
// asked for with its limit shown live, approved by the line manager in Team,
// reviewed by HR in Loans & Advances; the handlers tab; the loan type's
// limits in Payroll Setup.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/essRequests.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, PROJECT } = require('../emulator/_helpers');
const { portalPage, portalContext, AUTH } = require('./_essPage');

const results = [];
function check(name, fn) {
  return fn().then(() => { results.push(['PASS', name]); }, e => {
    results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300) + (e.stack ? ' @ ' + e.stack.split('\n').filter(l => l.includes('essRequests.ui.js')).map(l => l.trim().replace(/^.*essRequests\.ui\.js:/, '')).join(' < ') : '')]);
  });
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a9b10000000049454e44ae426082', 'hex');

let ALI, SARA, JULY, ADV;
(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  f.permissions.EMPREQUESTS = { access: ['Admin'], handle: ['Admin'], setup: ['Admin'] };
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from Employees', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-LOAN': { AccountCode: '1260', AccountName: 'Employee Loans', AccountType: 'Asset', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1', Gender: 'Male' }, e) }).then(r => r.employeeId);
  ALI = await emp({ FullName: 'Ali Hassan' });
  SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  const EL = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 6000 }, { ElementID: EL.HRA, Amount: 1500 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: SARA, compensation: { Lines: [{ ElementID: EL.BASIC, Amount: 9000 }] } });
  for (const id of [EL.BASIC, EL.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  JULY = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: JULY });
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI, SARA] });
  const signIn = async (code, pw) => (await (await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: code.toLowerCase() + '@ess.invalid', password: pw, returnSecureToken: true }) })).json()).localId;
  for (const [code, pw, np] of [['EMP-0001', 'alih0001', 'Sunrise#2026'], ['EMP-0002', 'sara0002', 'Garden#2026']]) await call(await signIn(code, pw), 'essPortal', { action: 'changePassword', newPassword: np });
  ADV = (await call('u-admin', 'saveLoanType', { loanType: { Name: 'Salary Advance', Kind: 'Advance', GLAccountID: 'A-LOAN', MaxMonths: 1, MaxBasis: 'Basic', OneOpen: true } })).loanTypeId;
  // The emulator starts each function on its first call: start them before the browser times them.
  for (const a of ['list', 'tasks', 'handlers']) await call('u-admin', 'employeeRequests', { action: a }).catch(() => {});
  for (const n of ['getLoanForm', 'getLoans', 'getAttachments', 'getLoanTypes', 'getPayrollSetup']) await call('u-admin', n, {}).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8189);
  const browser = await chromium.launch();
  const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const visible = (p, sel) => until(p, s => { const e = document.querySelector(s); return e && e.offsetParent !== null; }, sel);
  const toast = (p, re) => until(p, src => { const t = document.getElementById('ess-toast'); return !t.classList.contains('hidden') && new RegExp(src).test(t.textContent); }, re.source).then(() => p.textContent('#ess-toast'));
  const answer = async (p, ok, text) => {
    await visible(p, '#ess-dialog-ok');
    if (text !== undefined) await p.fill('#ess-dialog-input', text);
    await p.click(ok ? '#ess-dialog-ok' : '#ess-dialog-cancel');
    await until(p, () => document.getElementById('ess-dialog').classList.contains('hidden'));
  };
  async function portal(code, pw) {
    const ctx = await portalContext(browser);
    const p = await ctx.newPage();
    p.__errors = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    p.on('dialog', d => { p.__errors.push('browser popup: ' + d.message()); d.dismiss().catch(() => {}); });
    await p.goto('http://127.0.0.1:8189/ess.html');
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
    await page.goto('http://127.0.0.1:8189/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }

  let QID;
  await check('a payroll query from the payslip: "Something wrong?", the month already chosen, a line ticked, a photo; sent to HR', async () => {
    const p = await portal('EMP-0001', 'Sunrise#2026');
    assert.deepEqual(await p.$$eval('#bottom-nav a', a => a.map(x => x.textContent.trim())), ['Home', 'Leave', 'Pay', 'Requests', 'Me']);
    await p.click('#bottom-nav a[data-nav="pay"]');
    await visible(p, '.ps-open');
    await p.click('.ps-open');
    await visible(p, '#slip-query');
    await p.click('#slip-query');
    await visible(p, '#pq-run');
    assert.equal(await p.inputValue('#pq-run'), JULY);
    await until(p, () => document.querySelectorAll('.pq-line').length === 2);
    assert.match(await p.textContent('#pq-lines'), /Basic Salary\s*earning\s*6,000\.00[\s\S]*Housing Allowance/);
    await p.selectOption('#pq-cat', 'Deduction');
    await p.check('.pq-line[value="0"]');
    await p.fill('#pq-expected', '6300');
    await p.fill('#pq-desc', 'My basic looks short by 300.');
    await p.setInputFiles('#pq-files', { name: 'payslip-photo.png', mimeType: 'image/png', buffer: PNG });
    assert.equal(await p.textContent('#pq-files-label'), '1 file chosen');
    await p.click('#pq-submit');
    assert.match(await toast(p, /PQ-/), /PQ-2026-0001: sent to HR/);
    await until(p, () => /#requests\/view\//.test(location.hash) && document.querySelector('.rq-file'));
    QID = await p.evaluate(() => location.hash.split('/')[2]);
    assert.match(await p.textContent('#req-body'), /Pay query\s*PQ-2026-0001[\s\S]*New[\s\S]*Jul-2026[\s\S]*Deduction[\s\S]*Basic Salary\s*6,000\.00[\s\S]*Expected\s*6,300\.00[\s\S]*payslip-photo\.png/);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'fits the phone');
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('HR in Employee Requests: the query waiting, its photo; an internal note, a reply; resolved with the outcome', async () => {
    const page = await erp('EMPREQUESTS', 'u-admin', ['Corrected: 300 refunded in the September payroll.']);
    await page.waitForSelector('#erq-body tr[data-id]');
    assert.match(await page.textContent('#erq-body'), /PQ-2026-0001\s*Ali Hassan\s*EMP-0001\s*Test Co One \(01\)\s*Query: Deduction · Jul-2026\s*New/);
    await page.click('#erq-body tr[data-id]');
    await page.waitForSelector('#erq-detail:not(.hidden)');
    assert.match(await page.textContent('#erq-facts'), /Company\s*Test Co One \(01\)/, 'the company by name (owner, 2026-10-10)');
    assert.match(await page.textContent('#erq-facts'), /Payslip\s*Jul-2026[\s\S]*Basic Salary \(earning\)\s*6,000\.00[\s\S]*Expected\s*6,300\.00[\s\S]*My basic looks short by 300\./);
    await page.waitForFunction(() => /payslip-photo\.png/.test((document.querySelector('.supdocs') || {}).textContent), null, { timeout: 30000 });
    await page.fill('#erq-text', 'Check the attendance for 13 July.');
    await page.click('#erq-note');
    await page.waitForFunction(() => /internal note/.test(document.getElementById('erq-msgs').textContent), null, { timeout: 30000 });
    await page.fill('#erq-text', 'Thanks Ali, we are checking.');
    await page.click('#erq-reply');
    await page.waitForFunction(() => /we are checking/.test(document.getElementById('erq-msgs').textContent), null, { timeout: 30000 });
    assert.equal(await page.textContent('#erq-status-badge'), 'In progress');
    await page.click('#erq-resolve');
    await page.waitForFunction(() => document.getElementById('erq-status-badge').textContent === 'Resolved', null, { timeout: 30000 });
    assert.ok(await page.isHidden('#erq-compose'), 'closed');
    assert.match(page.__dialogs.join(' | '), /Resolve PQ-2026-0001\. What was done\?/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the employee: the reply badge and Home card, the reply but not the note, the outcome; reopen asks why', async () => {
    const p = await portal('EMP-0001', 'Sunrise#2026');
    await visible(p, '#home-replies');
    assert.match(await p.textContent('#home-replies'), /A request has a new reply from HR/);
    assert.equal(await p.textContent('#bottom-nav a[data-nav="requests"] .ess-req-badge'), '1');
    await p.click('#home-replies');
    await visible(p, '.req-row');
    await p.click('.req-row');
    await visible(p, '#rq-msgs');
    const txt = await p.textContent('#req-body');
    assert.match(txt, /Resolved[\s\S]*Corrected: 300 refunded in the September payroll\./);
    assert.match(await p.textContent('#rq-msgs'), /Thanks Ali, we are checking\./);
    assert.doesNotMatch(txt, /attendance for 13 July/, 'internal notes stay internal');
    assert.ok(!(await p.$('#rq-text')), 'closed: no reply box');
    await p.click('#rq-reopen');
    await answer(p, false);
    // The file opens (downloaded by the browser).
    await p.click('.rq-file');
    await until(p, () => window.__lastDownload === 'payslip-photo.png');
    await p.click('#bottom-nav a[data-nav="home"]');
    await visible(p, '#home-leave-left');
    assert.equal(await p.$('#home-replies'), null, 'read');
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  await check('a query: the employee marks it resolved, or withdraws it giving a reason, at any time while open (owner, 2026-10-14)', async () => {
    const p = await portal('EMP-0001', 'Sunrise#2026');
    await p.click('#bottom-nav a[data-nav="requests"]');
    await visible(p, '.req-row');
    await p.click('.req-row');
    await visible(p, '#rq-reopen');
    assert.equal(await p.$('#rq-resolved'), null, 'closed: nothing to mark');
    await p.click('#rq-reopen');
    await answer(p, true, 'Still not in my account.');
    await toast(p, /Reopened/);
    await visible(p, '#rq-resolved');
    await p.click('#rq-resolved');
    await answer(p, true, 'Received today.');
    await toast(p, /Marked resolved/);
    await until(p, () => /Marked resolved by the employee: Received today\./.test(document.getElementById('req-body').textContent));
    // Reopened again, then withdrawn: the reason is required.
    await p.click('#rq-reopen');
    await answer(p, true, 'One more question.');
    await toast(p, /Reopened/);
    await visible(p, '#rq-withdraw');
    await p.click('#rq-withdraw');
    await visible(p, '#ess-dialog-ok');
    await p.click('#ess-dialog-ok');
    assert.equal(await p.$eval('#ess-dialog', d => d.classList.contains('hidden')), false, 'no reason: the box stays open');
    await answer(p, true, 'Asked my manager instead.');
    await toast(p, /Withdrawn/);
    assert.deepEqual(p.__errors, []);
    await p.context().close();
  });

  let LR;
  await check('an advance: the limit shown live and an amount over it flagged; sent to the line manager, who approves it in Team', async () => {
    const p = await portal('EMP-0001', 'Sunrise#2026');
    await p.click('a[href="#requests/loan"]');
    await visible(p, '#lr-type');
    await p.selectOption('#lr-type', ADV);
    assert.match(await p.textContent('#lr-limit'), /Up to 1 month's basic salary: 6,000\.00[\s\S]*recovered whole in one payroll/);
    assert.ok(await p.isHidden('#lr-loan'), 'no instalments for an advance');
    await p.fill('#lr-amount', '6500');
    await until(p, () => /font-semibold/.test(document.querySelector('#lr-limit div').className));
    await p.fill('#lr-amount', '5000');
    await p.fill('#lr-reason', 'School fees');
    await p.click('#lr-submit');
    assert.match(await toast(p, /LR-/), /LR-2026-0001: sent to your line manager\./);
    await until(p, () => /With manager/.test(document.getElementById('req-body').textContent));
    LR = await p.evaluate(() => location.hash.split('/')[2]);
    const s = await portal('EMP-0002', 'Garden#2026');
    assert.equal(await s.textContent('#bottom-nav a[data-nav="team"] .ess-team-badge'), '1');
    await s.click('#bottom-nav a[data-nav="team"]');
    await visible(s, '.tm-loan');
    assert.match(await s.textContent('#page'), /Advance and loan requests[\s\S]*Ali Hassan[\s\S]*Salary Advance · 5,000\.00[\s\S]*Recovered in [A-Z][a-z]{2}-\d{4} · LR-2026-0001[\s\S]*School fees/);
    await s.click('.tm-loan[data-decision="Approved"]');
    assert.equal(await toast(s, /^Approved/), 'Approved: sent on to HR.');
    await p.reload();
    await until(p, () => /With HR/.test(document.getElementById('req-body') && document.getElementById('req-body').textContent));
    assert.deepEqual([p.__errors, s.__errors], [[], []]);
    await p.context().close(); await s.context().close();
  });

  await check('HR reviews the advance in Loans & Advances (a draft filled from the request); the handlers tab', async () => {
    const page = await erp('EMPREQUESTS', 'u-admin');
    await page.waitForSelector('#erq-body tr[data-id="' + LR + '"]');
    await page.click('#erq-body tr[data-id="' + LR + '"]');
    await page.waitForSelector('.erq-go[data-go="draft"]');
    assert.match(await page.textContent('#erq-facts'), /Salary Advance[\s\S]*5,000\.00[\s\S]*Sara Khan \(approved\)[\s\S]*School fees/);
    await page.click('.erq-go[data-go="draft"]');
    await page.waitForFunction(() => window.__moduleReady === true && /Requested in the Employee Portal, LR-2026-0001/.test(document.getElementById('module-container').innerHTML + Array.from(document.querySelectorAll('input,textarea')).map(x => x.value).join(' ')), null, { timeout: 30000 });
    assert.deepEqual(page.__errors, []);
    await page.close();
    // Handlers: set by "setup" for a company and category.
    const h = await erp('EMPREQUESTS', 'u-admin');
    await h.click('#erq-tab-handlers');
    await h.waitForSelector('#erq-handlers-view:not(.hidden)');
    assert.match(await h.textContent('#erq-h-body'), /No handlers yet/);
    await h.selectOption('#erq-h-co', 'C1');
    await h.selectOption('#erq-h-cat', 'Loan / advance');
    await h.selectOption('#erq-h-user', 'u-approver');
    await h.selectOption('#erq-h-backup', 'u-admin');
    await h.click('#erq-h-save');
    await h.waitForFunction(() => /Test Co One \(01\)\s*Loan \/ advance\s*Approver\s*Admin User/.test(document.getElementById('erq-h-body').textContent), null, { timeout: 30000 });
    assert.equal(await h.$eval('#erq-h-co option[value="C1"]', o => o.textContent), 'Test Co One (01)');
    assert.deepEqual(h.__errors, []);
    await h.close();
  });

  await check('Payroll Setup → Loans: the request limits of a loan type, saved', async () => {
    const page = await erp('PAYROLLSETUP', 'u-admin');
    await page.click('.ps-tab[data-tab="loans"]');
    await page.waitForSelector('#ps-lt-body tr[data-id="' + ADV + '"]');
    await page.click('#ps-lt-body tr[data-id="' + ADV + '"]');
    await page.waitForSelector('#ps-lt-form:not(.hidden)');
    assert.equal(await page.inputValue('#ps-lt-maxmonths'), '1');
    assert.ok(await page.isChecked('#ps-lt-oneopen'));
    assert.ok(await page.isHidden('#ps-lt-maxinst-wrap'), 'an advance has no instalments');
    await page.fill('#ps-lt-maxmonths', '1.5');
    await page.selectOption('#ps-lt-basis', 'Gross');
    await page.check('#ps-lt-probation');
    await page.click('#ps-lt-save');
    await page.waitForFunction(() => document.getElementById('ps-lt-form').classList.contains('hidden'), null, { timeout: 30000 });
    const t = (await call('u-admin', 'getLoanTypes', {})).types.find(x => x.LoanTypeID === ADV);
    assert.deepEqual([t.MaxMonths, t.MaxBasis, t.AfterProbation, t.OneOpen, t.MaxInstalments], [1.5, 'Gross', true, true, null]);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close();
  server.close();
  await app.delete();
  results.forEach(r => console.log(r.join(' — ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
