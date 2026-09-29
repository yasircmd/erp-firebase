// Drives the Sales Return screen (docs/modules/SALES_RETURN.md) in headless
// Chromium against the emulators, through the shell's real rpc bridge: a
// new return picked from the invoice's Delivery Note lines into a chosen
// warehouse, with live totals, posted; the posted note read-only with its
// GL impact; reversal from the screen; the Viewer's read-only access; and
// the Sales Returns Account per Sales Type in Sales Invoice Configuration. Run the salesReturn emulator suite
// first — its last test leaves the fixture this relies on (one posted
// invoice for CU1 with 6 of DeliveryNote-2 and 3 of DeliveryNote-5 still
// returnable):
//   node --test functions/test/emulator/salesReturn.emulator.test.js
//   node functions/test/ui/salesReturn.ui.js
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
const entries = async () => (await call('u-admin', 'getSalesReturnEntries', { limit: 'all' })).entries;

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const [inv] = await call('u-admin', 'getReturnableCustomerInvoices', { companyId: 'C1', customerId: 'CU1' });
  if (!inv) throw new Error('No returnable invoice — run the salesReturn emulator suite first.');
  const before = (await entries()).length;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8129);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8129/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };

  let posted;
  await check('new return: invoice picker, DN lines, warehouse per line, live totals, post', async () => {
    const page = await open('SALESRETURN', 'u-admin');
    await page.click('#srt-new-btn');
    await page.selectOption('#srt-form-company', 'C1');
    await page.selectOption('#srt-form-customer', 'CU1');
    await page.waitForFunction(id => [...document.querySelectorAll('#srt-form-invoice option')].some(o => o.value === id), inv.CustomerInvoiceID, { timeout: 30000 });
    await page.selectOption('#srt-form-invoice', inv.CustomerInvoiceID);
    await settle(page);
    const rows = await page.locator('#srt-grid-body tr').allTextContents();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /DeliveryNote-2.*RM-001.*50\.00\s+6\s/s);
    // Warehouse defaults to the delivery's; the other company's is not offered.
    const wh = page.locator('#srt-grid-body select.srt-wh').first();
    assert.equal(await wh.inputValue(), 'WH1');
    assert.equal(await wh.locator('option[value="WH9"]').count(), 0);
    await wh.selectOption('WH3');

    // 2 × 50 = 100; discount 60 × 100/600 = 10; tax 5% of 90 = 4.50; total 94.50.
    await page.locator('#srt-grid-body input.srt-qty').first().fill('2');
    assert.deepEqual(await Promise.all(['#srt-value-display', '#srt-discount-display', '#srt-tax-display', '#srt-total-display']
      .map(s => page.textContent(s))), ['100.00', '10.00', '4.50', '94.50']);
    assert.match(await page.textContent('#srt-settle-note'), /94\.50 settles it\.$/);
    await page.fill('#srt-form-description', 'UI return');

    await page.click('#srt-post-btn');
    await page.click('#srt-confirm-ok');
    await page.waitForSelector('#srt-list-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    const all = await entries();
    assert.equal(all.length, before + 1);
    posted = all.find(e => e.Description === 'UI return');
    assert.deepEqual([posted.Status, posted.Total, posted.Lines[0].Quantity, posted.Lines[0].WarehouseID], ['Posted', 94.5, 2, 'WH3']);
    await page.close();
  });

  await check('posted return: read-only, GL impact, reverse from the screen', async () => {
    const page = await open('SALESRETURN', 'u-admin');
    await page.locator('#srt-table-body tr', { hasText: posted.TransactionNumber }).click();
    await settle(page);
    assert.equal(await page.textContent('#srt-entry-title'), posted.TransactionNumber);
    assert.equal(await page.locator('#srt-grid-body input, #srt-grid-body select').count(), 0, 'nothing editable on a posted return');
    assert.match(await page.textContent('#srt-grid-body'), /WH3 — Returns Bay/);
    assert.match(await page.textContent('#srt-posted-note'), /Stock returned at cost 60\.00\. Settled 94\.50 against/);
    await page.click('#srt-gl-impact-btn');
    await page.waitForSelector('#srt-gl-modal-body table');
    const gl = await page.textContent('#srt-gl-modal-body');
    assert.match(gl, /Sales Returns & Discounts.*100\.00/s);
    assert.match(gl, /Trade Receivables.*94\.50/s);
    await page.click('#srt-gl-modal-close');

    // Print: the Sales Invoice's format, as a Credit Note (owner, 2026-09-29).
    assert.ok(await page.isVisible('#srt-print-btn'), 'Print on a posted return');
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.click('#srt-print-btn');
    assert.equal(await page.evaluate(() => window.__printed), 1);
    const doc = (await page.textContent('#srt-print-document')).replace(/\s+/g, ' ');
    assert.match(doc, /^ ?(TAX )?CREDIT NOTE /, doc.slice(0, 60));
    assert.ok(doc.includes('Credit Note No: ' + posted.TransactionNumber), 'its number');
    assert.ok(doc.includes('Against Invoice: ' + posted.SourceInvoiceNumber), 'the invoice');
    assert.match(doc, /Total ?94\.50/, 'the total');
    assert.ok(doc.includes(posted.Lines[0].ItemName || posted.Lines[0].ItemCode), 'the item');
    await page.emulateMedia({ media: 'print' });
    assert.ok(await page.isVisible('#srt-print-document') && await page.isHidden('#srt-entry-title'), 'only the document on paper');
    await page.emulateMedia({ media: 'screen' });

    await page.click('#srt-reverse-btn');
    await page.click('#srt-confirm-ok');
    await page.waitForSelector('#srt-list-view', { state: 'visible', timeout: 30000 });
    await settle(page);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    assert.ok((await entries()).find(e => e.ReturnID === posted.ReturnID).ReversedByReturnID);
    assert.match(await page.locator('#srt-table-body tr', { hasText: posted.TransactionNumber }).first().textContent(), /Posted \(Reversed\)/);
    await page.close();
  });

  await check('Viewer: sees the list, cannot create', async () => {
    const page = await open('SALESRETURN', 'u-viewer');
    assert.ok(!(await page.isVisible('#srt-new-btn')));
    assert.ok((await page.locator('#srt-table-body tr').count()) >= 1);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Sales Invoice Configuration: Sales Returns Account per Sales Type; gone from Company Master', async () => {
    const page = await open('SALESINVOICESETUP', 'u-admin');
    const row = page.locator('#sis-type-table-body tr', { hasText: 'Goods' });
    assert.match(await row.textContent(), /410000 — Sales Returns & Discounts/);
    assert.match(await page.locator('#sis-type-table-body tr', { hasText: 'Export' }).textContent(), /410100 — Sales Returns — Export/);
    await row.locator('.sis-type-edit-btn').click();
    await settle(page);
    assert.equal(await page.inputValue('#sis-type-form-returns-account'), 'A-SRET');
    // Revenue accounts only, as for the Revenue Account.
    assert.equal(await page.locator('#sis-type-form-returns-account option[value="A-DISCG"]').count(), 0);
    await page.selectOption('#sis-type-form-returns-account', 'A-SRETX');
    await page.click('#sis-type-save-btn');
    await page.waitForSelector('#sis-type-modal', { state: 'hidden', timeout: 15000 })
      .catch(async () => { throw new Error('modal still open: ' + await page.textContent('#sis-type-form-error')); });
    assert.equal((await call('u-admin', 'getSalesTypes')).find(t => t.SalesTypeID === 'ST1').SalesReturnsAccountID, 'A-SRETX');
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();

    const co = await open('COMPANYMASTER', 'u-admin');
    assert.equal(await co.locator('#co-form-sales-returns').count(), 0);
    assert.deepEqual(co.__errors, []);
    await co.close();
  });

  await browser.close(); server.close();
  for (const r of results) console.log(r.join('  '));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(passed + '/' + results.length + ' passed');
  process.exitCode = passed === results.length ? 0 : 1;
})();
