// Roles & Permissions with many roles (owner, 2026-10-03: with 12 roles the
// role names and checkboxes, all in one cell, wrapped onto a second line,
// under the wrong roles). Each role is its own column now: every checkbox
// sits under its role's header, on one line, and saving still works.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/rolesMatrix.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const EXTRA = ['ACCOUNTANT', 'ADMIN_TESTER', 'CASHIER', 'FINANCE_MGR', 'HR Executive', 'HR Manager', 'MM Executive', 'MM Manager', 'Sales Executive', 'Sales Manager'];

(async () => {
  const f = baseFixture();
  EXTRA.forEach((n, i) => { f.roles['R' + i] = { Name: n, Description: 'A role', Status: 'Active' }; });
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8167);
  const browser = await chromium.launch();

  await check('12 roles: one column each, every checkbox under its own role, one line per row; saving keeps working', async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], dialogs = [];
    p.on('pageerror', e => errors.push(e.message));
    await onAppDialog(p, d => { dialogs.push(d.message()); d.accept(); });
    await p.goto('http://127.0.0.1:8167/?module=ROLES&uid=u-admin');
    await p.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await p.waitForFunction(() => document.querySelectorAll('#perm-table-body input[type=checkbox]').length > 0, null, { timeout: 30000 });
    const r = await p.evaluate(() => {
      const heads = [...document.querySelectorAll('.perm-role-th')];
      const rows = [...document.querySelectorAll('#perm-table-body tr')];
      const bad = [];
      rows.forEach(tr => {
        const boxes = [...tr.querySelectorAll('input[type=checkbox]')];
        if (boxes.length !== heads.length) bad.push('count ' + boxes.length);
        const tops = new Set(boxes.map(b => Math.round(b.getBoundingClientRect().top)));
        if (tops.size !== 1) bad.push('not one line: ' + tr.textContent.trim());
        boxes.forEach((b, i) => {
          const h = heads[i].getBoundingClientRect(), c = b.getBoundingClientRect(), mid = c.left + c.width / 2;
          if (mid < h.left || mid > h.right || b.title !== heads[i].textContent) bad.push(b.dataset.module + '/' + b.dataset.cap + ': ' + b.title + ' not under ' + heads[i].textContent);
        });
      });
      const headTops = new Set(heads.map(h => Math.round(h.getBoundingClientRect().top)));
      return { names: heads.map(h => h.textContent), bad: bad.slice(0, 5), rows: rows.length, headTops: headTops.size };
    });
    assert.equal(r.names.length, 12);
    assert.deepEqual(r.names, r.names.slice().sort((a, b) => a.localeCompare(b)));
    assert.equal(r.headTops, 1, 'the role headers are on one line');
    assert.ok(r.rows > 20, 'rows: ' + r.rows);
    assert.deepEqual(r.bad, []);
    // Tick Viewer's (the last column's) Chart of Accounts write, save, and it is stored.
    const box = '#perm-table-body input[data-module="COA"][data-cap="write"][data-role="Viewer"]';
    assert.equal(await p.isChecked(box), false);
    await p.check(box);
    await p.click('#perm-save-btn');
    await p.waitForFunction(() => /saved/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    let stored;
    for (let i = 0; i < 30; i++) {
      stored = (await call('u-admin', 'getModulePermissionsMatrix', {})).permissions.COA.write;
      if (stored.includes('Viewer')) break;
      await new Promise(ok => setTimeout(ok, 500));
    }
    assert.ok(stored.includes('Viewer'), 'stored: ' + JSON.stringify(stored));
    assert.deepEqual(errors, []);
    await p.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
