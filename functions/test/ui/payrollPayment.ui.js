// HR Payroll, step 4: Payroll Setup → Payment Files and paying a run
// (owner, 2026-10-04; docs/modules/HR_PAYROLL.md, decisions 20-22): a
// format from the UAE WPS SIF, adjusted and previewed; the employee's WPS
// fields; the payment panel: the payees, the file, Mark paid, reversing it.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/payrollPayment.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, extra) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1' }, extra) }).then(r => r.employeeId);
  const ali = await emp('Ali Hassan', { BankName: 'ENBD', IBAN: 'AE070331234567890123456', WpsPersonID: '10012345678901', BankRoutingCode: '803320101' });
  const ben = await emp('Ben Okafor', {});
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'saveCompensation', { employeeId: ben, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 2000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  const runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8172);
  const browser = await chromium.launch();
  async function open(module, uid, answers) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept((answers || []).shift()); });
    await page.goto('http://127.0.0.1:8172/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const run = async () => (await call('u-admin', 'getPayrollRun', { runId })).run;

  await check('the employee record: the WPS person ID and bank routing code beside the IBAN', async () => {
    const p = await open('EMPLOYEES', 'u-admin');
    await p.waitForSelector('#emp-table-body tr[data-doc-id]', { timeout: 30000 });
    await p.click('#emp-table-body tr:has-text("Ali Hassan")');
    await p.waitForFunction(() => /Ali Hassan$/.test(document.getElementById('emp-heading').textContent), null, { timeout: 15000 });
    assert.deepEqual([await p.inputValue('[data-k="WpsPersonID"]'), await p.inputValue('[data-k="BankRoutingCode"]')], ['10012345678901', '803320101']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Payment Files: a format from the UAE WPS SIF, a header field added then removed, previewed on the run, saved', async () => {
    const p = await open('PAYROLLSETUP', 'u-admin');
    await p.waitForSelector('#ps-el-body tr', { timeout: 30000 });
    await p.click('.ps-tab[data-tab="files"]');
    await p.waitForFunction(() => /No payment file formats yet/.test(document.getElementById('ps-pf-body').textContent), null, { timeout: 15000 });
    await p.click('#ps-pf-starter');
    await p.waitForSelector('#ps-pf-form:not(.hidden)');
    assert.equal(await p.inputValue('#ps-pf-name'), 'UAE WPS SIF');
    assert.equal(await p.locator('.ps-pf-rec[data-rec="Employee"] .ps-pf-row').count(), 10);
    await p.fill('#ps-pf-bank', 'ENBD'); await p.fill('#ps-pf-employer', '0000123456789'); await p.fill('#ps-pf-bankcode', '803320101');
    await p.click('.ps-pf-add[data-rec="Header"]');
    await p.fill('.ps-pf-rec[data-rec="Header"] .ps-pf-text', 'HDR');
    await p.fill('#ps-pf-paydate', '2026-08-03');
    await p.click('#ps-pf-preview');
    await p.waitForSelector('#ps-pf-out:not(.hidden)', { timeout: 15000 });
    let out = await p.textContent('#ps-pf-out');
    assert.match(out, /^0000123456789\d{12}\.SIF {2}\(1 employees, 6000\.00\)/);
    assert.match(out, /\nHDR\nEDR,10012345678901,803320101,AE070331234567890123456,2026-07-01,2026-07-31,31,6000\.00,0\.00,0\nSCR,0000123456789,803320101,/, 'the stored dates, not the screen\'s');
    await p.click('.ps-pf-rec[data-rec="Header"] .ps-pf-del');
    await p.click('#ps-pf-preview');
    await p.waitForFunction(() => !/\nHDR\n/.test(document.getElementById('ps-pf-out').textContent), null, { timeout: 15000 });
    await p.click('#ps-pf-save');
    await p.waitForFunction(() => /UAE WPS SIF\s*ENBD/.test(document.getElementById('ps-pf-body').textContent), null, { timeout: 15000 });
    const saved = (await call('u-admin', 'getPaymentFormats', {})).formats[0];
    assert.deepEqual([saved.Values.EmployerID, saved.Records.Header.length, saved.Records.Trailer.length], ['0000123456789', 0, 10]);
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('paying the run (step 6, the plan): Ben moved to cheque, saved at once; the bank file and Mark paid per group; a payment reversed on its own; the run then reversible', async () => {
    const p = await open('PAYROLL', 'u-admin', [undefined, undefined, 'Cheque bounced', 'Redo']); // two Mark paid confirms, then two reasons
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-pay-form:not(.hidden)', { timeout: 30000 });
    assert.match(await p.textContent('#pr-pay-list'), /Ali Hassan\s*Bank file[\s\S]*ENBD\s*AE070331234567890123456\s*6,000\.00[\s\S]*Ben Okafor\s*Cash/);
    assert.deepEqual(await p.$$eval('#pr-pay-groups tr', t => t.map(r => r.cells[0].textContent + ' ' + r.cells[2].textContent)), ['Bank file 1', 'Cash 1']);
    // Ben has no IBAN: no bank file for him; by cheque from the bank.
    assert.deepEqual(await p.$$eval('#pr-pay-list tr[data-emp="' + ben + '"] .pr-w-way option', o => o.map(x => x.value)), ['Cash', 'Cheque']);
    await p.selectOption('#pr-pay-list tr[data-emp="' + ben + '"] .pr-w-way', 'Cheque');
    await p.waitForFunction(() => [...document.querySelectorAll('#pr-pay-groups tr')].map(r => r.cells[0].textContent).join() === 'Bank file,Cheque / transfer', null, { timeout: 30000 });
    await p.fill('#pr-pay-date', '2026-08-03');
    const download = p.waitForEvent('download');
    await p.click('#pr-pay-groups tr[data-way="BankFile"] .pr-g-file');
    const d = await download;
    assert.match(d.suggestedFilename(), /^0000123456789\d{12}\.SIF$/);
    assert.match(fs.readFileSync(await d.path(), 'utf8'), /^EDR,10012345678901,[\s\S]*\r\nSCR,0000123456789,803320101,.*,072026,1,6000\.00,AED,\r\n$/);
    await p.click('#pr-pay-groups tr[data-way="BankFile"] .pr-g-pay');
    await p.waitForFunction(() => /P1: 03\/08\/2026 — Bank file from 1100/.test(document.getElementById('pr-pay-made').textContent), null, { timeout: 30000 });
    assert.match(p.__dialogs[0], /^Mark 1 paid by bank file from 1100 — .* \(6,000\.00\) on 2026-08-03\?/);
    assert.ok(await p.isHidden('#pr-pay-done'), 'paid in part');
    assert.match(await p.textContent('#pr-pay-list tr[data-emp="' + ali + '"]'), /paid \(P1\)/);
    await p.click('#pr-pay-groups tr[data-way="Cheque"] .pr-g-pay');
    await p.waitForSelector('#pr-pay-done:not(.hidden)', { timeout: 30000 });
    assert.match(await p.textContent('#pr-pay-done'), /Paid in full \(the last on 03\/08\/2026\)/);
    assert.equal(await p.isHidden('#pr-reverse'), true);
    await p.click('#pr-pay-made li[data-pay="P2"] .pr-p-rev');
    await p.waitForSelector('#pr-pay-done.hidden', { state: 'attached', timeout: 30000 });
    await p.waitForFunction(() => /reversed: Cheque bounced/.test(document.getElementById('pr-pay-made').textContent), null, { timeout: 30000 });
    assert.equal((await run()).PaidAt, '');
    await p.click('#pr-pay-made li[data-pay="P1"] .pr-p-rev');
    await p.waitForFunction(() => (document.getElementById('pr-pay-made').textContent.match(/reversed/g) || []).length === 2, null, { timeout: 30000 });
    await p.waitForSelector('#pr-reverse:not(.hidden)', { timeout: 30000 });
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
