// Loading, not "nothing found" (owner, 2026-09-29; public/index.html,
// MODULE LOADING): while a module's first server calls are pending, a
// screen's empty-state text ("No transactions found.") reads "Loading…";
// once they finish, a list that is really empty shows its message again.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/moduleLoading.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8151);
  const browser = await chromium.launch();
  // Opens a module with one server call held back, sampling what the
  // list shows while it is pending.
  async function openSlow(module, slowCall, bodySelector) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    let release;
    const held = new Promise(r => { release = r; });
    await page.route('**/us-central1/' + slowCall, async route => { await held; await route.continue(); });
    await page.goto('http://127.0.0.1:8151/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForTimeout(1500); // everything else has answered by now
    const during = { text: (await page.textContent(bodySelector)).trim(), loading: await page.getAttribute('#module-container', 'data-loading') };
    release();
    await page.waitForFunction(() => !document.getElementById('module-container').dataset.loading, null, { timeout: 15000 });
    return { page, during };
  }

  await check('CBT with nothing yet: "Loading…" while its list loads, then "No transactions found."', async () => {
    const { page, during } = await openSlow('CBT', 'getCbtEntries', '#cbt-table-body');
    assert.equal(during.loading, 'true');
    assert.equal(during.text, 'Loading…', 'not "No transactions found." while loading');
    assert.equal((await page.textContent('#cbt-table-body')).trim(), 'No transactions found.');
    assert.equal(await page.locator('#module-container .module-loading-note').count(), 0);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('CBT with a transaction: "Loading…", then the transaction (never "No transactions found.")', async () => {
    const s = await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: '2026-09-10',
      Description: 'Office rent', CompanyID: 'C1', CostCenterID: 'CC1', OppositeLines: [{ AccountCode: '1000', Amount: 75, Description: 'Rent' }] } });
    assert.equal(s.success, true, s.error);
    const { page, during } = await openSlow('CBT', 'getCbtEntries', '#cbt-table-body');
    assert.equal(during.text, 'Loading…');
    await page.waitForSelector('#cbt-table-body tr:has-text("Office rent")', { timeout: 15000 });
    assert.doesNotMatch(await page.textContent('#cbt-table-body'), /No transactions found|Loading/);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('a generated screen (Price Listing): "Loading…", then its own empty message', async () => {
    const { page, during } = await openSlow('PRICELISTING', 'getPriceLists', '#pl-table-body');
    assert.equal(during.text, 'Loading…');
    assert.equal((await page.textContent('#pl-table-body')).trim(), 'No price lists found.');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('the rules: data cells are never swapped; a call started right after another keeps it loading', async () => {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:8151/?module=UOM&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('module-container').dataset.loading, null, { timeout: 15000 });
    const read = () => page.evaluate(() => [...document.querySelectorAll('#t td, #t p')].map(el => el.textContent.trim()));
    await page.evaluate(() => {
      const c = document.getElementById('module-container');
      __rpcPendingCount++; // as if a call were in flight
      watchModuleLoading(c);
      c.innerHTML = '<div id="t"><table><tr><td>No</td><td>No VAT on this line</td></tr>' +
        '<tr><td colspan="2">No lines yet.</td></tr></table><p>Nothing to show here.</p><p>Notes: none</p></div>';
    });
    await page.waitForTimeout(100);
    assert.deepEqual(await read(), ['No', 'No VAT on this line', 'Loading…', 'Loading…', 'Notes: none']);
    // One call ends and the next starts at once (e.g. permissions, then the list).
    await page.evaluate(() => { __rpcPendingCount--; moduleLoadingIdle(); __rpcPendingCount++; });
    await page.waitForTimeout(400);
    assert.deepEqual((await read()).slice(2, 4), ['Loading…', 'Loading…'], 'still loading');
    await page.evaluate(() => { __rpcPendingCount--; moduleLoadingIdle(); });
    await page.waitForTimeout(400);
    assert.deepEqual(await read(), ['No', 'No VAT on this line', 'No lines yet.', 'Nothing to show here.', 'Notes: none']);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
