// Module Builder, phase 5 (MODULE_BUILDER.md, Q489-Q492): the data sets made
// from the published definitions (a master, a document, its lines' second
// set, a built master's fields through a link); a variant's columns on the
// original's lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/builtDefinitions');
const X = require('../../src/builtMis');

const ROOM = B.cleanDefinition({ id: 'X_ROOM', label: 'Room', kind: 'master', fields: [
  { key: 'roomType', label: 'Room type', type: 'choice', options: ['Single', 'Double'] }, { key: 'rate', label: 'Rate', type: 'amount' }, { key: 'notes', label: 'Notes', type: 'longtext' }] }, []);
const STAY = B.cleanDefinition({ id: 'X_STAY', label: 'Stay', kind: 'document', numbering: { prefix: 'ST' },
  fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER' }, { key: 'vip', label: 'VIP', type: 'yesno' }],
  lines: { enabled: true, label: 'Rooms', fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM' }, { key: 'nights', label: 'Nights', type: 'number' }, { key: 'amount', label: 'Amount', type: 'amount' }] },
  statuses: [{ name: 'Open' }, { name: 'Closed', final: true }] }, ['X_ROOM']);
const RINV = B.cleanDefinition({ id: 'X_RINV', label: 'Room Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'RINV' },
  fields: [{ key: 'room', label: 'Room', type: 'text' }, { key: 'nights', label: 'Nights', type: 'number' }] }, []);

test('the data sets: a master; a document and its lines; a built master\'s fields through a link; no long text; not a variant', () => {
  const sets = X.datasetsOf([ROOM, STAY, RINV]);
  assert.deepEqual(Object.keys(sets), ['x:X_ROOM', 'x:X_STAY', 'xl:X_STAY'], 'a variant is in its original\'s data sets, not its own');
  assert.deepEqual(Object.entries(sets['x:X_ROOM'].fields).map(([k, f]) => k + ':' + f.type), ['code:text', 'name:text', 'active:text', 'f_roomType:text', 'f_rate:number']);
  assert.equal(sets['x:X_ROOM'].module, 'X_ROOM', 'its rights are the module\'s');
  const doc = sets['x:X_STAY'].fields;
  assert.deepEqual([doc.date.type, doc.month.type, doc.f_guest.type, doc.f_vip.type, doc['t_nights'].label, doc['t_amount'].type], ['date', 'month', 'text', 'text', 'Rooms · Nights (total)', 'number']);
  const lines = sets['xl:X_STAY'];
  assert.deepEqual([lines.title, lines.built.lines], ['Stay – rooms', true]);
  assert.deepEqual(['l_room', 'l_room__code', 'l_room__roomType', 'l_room__rate', 'l_nights'].map(k => lines.fields[k] && lines.fields[k].label),
    ['Room', 'Room · Code', 'Room · Room type', 'Room · Rate', 'Nights'], 'the room\'s own fields, one level');
  assert.equal(lines.fields.l_room__notes, undefined);
  assert.equal(lines.fields.t_nights, undefined, 'the lines set has the lines, not their totals');
});

test('a variant on its original\'s lines: its name and its extra fields, blank on other documents', () => {
  const v = X.variantColumns([ROOM, RINV], 'CUSTOMERINVOICE');
  assert.deepEqual(Object.keys(v.fields), ['variant', 'v_X_RINV__room', 'v_X_RINV__nights']);
  assert.deepEqual(v.rowValues({ Variant: 'X_RINV', VariantLabel: 'Room Invoice', VariantFields: { room: '101', nights: 2 } }), { variant: 'Room Invoice', v_X_RINV__room: '101', v_X_RINV__nights: 2 });
  assert.deepEqual(v.rowValues({}), { variant: '', v_X_RINV__room: '', v_X_RINV__nights: 0 });
  assert.deepEqual(v.rowValues(null), { variant: '', v_X_RINV__room: '', v_X_RINV__nights: 0 });
  assert.deepEqual(Object.keys(X.variantColumns([RINV], 'VENDORINVOICE').fields), ['variant']);
  assert.deepEqual([X.valueOf({ type: 'link' }, { id: 'K1', label: 'C-001 · Guest' }), X.valueOf({ type: 'yesno' }, true), X.valueOf({ type: 'amount' }, null)], ['C-001 · Guest', 'Yes', 0]);
});
