// Supporting documents on entries (owner, 2026-10-03; docs/modules/
// ATTACHMENTS.md): the section at the bottom of the entry (add, open,
// remove, the checks before upload), the paperclip in the list, the
// section in all 27 entry screens, and the Admin's Document Storage screen.
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/supportingDocs.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, call, reset, baseFixture, today } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); }); }

const MODULES = ['JV', 'CBT', 'PDCRECEIVED', 'PDCISSUED', 'RECURRINGJV', 'PURCHASEREQUISITION', 'INVENTORYPURCHASEREQUISITION', 'PURCHASEORDER',
  'JOBORDERREQUEST', 'SALESORDER', 'GRN', 'MATERIALISSUE', 'PRODUCTION', 'WAREHOUSEMOVEMENT', 'STOCKADJUSTMENT', 'PHYSICALCOUNT', 'VENDORINVOICE',
  'PURCHASERETURN', 'DELIVERYNOTE', 'CUSTOMERINVOICE', 'SALESRETURN', 'FAASSET', 'FAACQ', 'FAAUC', 'FAADDDEP', 'FADEPRUN', 'FARETIRE'];
const PDF = Buffer.from('%PDF-1.4\n% test document\n');
const XLSX = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('zip body')]);

(async () => {
  const f = baseFixture();
  f.permissions.DOCUMENTSTORAGE.access = ['Admin'];
  await reset(f);
  await call('u-admin', 'useTestDocumentStorage', {});
  const draft = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: today, Description: 'Bank charges', CompanyID: 'C1', CurrencyCode: 'AED',
    Lines: [{ AccountCode: '1100', Debit: 0, Credit: 50, Description: 'x' }, { AccountCode: '1000', Debit: 50, Credit: 0, Description: 'x' }] } });
  assert.equal(draft.success, true, draft.error);
  const jvId = draft.jvId;

  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8163);
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.__errors = [];
  const dialogs = [];
  page.on('pageerror', e => page.__errors.push(e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' ')));
  await onAppDialog(page, d => { dialogs.push(d.message()); d.accept(); });
  await page.goto('http://127.0.0.1:8163/?module=JV&uid=u-admin');
  await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
  await page.waitForSelector('#jv-table-body .jv-open', { timeout: 30000 });
  const sec = '.supdocs[data-module="JV"]';

  await check('a new entry: the section asks to save the draft first', async () => {
    assert.equal(await page.isVisible(sec), false, 'hidden with the list');
    await page.click('#jv-new-btn');
    await page.waitForSelector(sec + ':not(.hidden)', { timeout: 10000 });
    assert.match(await page.textContent(sec + ' .supdocs-note'), /Save the draft to attach documents\./);
    assert.equal(await page.isDisabled(sec + ' .supdocs-add'), true);
    await page.click('#jv-back-btn');
    await page.waitForSelector('#jv-table-body .jv-open', { timeout: 30000 });
  });

  await check('a draft: add files, the count, refused files never reach the server', async () => {
    await page.click('#jv-table-body tr[data-doc-id="' + jvId + '"] .jv-open');
    await page.waitForSelector(sec + ':not(.hidden)', { timeout: 10000 });
    await page.waitForFunction(s => /None yet/.test(document.querySelector(s + ' .supdocs-note').textContent), sec, { timeout: 15000 });
    const before = await page.evaluate(() => window.__rpcLog.filter(r => r.name === 'uploadAttachment').length);
    dialogs.length = 0;
    await page.setInputFiles(sec + ' .supdocs-input', [
      { name: 'invoice scan.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: 'calc.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX },
      { name: 'tool.exe', mimeType: 'application/octet-stream', buffer: PDF },
      { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10 * 1024 * 1024)]) }
    ]);
    await page.waitForFunction(s => document.querySelectorAll(s + ' .supdocs-list li').length === 2, sec, { timeout: 30000 });
    assert.deepEqual(await page.$$eval(sec + ' .supdocs-open', b => b.map(x => x.textContent)), ['invoice scan.pdf', 'calc.xlsx']);
    assert.equal((await page.textContent(sec + ' .supdocs-count')).trim(), '(2)');
    await page.waitForFunction(() => window.__rpcPendingCount === 0 || true);
    for (let i = 0; i < 20 && !dialogs.length; i++) await page.waitForTimeout(150);
    assert.equal(dialogs.length, 1, dialogs.join(' | '));
    assert.match(dialogs[0], /Some files were not added:/);
    assert.match(dialogs[0], /"tool\.exe": only PDF/);
    assert.match(dialogs[0], /"big\.pdf" is 10\.0 MB; the limit is 10 MB per file\./);
    const sent = await page.evaluate(() => window.__rpcLog.filter(r => r.name === 'uploadAttachment').map(r => r.arg.fileName));
    assert.deepEqual(sent.slice(before), ['invoice scan.pdf', 'calc.xlsx'], 'only the good files are uploaded');
    // Its own file field doesn't count as a change to the entry.
    const back = page.waitForSelector('#jv-table-body .jv-open', { timeout: 30000 });
    dialogs.length = 0;
    await page.click('#jv-back-btn');
    await back;
    assert.deepEqual(dialogs, [], 'no "unsaved changes" question');
  });

  await check('the list shows a paperclip with the count', async () => {
    await page.waitForSelector('#jv-table-body tr[data-doc-id="' + jvId + '"] .supdocs-clip', { timeout: 15000 });
    assert.equal((await page.textContent('#jv-table-body tr[data-doc-id="' + jvId + '"] .supdocs-clip')).trim(), '2');
  });

  await check('open: a PDF in a new tab, a spreadsheet downloads; remove asks first', async () => {
    await page.click('#jv-table-body tr[data-doc-id="' + jvId + '"] .jv-open');
    await page.waitForFunction(s => document.querySelectorAll(s + ' .supdocs-list li').length === 2, sec, { timeout: 15000 });
    // (Headless Chromium has no PDF viewer: the tab opening and the file
    // arriving is what is checked.)
    const [tab] = await Promise.all([context.waitForEvent('page'), page.click(sec + ' li:nth-child(1) .supdocs-open')]);
    await page.waitForFunction(() => window.__rpcLog.some(r => r.name === 'openAttachment' && r.ok), null, { timeout: 15000 });
    await tab.close();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sec + ' li:nth-child(2) .supdocs-open')]);
    assert.equal(dl.suggestedFilename(), 'calc.xlsx');
    assert.deepEqual(fs.readFileSync(await dl.path()), XLSX);
    dialogs.length = 0;
    await page.click(sec + ' li:nth-child(2) .supdocs-remove');
    await page.waitForFunction(s => document.querySelectorAll(s + ' .supdocs-list li').length === 1, sec, { timeout: 15000 });
    assert.deepEqual(dialogs, ['Remove "calc.xlsx" from this entry?']);
  });

  await check('an entry that gets its id while open (a new draft saved) gets its documents', async () => {
    await page.evaluate(() => {
      window.__sdId = '';
      const v = document.createElement('div'); v.id = 'sd-test-view'; document.body.appendChild(v);
      supportingDocs.mount({ module: 'JV', view: 'sd-test-view', id: () => window.__sdId });
    });
    const t = '#sd-test-view ~ .supdocs'; // its own section (the Linked documents panel may sit between, DOCUMENT LINKS)
    await page.waitForFunction(s => /Save the draft/.test(document.querySelector(s + ' .supdocs-note').textContent), t, { timeout: 5000 });
    await page.evaluate(id => { window.__sdId = id; }, jvId);
    await page.waitForFunction(s => document.querySelectorAll(s + ' .supdocs-list li').length === 1, t, { timeout: 15000 });
    assert.equal(await page.isDisabled(t + ' .supdocs-add'), false);
    await page.evaluate(() => document.getElementById('sd-test-view').remove());
  });

  await check('the section is in all 27 entry screens, below the entry, and loads cleanly', async () => {
    const missing = [];
    for (const m of MODULES) {
      await page.evaluate(id => { window.__moduleReady = false; openModule(id); }, m);
      await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
      await page.waitForFunction(() => __rpcPendingCount === 0, null, { timeout: 30000 }); // its own loads finish before the next screen
      const n = await page.$$eval('.supdocs[data-module="' + m + '"]', s => s.length);
      if (!n) missing.push(m);
    }
    assert.deepEqual(missing, []);
    assert.deepEqual(page.__errors, []);
  });

  await check('a stock document (GRN): the section belongs to the opened entry, and its paperclip', async () => {
    const g = await call('u-admin', 'saveGrnDraft', { TransactionDate: today, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
      Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: 1, UnitCost: 5, Description: 'in' }] });
    await call('u-admin', 'uploadAttachment', { module: 'GRN', docId: g.grnId, fileName: 'delivery note.pdf', data: PDF.toString('base64') });
    await page.evaluate(() => { window.__moduleReady = false; openModule('GRN'); });
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    const row = '#grn-table-body tr[data-doc-id="' + g.grnId + '"]';
    await page.waitForSelector(row + ' .supdocs-clip', { timeout: 30000 });
    await page.click(row + ' .grn-open');
    await page.waitForFunction(() => document.querySelectorAll('.supdocs[data-module="GRN"] .supdocs-list li').length === 1, null, { timeout: 15000 });
    assert.equal(await page.textContent('.supdocs[data-module="GRN"] .supdocs-open'), 'delivery note.pdf');
  });

  await check('Document Storage (Admin): status, OAuth client, the secret never comes back', async () => {
    await page.evaluate(() => { window.__moduleReady = false; openModule('DOCUMENTSTORAGE'); });
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    await page.waitForFunction(() => /Connected/.test(document.getElementById('ds-status').textContent), null, { timeout: 15000 });
    assert.match(await page.textContent('#ds-status'), /emulator@local/);
    assert.match(await page.textContent('#ds-redirect'), /\/driveOAuthCallback$/);
    await page.fill('#ds-client-id', 'abc');
    await page.fill('#ds-client-secret', 'shh');
    await page.click('#ds-save');
    await page.waitForFunction(() => /\.apps\.googleusercontent\.com/.test(document.getElementById('ds-message').textContent), null, { timeout: 15000 });
    await page.fill('#ds-client-id', '123-x.apps.googleusercontent.com');
    await page.fill('#ds-client-secret', 'shh');
    await page.click('#ds-save');
    await page.waitForFunction(() => /secret is saved/.test(document.getElementById('ds-secret-note').textContent), null, { timeout: 15000 });
    assert.equal(await page.inputValue('#ds-client-secret'), '');
    assert.equal(await page.isDisabled('#ds-connect'), false);
    await page.click('#ds-test');
    await page.waitForFunction(() => /The connection works/.test(document.getElementById('ds-message').textContent), null, { timeout: 15000 });
    assert.deepEqual(page.__errors, []);
  });

  await check('Document Storage is Admin only', async () => {
    const p2 = await browser.newPage();
    await p2.goto('http://127.0.0.1:8163/?module=DOCUMENTSTORAGE&uid=u-viewer');
    await p2.waitForFunction(() => /LOAD FAILED|Only Admin/.test(document.body.textContent), null, { timeout: 30000 });
    await p2.close();
  });

  await browser.close(); server.close(); await app.delete();
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log((results.length - failed) + '/' + results.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
