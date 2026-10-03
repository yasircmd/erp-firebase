// Company Documents (owner, 2026-10-03; docs/modules/COMPANY_DOCUMENTS.md):
// add a document and its files, a vendor's document, renew, remove, the
// view-only user, categories, and "Documents (n)" from the Company and
// Vendor Master (with Back).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/companyDocs.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture } = require('../emulator/_helpers');
const { todayIn, addDays } = require('../../src/recurringSchedule');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }
const T = todayIn('Asia/Dubai');
const PDF = Buffer.from('%PDF-1.4\n% licence\n');

(async () => {
  const f = baseFixture();
  f.permissions.DOCUMENTSTORAGE.access = ['Admin'];
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8164);
  const browser = await chromium.launch();
  async function open(module, uid) {
    const page = await browser.newPage();
    page.__errors = [];
    page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(page.__answer || '') : d.accept(); });
    await page.goto('http://127.0.0.1:8164/?module=' + module + '&uid=' + uid);
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }
  const page = await open('COMPANYDOCS', 'u-admin');
  await page.waitForFunction(() => document.querySelectorAll('#cd-form-company option').length > 1 && !document.getElementById('cd-new-btn').classList.contains('hidden'), null, { timeout: 30000 });
  const fillDoc = async (category, title, ref, expiry) => {
    await page.selectOption('#cd-form-category', { label: category });
    await page.fill('#cd-form-title', title);
    await page.fill('#cd-form-reference', ref);
    if (expiry) await page.fill('#cd-form-expiry', expiry);
  };
  const saved = title => page.waitForFunction(t => document.getElementById('cd-form-heading').textContent.startsWith(t) && !document.getElementById('cd-entry-view').classList.contains('hidden'), title, { timeout: 15000 });

  await check('add a document, then its files; the list shows its status and paperclip', async () => {
    await page.click('#cd-new-btn');
    assert.match(await page.textContent('.supdocs[data-module="COMPANYDOCS"] .supdocs-note'), /Save the document to attach its files/);
    await page.click('#cd-save-btn');
    await page.waitForFunction(() => /Choose the category|Enter the title/.test(document.getElementById('cd-form-error').textContent), null, { timeout: 10000 });
    await fillDoc('Trade Licence', 'Trade licence', 'TL-100', addDays(T, 10));
    await page.click('#cd-save-btn');
    await saved('Trade licence — TL-100');
    assert.match(await page.textContent('#cd-form-status'), /Expiring \(10 days\)/);
    await page.waitForSelector('.supdocs[data-module="COMPANYDOCS"] .supdocs-add:not(.hidden):not([disabled])', { timeout: 15000 });
    await page.setInputFiles('.supdocs[data-module="COMPANYDOCS"] .supdocs-input', [{ name: 'licence.pdf', mimeType: 'application/pdf', buffer: PDF }]);
    await page.waitForFunction(() => document.querySelectorAll('.supdocs[data-module="COMPANYDOCS"] .supdocs-list li').length === 1, null, { timeout: 15000 });
    await page.click('#cd-back-btn');
    await page.waitForSelector('#cd-table-body tr[data-doc-id] .supdocs-clip', { timeout: 15000 });
    const row = await page.textContent('#cd-table-body tr[data-doc-id]');
    assert.match(row, /Trade licence/); assert.match(row, /TL-100/); assert.match(row, /Expiring/);
  });

  await check('a vendor\'s document: the vendor list, saved with the vendor', async () => {
    await page.click('#cd-new-btn');
    await fillDoc('Contract', 'Supply contract', 'SC-1');
    await page.selectOption('#cd-form-party-type', 'Vendor');
    await page.waitForFunction(() => [...document.querySelectorAll('#cd-form-party option')].some(o => o.value === 'V1'), null, { timeout: 5000 });
    await page.selectOption('#cd-form-party', 'V1');
    await page.click('#cd-save-btn');
    await saved('Supply contract');
    await page.click('#cd-back-btn');
    await page.waitForFunction(() => /Acme Metals/.test(document.getElementById('cd-table-body').textContent), null, { timeout: 15000 });
  });

  await check('renew: a new record; the old one kept as an earlier version', async () => {
    await page.fill('#cd-search', 'TL-100');
    await page.click('#cd-table-body tr[data-doc-id]');
    await saved('Trade licence');
    await page.click('#cd-renew-btn');
    await page.fill('#cd-form-reference', 'TL-200');
    await page.fill('#cd-form-issue', T);
    await page.fill('#cd-form-expiry', addDays(T, 365));
    await page.click('#cd-save-btn');
    await saved('Trade licence — TL-200');
    assert.match(await page.textContent('#cd-form-status'), /Active/);
    assert.match(await page.textContent('#cd-versions'), /Earlier: Trade licence — TL-100/);
    // The renewal starts without files (the old ones stay with the old record).
    await page.waitForFunction(() => /None yet/.test(document.querySelector('.supdocs[data-module="COMPANYDOCS"] .supdocs-note').textContent), null, { timeout: 15000 });
  });

  await check('remove asks for the reason; the record stays, as Removed', async () => {
    page.__answer = 'Wrong scan';
    await page.click('#cd-remove-btn');
    await page.waitForFunction(() => /Removed by .*: Wrong scan/.test(document.getElementById('cd-form-note').textContent), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#cd-save-btn'), false);
    await page.waitForFunction(() => document.querySelector('.supdocs[data-module="COMPANYDOCS"] .supdocs-add').classList.contains('hidden'), null, { timeout: 15000 }); // no files added to a removed record
    assert.match(await page.textContent('#cd-history'), /Remove: Wrong scan/);
  });

  await check('categories: Admin adds one; it is offered in the form', async () => {
    await page.click('#cd-back-btn');
    await page.click('#cd-categories-btn');
    await page.fill('#cd-new-category', 'Staff Visas');
    await page.click('#cd-add-category');
    await page.waitForFunction(() => [...document.querySelectorAll('#cd-category-filter option')].some(o => o.textContent === 'Staff Visas'), null, { timeout: 15000 });
    await page.click('#cd-new-btn');
    assert.ok((await page.$$eval('#cd-form-category option', o => o.map(x => x.textContent))).includes('Staff Visas'));
    await page.click('#cd-back-btn');
    assert.deepEqual(page.__errors, []);
  });

  await check('a view-only user: no New, no changes, files open but no Add', async () => {
    const v = await open('COMPANYDOCS', 'u-viewer');
    await v.waitForSelector('#cd-table-body tr[data-doc-id]', { timeout: 30000 });
    assert.equal(await v.isVisible('#cd-new-btn'), false);
    await v.click('#cd-table-body tr[data-doc-id]');
    await v.waitForFunction(() => !document.getElementById('cd-entry-view').classList.contains('hidden'), null, { timeout: 15000 });
    // (The first current row is the vendor's contract, which has no files.)
    await v.waitForFunction(() => /No files\./.test(document.querySelector('.supdocs[data-module="COMPANYDOCS"] .supdocs-note').textContent), null, { timeout: 15000 });
    assert.equal(await v.isVisible('#cd-save-btn'), false);
    assert.equal(await v.isDisabled('#cd-form-title'), true);
    assert.equal(await v.isVisible('.supdocs[data-module="COMPANYDOCS"] .supdocs-add'), false);
    assert.match(await v.textContent('#cd-form-note'), /view this document but not change it|Renewed|Removed/);
    assert.deepEqual(v.__errors, []);
    await v.close();
  });

  await check('Vendor Master: "Documents (n)" opens that vendor\'s documents, and Back returns', async () => {
    const m = await open('VENDORMASTER', 'u-admin');
    await m.waitForSelector('#ven-table-body tr[data-party-id="V1"] .party-docs', { timeout: 30000 });
    assert.match(await m.textContent('#ven-table-body tr[data-party-id="V1"] .party-docs'), /Documents \(1\)/);
    await m.click('#ven-table-body tr[data-party-id="V1"] .party-docs');
    await m.waitForFunction(() => /Supply contract/.test((document.getElementById('cd-table-body') || {}).textContent || ''), null, { timeout: 30000 });
    assert.match(await m.textContent('#cd-party-chip'), /Documents of vendor Acme Metals/);
    assert.doesNotMatch(await m.textContent('#cd-table-body'), /Trade licence/);
    await m.click('#cd-back-chain-btn');
    await m.waitForSelector('#ven-table-body tr[data-party-id="V1"]', { timeout: 30000 });
    assert.deepEqual(m.__errors, []);
    await m.close();
  });

  await check('Company Master: "Documents (n)" opens the company\'s documents; none for a user without access', async () => {
    const m = await open('COMPANYMASTER', 'u-admin');
    await m.waitForSelector('#co-table-body tr[data-party-id="C1"] .party-docs', { timeout: 30000 });
    // Current only: the licence was renewed (TL-100) and the renewal removed (TL-200); the vendor's contract counts.
    assert.match(await m.textContent('#co-table-body tr[data-party-id="C1"] .party-docs'), /Documents \(1\)/);
    await m.click('#co-table-body tr[data-party-id="C1"] .party-docs');
    await m.waitForFunction(() => document.getElementById('cd-company-filter') && document.getElementById('cd-company-filter').value === 'C1', null, { timeout: 30000 });
    await m.close();
    const { rtdb } = require('../emulator/_helpers');
    await rtdb.ref('permissions/COMPANYDOCS/access').set(['Admin']);
    const v = await open('COMPANYMASTER', 'u-viewer');
    await v.waitForSelector('#co-table-body tr[data-party-id="C1"]', { timeout: 30000 });
    await v.waitForTimeout(1500);
    assert.equal(await v.$$eval('.party-docs', b => b.length), 0);
    await v.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
