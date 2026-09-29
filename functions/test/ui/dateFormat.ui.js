// Dates show dd/mm/yyyy, periods Sep-2026 (owner, 2026-09-29; public/index.html,
// DATE FORMAT): in lists, messages and Excel copies; date entry fields keep
// the browser picker and the stored yyyy-mm-dd value.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/dateFormat.ui.js
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
  const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Accrual for 2026-08', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] } });
  assert.equal(s.success, true, s.error);

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8153);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8153' });

  await check('JV: the list shows 10/09/2026 and Aug-2026; the entry\'s date field keeps 2026-09-10', async () => {
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8153/?module=JV&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#jv-table-body tr td:nth-child(3)', { timeout: 30000 });
    const row = await page.$$eval('#jv-table-body tr:first-child td', tds => tds.map(td => td.textContent.trim()));
    assert.equal(row[2], '10/09/2026');
    assert.equal(row[3], 'Accrual for Aug-2026');
    await page.evaluate(id => openModule('JV', { OpenEntryId: id }), s.jvId);
    await page.waitForSelector('#jv-form-date', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(500);
    assert.equal(await page.inputValue('#jv-form-date'), '2026-09-10', 'the browser picker keeps the stored value');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('messages, Excel copies and the copy box read dd/mm/yyyy; a question asking for yyyy-mm-dd keeps it; keep-iso opts out', async () => {
    const page = await context.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, () => {}); // answered below, after reading what it shows
    await page.goto('http://127.0.0.1:8153/?module=UOM&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });

    await page.evaluate(() => alert('Posted on 2026-09-10 for 2026-09.'));
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.equal(await page.textContent('#app-dialog-message'), 'Posted on 10/09/2026 for Sep-2026.');
    await page.click('#app-dialog-ok');

    await page.evaluate(() => navigator.clipboard.writeText('Date\tAmount\n2026-09-10\t40'));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Date\tAmount\n10/09/2026\t40');

    await page.evaluate(() => { window.__a = appPrompt('Copy this text (Ctrl+C / Cmd+C, then Enter):', 'Date\n2026-09-10'); });
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.equal(await page.inputValue('#app-dialog-textarea'), 'Date\n10/09/2026');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__b = appPrompt('Reversal date (YYYY-MM-DD):', '2026-09-29'); });
    await page.waitForSelector('#app-dialog:not(.hidden)');
    assert.equal(await page.inputValue('#app-dialog-input'), '2026-09-29', 'a date to type stays yyyy-mm-dd');
    await page.keyboard.press('Escape');

    const shown = await page.evaluate(async () => {
      const c = document.getElementById('module-container');
      c.insertAdjacentHTML('beforeend', '<p id="t1">Due 2026-12-31</p><p id="t2" class="keep-iso">Due 2026-12-31</p>');
      await new Promise(r => setTimeout(r, 50));
      document.getElementById('t1').firstChild.data = 'Changed to 2027-01-15';
      await new Promise(r => setTimeout(r, 50));
      return [document.getElementById('t1').textContent, document.getElementById('t2').textContent];
    });
    assert.deepEqual(shown, ['Changed to 15/01/2027', 'Due 2026-12-31']);
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
