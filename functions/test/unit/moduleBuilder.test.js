// Module Builder, phase 1 (MODULE_BUILDER.md, Q461-Q469): a definition checked;
// the registry extended in place (and a module no longer published taken out);
// a record's values by their types, links only from their choices, the lines'
// totals, the statuses a document may move to.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/builtDefinitions');
const R = require('../../src/builtModules');

const ROOM = { id: 'x_room', label: 'Room', kind: 'master', fields: [{ key: 'rate', label: 'Rate', type: 'amount' }] };
const DOC = { id: 'X_BOOKING', label: 'Booking', kind: 'document', numbering: { prefix: 'bk' },
  fields: [{ key: 'guest', label: 'Guest', type: 'link', target: 'CUSTOMER', required: true }],
  lines: { enabled: true, fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM' }, { key: 'nights', label: 'Nights', type: 'number' }, { key: 'amount', label: 'Amount', type: 'amount' }] },
  statuses: [{ name: 'Draft' }, { name: 'Confirmed', approval: true }, { name: 'Cancelled', final: true }] };

test('a definition: its id, keys, types, choices, links to published masters, numbering, statuses', () => {
  const r = B.cleanDefinition(ROOM, []);
  assert.deepEqual([r.id, r.kind, r.companyScoped, r.lines.enabled, r.printTitle], ['X_ROOM', 'master', true, false, 'Room']);
  const d = B.cleanDefinition(DOC, ['X_ROOM']);
  assert.deepEqual([d.numbering.prefix, d.statuses.map(s => [s.name, s.approval, s.final, s.editable])], ['BK', [['Draft', false, false, true], ['Confirmed', true, false, false], ['Cancelled', false, true, false]]]);
  const no = (x, re) => assert.throws(() => B.cleanDefinition(x, ['X_ROOM']), re);
  no(Object.assign({}, ROOM, { id: 'ROOM' }), /starts with X_/);
  no(Object.assign({}, ROOM, { fields: [{ key: 'Rate', label: 'R', type: 'amount' }] }), /small letter/);
  no(Object.assign({}, ROOM, { fields: [{ key: 'status', label: 'S', type: 'text' }] }), /kept for the ERP/);
  no(Object.assign({}, ROOM, { fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }] }), /used twice/);
  no(Object.assign({}, ROOM, { fields: [{ key: 'a', label: 'A', type: 'script' }] }), /choose its type/);
  no(Object.assign({}, ROOM, { fields: [{ key: 'a', label: 'A', type: 'link', target: 'X_NOPE' }] }), /links to/);
  no(Object.assign({}, DOC, { numbering: { prefix: 'B1' } }), /prefix/);
  no(Object.assign({}, DOC, { statuses: [{ name: 'Done', final: true }, { name: 'Other' }] }), /first status/);
  no(Object.assign({}, DOC, { statuses: [{ name: 'A' }, { name: 'a' }] }), /same name/);
  assert.equal(B.cleanDefinition(Object.assign({}, ROOM, { fields: [{ key: 'parent', label: 'Parent', type: 'link', target: 'X_ROOM' }] }), []).fields[0].target, 'X_ROOM', 'a master may link to itself');
  assert.deepEqual(B.cleanDefinition(Object.assign({}, ROOM, { fields: [{ key: 'k', label: 'K', type: 'choice', options: 'A, B\nA' }] }), []).fields[0].options, ['A', 'B']);
});

test('the registry: built modules joined in place, with rights and approvals; one no longer published taken out', () => {
  const reg = [{ id: 'JV', label: 'JV', capabilities: ['access'] }];
  const defaults = { JV: {} }, gate = [{ ModuleID: 'JV' }], storage = { JV: { type: 'rtdb' } };
  const room = B.cleanDefinition(ROOM, []), doc = B.cleanDefinition(DOC, ['X_ROOM']);
  B.applyToRegistry([room, doc], reg, defaults, gate, storage);
  assert.deepEqual(reg.map(m => [m.id, m.capabilities.join('/')]), [['JV', 'access'], ['X_ROOM', 'access/write'], ['X_BOOKING', 'access/write/void']]);
  assert.deepEqual([Object.keys(defaults), gate.map(g => g.ModuleID), storage.X_BOOKING.collection], [['JV', 'X_ROOM', 'X_BOOKING'], ['JV', 'X_BOOKING'], 'builtRecords']);
  B.applyToRegistry([room], reg, defaults, gate, storage);
  assert.deepEqual([reg.map(m => m.id), gate.map(g => g.ModuleID), Object.keys(storage)], [['JV', 'X_ROOM'], ['JV'], ['JV', 'X_ROOM']]);
  B.applyToRegistry([{ id: 'JV', label: 'Fake', kind: 'master' }], reg, defaults, gate, storage);
  assert.deepEqual(reg.map(m => m.label), ['JV'], 'never a coded module\'s id');
});

test('a record\'s values: by type; a link only from its choices; lines totalled; the statuses it may move to', () => {
  const ctx = { links: { CUSTOMER: new Map([['K1', 'C-001 · Guest']]), X_ROOM: new Map([['r1', '101 · Garden']]) } };
  const f = (type, extra) => Object.assign({ key: 'x', label: 'X', type }, extra || {});
  assert.equal(R.cleanValue(f('amount'), '1,234.567', ctx, ''), 1234.57);
  assert.equal(R.cleanValue(f('number'), '2.5', ctx, ''), 2.5);
  assert.equal(R.cleanValue(f('yesno'), undefined, ctx, ''), false);
  assert.deepEqual(R.cleanValue(f('link', { target: 'CUSTOMER' }), { id: 'K1', label: 'spoofed' }, ctx, ''), { id: 'K1', label: 'C-001 · Guest' }, 'the label is the ERP\'s, not the caller\'s');
  assert.throws(() => R.cleanValue(f('link', { target: 'CUSTOMER' }), { id: 'K9' }, ctx, ''), /choose one from the list/);
  assert.throws(() => R.cleanValue(f('date'), '2026-13-40', ctx, ''), /choose a date/);
  assert.throws(() => R.cleanValue(f('choice', { options: ['A'] }), 'B', ctx, ''), /options/);
  assert.throws(() => R.cleanValue(f('text', { required: true }), ' ', ctx, 'Line 2: '), /^Error: Line 2: X is required|Line 2: X is required/);
  const def = B.cleanDefinition(DOC, ['X_ROOM']);
  const { lines, totals } = R.cleanLines(def, [{ room: { id: 'r1' }, nights: 2, amount: '100.10' }, {}, { room: '', nights: '', amount: '' }, { room: { id: 'r1' }, nights: '1', amount: 50 }], ctx);
  assert.deepEqual([lines.length, totals], [2, { nights: 3, amount: 150.1 }]);
  assert.deepEqual(R.nextStatuses(def, 'Draft'), ['Confirmed', 'Cancelled']);
  assert.deepEqual(R.nextStatuses(def, 'Cancelled'), [], 'a final status is the end');
  assert.equal(R.amountOf(def, { Totals: { amount: 150.1 } }), 150.1);
});

test('phase 2: a schedule\'s days; a hotel\'s departure day free, a rental\'s last day used; overlaps; resources; the holding states', () => {
  const base = { id: 'X_BK', label: 'Booking', kind: 'document', numbering: { prefix: 'BK' },
    fields: [{ key: 'arrival', label: 'Arrival', type: 'date' }, { key: 'departure', label: 'Departure', type: 'date' }, { key: 'unit', label: 'Unit', type: 'link', target: 'X_ROOM' }],
    lines: { enabled: true, fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM' }] },
    statuses: [{ name: 'Draft' }, { name: 'Confirmed' }, { name: 'In' }, { name: 'Out', final: true }] };
  const sched = (extra) => B.cleanDefinition(Object.assign({}, base, { schedule: Object.assign({ enabled: true, resourceField: 'room', startField: 'arrival', endField: 'departure', holds: [{ status: 'Confirmed', state: 'Booked' }, { status: 'In', state: 'Occupied' }] }, extra) }), ['X_ROOM']);
  const hotel = sched({}), rental = sched({ endIsFree: false, resourceField: 'unit' });
  assert.deepEqual([hotel.schedule.resourceInLines, rental.schedule.resourceInLines, rental.schedule.endIsFree], [true, false, false]);
  const doc = (a, d, rooms, unit) => ({ Fields: { arrival: a, departure: d, unit: unit ? { id: unit } : null }, Lines: (rooms || []).map(id => ({ room: { id } })) });
  // A hotel: 20-22 is two nights; the next guest may arrive on the 22nd.
  const A = R.periodOf(hotel, doc('2026-11-20', '2026-11-22')), C = R.periodOf(hotel, doc('2026-11-22', '2026-11-24'));
  assert.deepEqual(A, { start: '2026-11-20', end: '2026-11-22' });
  assert.equal(R.overlaps(A, C), false, 'arriving on a departure day is fine');
  assert.equal(R.overlaps(A, R.periodOf(hotel, doc('2026-11-21', '2026-11-23'))), true);
  // A rental: 20-22 is three days; the 22nd is taken.
  const X = R.periodOf(rental, doc('2026-11-20', '2026-11-22')), Y = R.periodOf(rental, doc('2026-11-22', '2026-11-24'));
  assert.deepEqual(X, { start: '2026-11-20', end: '2026-11-23' });
  assert.equal(R.overlaps(X, Y), true, 'a rental\'s last day is used');
  assert.deepEqual(R.resourcesOf(hotel, doc('', '', ['r1', 'r2', 'r1'])), ['r1', 'r2']);
  assert.deepEqual(R.resourcesOf(rental, doc('', '', [], 'u9')), ['u9']);
  assert.deepEqual([R.holdingState(hotel, 'Confirmed'), R.holdingState(hotel, 'In'), R.holdingState(hotel, 'Draft'), R.holdingState(hotel, 'Out')], ['Booked', 'Occupied', null, null]);
  assert.equal(R.periodOf(hotel, doc('', '2026-11-22')), null);
  // The settings' checks.
  assert.throws(() => sched({ resourceField: 'arrival' }), /link field to a built master/);
  assert.throws(() => sched({ startField: 'unit' }), /start and end date fields/);
  assert.throws(() => sched({ holds: [{ status: 'Confirmed', state: '' }] }), /the state it shows/);
  assert.throws(() => sched({ holds: [{ status: 'Confirmed', state: 'A' }, { status: 'Confirmed', state: 'B' }] }), /listed twice/);
  assert.deepEqual(B.cleanDefinition(Object.assign({}, base, { schedule: { enabled: false } }), ['X_ROOM']).schedule, { enabled: false });
  assert.deepEqual(B.cleanDefinition({ id: 'X_ROOM', label: 'Room', kind: 'master', fields: [{ key: 'hk', label: 'HK', type: 'choice', options: ['Cleaning'] }], board: { enabled: true, stateField: 'hk' } }, []).board, { enabled: true, stateField: 'hk' });
  assert.throws(() => B.cleanDefinition({ id: 'X_ROOM', label: 'Room', kind: 'master', fields: [{ key: 'hk', label: 'HK', type: 'text' }], board: { enabled: true, stateField: 'hk' } }, []), /choice field/);
});
