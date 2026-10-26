// Employee requests of any type (docs/modules/EMPLOYEE_REQUEST_TYPES.md) in
// headless Chromium against the emulators: HR sets up a type in Employee
// Requests → Types; the employee raises one from the portal's form (the
// type's fields); the line manager approves it in Team; HR sees the answers,
// the due date, and resolves it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/requestTypes.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, PROJECT } = require('../emulator/_helpers');
const { portalPage, portalContext, AUTH } = require('./_essPage');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

const UID = {};
async function portalUser(code, pw, newPw) {
  const res = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: code.toLowerCase() + '@ess.invalid', password: pw, returnSecureToken: true }) });
  const uid = (await res.json()).localId;
  await call(uid, 'essPortal', { action: 'changePassword', newPassword: newPw });
  return uid;
}

(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  f.permissions.EMPREQUESTS = { access: ['Admin', 'Viewer'], handle: ['Admin'], setup: ['Admin'] };
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk' } })).designationId;
  const emp = e => call('u-admin', 'saveEmployee', { employee: Object.assign({ CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1', Gender: 'Male' }, e) }).then(r => r.employeeId);
  const ALI = await emp({ FullName: 'Ali Hassan' });
  const SARA = await emp({ FullName: 'Sara Khan', Gender: 'Female' });
  await call('u-admin', 'saveEmployee', { employee: Object.assign((await call('u-admin', 'getEmployee', { employeeId: ALI })).employee, { ManagerID: SARA }) });
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI, SARA] });
  UID.ALI = await portalUser('EMP-0001', 'alih0001', 'Sunrise#2026');
  UID.SARA = await portalUser('EMP-0002', 'sara0002', 'Garden#2026');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8133);
  const browser = await chromium.launch();
  async function erp(uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__answers = []; page.__dialogs = [];
    page.on('pageerror', x => page.__errors.push(x.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? page.__answers.shift() : undefined); });
    await page.goto('http://127.0.0.1:8133/?module=EMPREQUESTS&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    return page;
  }
  async function portal(uid, hash) {
    const ctx = await portalContext(browser, {});
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', x => page.__errors.push(x.message));
    await page.goto('http://127.0.0.1:8133/ess.html?uid=' + uid + (hash ? '#' + hash : ''));
    return { ctx, page };
  }
  let RQ = '';

  await check('Types: HR sets up a salary certificate with its fields, to the line manager first, answered in 3 days with a document', async () => {
    const page = await erp('u-admin');
    await page.click('#erq-tab-types');
    await page.waitForSelector('#erq-t-new:not(.hidden)', { timeout: 30000 });
    await page.click('#erq-t-new');
    await page.fill('#erq-t-name', 'Salary certificate');
    await page.fill('#erq-t-desc', 'For a bank or an embassy.');
    await page.selectOption('#erq-t-route', 'Manager');
    await page.fill('#erq-t-days', '3');
    await page.check('#erq-t-doc');
    for (let i = 0; i < 2; i++) await page.click('#erq-t-add');
    const rows = page.locator('.erq-t-field');
    await rows.nth(0).locator('.erq-tf-label').fill('Addressed to');
    await rows.nth(0).locator('.erq-tf-req').check();
    await rows.nth(1).locator('.erq-tf-label').fill('Purpose');
    await rows.nth(1).locator('.erq-tf-kind').selectOption('choice');
    await rows.nth(1).locator('.erq-tf-options').fill('Bank loan, Visa, Other');
    await page.click('#erq-t-save');
    await page.waitForFunction(() => /Salary certificate/.test(document.getElementById('erq-t-body').textContent), null, { timeout: 30000 });
    assert.match(await page.innerText('#erq-t-body'), /Salary certificate \(a document\)\s+Line manager, then handler\s+3 days\s+Addressed to, Purpose\s+Active/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the portal: Requests → Other → the type\'s form; sent to the line manager', async () => {
    const { ctx, page } = await portal(UID.ALI, 'requests/other');
    await page.waitForSelector('.rq-type', { timeout: 30000 });
    await page.click('.rq-type');
    await page.waitForSelector('#rqt-form', { timeout: 30000 });
    assert.match(await page.innerText('#rqt-form'), /Goes to your line manager, then HR\. HR answers within 3 days\. HR sends the document here/);
    await page.fill('#rqt-f-0', 'National Bank');
    await page.selectOption('#rqt-f-1', 'Bank loan');
    await page.click('#rqt-submit');
    await page.waitForFunction(() => /#requests\/view\//.test(location.hash), null, { timeout: 30000 });
    await page.waitForFunction(() => /National Bank/.test(document.body.innerText), null, { timeout: 30000 });
    const text = await page.innerText('#page');
    assert.match(text, /Salary certificate\s+RQ-\d{4}-0001/);
    assert.match(text, /Addressed to\s+National Bank[\s\S]*Purpose\s+Bank loan/);
    assert.match(text, /With the line manager/);
    RQ = (await firestore.collection('employeeRequests').where('Type', '==', 'Custom').get()).docs[0].id;
    assert.deepEqual(page.__errors, []);
    await ctx.close();
  });

  await check('Team: the line manager approves it; on to HR', async () => {
    const { ctx, page } = await portal(UID.SARA, 'team');
    await page.waitForSelector('#tm-reqs', { timeout: 30000 });
    assert.match(await page.innerText('#tm-reqs'), /Ali Hassan[\s\S]*Salary certificate[\s\S]*Addressed to\s+National Bank/);
    await page.click('#tm-reqs .tm-req[data-decision="Approved"]');
    await page.waitForFunction(() => !document.getElementById('tm-reqs'), null, { timeout: 30000 });
    assert.equal((await firestore.collection('employeeRequests').doc(RQ).get()).data().Status, 'New');
    assert.deepEqual(page.__errors, []);
    await ctx.close();
  });

  await check('Employee Requests: the answers and when it is due; resolving asks for the document first', async () => {
    const page = await erp('u-admin');
    await page.waitForSelector('#erq-body tr[data-id]', { timeout: 30000 });
    assert.match(await page.innerText('#erq-body'), /Request: Salary certificate/);
    await page.click('#erq-body tr[data-id="' + RQ + '"]');
    await page.waitForSelector('#erq-detail:not(.hidden)', { timeout: 30000 });
    const facts = await page.innerText('#erq-facts');
    assert.match(facts, /Type\s+Salary certificate[\s\S]*Addressed to\s+National Bank[\s\S]*Purpose\s+Bank loan[\s\S]*Line manager\s+Sara Khan[\s\S]*Answer by\s+\d{2}\/\d{2}\/\d{4}[\s\S]*Answer\s+a document/);
    assert.ok(await page.isVisible('#erq-resolve'));
    page.__answers.push('Certificate issued.');
    await page.click('#erq-resolve');
    for (let i = 0; i < 60 && !page.__dialogs.some(m => /Attach the document/.test(m)); i++) await page.waitForTimeout(250);
    assert.ok(page.__dialogs.some(m => /Attach the document/.test(m)), 'told why: ' + page.__dialogs.join(' | '));
    assert.equal((await firestore.collection('employeeRequests').doc(RQ).get()).data().Status, 'New', 'refused: no document yet');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
