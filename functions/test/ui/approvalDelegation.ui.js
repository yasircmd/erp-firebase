// Approval delegation in the Approval Tracker (owner, 2026-09-29;
// docs/modules/APPROVAL_DELEGATION.md): an Admin delegates any pending level,
// an approver their own; the delegation shows under the approver; "Delegate
// all pending…" moves an absent approver's and lists what it couldn't.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/approvalDelegation.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.roles.Approver = { Name: 'Approver', Status: 'Active' };
  f.permissions.JV.access.push('Approver'); f.permissions.JV.post.push('Approver');
  f.permissions.APPROVALTRACKER.access.push('Approver');
  const u = (name, role) => ({ status: 'Active', role, username: name.toLowerCase(), fullName: name, AssignedCompanies: ['C1'] });
  Object.assign(f.users, { 'u-anna': u('Anna', 'Approver'), 'u-ben': u('Ben', 'Approver'), 'u-cara': u('Cara', 'Approver') });
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global', GateType: 'Flat' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [
    { LevelNumber: 1, ApproverUserID: 'u-anna', ThresholdAmount: 0 }, { LevelNumber: 2, ApproverUserID: 'u-ben', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] } });
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'PendingApproval');
  const instanceId = (await firestore.collection('journalEntries').doc(s.jvId).get()).data().ApprovalInstanceID;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8154);
  const browser = await chromium.launch();
  async function open(uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__alerts = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__alerts.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8154/?module=APPROVALTRACKER&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#at-delegate-all-btn:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(500);
    return page;
  }
  // Level -> [approver text, has a Delegate button]
  const levels = page => page.$$eval('#at-table-body tr', trs => trs.map(tr => {
    const td = [...tr.cells];
    return [Number(td[4].textContent), td[5].textContent.trim(), Boolean(tr.querySelector('.at-delegate-btn'))];
  }));

  await check('an Admin delegates level 1 from Anna to Cara; the row shows who, by whom and why', async () => {
    const page = await open('u-admin');
    assert.deepEqual((await levels(page)).map(r => [r[0], r[2]]), [[1, true], [2, true]], 'an Admin can delegate either level');
    await page.click('.at-delegate-btn[data-level="1"]');
    await page.waitForSelector('#at-delegate-modal:not(.hidden)');
    await page.waitForFunction(() => document.querySelectorAll('#at-delegate-to option').length > 1);
    const offered = await page.$$eval('#at-delegate-to option', os => os.map(o => o.value).filter(Boolean));
    assert.ok(offered.includes('u-cara') && !offered.includes('u-anna') && !offered.includes('u-ben'), offered.join());
    await page.selectOption('#at-delegate-to', 'u-cara');
    await page.click('#at-delegate-ok');
    assert.match(await page.textContent('#at-delegate-error'), /reason/, 'a reason is required');
    await page.fill('#at-delegate-reason', 'On annual leave');
    await page.click('#at-delegate-ok');
    await page.waitForFunction(() => document.getElementById('at-delegate-modal').classList.contains('hidden'), null, { timeout: 15000 });
    await page.waitForSelector('.at-delegation');
    const [l1] = await levels(page);
    assert.match(l1[1], /^Cara\s*delegated from Anna by Admin User, \d\d\/\d\d\/\d{4} \d\d:\d\d: On annual leave$/);
    assert.equal(await val('approvalInstances/' + instanceId + '/RequiredLevels/0/ApproverUserID'), 'u-cara');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('an approver sees Delegate on their own level only; "Delegate all pending…" lists what can\'t move', async () => {
    const page = await open('u-ben');
    assert.deepEqual((await levels(page)).map(r => [r[0], r[2]]), [[1, false], [2, true]]);
    await page.click('#at-delegate-all-btn');
    await page.waitForSelector('#at-delegate-modal:not(.hidden)');
    assert.ok(await page.$eval('#at-delegate-from-wrap', el => el.classList.contains('hidden')), 'an approver moves only their own');
    await page.waitForFunction(() => document.querySelectorAll('#at-delegate-to option').length > 1);
    await page.selectOption('#at-delegate-to', 'u-cara'); // Cara already has level 1
    await page.fill('#at-delegate-reason', 'Travelling');
    await page.click('#at-delegate-ok');
    // The summary is an in-app message (answered by onAppDialog, which records it).
    const summary = async n => { for (let i = 0; i < 150 && page.__alerts.length < n; i++) await page.waitForTimeout(100); return page.__alerts[n - 1] || ''; };
    assert.match(await summary(1), /^0 approvals delegated to Cara\.\s+Not moved:\s+• Journal Entry \(JV\) JV-.*, level 2: Cara already approves another level of this document\.$/s);

    // To Anna instead: it moves.
    await page.click('#at-delegate-all-btn');
    await page.waitForFunction(() => document.querySelectorAll('#at-delegate-to option').length > 1);
    await page.selectOption('#at-delegate-to', 'u-anna');
    await page.fill('#at-delegate-reason', 'Travelling');
    await page.click('#at-delegate-ok');
    assert.match(await summary(2), /^1 approval delegated to Anna\.$/);
    await page.waitForFunction(() => document.querySelectorAll('.at-delegation').length === 2);
    assert.deepEqual((await levels(page)).map(r => [r[0], r[1].split('delegated')[0].trim(), r[2]]), [[1, 'Cara', false], [2, 'Anna', false]], 'Ben has nothing left to delegate');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
