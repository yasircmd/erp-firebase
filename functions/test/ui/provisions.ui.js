// HR Payroll, step 7c: the Provisions module on screen (owner, 2026-10-09;
// docs/modules/HR_PAYROLL.md, step 7, point 9, decisions 58, 60-63): the
// statement by provision with subtotals and the GL check, filters, Copy to
// Excel, a row's movements and their documents; openings entered, corrected
// and removed (Payroll Setup's write); a claim's journal opens it here.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/provisions.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, firestore, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const tsv = rows => rows.map(r => r.join('\t')).join('\n');

(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-FEXP': { AccountCode: '6120', AccountName: 'Air Ticket Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FPRO': { AccountCode: '2420', AccountName: 'Air Ticket Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, join) => call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male', JoinDate: join, CostCenterID: 'CC1', IBAN: 'AE070331234567890123456' } }).then(r => r.employeeId);
  const ali = await emp('Ali Hassan', '2021-01-01'), ben = await emp('Ben Okafor', '2026-01-01');
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  for (const [id, amt] of [[ali, 6000], [ben, 3000]]) await call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: els.BASIC, Amount: amt }] } });
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  const types = Object.fromEntries((await call('u-admin', 'getLeaveSetup', {})).leaveTypes.map(t => [t.Code, t.LeaveTypeID]));
  await call('u-admin', 'saveLeaveEntitlements', { leaveTypeId: types.ANNUAL, carryForwardCap: 10, rows: [{ LevelFrom: 1, LevelTo: 99, DaysPerYear: 24 }] });
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: m });

  const s0 = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s0.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s0.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  const flight = (await call('u-admin', 'saveAccrualType', { accrualType: { Name: 'Air ticket', Code: 'FLIGHT', Basis: 'Fixed', PaidAtLeaving: true, ExpenseAccountID: 'A-FEXP', ProvisionAccountID: 'A-FPRO',
    Rules: [{ LevelFrom: 1, LevelTo: 99, Value: 2400 }] } })).accrualTypeId;
  await call('u-admin', 'runMasterImport', { master: 'PROVOPEN', text: tsv([['Employee', 'Provision', 'Amount', 'Provided To'], ['EMP-0001', 'Air ticket', '600', '30/06/2026']]) });
  // Air ticket's opening is in the GL (the opening balances); gratuity's isn't, on purpose.
  await firestore.collection('journalEntries').doc('OB-1').set({ JVNumber: 'OB-1', JVDate: '2026-06-30', CompanyID: 'C1', Status: 'Posted',
    Lines: [{ AccountID: 'A-FPRO', AccountCode: '2420', Debit: 0, Credit: 600 }, { AccountID: 'A-SALPAY', AccountCode: '2300', Debit: 600, Credit: 0 }] });
  const july = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  await call('u-admin', 'submitPayrollRun', { runId: july });
  await call('u-admin', 'runMasterImport', { master: 'PROVOPEN', text: tsv([['Employee', 'Provision', 'Amount', 'Provided To'], ['EMP-0001', 'Gratuity', '1000', '31/07/2026']]) });
  const claim = await call('u-admin', 'recordAccrualClaim', { employeeId: ali, accrualTypeId: flight, date: '2026-08-10', amount: 150, accountId: 'A-BANK', note: 'Ticket home' });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8181);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  async function open(module, uid) {
    const page = await context.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8181/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const loaded = p => p.waitForFunction(() => /Ali Hassan/.test(document.getElementById('pv-body').textContent), null, { timeout: 30000 });
  const rowText = (p, sel) => p.$$eval(sel, t => t.map(r => [...r.cells].map(c => c.textContent.trim()).filter(Boolean).join('|')));
  const period = async p => { await p.fill('#pv-from', '2026-07'); await p.dispatchEvent('#pv-from', 'change'); await p.fill('#pv-to', '2026-08'); await p.dispatchEvent('#pv-to', 'change'); };

  await check('the statement: by provision with subtotals, the GL check, filters, Copy to Excel', async () => {
    const p = await open('PROVISIONS', 'u-admin');
    await loaded(p);
    await period(p);
    await p.waitForFunction(() => /2420 .* at Aug-2026/.test(document.getElementById('pv-body').textContent), null, { timeout: 30000 });
    const body = await rowText(p, '#pv-body tr');
    // Air ticket: Ali 600 opening + 200 July − 150 claimed; Ben 200 in July.
    assert.ok(body.includes('EMP-0001|Ali Hassan|600.00|200.00|150.00|650.00'), body.join(' / '));
    assert.ok(body.includes('EMP-0002|Ben Okafor|200.00|200.00'), body.join(' / '));
    assert.ok(body.includes('Air ticket total|600.00|400.00|150.00|850.00'), body.join(' / '));
    assert.ok(body.some(r => /^GL 2420 Air Ticket Provision at .*: 850\.00 — agrees$/.test(r)), body.join(' / '));
    // Gratuity: Ali's opening (to July) replaced his July run, which is in the GL: the check says they differ.
    assert.ok(body.includes('EMP-0001|Ali Hassan|1,000.00|1,000.00'), body.join(' / '));
    assert.ok(body.some(r => /^GL 2400 Gratuity Provision at .*: [\d,.]+ — differs from the statement by -?[\d,.]+$/.test(r)), body.join(' / '));
    // Filters: one provision; an employee (no GL check then).
    await p.selectOption('#pv-f-prov', { label: 'Air ticket' });
    assert.deepEqual(await p.$$eval('#pv-body tr.bg-slate-900\\/60', t => t.map(x => x.textContent)), ['Air ticket']);
    await p.fill('#pv-f-emp', 'ben');
    assert.deepEqual((await rowText(p, '#pv-body tr.pv-row')), ['EMP-0002|Ben Okafor|200.00|200.00']);
    assert.equal(await p.locator('#pv-body tr.pv-gl').count(), 0);
    await p.fill('#pv-f-emp', '');
    await p.click('#pv-copy');
    await p.waitForFunction(() => navigator.clipboard.readText().then(t => t.startsWith('Provision\t')), null, { timeout: 30000 });
    const lines = (await p.evaluate(() => navigator.clipboard.readText())).split('\n');
    assert.deepEqual(lines, ['Provision\tNo.\tEmployee\tOpening\tAccrued\tReleased\tUtilised\tClosing', 'Air ticket\tEMP-0001\tAli Hassan\t600.00\t200.00\t0.00\t150.00\t650.00', 'Air ticket\tEMP-0002\tBen Okafor\t0.00\t200.00\t0.00\t0.00\t200.00']);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a row\'s movements, with their documents: the claim opens on the Claims tab', async () => {
    const p = await open('PROVISIONS', 'u-admin');
    await loaded(p);
    await period(p);
    await p.waitForFunction(() => /2420 .* at Aug-2026/.test(document.getElementById('pv-body').textContent), null, { timeout: 30000 });
    await p.click('#pv-body tr.pv-row:has-text("Ali Hassan"):has-text("650.00")');
    await p.waitForSelector('#pv-mv:not(.hidden)', { timeout: 30000 });
    assert.equal(await p.textContent('#pv-mv-heading'), 'EMP-0001 · Ali Hassan — Air ticket');
    const mv = await rowText(p, '#pv-mv-body tr');
    assert.equal(mv.length, 4, mv.join(' / '));
    assert.match(mv[0], /^Opening\|600\.00$/);
    assert.match(mv[1], /^31\/07\/2026\|Accrued: Run .*\|200\.00\|800\.00$/);
    assert.match(mv[2], /^10\/08\/2026\|Utilised: Claim — Ticket home\|PPR-[\d-]+\|PPR-[\d-]+\|-150\.00\|650\.00$/);
    assert.match(mv[3], /^Closing\|650\.00$/);
    await p.click('#pv-mv-body tr:nth-child(3) .pv-doc');
    await p.waitForSelector('#pv-claims:not(.hidden)', { timeout: 30000 });
    assert.equal(await p.locator('#pv-claims-body tr.bg-blue-900\\/30').count(), 1);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('openings: entered, corrected, removed (Payroll Setup\'s write); read-only without it', async () => {
    const p = await open('PROVISIONS', 'u-admin');
    await loaded(p);
    await p.click('.pv-tab[data-tab="openings"]');
    assert.ok(await p.isHidden('#pv-from'), 'the period is the statement\'s');
    assert.deepEqual(await rowText(p, '#pv-op-body tr'), ['EMP-0001|Ali Hassan|Air ticket|600.00|30/06/2026|EditRemove', 'EMP-0001|Ali Hassan|Gratuity|1,000.00|31/07/2026|EditRemove']);
    await p.selectOption('#pv-op-emp', ben); await p.selectOption('#pv-op-prov', { label: 'Leave salary' });
    await p.fill('#pv-op-amount', '400'); await p.fill('#pv-op-asof', '2026-06-30');
    await p.click('#pv-op-save');
    await p.waitForFunction(() => /Ben Okafor\s*Leave salary\s*400\.00/.test(document.getElementById('pv-op-body').textContent), null, { timeout: 30000 });
    await p.click('#pv-op-body tr:has-text("Ben Okafor") .pv-op-edit');
    assert.equal(await p.inputValue('#pv-op-amount'), '400');
    await p.fill('#pv-op-amount', '450');
    await p.click('#pv-op-save');
    await p.waitForFunction(() => /Ben Okafor\s*Leave salary\s*450\.00/.test(document.getElementById('pv-op-body').textContent), null, { timeout: 30000 });
    assert.equal(await p.locator('#pv-op-body tr:has-text("Ben Okafor")').count(), 1);
    await p.click('#pv-op-body tr:has-text("Ben Okafor") .pv-op-del');
    await p.waitForFunction(() => !/Ben Okafor/.test(document.getElementById('pv-op-body').textContent), null, { timeout: 30000 });
    assert.deepEqual(p.__dialogs, ['Remove Ben Okafor\'s Leave salary opening (450.00)?']);
    assert.deepEqual(p.__errors, []);
    await p.close();
    const v = await open('PROVISIONS', 'u-viewer');
    await loaded(v);
    await v.click('.pv-tab[data-tab="openings"]');
    assert.ok(await v.isHidden('#pv-op-form'));
    assert.equal(await v.locator('.pv-op-edit').count(), 0);
    await v.click('.pv-tab[data-tab="claims"]');
    assert.ok(await v.isHidden('#pv-claim-new'));
    assert.equal(await v.locator('.pv-claim-rev').count(), 0);
    await v.close();
  });

  await check('a claim\'s journal from the GL (routed to Payroll, as every payroll journal) opens it here', async () => {
    const jvId = (await call('u-admin', 'getProvisionStatement', { companyId: 'C1', from: '2026-08', to: '2026-08' })).claims[0].JVID;
    const p = await open('PAYROLL', 'u-admin');
    await p.waitForSelector('#pr-runs-body tr[data-id]', { timeout: 30000 });
    await p.evaluate(id => openModule('PAYROLL', { OpenEntryId: id }), jvId);
    await p.waitForFunction(() => document.getElementById('pv-claims') && !document.getElementById('pv-claims').classList.contains('hidden') && document.querySelectorAll('#pv-claims-body tr.bg-blue-900\\/30').length === 1, null, { timeout: 30000 });
    assert.match(await p.textContent('#pv-claims-body tr.bg-blue-900\\/30'), new RegExp(claim.jvNumber));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
