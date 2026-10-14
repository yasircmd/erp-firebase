// One look for every document print (owner, 2026-10-14; the shell's PRINT
// STYLE): a light, rounded frame and light lines between the cells, in
// place of the screens' dark grid. Checked on a posted JV's print; the
// payslip keeps its own layout. Saves a picture of the print to
// PRINT_STYLE_PNG when set. Seeds its own data (it WIPES the emulator
// database, like the suites):
//   node functions/test/ui/printStyle.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const ok = r => { assert.equal(r.success, true, r.error); return r; };

(async () => {
  await reset(baseFixture());
  const jv = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Monthly accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'Rent' }, { AccountCode: '1100', Credit: 40, Description: 'Bank' }] } })).jvId;
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: jv })).status, 'Posted');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8163);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => d.accept());
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto('http://127.0.0.1:8163/?module=JV&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });

  await check('a JV print: a light, rounded frame; light lines between cells; none on the outer edge twice', async () => {
    await page.evaluate(id => openModule('JV', { OpenEntryId: id }), jv);
    await page.waitForSelector('#jv-print-btn:not(.hidden)', { timeout: 30000 });
    await page.click('#jv-print-btn');
    await page.waitForFunction(() => window.__printed === 1);
    await page.emulateMedia({ media: 'print' });
    const s = await page.$eval('#jv-print-document table', t => {
      const cs = el => getComputedStyle(el);
      const rows = t.querySelectorAll('tr');
      const first = rows[0].cells[0], last = rows[rows.length - 1];
      return {
        collapse: cs(t).borderCollapse, frame: cs(t).borderTopColor + ' ' + cs(t).borderTopWidth, radius: cs(t).borderTopLeftRadius,
        line: cs(first).borderRightColor + ' ' + cs(first).borderRightWidth, lastCol: cs(rows[0].cells[rows[0].cells.length - 1]).borderRightWidth,
        lastRow: cs(last.cells[0]).borderBottomWidth, cellTop: cs(first).borderTopWidth, corner: cs(first).borderTopLeftRadius
      };
    });
    assert.deepEqual(s, { collapse: 'separate', frame: 'rgb(203, 213, 225) 1px', radius: '6px', line: 'rgb(226, 232, 240) 1px',
      lastCol: '0px', lastRow: '0px', cellTop: '0px', corner: '6px' });
    if (process.env.PRINT_STYLE_PNG) {
      await page.setViewportSize({ width: 820, height: 600 });
      await (await page.$('#jv-print-document')).screenshot({ path: process.env.PRINT_STYLE_PNG });
    }
    await page.emulateMedia({ media: 'screen' });
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
