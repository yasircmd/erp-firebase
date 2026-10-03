// HR: Employee Records, step 1 (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md):
// HR Setup (grade with a company pay band, designation, a compulsory extra
// field), a new employee, Correct with a reason, line manager, direct
// reports, Replace manager, and the view-only user.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/hrEmployees.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Finance', Status: 'Active', CompanyID: 'C1' };
  f.permissions.DOCUMENTSTORAGE.access = ['Admin'];
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Name: 'Officer', Level: 3 } })).gradeId;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8165);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(page.__answer || '') : d.accept(); });
    await page.goto('http://127.0.0.1:8165/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }

  await check('HR Setup: a grade with a company pay band, a designation, a compulsory extra field', async () => {
    const p = await open('HRSETUP', 'u-admin');
    await p.waitForSelector('#hs-grades-body tr[data-id]', { timeout: 30000 });
    await p.click('#hs-grade-new');
    await p.fill('#hs-grade-code', 'G5'); await p.fill('#hs-grade-name', 'Senior Officer'); await p.fill('#hs-grade-level', '5');
    await p.fill('.hs-band[data-co="C1"][data-k="Min"]', '8000'); await p.fill('.hs-band[data-co="C1"][data-k="Mid"]', '10000'); await p.fill('.hs-band[data-co="C1"][data-k="Max"]', '12000');
    await p.click('#hs-grade-save');
    await p.waitForFunction(() => /G5[\s\S]*8,000\.00 \/ 10,000\.00 \/ 12,000\.00/.test(document.getElementById('hs-grades-body').textContent), null, { timeout: 15000 });
    await p.click('.hs-tab[data-tab="designations"]');
    await p.click('#hs-des-new');
    await p.fill('#hs-des-title', 'Accountant');
    await p.selectOption('#hs-des-from', { label: 'G3 — Officer' }); await p.selectOption('#hs-des-to', { label: 'G5 — Senior Officer' });
    await p.click('#hs-des-save');
    await p.waitForFunction(() => /Accountant\s*G3 – G5/.test(document.getElementById('hs-des-body').textContent), null, { timeout: 15000 });
    await p.click('.hs-tab[data-tab="fields"]');
    await p.click('#hs-field-new');
    await p.fill('#hs-field-label', 'Emirates ID no.');
    await p.selectOption('#hs-field-section', 'Personal');
    await p.check('#hs-field-required'); await p.check('#hs-field-sensitive');
    await p.click('#hs-field-save');
    await p.waitForFunction(() => /Emirates ID no\./.test(document.getElementById('hs-fields-body').textContent), null, { timeout: 15000 });
    await p.click('.hs-tab[data-tab="doctypes"]');
    assert.match(await p.textContent('#hs-dt-body'), /Passport[\s\S]*Emirates ID[\s\S]*Labour Card/);
    // Pay Elements (step 3): six to start; a new one.
    await p.click('.hs-tab[data-tab="elements"]');
    assert.match(await p.textContent('#hs-el-body'), /BASIC\s*Basic Salary[\s\S]*Basic[\s\S]*COMM\s*Commission/);
    await p.click('#hs-el-new');
    await p.fill('#hs-el-code', 'SHIFT'); await p.fill('#hs-el-name', 'Shift Allowance');
    await p.click('#hs-el-save');
    await p.waitForFunction(() => /SHIFT\s*Shift Allowance/.test(document.getElementById('hs-el-body').textContent), null, { timeout: 15000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  const page = await open('EMPLOYEES', 'u-admin');
  await page.waitForFunction(() => !document.getElementById('emp-new-btn').classList.contains('hidden'), null, { timeout: 30000 });
  async function addEmployee(name, managerLabel) {
    await page.click('#emp-new-btn');
    await page.fill('[data-k="FullName"]', name);
    await page.fill('[data-k="JoinDate"]', '2024-03-01');
    await page.selectOption('#emp-form-designation', { label: 'Accountant' });
    await page.selectOption('#emp-form-grade', { label: 'G5 — Senior Officer' });
    await page.selectOption('[data-k="CostCenterID"]', { label: 'CC1 — Workshop' });
    if (managerLabel) await page.selectOption('#emp-form-manager', { label: managerLabel });
    await page.fill('[data-k="IBAN"]', 'AE07 0331 2345 6789 0123 456');
    await page.fill('.emp-cf', '784-' + name.length);
    await page.click('#emp-save-btn');
    await page.waitForFunction(n => document.getElementById('emp-heading').textContent.endsWith(n), name, { timeout: 15000 });
  }

  await check('a new employee: the compulsory extra field, then the number EMP-0001; job fields locked after creation', async () => {
    await page.click('#emp-new-btn');
    await page.fill('[data-k="FullName"]', 'Omar Boss');
    await page.click('#emp-save-btn');
    await page.waitForFunction(() => /Enter the date of joining|Choose the/.test(document.getElementById('emp-error').textContent), null, { timeout: 10000 });
    await page.click('#emp-back-btn');
    await addEmployee('Omar Boss');
    assert.equal(await page.textContent('#emp-heading'), 'EMP-0001 — Omar Boss');
    assert.equal(await page.isDisabled('#emp-form-grade'), true);
    assert.equal(await page.isDisabled('[data-k="Mobile"]'), false);
    assert.match(await page.textContent('#emp-history'), /Create/);
    assert.equal(await page.inputValue('[data-k="IBAN"]'), 'AE070331234567890123456');
  });

  await check('Correct: the grade, with a reason, kept in the history', async () => {
    await page.click('#emp-correct-btn');
    assert.equal(await page.isDisabled('#emp-form-grade'), false);
    await page.selectOption('#emp-form-grade', { label: 'G3 — Officer' });
    page.__answer = 'Entered the wrong grade';
    await page.click('#emp-save-btn');
    await page.waitForFunction(() => /Correction — Entered the wrong grade[\s\S]*Grade: G5 → G3/.test(document.getElementById('emp-history').textContent), null, { timeout: 15000 });
    assert.equal(await page.isDisabled('#emp-form-grade'), true);
  });

  await check('line manager, direct reports, Replace manager', async () => {
    await page.click('#emp-back-btn');
    await addEmployee('Rami', 'EMP-0001 — Omar Boss');
    await page.click('#emp-back-btn');
    await addEmployee('Rana', 'EMP-0001 — Omar Boss');
    await page.click('#emp-back-btn');
    await page.waitForFunction(() => /Omar Boss\s*2 direct reports/.test(document.getElementById('emp-table-body').textContent), null, { timeout: 15000 });
    await page.click('#emp-table-body tr:has-text("Omar Boss")');
    await page.waitForFunction(() => document.querySelectorAll('#emp-reports li').length === 2, null, { timeout: 15000 });
    await page.click('#emp-back-btn');
    await page.click('#emp-replace-btn');
    await page.selectOption('#emp-replace-from', { label: 'EMP-0001 — Omar Boss (2)' });
    await page.selectOption('#emp-replace-to', { label: 'EMP-0003 — Rana' });
    await page.fill('#emp-replace-reason', 'Rana leads the team');
    page.__dialogs.length = 0;
    await page.click('#emp-replace-go');
    await page.waitForFunction(() => /Rami[\s\S]*Rana/.test(document.getElementById('emp-table-body').textContent), null, { timeout: 15000 });
    await page.waitForFunction(() => /Rana\s*1 direct report/.test(document.getElementById('emp-table-body').textContent), null, { timeout: 15000 });
    assert.deepEqual(page.__dialogs, ['Move all 2 direct reports of Omar Boss to Rana?', '2 employees now report to Rana.']);
    const rami = await page.textContent('#emp-table-body tr:has-text("Rami")');
    assert.match(rami, /Rana/);
    assert.deepEqual(page.__errors, []);
  });

  await check('documents (step 2): a passport with its scan, expiring soon; renew; remove with a reason', async () => {
    await page.click('#emp-table-body tr:has-text("Rami")');
    await page.waitForSelector('#emp-docs-wrap:not(.hidden) #emp-doc-new:not(.hidden)', { timeout: 15000 });
    await page.click('#emp-doc-new');
    await page.selectOption('#emp-doc-type', { label: 'Passport' });
    await page.click('#emp-doc-save');
    await page.waitForFunction(() => /Enter the Passport number/.test(document.getElementById('emp-doc-error').textContent), null, { timeout: 10000 });
    const T = todayIn('Asia/Dubai');
    await page.fill('#emp-doc-number', 'P123');
    await page.fill('#emp-doc-expiry', addDays(T, 45));
    await page.click('#emp-doc-save');
    await page.waitForFunction(() => /Passport\s*P123[\s\S]*Expiring \(45 days\)/.test(document.getElementById('emp-docs-body').textContent), null, { timeout: 15000 });
    const files = '.supdocs[data-module="EMPDOCS"]';
    await page.waitForSelector(files + ' .supdocs-add:not(.hidden):not([disabled])', { timeout: 15000 });
    await page.setInputFiles(files + ' .supdocs-input', [{ name: 'passport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% scan\n') }]);
    await page.waitForFunction(s => document.querySelectorAll(s + ' .supdocs-list li').length === 1, files, { timeout: 15000 });
    assert.equal(await page.isVisible('#emp-save-btn'), true);
    await page.click('#emp-doc-renew');
    await page.fill('#emp-doc-number', 'P999');
    await page.fill('#emp-doc-expiry', addDays(T, 3650));
    await page.click('#emp-doc-save');
    await page.waitForFunction(() => /P999[\s\S]*Active/.test(document.getElementById('emp-docs-body').textContent) && /P123[\s\S]*Renewed/.test(document.getElementById('emp-docs-body').textContent), null, { timeout: 15000 });
    page.__answer = 'Lost; replaced';
    await page.click('#emp-doc-remove');
    await page.waitForFunction(() => /Removed by .*: Lost; replaced/.test(document.getElementById('emp-doc-note').textContent), null, { timeout: 15000 });
    await page.click('#emp-back-btn');
    assert.deepEqual(page.__errors, []);
  });

  await check('pay (step 3): set with monthly amounts and a commission term; below the band warns; Correct keeps the old version', async () => {
    await page.click('#emp-table-body tr:has-text("Rami")');
    await page.waitForSelector('#emp-pay-wrap:not(.hidden) #emp-pay-set:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#emp-pay-current'), /No pay set yet/);
    await page.click('#emp-pay-set');
    await page.fill('.emp-pay-amount[data-el="pe-basic"]', '7000');
    await page.fill('.emp-pay-amount[data-el="pe-hra"]', '2500');
    const comm = '.emp-pay-term[data-el="pe-comm"]';
    await page.selectOption(comm + ' .t-basis', 'Percent'); await page.fill(comm + ' .t-value', '3'); await page.fill(comm + ' .t-of', 'of sales'); await page.selectOption(comm + ' .t-freq', 'Monthly');
    page.__dialogs.length = 0;
    await page.click('#emp-pay-save');
    await page.waitForFunction(() => /Monthly earnings\s*9,500\.00/.test(document.getElementById('emp-pay-current').textContent), null, { timeout: 15000 });
    assert.deepEqual(page.__dialogs, ['The basic 7,000.00 is below the G5 band (minimum 8,000.00).']);
    assert.match(await page.textContent('#emp-pay-current'), /Commission: 3% of sales, monthly/);
    assert.match(await page.textContent('#emp-pay-warning'), /below the G5 band/);
    assert.equal(await page.isVisible('#emp-pay-set'), false);
    await page.click('#emp-pay-correct');
    assert.equal(await page.inputValue('.emp-pay-amount[data-el="pe-basic"]'), '7000');
    await page.fill('.emp-pay-amount[data-el="pe-basic"]', '8500');
    page.__answer = 'Basic typed wrongly';
    await page.click('#emp-pay-save');
    await page.waitForFunction(() => /Monthly earnings\s*11,000\.00/.test(document.getElementById('emp-pay-current').textContent), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#emp-pay-warning'), false);
    assert.match(await page.textContent('#emp-pay-versions'), /Correction — Basic typed wrongly[\s\S]*Initial · Replaced/);
    await page.click('#emp-back-btn');
    assert.deepEqual(page.__errors, []);
  });

  await check('a view-only user: no New, no changes, no pay-out section', async () => {
    const v = await open('EMPLOYEES', 'u-viewer');
    await v.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    assert.equal(await v.isVisible('#emp-new-btn'), false);
    assert.equal(await v.isVisible('#emp-replace-btn'), false);
    await v.click('#emp-table-body tr:has-text("Rami")');
    await v.waitForFunction(() => !document.getElementById('emp-entry-view').classList.contains('hidden'), null, { timeout: 15000 });
    assert.equal(await v.isVisible('#emp-sec-pay'), false);
    assert.equal(await v.isVisible('#emp-save-btn'), false);
    assert.equal(await v.isDisabled('[data-k="Mobile"]'), true);
    assert.equal(await v.$$eval('.emp-cf', x => x.length), 0, 'the sensitive extra field is not shown');
    assert.equal(await v.isVisible('#emp-docs-wrap'), false, 'no documents without the sensitive right');
    assert.equal(await v.isVisible('#emp-pay-wrap'), false, 'no pay without the sensitive right');
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
