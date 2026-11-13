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
  f.customers = { K1: { CustomerCode: 'C-001', CustomerName: 'Example Guest LLC', CompanyID: 'C1', Status: 'Active', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
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

  await check('phase 2: the builder sets a board; the Board tab shows each room\'s state; the Calendar tab shows a booking as a bar that opens it', async () => {
    // The builder: X_ROOM gets a board, its state set by hand from Room type (a choice field here).
    const p = await open('BUILDER');
    await p.click('#bd-body tr[data-id="X_ROOM"]');
    await p.waitForSelector('#bd-edit-view:not(.hidden)');
    await p.check('#bd-board-on');
    await p.waitForSelector('#bd-board-field', { state: 'visible' });
    await p.click('#bd-publish');
    await p.waitForFunction(() => /Published v2/.test(document.getElementById('bd-version').textContent));
    assert.deepEqual((await call('u-admin', 'getModuleDefinition', { id: 'X_ROOM' })).published.board, { enabled: true, stateField: '' });
    assert.deepEqual(p.__errors, []);
    await p.close();

    // A booking module with a schedule, a room and a confirmed booking (by the server calls).
    await call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: { id: 'X_HOLD', label: 'Hold', kind: 'document', numbering: { prefix: 'HD' }, listColumns: ['guest'],
      fields: [{ key: 'guest', label: 'Guest', type: 'text' }, { key: 'arrival', label: 'Arrival', type: 'date' }, { key: 'departure', label: 'Departure', type: 'date' }],
      lines: { enabled: true, fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM' }] },
      statuses: [{ name: 'Draft' }, { name: 'Confirmed' }, { name: 'Cancelled', final: true }],
      schedule: { enabled: true, resourceField: 'room', startField: 'arrival', endField: 'departure', holds: [{ status: 'Confirmed', state: 'Booked' }] } } });
    await call('u-admin', 'publishModuleDefinition', { id: 'X_HOLD' });
    await rtdb.ref('permissions/X_HOLD').set({ access: ['Admin'], write: ['Admin'], void: ['Admin'] });
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const plus = n => { const t = new Date(today + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const roomId = (await call('u-admin', 'listBuiltRecords', { moduleId: 'X_ROOM' })).records.find(r => r.Code === '101').RecordID;
    const h = await call('u-admin', 'saveBuiltRecord', { moduleId: 'X_HOLD', record: { CompanyID: 'C1', Date: today, Fields: { guest: 'Guest A', arrival: today, departure: plus(2) }, Lines: [{ room: { id: roomId } }] } });
    await call('u-admin', 'setBuiltStatus', { moduleId: 'X_HOLD', id: h.id, status: 'Confirmed' });

    const r = await open('X_ROOM');
    await r.waitForSelector('#bm-tabs:not(.hidden)');
    assert.ok(await r.isHidden('.bm-tab[data-tab="calendar"]'), 'a master has no calendar');
    await r.click('.bm-tab[data-tab="board"]');
    await r.waitForFunction(() => /Booked/.test(document.getElementById('bm-board').textContent));
    assert.match(await r.textContent('#bm-board'), /Booked\s*1\s*101 · Garden room\s*HD-\d\d-000001 · Guest A/);
    assert.match(await r.textContent('#bm-board'), /Free\s*0/);
    assert.deepEqual(r.__errors, []);
    await r.close();

    const c = await open('X_HOLD');
    await c.waitForSelector('#bm-tabs:not(.hidden)');
    assert.ok(await c.isHidden('.bm-tab[data-tab="board"]'), 'a document has no board');
    await c.click('.bm-tab[data-tab="calendar"]');
    await c.waitForSelector('#bm-calendar .bm-bar');
    assert.equal(await c.$eval('#bm-calendar .bm-bar', b => b.closest('td').colSpan), 2, 'two nights: two days\' bar');
    assert.match(await c.textContent('#bm-calendar'), /101 · Garden room/);
    await c.click('#bm-calendar .bm-bar');
    await c.waitForFunction(() => /Hold HD-\d\d-000001/.test(document.getElementById('bm-title').textContent));
    assert.deepEqual(c.__errors, []);
    await c.close();
  });

  await check('phase 3: the builder adds a run action; Setup sets the books; a record\'s action makes its invoice; the Runs tab proposes and runs the due', async () => {
    const day = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const first = day.slice(0, 8) + '01';
    await call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: { id: 'X_SUBS', label: 'Subscription', kind: 'master', listColumns: ['fee'],
      fields: [{ key: 'customer', label: 'Customer', type: 'link', target: 'CUSTOMER' }, { key: 'fee', label: 'Fee', type: 'amount' },
        { key: 'nextDue', label: 'Next due', type: 'date' }, { key: 'every', label: 'Billed', type: 'choice', options: ['Monthly', 'Yearly'] }] } });
    const p = await open('BUILDER');
    await p.click('#bd-body tr[data-id="X_SUBS"]');
    await p.waitForSelector('#bd-edit-view:not(.hidden)');
    await p.click('#bd-add-action');
    const card = '#bd-actions .bd-action[data-a="0"] ';
    await p.fill(card + '[data-k="key"]', 'bill');
    await p.fill(card + '[data-k="label"]', 'Bill');
    await p.selectOption(card + '[data-k="party"]', 'customer');
    await p.selectOption(card + '[data-k="amount"]', 'fee');
    await p.fill(card + '[data-k="description"]', 'Subscription {code} {period}');
    await p.check(card + '.bd-abulk');
    await p.waitForSelector(card + '[data-k="b.nextDue"]');
    await p.selectOption(card + '[data-k="b.nextDue"]', 'nextDue');
    await p.selectOption(card + '[data-k="b.periodField"]', 'every');
    await p.click('#bd-publish');
    await p.waitForFunction(() => /Published v1/.test(document.getElementById('bd-version').textContent));
    const pub = (await call('u-admin', 'getModuleDefinition', { id: 'X_SUBS' })).published.actions[0];
    assert.deepEqual([pub.key, pub.target, pub.party, pub.amount, pub.account, pub.bulk.enabled, pub.bulk.nextDue, pub.bulk.periodField, pub.bulk.group], ['bill', 'CUSTOMERINVOICE', 'customer', 'fee', '', true, 'nextDue', 'every', 'party']);
    assert.deepEqual(p.__errors, []);
    await p.close();
    await rtdb.ref('permissions/X_SUBS').set({ access: ['Admin'], write: ['Admin'] });
    const a = (await call('u-admin', 'saveBuiltRecord', { moduleId: 'X_SUBS', record: { CompanyID: 'C1', Code: 'S1', Name: 'First', Fields: { customer: { id: 'K1' }, fee: 100, nextDue: first, every: 'Monthly' } } })).id;
    await call('u-admin', 'saveBuiltRecord', { moduleId: 'X_SUBS', record: { CompanyID: 'C1', Code: 'S2', Name: 'Second', Fields: { customer: { id: 'K1' }, fee: 30, nextDue: first, every: 'Yearly' } } });

    const r = await open('X_SUBS');
    await r.waitForSelector('#bm-tabs:not(.hidden)');
    await r.click('.bm-tab[data-tab="setup"]');
    await r.waitForSelector('#bm-setup [data-setup="bill"] select[data-k="SalesTypeID"]');
    await r.selectOption('#bm-setup [data-setup="bill"] select[data-k="SalesTypeID"]', 'ST1');
    await r.selectOption('#bm-setup [data-setup="bill"] select[data-k="AccountCode"]', '4000');
    await r.selectOption('#bm-setup [data-setup="bill"] select[data-k="CostCenterID"]', 'CC1');
    await r.click('#bm-setup-save');
    for (let i = 0; i < 40 && !r.__dialogs.some(m => /Setup saved/.test(m)); i++) await r.waitForTimeout(150);
    assert.ok(r.__dialogs.some(m => /Setup saved/.test(m)), r.__dialogs.join(' | '));
    // A record's action: its invoice made, listed with its link.
    await r.click('.bm-tab[data-tab="list"]');
    await r.click('#bm-body tr[data-id="' + a + '"]');
    await r.waitForSelector('#bm-book-buttons .bm-act');
    await r.click('#bm-book-buttons .bm-act');
    await r.waitForSelector('#bm-made .bm-made-open');
    assert.ok(r.__dialogs.some(m => /Customer Invoice .*made: Draft/.test(m)), r.__dialogs.join(' | '));
    assert.match(await r.textContent('#bm-made'), /Bill: Customer Invoice \(Draft\) Draft \(due /);
    // The Runs tab: the second is still due; ticked and run.
    await r.click('#bm-back');
    await r.click('.bm-tab[data-tab="runs"]');
    await r.click('#bm-run-propose');
    await r.waitForSelector('#bm-run-list .bm-run-tick');
    assert.equal(await r.$$eval('#bm-run-list .bm-run-tick', x => x.length), 1, 'S1 was billed: only S2 is due');
    await r.click('#bm-run-go');
    await r.waitForFunction(() => /1 made/.test(document.getElementById('bm-run-past').textContent));
    assert.match(await r.textContent('#bm-run-past'), /Bill, due by .* 1 made/);
    assert.deepEqual(r.__errors, []);
    await r.close();
  });

  await check('phase 6: the builder makes a calculated field; a claim\'s lines and header work out as typed; the saved values are the server\'s', async () => {
    const p = await open('BUILDER');
    await p.click('#bd-new');
    await p.fill('#bd-id', 'x_calc');
    await p.fill('#bd-label', 'Quick quote');
    await p.selectOption('#bd-kind', 'document');
    await p.fill('#bd-prefix', 'QQ');
    for (const [i, key, label, type] of [[0, 'qty', 'Qty', 'number'], [1, 'rate', 'Rate', 'amount'], [2, 'amount', 'Amount', 'calc']]) {
      await p.click('#bd-add-field');
      await p.fill('#bd-fields tr[data-i="' + i + '"] .bd-key', key);
      await p.fill('#bd-fields tr[data-i="' + i + '"] .bd-flabel', label);
      await p.selectOption('#bd-fields tr[data-i="' + i + '"] .bd-type', type);
    }
    await p.waitForSelector('#bd-fields tr[data-i="2"] .bd-cop');
    assert.equal(await p.$('#bd-fields tr[data-i="2"] .bd-required'), null, 'a calculated field is never required');
    await p.selectOption('#bd-fields tr[data-i="2"] .bd-cop', 'percent');
    await p.waitForSelector('#bd-fields tr[data-i="2"] .bd-cvalue');
    await p.selectOption('#bd-fields tr[data-i="2"] .bd-cop', 'product');
    await p.fill('#bd-fields tr[data-i="2"] .bd-cof', 'qty, rate');
    await p.click('#bd-save');
    await p.waitForFunction(() => /Not published yet/.test(document.getElementById('bd-version').textContent));
    const d = (await call('u-admin', 'getModuleDefinition', { id: 'X_CALC' })).draft;
    assert.deepEqual([d.fields[2].type, d.fields[2].op, d.fields[2].of, d.fields[2].money], ['calc', 'product', ['qty', 'rate'], true]);
    assert.deepEqual(p.__errors, []);
    await p.close();

    // A claim (by the server calls): lines qty × rate, header retention 10% of the lines' total.
    await call('u-admin', 'saveModuleDefinitionDraft', { isNew: true, definition: { id: 'X_CLAIM', label: 'Claim', kind: 'document', numbering: { prefix: 'PC' },
      fields: [{ key: 'retPct', label: 'Retention %', type: 'number' }, { key: 'retention', label: 'Retention', type: 'calc', op: 'percent', of: ['t:amount', 'retPct'] }],
      lines: { enabled: true, label: 'Work', fields: [{ key: 'qty', label: 'Qty', type: 'number' }, { key: 'rate', label: 'Rate', type: 'amount' }, { key: 'amount', label: 'Amount', type: 'calc', op: 'product', of: ['qty', 'rate'] }] },
      statuses: [{ name: 'Draft' }, { name: 'Certified' }] } });
    await call('u-admin', 'publishModuleDefinition', { id: 'X_CLAIM' });
    await rtdb.ref('permissions/X_CLAIM').set({ access: ['Admin'], write: ['Admin'], void: ['Admin'] });
    const s = await open('X_CLAIM');
    await s.waitForSelector('#bm-list-view:not(.hidden)');
    await s.click('#bm-new');
    await s.waitForSelector('#bm-lines tr[data-line="0"] [data-calc="amount"]');
    await s.fill('#bm-fields input[data-key="retPct"]', '10');
    await s.fill('#bm-lines tr[data-line="0"] input[data-key="qty"]', '12');
    await s.fill('#bm-lines tr[data-line="0"] input[data-key="rate"]', '25.50');
    await s.waitForFunction(() => document.querySelector('#bm-lines tr[data-line="0"] [data-calc="amount"]').textContent === '306.00');
    assert.equal(await s.textContent('#bm-fields [data-calc="retention"]'), '30.60');
    assert.match(await s.textContent('#bm-lines-total'), /306\.00/);
    await s.click('#bm-save');
    await s.waitForFunction(() => /Claim PC-\d\d-000001/.test(document.getElementById('bm-title').textContent));
    const list = await call('u-admin', 'listBuiltRecords', { moduleId: 'X_CLAIM' });
    const saved = (await call('u-admin', 'getBuiltRecord', { moduleId: 'X_CLAIM', id: list.records[0].RecordID })).record;
    assert.deepEqual([saved.Lines[0].amount, saved.Totals.amount, saved.Fields.retention], [306, 306, 30.6]);
    assert.equal(await s.textContent('#bm-fields [data-calc="retention"]'), '30.60');
    assert.deepEqual(s.__errors, []);
    await s.close();
  });

  await check('phase 6: the Packs tab lists the five packs and publishes one; Pack setup shows its checklist, a step ticked by hand, the starter reports added', async () => {
    const p = await open('BUILDER');
    await p.waitForSelector('#bd-packs tr[data-pack="P_HOTEL"] .bd-pack-publish');
    assert.deepEqual(await p.$$eval('#bd-packs tr[data-pack]', r => r.map(x => x.dataset.pack)), ['P_HOTEL', 'P_SUBS', 'P_REALTY', 'P_INVEST', 'P_CONSTR']);
    await p.click('#bd-packs tr[data-pack="P_HOTEL"] .bd-pack-publish');
    await p.waitForFunction(() => /v1/.test(document.querySelector('#bd-packs tr[data-pack="P_HOTEL"]').textContent));
    assert.ok(p.__dialogs.some(m => /Pack version 1 published with X_HROOM v1/.test(m)), p.__dialogs.join(' | '));
    assert.equal(await p.$('#bd-packs tr[data-pack="P_HOTEL"] .bd-pack-publish'), null, 'nothing changed: no Publish');
    assert.deepEqual(p.__errors, []);
    await p.close();

    const s = await open('PACKSETUP');
    await s.waitForSelector('#ps-body [data-pack="P_HOTEL"] li[data-key="tax"]');
    assert.match(await s.textContent('#app-title'), /Pack setup/);
    assert.match(await s.textContent('#ps-body [data-pack="P_HOTEL"] .ps-progress'), /0 of 5 done/);
    assert.ok(await s.isDisabled('#ps-body [data-pack="P_HOTEL"] li[data-key="bookBooks"] .ps-tick'), 'a Setup step is ticked by itself');
    await s.check('#ps-body [data-pack="P_HOTEL"] li[data-key="tax"] .ps-tick');
    await s.waitForFunction(() => /1 of 5 done/.test(document.querySelector('#ps-body [data-pack="P_HOTEL"] .ps-progress').textContent));
    await s.click('#ps-body [data-pack="P_HOTEL"] .ps-reports');
    await s.waitForFunction(() => /in your MIS reports/.test(document.querySelector('#ps-body [data-pack="P_HOTEL"]').textContent));
    assert.ok(s.__dialogs.some(m => /3 report\(s\) are in your MIS reports/.test(m)), s.__dialogs.join(' | '));
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
