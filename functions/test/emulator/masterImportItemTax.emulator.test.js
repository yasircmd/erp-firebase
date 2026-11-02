// Master Data Import, items' tax columns (fixed 2026-11-02; docs/modules/
// MASTER_IMPORT.md): Tax Code and HSN / SAC reach the item, when adding and
// when updating (they were dropped), checked as Item Master checks them;
// and every column an import accepts reaches its master's save.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const run = (rows, mode) => call('u-admin', 'runMasterImport', { master: 'ITEM', mode, text: tsv(rows) });
const check = (rows, mode) => call('u-admin', 'checkMasterImport', { master: 'ITEM', mode, text: tsv(rows) });
const msgs = r => r.issues.map(i => (i.row ? 'R' + i.row : 'H') + (i.column ? ' ' + i.column : '') + ': ' + i.message);
const items = async () => Object.values((await val('items')) || {});

test('adding items: the tax code (upper case) and HSN / SAC are saved; a bad one is said against its row, nothing imported', async () => {
  await reset(baseFixture());
  const head = ['Item Name', 'Category', 'UOM', 'Company', 'Inventory Account', 'Consumption Account', 'Tax Code', 'HSN / SAC'];
  const bad = await check([head, ['Clamp', 'Raw Material', 'PCS', '01', '1300', '5100', 'GST-18%', '72'], ['Bolt', 'Raw Material', 'PCS', '01', '1300', '5100', 'SR', '99831']]);
  assert.equal(bad.issues.length, 3, msgs(bad).join(' | '));
  assert.deepEqual(bad.issues.map(i => [i.row, i.column]), [[1, 'Tax Code'], [1, 'HSN / SAC'], [2, 'HSN / SAC']]);
  assert.match(msgs(bad)[0], /up to 12 letters, digits or _/);
  const before = (await items()).length;
  assert.equal((await run([head, ['Clamp', 'Raw Material', 'PCS', '01', '1300', '5100', 'GST-18%', '72']])).success, false);
  assert.equal((await items()).length, before, 'nothing imported');

  const ok = await run([head, ['Clamp', 'Raw Material', 'PCS', '01', '1300', '5100', 'gst18', '7208'], ['Bolt', 'Raw Material', 'PCS', '01', '1300', '5100', '', '']]);
  assert.equal(ok.success, true, JSON.stringify(ok));
  const all = await items();
  const pick = n => { const i = all.find(x => x.ItemName === n); return [i.TaxCode, i.HSNCode]; };
  assert.deepEqual([pick('Clamp'), pick('Bolt')], [['GST18', '7208'], ['', '']]);
});

test('updating items: the tax columns change; a blank cell keeps, "-" clears; a bad one is refused; Copy current records shows them', async () => {
  const f = baseFixture();
  f.items.I1.UserCode = 'SS-1';
  f.items.I1.TaxCode = 'ZR';
  await reset(f);
  let r = await run([['Item Code', 'Tax Code', 'HSN / SAC'], ['RM-001', 'SR', '720851']], 'update');
  assert.equal(r.success, true, JSON.stringify(r));
  let i1 = await val('items/I1');
  assert.deepEqual([i1.TaxCode, i1.HSNCode, i1.UserCode, i1.ItemName], ['SR', '720851', 'SS-1', 'Steel Sheet'], 'the rest as it was');

  r = await run([['Item Code', 'Tax Code', 'HSN / SAC'], ['RM-001', '-', '']], 'update');
  assert.equal(r.success, true, JSON.stringify(r));
  i1 = await val('items/I1');
  assert.deepEqual([i1.TaxCode, i1.HSNCode], ['', '720851']);

  const bad = await check([['Item Code', 'HSN / SAC'], ['RM-001', '12345']], 'update');
  assert.deepEqual(bad.issues.map(i => [i.row, i.column]), [[1, 'HSN / SAC']]);

  await run([['Item Code', 'Tax Code'], ['RM-001', 'SR']], 'update');
  const sheet = (await call('u-admin', 'getMasterImportRecords', { master: 'ITEM' })).text.split('\n').map(l => l.split('\t'));
  const h = sheet[0];
  const row = sheet.find(l => l[0] === 'RM-001');
  assert.ok(row, 'the key column holds the item code: ' + sheet.map(l => l[0]).join(','));
  assert.deepEqual([h[0], row[h.indexOf('User Code')], row[h.indexOf('Tax Code')], row[h.indexOf('HSN / SAC')]], ['Item Code', 'SS-1', 'SR', '720851']);
});
