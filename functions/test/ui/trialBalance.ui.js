// Drives the Trial Balance screen (opening / transactions / closing,
// 2026-09-27) in headless Chromium against the emulators, through the
// shell's real rpc bridge: From/To run, the nine columns and totals, the
// compact grid, drill-through to GL Report with the same period and back,
// the compact GL Report it opens, and the Viewer. Run the trialBalance emulator suite first — it leaves
// the journal entries this check reads:
//   node --test functions/test/emulator/trialBalance.emulator.test.js
//   node functions/test/ui/trialBalance.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8132);
  const browser = await chromium.launch();

  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8132/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return page;
  }
  const rpcFailures = page => page.evaluate(() => window.__rpcLog.filter(c => !c.ok).map(c => c.name + ': ' + c.error));
  async function runTb(page, from, to) {
    await page.waitForFunction(() => document.getElementById('tb-company').options.length > 1, null, { timeout: 30000 });
    await page.fill('#tb-from-date', from);
    await page.fill('#tb-to-date', to);
    await page.click('#tb-run-btn');
    await page.waitForSelector('#tb-results:not(.hidden)', { timeout: 30000 });
  }
  const tableRows = page => page.$$eval('#tb-table-body tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent.trim())));
  const totals = page => page.$$eval('#tb-total-od, #tb-total-oc, #tb-total-pd, #tb-total-pc, #tb-total-cd, #tb-total-cc', tds => tds.map(td => td.textContent));

  await check('From/To defaults, then a period run shows opening, transactions and closing', async () => {
    const page = await open('TRIALBALANCE', 'u-admin');
    const today = new Date().toISOString().substring(0, 10);
    assert.equal(await page.inputValue('#tb-from-date'), today.substring(0, 8) + '01');
    assert.equal(await page.inputValue('#tb-to-date'), today);
    await runTb(page, '2026-09-01', '2026-09-30');
    assert.equal(await page.textContent('#tb-period-label'), '2026-09-01 to 2026-09-30');
    assert.deepEqual(await tableRows(page), [
      ['1000', 'Cash', 'Asset', '500.00', '', '', '120.00', '380.00', ''],
      ['3000', 'Capital', 'Equity', '', '500.00', '', '', '', '500.00'],
      ['5100', 'Material Consumption', 'Expense', '', '', '120.00', '', '120.00', '']
    ]);
    assert.deepEqual(await totals(page), ['500.00', '500.00', '120.00', '120.00', '500.00', '500.00']);
    assert.match(await page.textContent('#tb-balance-note'), /totals match/);
    assert.deepEqual(await page.$$eval('#tb-results thead tr:first-child th', ths => ths.map(th => th.textContent.trim())),
      ['Code', 'Account', 'Type', 'Opening', 'Transactions', 'Closing']);
    assert.deepEqual(await rpcFailures(page), []);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('compact grid: tight cell padding and row height', async () => {
    const page = await open('TRIALBALANCE', 'u-admin');
    await runTb(page, '2026-09-01', '2026-09-30');
    const m = await page.$eval('#tb-table-body tr td:nth-child(4)', td => {
      const s = getComputedStyle(td);
      return { top: parseFloat(s.paddingTop), left: parseFloat(s.paddingLeft), height: td.parentElement.getBoundingClientRect().height };
    });
    assert.ok(m.top <= 4, 'vertical padding ' + m.top + 'px');
    assert.ok(m.left <= 8, 'horizontal padding ' + m.left + 'px');
    assert.ok(m.height <= 26, 'row height ' + m.height + 'px');
    await page.close();
  });

  await check('both dates required: an empty From shows the server message', async () => {
    const page = await open('TRIALBALANCE', 'u-admin');
    await runTb(page, '2026-09-01', '2026-09-30');
    await page.fill('#tb-from-date', '');
    await page.click('#tb-run-btn');
    await page.waitForSelector('#tb-error:not(.hidden)', { timeout: 30000 });
    assert.match(await page.textContent('#tb-error'), /Select both a From date and a To date/);
    assert.equal(await page.isHidden('#tb-results'), true);
    await page.close();
  });

  await check('drill-through to GL Report keeps the period, and Back restores the TB', async () => {
    const page = await open('TRIALBALANCE', 'u-admin');
    await runTb(page, '2026-09-01', '2026-09-30');
    await page.click('#tb-table-body tr:first-child .tb-drill-link');
    // (GL Report's own default From is this month's 1st, so wait on the account.)
    await page.waitForFunction(() => document.getElementById('gl-account-input') && document.getElementById('gl-account-input').value.startsWith('1000'), null, { timeout: 30000 });
    assert.equal(await page.inputValue('#gl-from-date'), '2026-09-01');
    assert.equal(await page.inputValue('#gl-to-date'), '2026-09-30');
    await page.click('#gl-back-btn');
    await page.waitForSelector('#tb-results:not(.hidden)', { timeout: 30000 });
    assert.equal(await page.inputValue('#tb-from-date'), '2026-09-01');
    assert.equal(await page.inputValue('#tb-to-date'), '2026-09-30');
    assert.equal((await tableRows(page)).length, 3);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('GL Report is compact too: opening, rows, closing; tight cells', async () => {
    const page = await open('TRIALBALANCE', 'u-admin');
    await runTb(page, '2026-09-01', '2026-09-30');
    await page.click('#tb-table-body tr:first-child .tb-drill-link');
    await page.waitForSelector('#gl-results:not(.hidden)', { timeout: 30000 });
    assert.equal(await page.textContent('#gl-opening-cell'), '500.00');
    assert.equal(await page.textContent('#gl-closing-cell'), '380.00');
    assert.equal(await page.textContent('#gl-total-credit'), '120.00');
    const cells = await page.$$eval('#gl-table-body tr td, #gl-results thead th, #gl-results tfoot td', tds => tds.map(td => {
      const s = getComputedStyle(td);
      return Math.max(parseFloat(s.paddingTop), parseFloat(s.paddingLeft) / 2);
    }));
    assert.ok(cells.length > 10 && cells.every(p => p <= 4), 'cell padding ' + JSON.stringify(cells));
    const h = await page.$eval('#gl-table-body tr:nth-child(2)', tr => tr.getBoundingClientRect().height);
    assert.ok(h <= 26, 'row height ' + h + 'px');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Viewer runs the report', async () => {
    const page = await open('TRIALBALANCE', 'u-viewer');
    await runTb(page, '2026-10-01', '2026-10-31');
    assert.deepEqual((await tableRows(page)).map(r => r[0]), ['1000', '1100', '3000', '5100']);
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
