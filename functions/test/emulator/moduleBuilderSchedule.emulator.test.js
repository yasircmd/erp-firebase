// Module Builder, phase 2 (owner, 2026-11-09; docs/modules/MODULE_BUILDER.md,
// Q470-Q473): a booking's rooms are held by its holding statuses; an overlap
// is refused (a departure day free for the next arrival); the board's state of
// each room on a day (a hand-set state wins); the calendar's rows and bars.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, JSON.stringify(r)); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };

const ROOM = { id: 'X_ROOM', label: 'Room', kind: 'master', fields: [{ key: 'housekeeping', label: 'Housekeeping', type: 'choice', options: ['Cleaning', 'Out of order'] }],
  board: { enabled: true, stateField: 'housekeeping' } };
const BOOKING = { id: 'X_BOOKING', label: 'Booking', kind: 'document', numbering: { prefix: 'BK' }, listColumns: ['guest'],
  fields: [{ key: 'guest', label: 'Guest', type: 'text', required: true }, { key: 'arrival', label: 'Arrival', type: 'date' }, { key: 'departure', label: 'Departure', type: 'date' }],
  lines: { enabled: true, label: 'Rooms', fields: [{ key: 'room', label: 'Room', type: 'link', target: 'X_ROOM', required: true }] },
  statuses: [{ name: 'Draft' }, { name: 'Confirmed', editable: true }, { name: 'Checked in' }, { name: 'Checked out', final: true }, { name: 'Cancelled', final: true }],
  schedule: { enabled: true, resourceField: 'room', startField: 'arrival', endField: 'departure', endIsFree: true,
    holds: [{ status: 'Confirmed', state: 'Booked' }, { status: 'Checked in', state: 'Occupied' }] } };

function fixture() {
  const f = baseFixture();
  f.permissions.X_ROOM = { access: ['Admin'], write: ['Admin'] };
  f.permissions.X_BOOKING = { access: ['Admin'], write: ['Admin'], void: ['Admin'] };
  return f;
}
async function publish(def) {
  ok(await call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }));
  ok(await call('u-admin', 'publishModuleDefinition', { id: def.id }));
}
const room = async code => ok(await call('u-admin', 'saveBuiltRecord', { moduleId: 'X_ROOM', record: { CompanyID: 'C1', Code: code, Name: 'Room ' + code, Fields: {} } })).id;
const booking = async (guest, arrival, departure, rooms) => ok(await call('u-admin', 'saveBuiltRecord', { moduleId: 'X_BOOKING',
  record: { CompanyID: 'C1', Date: '2026-11-09', Fields: { guest, arrival, departure }, Lines: rooms.map(id => ({ room: { id } })) } }));
const to = (id, status) => call('u-admin', 'setBuiltStatus', { moduleId: 'X_BOOKING', id, status });

test('the schedule\'s settings are checked', async () => {
  await reset(fixture());
  const save = def => refused(call('u-admin', 'saveModuleDefinitionDraft', { definition: def, isNew: true }));
  assert.match(await save(Object.assign({}, BOOKING, { schedule: Object.assign({}, BOOKING.schedule, { resourceField: 'guest' }) })), /link field to a built master|links to/);
  await publish(ROOM);
  assert.match(await save(Object.assign({}, BOOKING, { schedule: Object.assign({}, BOOKING.schedule, { endField: 'arrival' }) })), /two different date fields/);
  assert.match(await save(Object.assign({}, BOOKING, { schedule: Object.assign({}, BOOKING.schedule, { holds: [] }) })), /at least one status/);
  assert.match(await save(Object.assign({}, BOOKING, { schedule: Object.assign({}, BOOKING.schedule, { holds: [{ status: 'Booked', state: 'Booked' }] }) })), /not one of its statuses/);
  assert.match(await save(Object.assign({}, ROOM, { id: 'X_R2', board: { enabled: true, stateField: 'nope' } })), /choice field/);
});

test('a room held twice for overlapping nights is refused; the departure day is free; the board and the calendar', async () => {
  await reset(fixture());
  await publish(ROOM);
  await publish(BOOKING);
  const r101 = await room('101'), r102 = await room('102');

  const a = await booking('Guest A', '2026-11-20', '2026-11-22', [r101]);
  ok(await to(a.id, 'Confirmed'));
  const b = await booking('Guest B', '2026-11-21', '2026-11-23', [r101]);
  assert.match(await refused(to(b.id, 'Confirmed')), /101 · Room 101 is already held by BK-26-000001 from 2026-11-20 to 2026-11-22/);
  // Arriving on A's departure day: no clash (the end is the day it is free again).
  const c = await booking('Guest C', '2026-11-22', '2026-11-24', [r101]);
  ok(await to(c.id, 'Confirmed'));
  // Two rooms, one of them taken: refused; dates the wrong way round: refused.
  const d = await booking('Guest D', '2026-11-20', '2026-11-21', [r102, r101]);
  assert.match(await refused(to(d.id, 'Confirmed')), /Room 101 is already held by BK-26-000001/);
  const e = await booking('Guest E', '2026-11-25', '2026-11-25', [r102]);
  assert.match(await refused(to(e.id, 'Confirmed')), /Departure must be after Arrival/);
  // An edit of a holding document is checked again: C moved a night earlier now overlaps A.
  assert.match(await refused(call('u-admin', 'saveBuiltRecord', { moduleId: 'X_BOOKING', record: { RecordID: c.id, Date: '2026-11-09', Fields: { guest: 'Guest C', arrival: '2026-11-21', departure: '2026-11-24' }, Lines: [{ room: { id: r101 } }] } })), /held by BK-26-000001/);
  // A cancelled: B may now be confirmed (it overlaps C? B 21-23 and C 22-24 do: refused by C).
  ok(await to(a.id, 'Cancelled'));
  assert.match(await refused(to(b.id, 'Confirmed')), /held by BK-26-000003/);
  ok(await to(d.id, 'Confirmed'));
  ok(await to(d.id, 'Checked in'));

  // The board on 20/11: 101 Occupied by D, 102 Occupied by D; on 22/11: 101 Booked (C), 102 Free; a hand-set state wins.
  let board = await call('u-admin', 'getBuiltBoard', { moduleId: 'X_ROOM', companyId: 'C1', date: '2026-11-20' });
  assert.deepEqual(board.states, ['Booked', 'Occupied', 'Cleaning', 'Out of order', 'Free']);
  assert.deepEqual(board.cards.map(x => [x.code, x.state, x.doc && x.doc.number, x.doc && x.doc.title]), [['101', 'Occupied', 'BK-26-000004', 'Guest D'], ['102', 'Occupied', 'BK-26-000004', 'Guest D']]);
  board = await call('u-admin', 'getBuiltBoard', { moduleId: 'X_ROOM', companyId: 'C1', date: '2026-11-22' });
  assert.deepEqual(board.cards.map(x => [x.code, x.state]), [['101', 'Booked'], ['102', 'Free']]);
  ok(await call('u-admin', 'setBuiltBoardState', { moduleId: 'X_ROOM', id: r102, value: 'Cleaning' }));
  assert.match(await refused(call('u-admin', 'setBuiltBoardState', { moduleId: 'X_ROOM', id: r102, value: 'Painted' })), /options/);
  board = await call('u-admin', 'getBuiltBoard', { moduleId: 'X_ROOM', companyId: 'C1', date: '2026-11-22' });
  assert.deepEqual(board.cards.map(x => [x.code, x.state, x.manual]), [['101', 'Booked', ''], ['102', 'Cleaning', 'Cleaning']]);
  ok(await call('u-admin', 'setBuiltBoardState', { moduleId: 'X_ROOM', id: r102, value: '' }));
  assert.equal((await call('u-admin', 'getBuiltBoard', { moduleId: 'X_ROOM', companyId: 'C1', date: '2026-11-22' })).cards[1].state, 'Free');

  // The calendar: rows are the rooms, bars the holding bookings (a cancelled or draft one doesn't show).
  const cal = await call('u-admin', 'getBuiltCalendar', { moduleId: 'X_BOOKING', companyId: 'C1', from: '2026-11-19', days: 7 });
  assert.deepEqual([cal.rows.map(r => r.label), cal.resource, cal.states], [['101 · Room 101', '102 · Room 102'], 'Room', ['Booked', 'Occupied']]);
  assert.deepEqual(cal.bars.map(x => [x.number, x.resourceId === r101 ? '101' : '102', x.start, x.end, x.state]).sort(),
    [['BK-26-000003', '101', '2026-11-22', '2026-11-24', 'Booked'], ['BK-26-000004', '101', '2026-11-20', '2026-11-21', 'Occupied'], ['BK-26-000004', '102', '2026-11-20', '2026-11-21', 'Occupied']]);
  assert.match(await refused(call('u-admin', 'getBuiltCalendar', { moduleId: 'X_ROOM', companyId: 'C1' })), /has no calendar/);
  assert.match(await refused(call('u-admin', 'getBuiltBoard', { moduleId: 'X_BOOKING', companyId: 'C1' })), /has no board/);
});
