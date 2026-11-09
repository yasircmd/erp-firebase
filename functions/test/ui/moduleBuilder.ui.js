// Module Builder, phase 1 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md):
// the builder screen makes and publishes a master; the one runtime screen runs
// it and a document (links, a line table with totals, numbering, a status move).
// Seeds its own data (it WIPES the emulator database, like the suites):
//   node functions/test/ui/moduleBuilder.ui.js
const http = require('http');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { onAppDialog } = require('./_appDialogs');
const { app, rtdb, call, reset, baseFixture } = require('../emulator/_helpers');

const results = [];
function check(name, fn) { return fn().then(() => { results.push(['PASS', name]); }, e => { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 400)]); }); }

(async () => {
  const f = baseFixture();
  f.customers = { K1: { CustomerCode: 'C-001', CustomerName: 'Example Guest LLC', CompanyID: 'C1', Status: 'Active' } };
  f.permissions.X_ROOM = { access: ['Admin'], write: ['Admin'] };
  f.permissions.X_STAY = { access: ['Admin'], write: ['Admin'], void: ['Admin'] };
  await reset(f);
  const harness = (require('./buildHarness'), fs.readFileSync(__dirname + '/harness.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); }).listen(8171);
  const browser = await chromium.launch();
  async function open(moduleId) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.__errors = []; page.__dialogs = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    await onAppDialog(page, d => { page.__dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? '' : undefined); });
    await page.goto('http://127.0.0.1:8171/?module=' + moduleId + '&uid=u-admin');
    await page.waitForFunction(() => window.__moduleReady === true, null, { timeout: 30000 });
    return page;
  }

  await check('the builder: a new master defined, saved as a draft, then published', async () => {
    const p = await open('BUILDER');
    await p.click('#bd-new');
    await p.fill('#bd-id', 'x_room');
    await p.fill('#bd-label', 'Room');
    await p.click('#bd-add-field');
    await p.fill('#bd-fields tr[data-i="0"] .bd-key', 'roomType');
    await p.fill('#bd-fields tr[data-i="0"] .bd-flabel', 'Room type');
    await p.selectOption('#bd-fields tr[data-i="0"] .bd-type', 'choice');
    await p.fill('#bd-fields tr[data-i="0"] .bd-options', 'Single\nDouble');
    await p.check('#bd-fields tr[data-i="0"] .bd-required');
    await p.check('#bd-fields tr[data-i="0"] .bd-col');
    await p.click('#bd-add-field');
    await p.fill('#bd-fields tr[data-i="1"] .bd-key', 'rate');
    await p.fill('#bd-fields tr[data-i="1"] .bd-flabel', 'Rate per night');
    await p.selectOption('#bd-fields tr[data-i="1"] .bd-type', 'amount');
    await p.check('#bd-fields tr[data-i="1"] .bd-col');
    await p.click('#bd-save');
    await p.waitForFunction(() => /Not published yet/.test(document.getElementById('bd-version').textContent));
    assert.ok(p.__dialogs.some(m => /Draft saved/.test(m)), p.__dialogs.join(' | '));
    await p.click('#bd-publish');
    await p.waitForFunction(() => /Published v1/.test(document.getElementById('bd-version').textContent));
    assert.ok(p.__dialogs.some(m => /version 1 published/.test(m)), p.__dialogs.join(' | '));
    await p.click('#bd-back');
    await p.waitForFunction(() => /X_ROOM/.test(document.getElementById('bd-body').textContent) && /v1/.test(document.getElementById('bd-body').textContent));
    assert.deepEqual(p.__errors, []);
    await p.close();
  });

  await check('the runtime: a room saved; a stay with a guest, rooms on its lines, totals, a number, then Confirmed', async () => {
    // The document, defined by the server calls (the builder screen's own work is checked above).
    await call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: { id: 'X_STAY', label: 'Stay', kind: 'document', numbering: { prefix: 'ST' },
      fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER', required: true }, { key: 'notes', label: 'Notes', type: 'longtext' }],
      lines: { enabled: true, label: 'Rooms', fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM', required: true }, { key: 'nights', label: 'Nights', type: 'number', required: true }, { key: 'amount', label: 'Amount', type: 'amount' }] },
      statuses: [{ name: 'Draft' }, { name: 'Confirmed' }, { name: 'Cancelled', final: true }], listColumns: ['guest'] } });
    await call('u-admin', 'publishModuleDefinition', { id: 'X_STAY' });

    const r = await open('X_ROOM');
    await r.waitForSelector('#bm-list-view:not(.hidden)');
    assert.equal(await r.textContent('#bm-label'), 'Room');
    await r.click('#bm-new');
    await r.fill('#bm-code', '101');
    await r.fill('#bm-name', 'Garden room');
    await r.selectOption('#bm-fields select[data-key="roomType"]', 'Double');
    await r.fill('#bm-fields input[data-key="rate"]', '450.50');
    await r.click('#bm-save');
    await r.waitForFunction(() => /101 · Garden room/.test(document.getElementById('bm-title').textContent));
    await r.click('#bm-back');
    await r.waitForFunction(() => /Garden room/.test(document.getElementById('bm-body').textContent));
    assert.match(await r.textContent('#bm-body'), /101\s*Garden room\s*Test Co One\s*Double\s*450\.50\s*Active/);
    assert.deepEqual(r.__errors, []);
    await r.close();

    const s = await open('X_STAY');
    await s.waitForSelector('#bm-list-view:not(.hidden)');
    await s.click('#bm-new');
    await s.waitForSelector('#bm-fields select[data-key="guest"] option[value="K1"]', { state: 'attached' });
    await s.selectOption('#bm-fields select[data-key="guest"]', 'K1');
    const room = await s.$eval('#bm-lines tr[data-line="0"] select[data-key="room"]', el => [...el.options].find(o => /101/.test(o.text)).value);
    await s.selectOption('#bm-lines tr[data-line="0"] select[data-key="room"]', room);
    await s.fill('#bm-lines tr[data-line="0"] input[data-key="nights"]', '2');
    await s.fill('#bm-lines tr[data-line="0"] input[data-key="amount"]', '901');
    await s.click('#bm-add-line');
    await s.selectOption('#bm-lines tr[data-line="1"] select[data-key="room"]', room);
    await s.fill('#bm-lines tr[data-line="1"] input[data-key="nights"]', '1');
    await s.fill('#bm-lines tr[data-line="1"] input[data-key="amount"]', '450.5');
    await s.waitForFunction(() => /1,351\.50/.test(document.getElementById('bm-lines-total').textContent));
    await s.click('#bm-save');
    await s.waitForFunction(() => /Stay ST-\d\d-000001/.test(document.getElementById('bm-title').textContent));
    assert.equal(await s.textContent('#bm-badge'), 'Draft');
    await s.click('#bm-status-buttons .bm-to[data-status="Confirmed"]');
    await s.waitForFunction(() => document.getElementById('bm-badge').textContent === 'Confirmed');
    assert.ok(await s.isHidden('#bm-save'), 'Confirmed: not editable');
    assert.ok(await s.isHidden('#bm-delete'));
    await s.click('#bm-back');
    await s.waitForFunction(() => /ST-\d\d-000001/.test(document.getElementById('bm-body').textContent));
    assert.match(await s.textContent('#bm-body'), /C-001 · Example Guest LLC\s*1,351\.50\s*Confirmed/);
    assert.deepEqual(s.__errors, []);
    await s.close();
  });

  await browser.close(); server.close(); await app.delete();
  void rtdb;
  results.forEach(r => console.log(r.join('  ')));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? failed + ' FAILED' : results.length + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
