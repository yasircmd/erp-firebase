// Drives the Vendor and Customer Statement of Account screens
// (docs/modules/VENDOR_SOA.md, CUSTOMER_SOA.md) in headless Chromium
// against the emulators, through the shell's real rpc bridge: run a
// statement, the open items / aging / reconciliation panels, CSV download,
// drill-through to the source document and back, the Viewer, and that
// CUSTOMERSOA.html is in sync with VENDORSOA.html. Run the partyStatement
// emulator suite first — its last test leaves CU1's May history:
//   node --test functions/test/emulator/partyStatement.emulator.test.js
//   node functions/test/ui/partyStatement.ui.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  // One vendor bill so the vendor statement has something to show.
  const s = await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: '2026-05-02', Description: 'UI bill', VendorRefNumber: 'UI-1',
    CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: 300, Description: 'Freight', CostCenterID: 'CC1' }] } });
  if (!s.success) throw new Error(s.error);
  const bill = await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId });

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8131);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage({ acceptDownloads: true });
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8131/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  async function runStatement(page, party, from, to) {
    await page.waitForFunction(() => document.getElementById('soa-company').options.length > 1, null, { timeout: 30000 });
    await page.selectOption('#soa-company', 'C1');
    await page.waitForFunction(p => [...document.getElementById('soa-party').options].some(o => o.value === p), party, { timeout: 30000 });
    await page.selectOption('#soa-party', party);
    await page.fill('#soa-from', from);
    await page.fill('#soa-to', to);
    await page.click('#soa-run-btn');
    await page.waitForSelector('#soa-report:not(.hidden)', { timeout: 30000 });
  }

  await check('CUSTOMERSOA.html is generated from VENDORSOA.html and up to date', async () => {
    execFileSync('node', [path.join(__dirname, '../../../tools/build-soa-screens.js'), '--check'], { stdio: 'pipe' });
  });

  await check('customer statement: rows, closing, open items, aging, reconciliation, CSV', async () => {
    const page = await open('CUSTOMERSOA', 'u-admin');
    assert.match(await page.textContent('#soa-heading'), /Customer Statement of Account/);
    await runStatement(page, 'CU1', '2026-05-01', '2026-05-31');
    const rows = await page.locator('#soa-rows tr').allTextContents();
    assert.equal(rows.length, 4, 'opening + 3 rows');
    assert.match(rows[1], /Invoice.*500\.00.*500\.00/s);
    assert.match(rows[2], /Bank Receipt.*200\.00.*300\.00/s);
    assert.match(rows[3], /Credit Note.*100\.00.*200\.00/s);
    assert.equal(await page.textContent('#soa-closing'), '200.00');
    assert.match(await page.textContent('#soa-open'), /2026-05-16\s*15\s*500\.00\s*200\.00/);
    assert.match(await page.textContent('#soa-aging [data-bucket="d1_30"]'), /200\.00/);
    // The suite's last step gave CU2 the same receivables account.
    assert.match(await page.textContent('#soa-recon'), /GL account 1200 is shared with other parties/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#soa-csv-btn')]);
    assert.match(download.suggestedFilename(), /^SOA_C001_2026-05-01_2026-05-31\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.match(csv, /Opening balance/);
    assert.match(csv, /Credit Note,.*,,100\.00,200\.00/);
    assert.match(csv, /Closing balance,,,500\.00,300\.00,200\.00/);
    assert.ok(await page.isEnabled('#soa-print-btn'));
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('vendor statement: drill through to the invoice and back', async () => {
    const page = await open('VENDORSOA', 'u-admin');
    await runStatement(page, 'V1', '2026-05-01', '2026-05-31');
    assert.match(await page.textContent('#soa-rows'), new RegExp(bill.invoiceNumber + '.*Invoice.*300\\.00', 's'));
    await page.click('#soa-rows .soa-open');
    await page.waitForFunction(n => document.getElementById('vinv-entry-title') && document.getElementById('vinv-entry-title').textContent === n,
      bill.invoiceNumber, { timeout: 30000 });
    await page.click('#vinv-back-chain-btn');
    await page.waitForSelector('#soa-report:not(.hidden)', { timeout: 30000 });
    assert.equal(await page.inputValue('#soa-party'), 'V1', 'the statement is re-run with the same parameters');
    assert.equal(await page.textContent('#soa-closing'), '300.00');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Viewer runs a statement', async () => {
    const page = await open('VENDORSOA', 'u-viewer');
    await runStatement(page, 'V1', '2026-01-01', '2026-12-31');
    assert.equal(await page.textContent('#soa-closing'), '300.00');
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
