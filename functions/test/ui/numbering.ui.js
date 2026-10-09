// Numbering on screen (owner, 2026-10-09; docs/modules/NUMBERING.md,
// decisions 80-83): every type listed with its sample; the builder (prefix,
// company code, year, order, separator, digits) with a live sample; saved,
// marked customized and logged; a format giving another type's numbers
// refused; the company code offered only where a type belongs to a company;
// reset to the default (asked first); a Viewer sees it read-only.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/numbering.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, val } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const YY = String(new Date().getFullYear()).slice(-2);

(async () => {
  await reset(baseFixture());
  // The emulator starts each function on its first call: start them before the browser times them.
  await call('u-admin', 'getNumbering', {});
  await call('u-admin', 'saveNumberingFormat', { kind: 'doc:NOPE' }).catch(() => {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8186);
  const browser = await chromium.launch();
  async function open(uid, answer) {
    const page = await browser.newPage();
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); if (answer && answer(d) === 'dismiss') d.dismiss(); else d.accept(); });
    await page.goto('http://127.0.0.1:8186/?module=NUMBERING&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForSelector('#nb-groups tr[data-kind="doc:BP"]', { timeout: 30000 });
    return page;
  }
  const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 30000 });
  const dialogs = async (p, n) => { for (let i = 0; i < 300 && p.__dialogs.length < n; i++) await new Promise(r => setTimeout(r, 100)); };
  const closed = p => until(p, () => !document.getElementById('app-dialog') || document.getElementById('app-dialog').classList.contains('hidden'));
  const row = (p, k) => p.textContent('#nb-groups tr[data-kind="' + k + '"]');

  await check('the list: documents, master codes, HR documents, each with its sample; the owner\'s BP-01-26-00001 built and saved, marked customized and logged', async () => {
    const p = await open('u-admin');
    assert.match(await row(p, 'doc:BP'), new RegExp('Bank Payment\\s*BP-' + YY + '-01-000001\\s*default'));
    assert.match(await row(p, 'item:RawMaterial'), /Item — Raw Material\s*RM-000001/);
    assert.match(await row(p, 'hr:LV'), new RegExp('Leave Application\\s*LV-20' + YY + '-0001'));
    assert.deepEqual(await p.$$eval('#nb-groups > div > div:first-child', x => x.map(e => e.textContent)), ['Documents', 'Master codes', 'HR documents']);
    await p.click('#nb-groups tr[data-kind="doc:BP"] .nb-edit');
    await p.waitForSelector('#nb-edit:not(.hidden)');
    assert.equal(await p.textContent('#nb-preview'), 'BP-' + YY + '-01-000001');
    assert.equal(await p.textContent('#nb-default-note'), '(the default)');
    await p.selectOption('#nb-order', 'CY');
    await p.fill('#nb-digits', '5');
    assert.equal(await p.textContent('#nb-preview'), 'BP-01-' + YY + '-00001');
    await p.uncheck('#nb-company');
    assert.ok(await p.isHidden('#nb-order-wrap'), 'the order only matters with both');
    assert.equal(await p.textContent('#nb-preview'), 'BP-' + YY + '-00001');
    await p.check('#nb-company');
    await p.click('#nb-save');
    await dialogs(p, 1);
    assert.deepEqual(p.__dialogs, ['Bank Payment: new numbers will look like BP-01-' + YY + '-00001.']);
    await until(p, () => /customized/.test(document.querySelector('#nb-groups tr[data-kind="doc:BP"]').textContent));
    assert.match(await row(p, 'doc:BP'), new RegExp('BP-01-' + YY + '-00001'));
    assert.match(await p.textContent('#nb-log'), new RegExp('admin\\s*Bank Payment\\s*BP-' + YY + '-01-000001\\s*BP-01-' + YY + '-00001'));
    assert.deepEqual((await val('numbering/formats/doc:BP')).Order, 'CY');
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a format giving another type\'s numbers is refused; an item has no company code; Find narrows the list', async () => {
    const p = await open('u-admin');
    await p.click('#nb-groups tr[data-kind="doc:CR"] .nb-edit');
    await p.fill('#nb-prefix', 'BR');
    await p.click('#nb-save');
    await dialogs(p, 1);
    assert.match(p.__dialogs[0], /That would give the same numbers as Bank Receipt/);
    await closed(p);
    assert.ok(await p.isVisible('#nb-edit'), 'the builder stays open to fix it');
    await p.click('#nb-cancel');
    await p.fill('#nb-search', 'raw');
    await until(p, () => document.querySelectorAll('#nb-groups tr[data-kind]').length === 1);
    await p.click('#nb-groups tr[data-kind="item:RawMaterial"] .nb-edit');
    assert.ok(await p.isDisabled('#nb-company'));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('reset to the default, asked first; Cancel keeps it', async () => {
    let answer = 'dismiss';
    const p = await open('u-admin', d => (d.type() === 'confirm' ? answer : undefined));
    await p.click('#nb-groups tr[data-kind="doc:BP"] .nb-edit');
    await p.click('#nb-reset');
    await dialogs(p, 1);
    assert.match(p.__dialogs[0], new RegExp('^Reset Bank Payment to the default \\(BP-' + YY + '-01-000001\\)\\?'));
    await closed(p);
    await new Promise(r => setTimeout(r, 1000));
    assert.ok((await val('numbering/formats/doc:BP')), 'Cancel keeps the customized format');
    assert.ok(await p.isVisible('#nb-edit'));
    answer = 'ok';
    await p.click('#nb-reset');
    await dialogs(p, 3);
    assert.equal(p.__dialogs.length, 3);
    assert.equal(p.__dialogs[2], 'Bank Payment: new numbers will look like BP-' + YY + '-01-000001.');
    assert.equal(await val('numbering/formats/doc:BP'), null);
    await until(p, () => /default/.test(document.querySelector('#nb-groups tr[data-kind="doc:BP"]').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('a Viewer sees the numbering read-only', async () => {
    const p = await open('u-viewer');
    assert.ok(await p.isVisible('#nb-readonly'));
    assert.equal(await p.locator('.nb-edit').count(), 0);
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
