// Drives the Purchase Return and Vendor Account Statement screens
// (docs/modules/PURCHASE_RETURN.md, VENDOR_SOA.md) in headless Chromium
// against the emulators, through the shell's real rpc bridge: a debit note
// picked from a posted bill and posted, then the vendor's statement with
// its running balance and CSV export. Run the returns emulator suite
// first — its fixture (company tax/discount accounts) is what this uses:
//   node --test functions/test/emulator/returns.emulator.test.js
//   node functions/test/ui/returns.ui.js
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

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  // A fresh bill: 5 @ 40 received and invoiced, no discount, 5% tax = 210.
  const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'UI receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 5, UnitCost: 40, Description: 'Steel' }] });
  await call('u-admin', 'postGrn', { grnId: g.grnId });
  const s = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: today, Description: 'UI bill', VendorRefNumber: 'UI-9',
    CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [{ GRNID: g.grnId }], DirectLines: [], TaxPercent: 5 } });
  if (!s.success) throw new Error(s.error);
  const bill = await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8127);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__lastDialog = d.message(); d.accept(); });
    await page.goto('http://127.0.0.1:8127/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const settle = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));

  let noteNumber = '';
  await check('Purchase Return: pick the bill, return 2, see the totals, post', async () => {
    const page = await open('PURCHASERETURN', 'u-admin');
    await page.click('#pret-new-btn');
    await page.selectOption('#pret-form-company', 'C1');
    await page.selectOption('#pret-form-party', 'V1');
    await settle(page);
    await page.selectOption('#pret-form-invoice', s.invoiceId);
    await settle(page);
    await page.fill('#pret-form-description', 'Two damaged sheets');
    await page.selectOption('#pret-form-costcenter', 'CC1');
    await page.fill('.pret-qty', '2');
    // goods 80, tax 5% = 4, total 84
    assert.equal(await page.textContent('#pret-sum-goods'), '80.00');
    assert.equal(await page.textContent('#pret-sum-tax'), '4.00');
    assert.equal(await page.textContent('#pret-sum-total'), '84.00');
    await page.click('#pret-post-btn');
    await page.click('#pret-confirm-ok');
    await settle(page);
    assert.ok(await page.isVisible('#pret-list-view'), await page.textContent('#pret-form-error'));
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    const row = await page.locator('#pret-table-body tr').first().textContent();
    assert.match(row, /DBN-/);
    assert.match(row, /84\.00/);
    noteNumber = row.match(/DBN-[\d-]+/)[0];
    const bills = (await call('u-admin', 'getVendorInvoiceEntries', { limit: 'all' })).entries;
    assert.equal(bills.find(b => b.VendorInvoiceID === s.invoiceId).Outstanding, 126);

    // Opened again: read-only, with the settlement line.
    await page.locator('#pret-table-body tr').first().click();
    await settle(page);
    assert.match(await page.textContent('#pret-sum-settle'), new RegExp('Settled 84.00 against ' + bill.invoiceNumber));
    assert.ok(await page.isVisible('#pret-reverse-btn'));
    assert.equal(await page.locator('.pret-qty').count(), 0, 'no inputs on a posted note');
    await page.close();
  });

  await check('Vendor Account Statement: running balance and CSV', async () => {
    const page = await open('VENDORSOA', 'u-viewer');
    await page.selectOption('#vsoa-company', 'C1');
    await page.selectOption('#vsoa-party', 'V1');
    await page.click('#vsoa-run-btn');
    await settle(page);
    const body = await page.textContent('#vsoa-body');
    assert.match(body, new RegExp(bill.invoiceNumber));
    assert.match(body, new RegExp(noteNumber));
    const expected = (await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' })).Closing;
    assert.match(await page.textContent('#vsoa-foot'), new RegExp(expected.toLocaleString('en-US', { minimumFractionDigits: 2 }).replace('.', '\\.')));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#vsoa-csv-btn')]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.match(csv, /"Closing balance"/);
    assert.match(csv, new RegExp(noteNumber));
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
