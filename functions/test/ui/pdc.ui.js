// Drives the PDC Received / PDC Issued screens (docs/modules/PDC.md) in
// headless Chromium against the emulators, through the shell's real rpc
// bridge: a new received cheque with "Oldest first" allocation, posted;
// the due view and clearing from the list; bouncing an issued cheque from
// its screen with the history; GL drill-through; the Viewer's read-only
// list; the Customer SOA's pending PDCs; Company Master's two accounts;
// and PDCISSUED.html in step with its template. Run the pdc emulator
// suite first — its last test leaves the fixture this relies on (CINV-1
// with 400 outstanding, issued cheque 500001 pending):
//   node --test functions/test/emulator/pdc.emulator.test.js
//   node functions/test/ui/pdc.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

function tokenFor(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/erp1-8f4cd', aud: 'erp1-8f4cd', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600 }) + '.';
}
async function call(uid, fn, data) {
  const r = await fetch('http://127.0.0.1:5001/erp1-8f4cd/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(uid) }, body: JSON.stringify({ data: data ?? null }) });
  const b = await r.json(); if (b.error) throw new Error(fn + ': ' + b.error.message); return b.result;
}
const entries = async (direction) => (await call('u-admin', 'getPdcEntries', { direction, limit: 'all' })).entries;
const today = new Date().toISOString().substring(0, 10);

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const issued = (await entries('Issued')).find(e => e.ChequeNumber === '500001' && e.Status === 'Pending');
  if (!issued) throw new Error('No pending issued cheque 500001 — run the pdc emulator suite first.');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8128);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8128/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };

  await check('PDCISSUED.html is built from PDCRECEIVED.html', async () => {
    execFileSync('node', [path.join(__dirname, '../../../tools/build-pdc-screens.js'), '--check'], { stdio: 'pipe' });
  });

  let created;
  await check('received: new cheque, oldest-first allocation, post', async () => {
    const page = await open('PDCRECEIVED', 'u-admin');
    assert.equal(await page.textContent('#pdc-heading'), 'PDC Received');
    await page.click('#pdc-new-btn');
    await page.selectOption('#pdc-form-company', 'C1');
    await settle(page);
    assert.ok(await page.isVisible('#pdc-form-drawee'));
    assert.ok(!(await page.isVisible('#pdc-form-bank')));
    await page.selectOption('#pdc-form-party', 'CU1');
    await page.waitForSelector('#pdc-alloc-body tr', { timeout: 15000 });
    await page.fill('#pdc-form-cheque-date', today);
    await page.fill('#pdc-form-cheque-no', 'UI-777');
    await page.fill('#pdc-form-amount', '250');
    await page.fill('#pdc-form-drawee', 'Mashreq');
    await page.fill('#pdc-form-description', 'UI cheque');
    const items = await page.locator('#pdc-alloc-body tr').allTextContents();
    assert.match(items[0], /CINV-1.*1,000\.00.*400\.00/s);
    await page.click('#pdc-oldest-btn');
    assert.equal(await page.inputValue('#pdc-alloc-body input.pdc-alloc >> nth=0'), '250');
    assert.match(await page.textContent('#pdc-alloc-summary'), /Cheque 250\.00 — settles 250\.00\.$/);
    await page.click('#pdc-post-btn');
    await page.waitForSelector('#pdc-list-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    created = (await entries('Received')).find(e => e.ChequeNumber === 'UI-777');
    assert.equal(created.Status, 'Pending');
    assert.deepEqual(created.Allocations.map(a => [a.RefType, a.RefNumber, a.Amount]), [['Against', 'CINV-1', 250]]);
    await page.close();
  });

  await check('received: due view and clearing selected cheques into a bank', async () => {
    const page = await open('PDCRECEIVED', 'u-admin');
    await page.check('#pdc-due-toggle');
    await settle(page);
    const row = page.locator('#pdc-table-body tr', { hasText: 'UI-777' });
    assert.match(await row.textContent(), /Mashreq.*250\.00.*Pending/s);
    assert.match(await page.textContent('#pdc-due-summary'), /Mashreq: 250\.00/);
    await row.locator('.pdc-row-check').check();
    assert.equal(await page.textContent('#pdc-selected-count'), '1');
    await page.click('#pdc-clear-selected-btn');
    await settle(page);
    await page.selectOption('#pdc-action-bank', 'A-BANK');
    await page.click('#pdc-action-ok');
    await page.waitForSelector('#pdc-action-modal', { state: 'hidden', timeout: 30000 });
    await settle(page);
    const p = (await entries('Received')).find(e => e.PdcID === created.PdcID);
    assert.deepEqual([p.Status, p.DepositAccountCode, p.ClearedDate], ['Cleared', '1100', today]);
    assert.deepEqual(await rpcFailures(page), []);
    await page.close();
  });

  await check('issued: open, bounce with a reason, history with GL entries, drill-through by GL entry', async () => {
    const page = await open('PDCISSUED', 'u-admin');
    assert.equal(await page.textContent('#pdc-heading'), 'PDC Issued');
    await page.locator('#pdc-table-body tr', { hasText: '500001' }).click();
    await settle(page);
    assert.ok(await page.isDisabled('#pdc-form-bank'));
    await page.waitForFunction(() => document.getElementById('pdc-form-bank').value === 'A-BANK', null, { timeout: 15000 });
    assert.ok(await page.isVisible('#pdc-clear-btn'));
    await page.click('#pdc-bounce-btn');
    await page.click('#pdc-action-ok');
    assert.match(await page.textContent('#pdc-action-error'), /Enter the reason/);
    await page.fill('#pdc-action-reason', 'Stopped by bank');
    await page.click('#pdc-action-ok');
    await page.waitForSelector('#pdc-list-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    const p = (await entries('Issued')).find(e => e.PdcID === issued.PdcID);
    assert.equal(p.Status, 'Bounced');

    // Reopen through the reversal's GL entry, as GL Report would.
    await page.evaluate(jv => openModule('PDCISSUED', { OpenEntryId: jv }), p.ReversalJVID);
    await page.waitForSelector('#pdc-entry-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    assert.equal(await page.textContent('#pdc-entry-title'), p.TransactionNumber);
    const history = await page.locator('#pdc-history-body tr').allTextContents();
    assert.deepEqual(history.map(h => h.trim().split(/\s+/)[0]), ['Posted', 'Bounced']);
    await page.locator('#pdc-history-body .pdc-gl-link').nth(1).click();
    await page.waitForSelector('#pdc-gl-modal-body table');
    assert.match(await page.textContent('#pdc-gl-modal-body'), /Trade Payables.*500\.00/s);
    assert.ok(!(await page.isVisible('#pdc-bounce-btn')));
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('approval from Home Tasks: the approver sees Approve even when rights arrive after the entry', async () => {
    const rtdb = (path, body) => fetch('http://127.0.0.1:9000/' + path + '.json?ns=erp1-8f4cd-default-rtdb', {
      method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
    await rtdb('approvalConfigurations/PDCRECEIVED', { Enabled: true, ScopeType: 'Global' });
    await rtdb('approvalLevels/PDCRECEIVED', { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } });
    try {
      const s = await call('u-admin', 'savePdcDraft', { Direction: 'Received', CompanyID: 'C1', PartyID: 'CU1', TransactionDate: today, ChequeDate: today,
        ChequeNumber: 'UI-APPR', DraweeBank: 'Mashreq', Amount: 50, Description: 'Needs approval', Allocations: [] });
      assert.equal((await call('u-admin', 'postPdc', { pdcId: s.pdcId })).status, 'PendingApproval');
      const task = (await call('u-approver', 'getPendingApprovalsForUser')).find(t => t.DocumentID === s.pdcId);
      assert.equal(task.ModuleID, 'PDCRECEIVED');

      // As the shell's Home task does: open the module with the document ID.
      // The rights call is held back so the entry is drawn first (the race).
      const page = await browser.newPage();
      page.__errors = [];
      page.on('pageerror', e => page.__errors.push(e.message));
      page.on('dialog', d => d.accept());
      await page.route('**/getModulePermissionsForUser', async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
      await page.goto('http://127.0.0.1:8128/?module=PDCRECEIVED&uid=u-approver');
      await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
      await page.evaluate(id => openModule('PDCRECEIVED', { OpenEntryId: id }), task.DocumentID);
      await page.waitForSelector('#pdc-my-approval-banner', { state: 'visible', timeout: 30000 });
      await page.click('#pdc-approve-btn');
      await page.waitForSelector('#pdc-list-view', { state: 'visible', timeout: 30000 });
      await settle(page);
      assert.equal((await entries('Received')).find(e => e.PdcID === s.pdcId).Status, 'Pending');
      assert.deepEqual(page.__errors, []);
      await page.close();
      // Out of the way of the SOA check below.
      await call('u-admin', 'cancelPdc', { pdcId: s.pdcId, date: today, reason: 'UI check' });
    } finally {
      await rtdb('approvalConfigurations/PDCRECEIVED', null);
      await rtdb('approvalLevels/PDCRECEIVED', null);
    }
  });

  await check('Viewer: sees the list, cannot create or clear', async () => {
    const page = await open('PDCRECEIVED', 'u-viewer');
    assert.ok(!(await page.isVisible('#pdc-new-btn')));
    assert.ok((await page.locator('#pdc-table-body tr').count()) >= 1);
    assert.equal(await page.locator('.pdc-row-check').count(), 0);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Customer SOA: pending PDCs with their total, no "if they bounce" lines', async () => {
    // One more pending cheque, dated into next month.
    const next = new Date(Date.now() + 20 * 86400000).toISOString().substring(0, 10);
    const s = await call('u-admin', 'savePdcDraft', { Direction: 'Received', CompanyID: 'C1', PartyID: 'CU1', TransactionDate: today, ChequeDate: next,
      ChequeNumber: 'UI-888', DraweeBank: 'Mashreq', Amount: 100, Description: 'Next month', Allocations: [] });
    await call('u-admin', 'postPdc', { pdcId: s.pdcId });
    const page = await open('CUSTOMERSOA', 'u-admin');
    await page.selectOption('#soa-company', 'C1');
    await settle(page);
    await page.selectOption('#soa-party', 'CU1');
    await page.fill('#soa-from', '2026-01-01');
    await page.fill('#soa-to', today);
    await page.click('#soa-run-btn');
    await page.waitForSelector('#soa-report:not(.hidden)', { timeout: 30000 });
    await settle(page);
    const rows = await page.locator('#soa-pdc-rows tr').allTextContents();
    assert.equal(rows.length, 1);
    assert.match(rows[0], /UI-888.*Mashreq.*100\.00/s);
    assert.equal(await page.textContent('#soa-pdc-total'), '100.00');
    assert.doesNotMatch(await page.textContent('#soa-report'), /if pending PDCs bounce|of which settled by pending PDCs/);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Company Master: the two PDC clearing accounts', async () => {
    const page = await open('COMPANYMASTER', 'u-admin');
    await page.locator('tr', { hasText: 'Test Co One' }).locator('.co-edit').first().click();
    await settle(page);
    assert.equal(await page.inputValue('#co-form-pdc-received'), 'A-PDCR');
    assert.equal(await page.inputValue('#co-form-pdc-issued'), 'A-PDCI');
    assert.match(await page.locator('#co-form-pdc-received option[value="A-PDCR"]').textContent(), /1250 — PDC Received Clearing/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
