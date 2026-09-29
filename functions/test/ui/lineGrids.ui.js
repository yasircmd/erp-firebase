// Line grids (owner, 2026-09-29; public/index.html, LINE GRIDS): compact
// rows and columns, room for the item / account name, and no empty last
// line once an entry is posted (a draft keeps it for typing).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/lineGrids.ui.js
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
  const jv = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-09-10', Description: 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] } })).jvId;
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: jv })).status, 'Posted');

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8152);
  const browser = await chromium.launch();
  async function open(module) {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__errors.push('dialog: ' + d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:8152/?module=' + module + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    return page;
  }
  const rows = (page, body) => page.$$eval(body + ' > tr', trs => trs.map(tr => ({
    shown: getComputedStyle(tr).display !== 'none',
    first: (tr.querySelector('input, select') || {}).value || ''
  })));

  await check('JV: a posted entry shows its two lines and no empty line; a new draft keeps the empty line', async () => {
    const page = await open('JV');
    await page.evaluate(id => openModule('JV', { OpenEntryId: id }), jv);
    await page.waitForSelector('#jv-grid-body tr input[disabled]', { timeout: 30000 });
    await page.waitForTimeout(300);
    const posted = await rows(page, '#jv-grid-body');
    assert.deepEqual(posted.filter(r => r.shown).map(r => r.first), ['1000', '1100'], 'only the two lines');
    assert.ok(posted.length === 3 && !posted[2].shown && posted[2].first === '', 'the empty last row is there, hidden');

    await page.evaluate(() => openModule('JV'));
    await page.waitForSelector('#jv-new-btn:not(.hidden)', { timeout: 30000 });
    await page.click('#jv-new-btn');
    await page.waitForSelector('#jv-grid-body tr input:not([disabled])');
    const draft = await rows(page, '#jv-grid-body');
    assert.ok(draft.length >= 1 && draft.every(r => r.shown), 'a draft shows its empty line for typing');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('Production: compact cells and inputs, and room for the item name', async () => {
    const page = await open('PRODUCTION');
    await page.click('#prd-new-btn');
    await page.waitForSelector('#prd-grid-body tr');
    const s = await page.evaluate(() => {
      const td = document.querySelector('#prd-grid-body tr td:nth-child(2)');
      const input = td.querySelector('input, select');
      const th = document.querySelector('#prd-grid-body').closest('table').querySelector('thead th');
      const name = document.querySelector('#prd-grid-body td.prd-item-name');
      const px = v => parseFloat(v);
      return { td: px(getComputedStyle(td).paddingTop), input: px(getComputedStyle(input).paddingTop), th: px(getComputedStyle(th).paddingTop),
        nameMin: px(getComputedStyle(name).minWidth), nameWidth: name.getBoundingClientRect().width };
    });
    assert.ok(s.td <= 2, 'cell padding ' + s.td);
    assert.ok(s.input <= 3.5, 'input padding ' + s.input);
    assert.ok(s.th <= 5, 'header padding ' + s.th);
    assert.ok(s.nameMin >= 200 && s.nameWidth >= 200, 'item name ' + JSON.stringify(s));
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await check('lists and reports: compact rows in every table; the Trial Balance keeps its own tighter grid', async () => {
    const pad = (page, sel) => page.$eval(sel, el => [parseFloat(getComputedStyle(el).paddingTop), parseFloat(getComputedStyle(el).paddingLeft)]);
    let page = await open('JV');
    await page.waitForSelector('#jv-table-body tr td:nth-child(2)', { timeout: 30000 });
    assert.deepEqual(await pad(page, '#jv-table-body tr td'), [4.8, 9.6], 'list row: 0.3rem / 0.6rem');
    assert.deepEqual(await pad(page, 'table:has(#jv-table-body) thead th'), [4.8, 9.6], 'list header');
    // JV list (owner, 2026-09-29): JV Number, Txn Ref and Date stay on one
    // line; Description gives up the room (2/5 of the width, wrapping).
    const cols = await page.$eval('table:has(#jv-table-body)', t => ({
      head: [...t.tHead.rows[0].cells].slice(0, 4).map(c => c.className),
      row: [...t.tBodies[0].rows[0].cells].slice(0, 4).map(c => c.className) }));
    for (const part of ['head', 'row']) {
      cols[part].slice(0, 3).forEach((c, i) => assert.match(c, /\bwhitespace-nowrap\b/, part + ' column ' + (i + 1)));
      assert.doesNotMatch(cols[part][3], /whitespace-nowrap/, part + ' Description wraps');
    }
    assert.match(cols.head[3], /\bw-2\/5\b/, 'Description width');
    await page.close();
    page = await open('TRIALBALANCE');
    const tb = await pad(page, 'table.tb-compact thead th');
    assert.equal(tb[0], 3.2, 'Trial Balance: its own 0.2rem');
    assert.deepEqual(page.__errors, []);
    await page.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
