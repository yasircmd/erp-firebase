// Drives the JV and CBT screens' party + allocation controls
// (docs/modules/PARTY_PAYMENTS.md) in headless Chromium against the
// emulators, through the shell's real rpc bridge: a CBT vendor payment
// allocated "oldest first" against a posted bill, a JV write-off of a
// customer balance, the read-only view of a posted entry, and the
// invoice lists' Outstanding column. Run the partyPayments emulator
// suite first — its last test leaves the fixture this relies on:
//   node --test functions/test/emulator/partyPayments.emulator.test.js
//   node functions/test/ui/partyPayments.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const today = new Date().toISOString().substring(0, 10);
function tokenFor(uid) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/erp1-8f4cd', aud: 'erp1-8f4cd', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600 }) + '.';
}
async function call(uid, fn, data) {
  const r = await fetch('http://127.0.0.1:5001/erp1-8f4cd/us-central1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(uid) }, body: JSON.stringify({ data: data ?? null }) });
  const b = await r.json(); if (b.error) throw new Error(fn + ': ' + b.error.message); return b.result;
}
const outstanding = async (partyType, partyId) => (await call('u-admin', 'getPartyOpenItems', { partyType, partyId, companyId: 'C1' }))
  .map(i => [i.Number, i.Outstanding]);

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  // One posted vendor bill of 400 for V1.
  const s = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: {
    InvoiceDate: today, Description: 'UI bill', VendorRefNumber: 'UI-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: 400, Description: 'Freight', CostCenterID: 'CC1' }] } });
  if (!s.success) throw new Error(s.error);
  const bill = await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8126);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__lastDialog = d.message(); d.accept(); });
    await page.goto('http://127.0.0.1:8126/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };

  await check('CBT: vendor payment picks the vendor, allocates oldest first, posts', async () => {
    const page = await open('CBT', 'u-admin');
    await page.click('#cbt-new-btn');
    await page.click('.cbt-type-btn[data-type="Bank Payment"]');
    await page.selectOption('#cbt-form-company', 'C1');
    await settle(page);
    await page.selectOption('#cbt-form-ledger', '1100');
    await page.fill('#cbt-form-description', 'Pay Acme');
    const acct = page.locator('#cbt-grid-body input[data-row="0"][data-col="0"]');
    await acct.fill('2000'); await acct.blur();
    const amt = page.locator('#cbt-grid-body input[data-row="0"][data-col="2"]');
    await amt.fill('150'); await amt.blur();
    assert.ok(await page.isVisible('.cbt-party-select'), 'party picker shown for a payables line');

    // Posting without a vendor is stopped on the client.
    await page.click('#cbt-post-btn');
    assert.match(await page.textContent('#cbt-form-error'), /Line 1: select the Vendor or Customer for account 2000/);

    await page.selectOption('.cbt-party-select', 'Vendor:V1');
    await page.click('.cbt-allocate-btn');
    await page.waitForSelector('#cbt-alloc-modal input[data-ref]');
    await page.click('.cbt-alloc-auto');
    assert.equal(await page.textContent('.cbt-alloc-total'), '150.00');
    assert.equal(await page.textContent('.cbt-alloc-rest'), '0.00');
    await page.click('.cbt-alloc-ok');
    assert.match(await page.textContent('.cbt-party-row'), new RegExp('Against ' + bill.invoiceNumber + ' 150.00'));

    await page.click('#cbt-post-btn');
    await page.click('#cbt-confirm-ok');
    await settle(page);
    assert.ok(await page.isVisible('#cbt-list-view'), 'back on the list after posting');
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    assert.deepEqual((await outstanding('Vendor', 'V1')).find(i => i[0] === bill.invoiceNumber), [bill.invoiceNumber, 250]);

    // The posted entry shows its party and allocation read-only.
    await page.locator('.cbt-open').first().click();
    await settle(page);
    const row = await page.textContent('.cbt-party-row');
    assert.match(row, /Vendor: Acme Metals/);
    assert.match(row, new RegExp('Against ' + bill.invoiceNumber + ' 150.00'));
    assert.equal(await page.locator('.cbt-party-select').count(), 0, 'no picker on a posted entry');
    await page.close();
  });

  await check('JV: write off a customer balance against the invoice', async () => {
    const before = (await outstanding('Customer', 'CU1')).find(i => i[0] === 'CINV-26-01-000001');
    const page = await open('JV', 'u-admin');
    await page.click('#jv-new-btn');
    await page.selectOption('#jv-form-company', 'C1');
    await settle(page);
    await page.fill('#jv-form-description', 'Write off');
    await page.selectOption('#jv-form-costcenter', 'CC1');
    const cell = (r, c) => page.locator(`#jv-grid-body input[data-row="${r}"][data-col="${c}"]`);
    await cell(0, 0).fill('6800'); await cell(0, 0).blur();
    await cell(0, 2).fill('20'); await cell(0, 2).blur();
    await cell(1, 0).fill('1200'); await cell(1, 0).blur();
    await cell(1, 3).fill('20'); await cell(1, 3).blur();
    await page.selectOption('.jv-party-select', 'Customer:CU1');
    await page.click('.jv-allocate-btn');
    await page.waitForSelector('#jv-alloc-modal input[data-ref]');
    await page.click('.jv-alloc-auto');
    await page.click('.jv-alloc-ok');
    await page.click('#jv-post-btn');
    await page.click('#jv-confirm-ok');
    await settle(page);
    assert.ok(await page.isVisible('#jv-list-view'), await page.textContent('#jv-form-error'));
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    const after = (await outstanding('Customer', 'CU1')).find(i => i[0] === 'CINV-26-01-000001');
    assert.equal(after[1], before[1] - 20);
    await page.close();
  });

  await check('Vendor Invoice list: Outstanding and payment status', async () => {
    const page = await open('VENDORINVOICE', 'u-admin');
    const row = await page.locator('#vinv-table-body tr', { hasText: bill.invoiceNumber }).textContent();
    assert.match(row, /250\.00/);
    assert.match(row, /Partly paid/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
