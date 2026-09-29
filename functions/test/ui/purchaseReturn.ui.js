// Drives the Purchase Return screen (docs/modules/PURCHASE_RETURN.md) in
// headless Chromium against the emulators, through the shell's real rpc
// bridge: a new return picked from the invoice's GRN lines with live
// totals, posted; the posted note read-only with its GL impact; reversal
// from the screen; the Viewer's read-only access; and Company Master's new
// account field. Run the purchaseReturn emulator suite first — its last
// test leaves the fixture this relies on (one posted invoice for V1 with
// 6 of GRN-1 and 3 of GRN-2 still returnable):
//   node --test functions/test/emulator/purchaseReturn.emulator.test.js
//   node functions/test/ui/purchaseReturn.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
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
const entries = async () => (await call('u-admin', 'getPurchaseReturnEntries', { limit: 'all' })).entries;

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const [inv] = await call('u-admin', 'getReturnableVendorInvoices', { companyId: 'C1', vendorId: 'V1' });
  if (!inv) throw new Error('No returnable invoice — run the purchaseReturn emulator suite first.');
  const before = (await entries()).length;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8127);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8127/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };

  let posted;
  await check('new return: invoice picker, GRN lines, live totals, post', async () => {
    const page = await open('PURCHASERETURN', 'u-admin');
    await page.click('#prt-new-btn');
    await page.selectOption('#prt-form-company', 'C1');
    await page.selectOption('#prt-form-vendor', 'V1');
    await settle(page);
    await page.selectOption('#prt-form-invoice', inv.VendorInvoiceID);
    await settle(page);
    const rows = await page.locator('#prt-grid-body tr').allTextContents();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /GRN-1.*RM-001.*WH1 — Main Store.*20\.00\s+6\s/s);

    // Over the returnable quantity: flagged on the line, refused by the server.
    const qty = page.locator('#prt-grid-body input.prt-qty').first();
    await qty.fill('7'); await qty.blur();
    assert.equal(await page.locator('#prt-grid-body input.border-red-500\\/60').count(), 1);
    await page.fill('#prt-form-description', 'UI return');
    await page.click('#prt-save-draft-btn');
    await page.waitForFunction(() => /left to return/.test(document.getElementById('prt-form-error').textContent), null, { timeout: 30000 });
    assert.match(await page.textContent('#prt-form-error'), /only 6 left to return/);

    // 2 × 20 = 40; discount 25 × 40/250 = 4; tax 5% of 36 = 1.80; total 37.80.
    await page.locator('#prt-grid-body input.prt-qty').first().fill('2');
    assert.deepEqual(await Promise.all(['#prt-value-display', '#prt-discount-display', '#prt-tax-display', '#prt-total-display']
      .map(s => page.textContent(s))), ['40.00', '4.00', '1.80', '37.80']);
    assert.match(await page.textContent('#prt-settle-note'), /37\.80 settles it\.$/);

    await page.click('#prt-post-btn');
    await page.click('#prt-confirm-ok');
    await page.waitForSelector('#prt-list-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    assert.deepEqual(await rpcFailures(page), [await page.textContent('#prt-form-error').then(t => 'savePurchaseReturnDraft: ' + t)],
      'only the deliberate over-quantity save failed');
    const all = await entries();
    assert.equal(all.length, before + 1);
    posted = all.find(e => e.Description === 'UI return');
    assert.deepEqual([posted.Status, posted.Total, posted.Lines[0].Quantity], ['Posted', 37.8, 2]);
    assert.match(await page.locator('#prt-table-body tr', { hasText: posted.TransactionNumber }).textContent(), /37\.80.*Posted/s);
    await page.close();
  });

  await check('posted return: read-only, GL impact, reverse from the screen', async () => {
    const page = await open('PURCHASERETURN', 'u-admin');
    await page.locator('#prt-table-body tr', { hasText: posted.TransactionNumber }).click();
    await settle(page);
    assert.equal(await page.textContent('#prt-entry-title'), posted.TransactionNumber);
    assert.equal(await page.locator('#prt-grid-body input').count(), 0, 'no quantity inputs on a posted return');
    assert.ok(await page.isDisabled('#prt-form-invoice'));
    assert.ok(!(await page.isVisible('#prt-post-btn')));
    assert.match(await page.textContent('#prt-posted-note'), /Settled 37\.80 against/);
    await page.click('#prt-gl-impact-btn');
    await page.waitForSelector('#prt-gl-modal-body table');
    const gl = await page.textContent('#prt-gl-modal-body');
    assert.match(gl, /Trade Payables.*37\.80/s);
    assert.match(gl, /Inventory/);
    await page.click('#prt-gl-modal-close');

    // Print: the Sales Invoice's format, as a Debit Note (owner, 2026-09-29).
    assert.ok(await page.isVisible('#prt-print-btn'), 'Print on a posted return');
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.click('#prt-print-btn');
    assert.equal(await page.evaluate(() => window.__printed), 1);
    const doc = (await page.textContent('#prt-print-document')).replace(/\s+/g, ' ');
    assert.match(doc, /^ ?(TAX )?DEBIT NOTE /, doc.slice(0, 60));
    assert.ok(doc.includes('Debit Note No: ' + posted.TransactionNumber), 'its number');
    assert.ok(doc.includes('Against Invoice: ' + posted.SourceInvoiceNumber), 'the invoice');
    assert.match(doc, /Total ?37\.80/, 'the total');
    assert.ok(doc.includes(posted.Lines[0].ItemName || posted.Lines[0].ItemCode), 'the item');
    await page.emulateMedia({ media: 'print' });
    assert.ok(await page.isVisible('#prt-print-document') && await page.isHidden('#prt-entry-title'), 'only the document on paper');
    await page.emulateMedia({ media: 'screen' });

    await page.click('#prt-reverse-btn');
    await page.click('#prt-confirm-ok');
    await page.waitForSelector('#prt-list-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    const all = await entries();
    assert.ok(all.find(e => e.ReturnID === posted.ReturnID).ReversedByReturnID);
    assert.match(await page.locator('#prt-table-body tr', { hasText: posted.TransactionNumber }).first().textContent(), /Posted \(Reversed\)/);
    await page.close();
  });

  await check('Viewer: sees the list, cannot create', async () => {
    const page = await open('PURCHASERETURN', 'u-viewer');
    assert.ok(!(await page.isVisible('#prt-new-btn')));
    assert.ok((await page.locator('#prt-table-body tr').count()) >= 1);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Company Master: Purchase Return Variance Account field', async () => {
    const page = await open('COMPANYMASTER', 'u-admin');
    await page.locator('tr', { hasText: 'Test Co One' }).locator('.co-edit').first().click();
    await settle(page);
    assert.equal(await page.inputValue('#co-form-return-variance'), 'A-PRV');
    assert.match(await page.locator('#co-form-return-variance option[value="A-PRV"]').textContent(), /5200 — Purchase Return Variance/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
