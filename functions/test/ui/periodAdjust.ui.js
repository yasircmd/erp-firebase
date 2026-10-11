// Period Closing step 1c on screen (docs/modules/PERIOD_CLOSING.md,
// decisions 131, 136-139): reversing a payroll run of a closed month shows
// the in-app warning; Cancel changes nothing; Continue reverses it on the
// first day of the first open month and the run is back to draft. Seeds its
// own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/periodAdjust.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, firestore, call, reset, baseFixture } = require('../emulator/_helpers');

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
  const ali = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01',
    CostCenterID: 'CC1', BankName: 'ENBD', IBAN: 'AE070331234567890123456' } })).employeeId;
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  await call('u-admin', 'saveCompensation', { employeeId: ali, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 6000 }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  const sys = (await call('u-admin', 'getPayrollSetup', {})).elements.find(e => e.Code === 'UNPAIDLV');
  await call('u-admin', 'savePayElementPayroll', { elementId: sys.ElementID, glAccountId: 'A-SAL' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  const runId = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId })).status, 'Posted');
  await rtdb.ref('periodClosing/C1/ClosedThrough').set('2026-07');
  const status = async () => (await call('u-admin', 'getPayrollRun', { runId })).run;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8181);
  const browser = await chromium.launch();
  // answers: per dialog, the reply (a string for a prompt, true / false for a confirm).
  async function openRun(answers) {
    const p = await browser.newPage();
    p.__errors = []; p.__dialogs = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    await onAppDialog(p, d => { p.__dialogs.push(d.type() + ': ' + d.message()); const a = answers.shift(); return a === false ? d.dismiss() : d.accept(typeof a === 'string' ? a : undefined); });
    await p.goto('http://127.0.0.1:8181/?module=PAYROLL&uid=u-admin');
    await p.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.click('#pr-runs-body tr[data-id]');
    await p.waitForSelector('#pr-run-view:not(.hidden)', { timeout: 30000 });
    return p;
  }
  const waitFor = async (p, pred) => { for (let i = 0; i < 100 && !pred(); i++) await p.waitForTimeout(100); };

  await check('a closed month: the warning names the first open day; Cancel changes nothing', async () => {
    const p = await openRun(['Wrong basic', false]);
    await p.click('#pr-reverse');
    await waitFor(p, () => p.__dialogs.length >= 2);
    await p.waitForTimeout(800);
    assert.match(p.__dialogs[1], /^confirm: (2026-07|Jul-2026) is closed for Test Co One\. It can be adjusted in the first open month: it is posted on (2026-08-01|01\/08\/2026)/);
    assert.equal((await status()).Status, 'Posted');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('Continue: reversed on the first open day, the run back to draft for its own month', async () => {
    const before = await status();
    const p = await openRun(['Wrong basic', true]);
    await p.click('#pr-reverse');
    await p.waitForFunction(() => /^Draft$/.test(document.getElementById('pr-status').textContent), null, { timeout: 30000 });
    const orig = (await firestore.collection('journalEntries').doc(before.JVID).get()).data();
    const rev = (await firestore.collection('journalEntries').doc(orig.ReversedByJV).get()).data();
    assert.deepEqual([rev.JVDate, rev.AdjustedFromDate], ['2026-08-01', '2026-07-31']);
    assert.match(await p.textContent('#pr-history'), /posted on (2026-08-01|01\/08\/2026): (2026-07|Jul-2026) is closed/);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
