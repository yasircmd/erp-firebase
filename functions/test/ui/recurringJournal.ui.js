// Drives the Recurring Journal Entries screen (docs/modules/RECURRING_JOURNAL.md)
// in headless Chromium against the emulators, through the shell's real rpc
// bridge: a new entry typed into the form with the live run-date preview,
// saved and activated (the approval gate the suite leaves on), approved
// from the Home task route, "Post Due Runs" from the list, the run log's
// GL drill-through, reversing a run with its prompts, GL Report's
// drill-through by a run's GL entry ID, and the Viewer's read-only list.
// Run the recurringJournal emulator suite first — its fixture (accounts
// 6100/1500, CC1) and approval gate are what this relies on:
//   node --test functions/test/emulator/recurringJournal.emulator.test.js
//   node functions/test/ui/recurringJournal.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const S = require('../../src/recurringSchedule');

function tokenFor(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/erp1-8f4cd', aud: 'erp1-8f4cd', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600 }) + '.';
}
async function call(uid, fn, data) {
  const r = await fetch('http://127.0.0.1:5001/erp1-8f4cd/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(uid) }, body: JSON.stringify({ data: data ?? null }) });
  const b = await r.json(); if (b.error) throw new Error(fn + ': ' + b.error.message); return b.result;
}
const TODAY = S.todayIn('Asia/Dubai');
function monthStart(offset) {
  const d = new Date(TODAY.substring(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().substring(0, 10);
}
const list = async () => (await call('u-admin', 'getRecurringJournals', {})).entries;

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  // The suite's last test leaves its approval-gated entry behind.
  if (!(await list()).some(e => e.Description === 'Rent {MONTH}' && e.Status === 'Active')) {
    throw new Error('Run the recurringJournal emulator suite first (it leaves the fixture and approval gate this relies on).');
  }

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8128);
  const browser = await chromium.launch();

  // Prompts are answered from page.__answers, in order; confirms are accepted.
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = []; page.__answers = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? (page.__answers.shift() ?? d.defaultValue()) : undefined); });
    await page.goto('http://127.0.0.1:8128/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); };

  let created;
  await check('new entry: form, live preview, save, activate (approval gate)', async () => {
    const page = await open('RECURRINGJV', 'u-admin');
    await page.click('#rj-new-btn');
    await page.selectOption('#rj-form-company', 'C1');
    await settle(page);
    await page.fill('#rj-form-description', 'UI rent {MONTH}');
    await page.selectOption('#rj-form-costcenter', 'CC1');
    await page.selectOption('#rj-freq', 'MonthlyDay');
    await page.fill('#rj-day', '1');
    await page.fill('#rj-start', monthStart(-2));
    await page.fill('#rj-count', '4');
    const acct = page.locator('#rj-lines-body input[data-f="AccountCode"]');
    await acct.nth(0).fill('6100'); await acct.nth(0).dispatchEvent('change');
    await page.locator('#rj-lines-body input[data-f="Debit"]').nth(0).fill('500');
    await page.locator('#rj-lines-body input[data-f="Description"]').nth(0).fill('Rent');
    await acct.nth(1).fill('1500'); await acct.nth(1).dispatchEvent('change');
    await page.locator('#rj-lines-body input[data-f="Credit"]').nth(1).fill('500');
    await page.locator('#rj-lines-body input[data-f="Description"]').nth(1).fill('Prepaid');
    await settle(page);
    assert.match(await page.textContent('#rj-balance-note'), /balanced/);
    assert.match(await page.textContent('#rj-lines-body'), /Rent Expense/, 'account name under the code');
    const dates = await page.locator('#rj-plan-body tr td:first-child').allTextContents();
    assert.deepEqual(dates.map(t => t.substring(0, 10)), [0, 1, 2, 3].map(i => monthStart(i - 2)));
    assert.match(await page.textContent('#rj-schedule-text'), /^Day 1 of every month, from .*, 4 runs$/);
    await page.click('#rj-activate-btn'); // saves, then activates
    await page.waitForSelector('#rj-status-badge:has-text("Pending Approval")', { timeout: 30000 });
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    created = (await list()).find(e => e.Description === 'UI rent {MONTH}');
    assert.equal(created.Status, 'PendingApproval');
    await page.close();
  });

  await check('approver opens it as from Home, approves; "Post Due Runs" on the list posts the catch-up', async () => {
    const approver = await open('RECURRINGJV', 'u-approver');
    await approver.evaluate(id => openModule('RECURRINGJV', { OpenEntryId: id }), created.TemplateID);
    await approver.waitForSelector('#rj-my-approval-banner', { state: 'visible', timeout: 30000 });
    await approver.click('#rj-approve-btn');
    await approver.waitForSelector('#rj-status-badge:has-text("Active")', { timeout: 30000 });
    assert.deepEqual(approver.__errors, []);
    await approver.close();

    const page = await open('RECURRINGJV', 'u-admin');
    assert.match(await page.textContent('#rj-due-summary'), /3 runs due on 1 recurring entry/);
    assert.match(await page.locator('#rj-table-body tr', { hasText: 'UI rent' }).textContent(), /3 due.*0 \/ 4.*Active/s);
    await page.click('#rj-post-all-btn');
    await page.waitForSelector('#rj-list-message:has-text("posted")', { timeout: 60000 });
    assert.match(await page.textContent('#rj-list-message'), /^3 runs posted\.$/);
    await settle(page);
    assert.match(await page.locator('#rj-table-body tr', { hasText: 'UI rent' }).textContent(), /3 \/ 4/);
    assert.ok(await page.isHidden('#rj-post-all-btn'), 'nothing more due');
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('run log: GL drill-through, reverse with prompts, post again', async () => {
    const page = await open('RECURRINGJV', 'u-admin');
    await page.locator('#rj-table-body tr', { hasText: 'UI rent' }).click();
    await page.waitForSelector('#rj-entry-view:not(.hidden)');
    await settle(page);
    const rows = await page.locator('#rj-plan-body tr').allTextContents();
    assert.equal(rows.length, 4);
    assert.ok(rows.slice(0, 3).every(r => /500\.00.*Posted.*RJV-/s.test(r)));
    assert.match(rows[3], /Scheduled/);
    assert.ok(await page.isDisabled('#rj-form-description'), 'an active entry is read-only');
    await page.locator('#rj-plan-body .rj-gl').first().click();
    await page.waitForSelector('#rj-gl-modal-body table');
    assert.match(await page.textContent('#rj-gl-modal-body'), /6100.*Rent Expense.*500\.00.*1500/s);
    assert.match(await page.textContent('#rj-gl-modal-body'), /UI rent [A-Z][a-z]{2}-\d{4}/);
    await page.click('#rj-gl-modal-close');

    page.__answers.push('Wrong month', TODAY);
    await page.locator('#rj-plan-body tr').nth(1).locator('button[data-act="reverse"]').click();
    await page.waitForSelector('#rj-ok:has-text("Reversed by")', { timeout: 30000 });
    assert.match(await page.locator('#rj-plan-body tr').nth(1).textContent(), /Reversed.*rev\..*Wrong month/s);
    await page.locator('#rj-plan-body tr').nth(1).locator('button[data-act="repost"]').click();
    await page.waitForSelector('#rj-ok:has-text("Posted RJV-")', { timeout: 30000 });
    assert.match(await page.locator('#rj-plan-body tr').nth(1).textContent(), /Posted/);
    assert.match(await page.textContent('#rj-history-body'), /Run posted again.*Run reversed/s);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('GL Report drill-through: a run\'s GL entry ID opens its recurring entry', async () => {
    const t = await call('u-admin', 'getRecurringJournal', { templateId: created.TemplateID });
    const jvId = t.Plan[0].JVID;
    const page = await open('RECURRINGJV', 'u-admin');
    await page.evaluate(id => openModule('RECURRINGJV', { OpenEntryId: id }), jvId);
    await page.waitForSelector('#rj-entry-view:not(.hidden)', { timeout: 30000 });
    await settle(page);
    assert.equal(await page.textContent('#rj-entry-title'), t.TemplateNumber);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Viewer: read-only list', async () => {
    const page = await open('RECURRINGJV', 'u-viewer');
    assert.ok(await page.isHidden('#rj-new-btn'));
    assert.ok(await page.isHidden('#rj-post-all-btn'));
    assert.ok((await page.locator('#rj-table-body tr').count()) >= 1);
    await page.locator('#rj-table-body tr', { hasText: 'UI rent' }).click();
    await page.waitForSelector('#rj-entry-view:not(.hidden)');
    await settle(page);
    assert.ok(await page.isHidden('#rj-pause-btn'));
    assert.equal(await page.locator('#rj-plan-body button[data-act]').count(), 0);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
