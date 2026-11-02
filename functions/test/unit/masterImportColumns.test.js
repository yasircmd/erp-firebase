// Master Data Import: every column a master's import accepts reaches its
// save (2026-11-02: items' Tax Code and HSN / SAC were checked, shown and
// copied, but never saved). A master whose toData needs the database
// (VALUATION: the item's stock) is checked by its own emulator suite.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'unit-test';
const { MASTERS } = require('../../src/masterImport');

const NEEDS_DATA = ['VALUATION'];

test('every column of every master is passed to its save', () => {
  const lost = {};
  Object.entries(MASTERS).forEach(([k, m]) => {
    if (!m.toData || NEEDS_DATA.includes(k)) return;
    const r = {};
    m.columns.forEach((c, i) => { r[c.key] = c.type === 'yesno' ? true : c.type === 'number' ? 5 : c.type === 'refs' ? ['X' + i] : 'V' + i; });
    const out = m.toData(r, null, {});
    const text = JSON.stringify(out);
    const gone = m.columns.filter((c, i) => !(c.key in out) && !text.includes('"V' + i + '"') && !text.includes('"X' + i + '"')).map(c => c.h);
    if (gone.length) lost[k] = gone;
  });
  assert.deepEqual(lost, {});
});

test('items: the tax columns are checked as Item Master checks them', () => {
  const cols = MASTERS.ITEM.columns;
  const tax = cols.find(c => c.key === 'TaxCode'), hsn = cols.find(c => c.key === 'HSNCode');
  assert.deepEqual([tax.check('GST18'), tax.check('SR')], ['', '']);
  assert.match(tax.check('GST-18%'), /up to 12 letters, digits or _/);
  assert.deepEqual([hsn.check('7208'), hsn.check('720851'), hsn.check('99831400'.slice(0, 6))], ['', '', '']);
  assert.ok(hsn.check('72') && hsn.check('12345'), 'a 2- or 5-digit code is refused');
});
