// Master Data Import, Part 3 (owner, 2026-10-05; docs/modules/MASTER_IMPORT.md,
// decisions 8-11): Update existing, on screen. Employees offer the mode
// (Units of Measure don't yet); its columns start with the key; Copy
// current records gives the sheet; a paste of line managers shows each
// change before it is applied, then updates only what changed.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/masterImportUpdate.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, firestore } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

(async () => {
  await reset(baseFixture());
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const ids = [];
  for (const name of ['Sara Khan', 'Ali Hassan', 'Ben Okafor']) {
    ids.push((await call('u-admin', 'saveEmployee', { employee: { FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01' } })).employeeId);
  }
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8175);
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.__errors = []; page.__dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8175/?module=MASTERIMPORT&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#mimp-master option').length > 18, null, { timeout: 30000 });

  await check('Update existing is offered for Employees (not yet for others); its columns start with the key, without the job ones', async () => {
    await page.selectOption('#mimp-master', 'UOM');
    assert.ok(await page.isHidden('#mimp-mode-wrap'));
    await page.selectOption('#mimp-master', 'EMPLOYEE');
    assert.ok(await page.isVisible('#mimp-mode-wrap'));
    assert.ok(await page.isHidden('#mimp-copy-records'));
    await page.check('#mimp-mode-update');
    const cols = await page.$$eval('#mimp-columns tr td:first-child', tds => tds.map(t => t.textContent));
    assert.deepEqual([cols[0], cols.includes('Line Manager'), cols.includes('Grade'), cols.includes('Company')], ['Employee No.', true, false, false]);
    assert.match(await page.textContent('#mimp-note'), /A blank cell keeps the value; type - to clear it/);
    assert.ok(await page.isVisible('#mimp-copy-records'));
    assert.ok(await page.isHidden('#mimp-copy-sample'));
  });

  await check('Copy current records: the sheet of existing employees, key first', async () => {
    await page.click('#mimp-copy-records');
    await page.waitForFunction(() => /3 records copied/.test(document.getElementById('mimp-status').textContent), null, { timeout: 30000 });
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    assert.deepEqual([lines.length, lines[0].split('\t')[0], lines[1].split('\t')[0], lines[2].split('\t')[1]], [4, 'Employee No.', 'EMP-0001', 'Ali Hassan']);
  });

  await check('line managers pasted: each change shown, the unchanged row counted, then only the changes applied', async () => {
    await page.fill('#mimp-paste', 'Employee No.\tLine Manager\nEMP-0002\tEMP-0001\nEMP-0003\tSara Khan\nEMP-0001\t');
    await page.click('#mimp-check');
    await page.waitForFunction(() => /Ready to update/.test(document.getElementById('mimp-status').textContent), null, { timeout: 30000 });
    assert.match(await page.textContent('#mimp-status'), /3 rows checked, no issues: 2 records change, 1 unchanged/);
    const ch = await page.$$eval('#mimp-preview-body tr', rows => rows.map(r => r.cells[1].textContent));
    assert.deepEqual(ch, ['Line Manager: (empty) → EMP-0001 Sara Khan', 'Line Manager: (empty) → EMP-0001 Sara Khan', 'No change']);
    await page.click('#mimp-import');
    await page.waitForFunction(() => /2 records updated in Employees/.test(document.getElementById('mimp-status').textContent), null, { timeout: 30000 });
    assert.match(page.__dialogs[0], /^Update Employees from 3 rows\?/);
    const mgr = async id => (await firestore.collection('employees').doc(id).get()).data().ManagerID || '';
    assert.deepEqual([await mgr(ids[0]), await mgr(ids[1]), await mgr(ids[2])], ['', ids[0], ids[0]]);
  });

  await check('a locked column is refused with the reason, and Import stays off', async () => {
    await page.fill('#mimp-paste', 'Employee No.\tGrade\nEMP-0002\tG3');
    await page.click('#mimp-check');
    await page.waitForSelector('#mimp-issues-wrap:not(.hidden)', { timeout: 20000 });
    assert.match(await page.textContent('#mimp-issues'), /Grade can't be changed here: it changes through an Employee Change/);
    assert.ok(await page.$eval('#mimp-import', b => b.disabled));
    assert.deepEqual(page.__errors, []);
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
