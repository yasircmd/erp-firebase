// GL references on screen (owner, 2026-10-06; docs/modules/GL_REFERENCES.md):
// an opening balance journal opened from the GL report lands in Opening
// Balances with its company selected and the batch that posted it
// highlighted. Seeds its own data (it WIPES the emulator database):
//   node functions/test/ui/glReferences.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  const f = baseFixture();
  f.coa['A-OBC'] = { AccountCode: '3900', AccountName: 'Opening Balance Clearing', AccountType: 'Equity', Status: 'Active', IsPostable: true };
  await reset(f);
  await call('u-admin', 'saveOpeningBalanceSettings', { companyId: 'C1', openingDate: '2025-12-31', clearingAccountId: 'A-OBC' });
  const tsv = rows => rows.map(r => r.join('\t')).join('\n');
  const first = (await call('u-admin', 'postOpeningBalances', { kind: 'GL', companyId: 'C1', text: tsv([['Account', 'Debit', 'Credit', 'Description', 'Cost Center', 'Profit Center'], ['1000', '500', '', '', '', '']]) })).batchId;
  const second = (await call('u-admin', 'postOpeningBalances', { kind: 'GL', companyId: 'C1', text: tsv([['Account', 'Debit', 'Credit', 'Description', 'Cost Center', 'Profit Center'], ['1000', '40', '', '', '', '']]) })).batchId;
  const jvId = (await val('openingBalances/batches/' + first)).JVIDs[0];

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8177);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8177/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }

  await check('from the GL: an opening balance journal opens Opening Balances, its company selected and the batch that posted it highlighted', async () => {
    const p = await open('OPENINGBALANCES', 'u-admin');
    await p.waitForFunction(() => document.getElementById('ob-company').options.length > 1, null, { timeout: 30000 });
    await p.evaluate(jv => openModule('OPENINGBALANCES', { OpenEntryId: jv }), jvId);
    await p.waitForSelector('#ob-batches tr.ob-opened', { timeout: 30000 });
    assert.equal(await p.inputValue('#ob-company'), 'C1');
    assert.equal(await p.getAttribute('#ob-batches tr.ob-opened', 'data-batch'), first);
    assert.equal(await p.locator('#ob-batches tr.ob-opened').count(), 1);
    assert.ok(await p.locator('#ob-batches tr[data-batch="' + second + '"]:not(.ob-opened)').count());
    assert.deepEqual([p.__errors, p.__dialogs], [[], []]);
    await p.close();
  });

  await check('a journal no batch posted: the screen says so and opens as usual', async () => {
    const p = await open('OPENINGBALANCES', 'u-admin');
    await p.waitForFunction(() => document.getElementById('ob-company').options.length > 1, null, { timeout: 30000 });
    await p.evaluate(() => openModule('OPENINGBALANCES', { OpenEntryId: 'nope' }));
    await p.waitForFunction(() => document.getElementById('ob-company') && document.getElementById('ob-company').options.length > 1, null, { timeout: 30000 });
    for (let i = 0; i < 40 && !p.__dialogs.length; i++) await new Promise(ok => setTimeout(ok, 250));
    assert.deepEqual(p.__dialogs, ['That journal was not posted by an opening balance batch.']);
    assert.equal(await p.locator('#ob-batches tr.ob-opened').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
