// A leaver's clearance (docs/modules/LEAVER_CLEARANCE.md) in headless
// Chromium against the emulators: the Clearances list and one clearance,
// a step ticked and signed off (the next one opening), the set-up with a
// step added; the leaver's read-only card in the Employee Portal.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/clearance.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, PROJECT } = require('../emulator/_helpers');
const { portalPage, portalContext, AUTH } = require('./_essPage');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

let ALI, aliUid;
(async () => {
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = baseFixture();
  f.permissions.EMPLOYEES.portal = ['Admin'];
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Clerk' } })).designationId;
  ALI = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', Gender: 'Male', CompanyID: 'C1', JoinDate: '2024-01-01', DesignationID: des, GradeID: g, CostCenterID: 'CC1' } })).employeeId;
  await call('u-admin', 'manageEssAccounts', { action: 'enable', employeeIds: [ALI] });
  aliUid = (await (await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'emp-0001@ess.invalid', password: 'alih0001', returnSecureToken: true }) })).json()).localId;
  await call(aliUid, 'essPortal', { action: 'changePassword', newPassword: 'Garden#2026' });
  const e = (await firestore.collection('employees').doc(ALI).get()).data();
  const reason = (await call('u-admin', 'leavingReasonSetup', { action: 'list' })).reasons.find(r => r.Name === 'Relocation').ReasonID;
  await call('u-admin', 'saveEmployee', { employee: Object.assign({}, e, { EmployeeID: ALI, Status: 'On notice', LeavingDate: '2026-12-31', LeavingReasonID: reason }) });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const ess = portalPage();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/ess.html') ? ess : harness); }).listen(8132);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.__dialogs = [];
    page.on('pageerror', x => page.__errors.push(x.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8132/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };
  const stepState = page => page.evaluate(() => [...document.querySelectorAll('.clr-step')].map(b => b.dataset.step + ':' + b.querySelector('.clr-state').textContent.trim()));

  await check('the list and one clearance: Finance ticked and signed off; IT then opens', async () => {
    const page = await open('CLEARANCE', 'u-admin');
    await page.waitForSelector('#clr-body tr[data-id]', { timeout: 30000 });
    assert.match(await page.innerText('#clr-body'), /Ali Hassan[\s\S]*31\/12\/2026[\s\S]*Finance[\s\S]*0 of 3 signed[\s\S]*Open/);
    await page.click('#clr-body tr[data-id]');
    await page.waitForSelector('.clr-step', { timeout: 30000 });
    assert.deepEqual(await stepState(page), ['finance:Open', 'it:Waiting for the steps before', 'hr:Waiting for the steps before']);
    const fin = page.locator('.clr-step[data-step="finance"]');
    for (const box of await fin.locator('.clr-item').all()) await box.check();
    await fin.locator('.clr-notes').fill('Loan balance nil.');
    await fin.locator('.clr-sign').click();
    await page.waitForFunction(() => /Signed/.test(document.querySelector('.clr-step[data-step="finance"] .clr-state').textContent), null, { timeout: 30000 });
    assert.deepEqual((await stepState(page)).slice(0, 2), ['finance:Signed', 'it:Open']);
    assert.match(await page.textContent('#clr-progress'), /1 of 3 signed/);
    assert.match(await page.innerText('#clr-history'), /Finance signed off/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the set-up: the default steps shown; a step added and saved', async () => {
    const page = await open('CLEARANCE', 'u-admin');
    await page.click('#clr-tab-setup');
    await page.waitForSelector('.clr-sstep', { timeout: 30000 });
    assert.ok(await page.isVisible('#clr-default-note'));
    assert.deepEqual(await page.$$eval('.clr-sname', x => x.map(i => i.value)), ['Finance', 'IT', 'HR']);
    await page.click('#clr-add-step');
    await page.locator('.clr-sname').last().fill('Admin');
    await page.locator('.clr-slist').last().fill('Car keys returned\nParking card returned');
    await page.click('#clr-save-setup');
    await page.waitForFunction(() => document.getElementById('clr-default-note').classList.contains('hidden'), null, { timeout: 30000 });
    const s = (await call('u-admin', 'getClearanceSetup', { companyId: 'C1' })).setup;
    assert.deepEqual(s.Steps.map(x => [x.Name, x.Checklist.length]), [['Finance', 3], ['IT', 4], ['HR', 2], ['Admin', 2]]);
    assert.ok(page.__dialogs.some(m => /Saved/.test(m)));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the leaver\'s portal: the clearance card, read only, with what is still open', async () => {
    const ctx = await portalContext(browser, {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', x => errors.push(x.message));
    await page.goto('http://127.0.0.1:8132/ess.html?uid=' + aliUid);
    await page.waitForSelector('#home-clearance', { timeout: 30000 });
    const text = await page.innerText('#home-clearance');
    assert.match(text, /Your clearance before leaving[\s\S]*1 of 3 signed/);
    assert.match(text, /Finance[\s\S]*Done[\s\S]*IT[\s\S]*In progress[\s\S]*Still open: Laptop returned, Phone returned, Access card returned, Email and system access closed[\s\S]*HR[\s\S]*Waiting/);
    assert.doesNotMatch(text, /Loan balance nil/, 'never the notes');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await browser.close(); server.close(); await app.delete();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
