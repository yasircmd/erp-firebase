// Recurring Journal Entries: schedule and amount engine
// (functions/src/recurringSchedule.js). Pure functions, no emulators:
// node --test functions/test/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/recurringSchedule');

const dates = raw => S.scheduleDates(S.normalizeSchedule(raw));
const err = raw => { try { S.normalizeSchedule(raw); } catch (e) { return e.message; } return ''; };

test('1st of every month, and day 31 falls back to the month end (Feb, leap year)', () => {
  assert.deepEqual(dates({ Frequency: 'MonthlyDay', Day: 1, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 4 }),
    ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
  assert.deepEqual(dates({ Frequency: 'MonthlyDay', Day: 31, StartDate: '2028-01-15', EndMode: 'EndDate', EndDate: '2028-04-30' }),
    ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
  // A start after this month's day begins next month.
  assert.deepEqual(dates({ Frequency: 'MonthlyDay', Day: 1, StartDate: '2026-10-02', EndMode: 'Count', RunCount: 1 }), ['2026-11-01']);
});

test('month end (EOM), across a year and a non-leap February', () => {
  assert.deepEqual(dates({ Frequency: 'MonthEnd', StartDate: '2026-11-10', EndMode: 'Count', RunCount: 4 }),
    ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
});

test('any weekday, weekly and every 2 weeks, end date inclusive', () => {
  // 2026-10-01 is a Thursday.
  assert.deepEqual(dates({ Frequency: 'Weekly', Weekday: 4, StartDate: '2026-10-01', EndMode: 'EndDate', EndDate: '2026-10-22' }),
    ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
  assert.deepEqual(dates({ Frequency: 'Weekly', Weekday: 1, Interval: 2, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 3 }),
    ['2026-10-05', '2026-10-19', '2026-11-02']);
  assert.deepEqual(dates({ Frequency: 'Weekly', Weekday: 7, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 1 }), ['2026-10-04']);
});

test('Nth weekday of the month: first Monday, last Friday', () => {
  assert.deepEqual(dates({ Frequency: 'MonthlyWeekday', Nth: 1, Weekday: 1, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 3 }),
    ['2026-10-05', '2026-11-02', '2026-12-07']);
  assert.deepEqual(dates({ Frequency: 'MonthlyWeekday', Nth: -1, Weekday: 5, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 3 }),
    ['2026-10-30', '2026-11-27', '2026-12-25']);
});

test('every 3 months (quarterly) anchored on the start month', () => {
  assert.deepEqual(dates({ Frequency: 'MonthEnd', Interval: 3, StartDate: '2026-01-01', EndMode: 'EndDate', EndDate: '2026-12-31' }),
    ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
});

test('validation messages', () => {
  assert.match(err({}), /how often/);
  assert.match(err({ Frequency: 'MonthlyDay', Day: 0, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 1 }), /Day of the month/);
  assert.match(err({ Frequency: 'Weekly', StartDate: '2026-10-01', EndMode: 'Count', RunCount: 1 }), /weekday/);
  assert.match(err({ Frequency: 'MonthlyWeekday', Weekday: 1, Nth: 5, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 1 }), /which weekday/);
  assert.match(err({ Frequency: 'MonthEnd', StartDate: '2026-02-30', EndMode: 'Count', RunCount: 1 }), /Start date/);
  assert.match(err({ Frequency: 'MonthEnd', StartDate: '2026-10-01', EndMode: 'EndDate', EndDate: '2026-09-01' }), /before the start/);
  assert.match(err({ Frequency: 'MonthEnd', StartDate: '2026-10-01' }), /how the period ends/);
  assert.match(err({ Frequency: 'MonthlyDay', Day: 31, StartDate: '2026-10-01', EndMode: 'EndDate', EndDate: '2026-10-30' }), /no run dates/);
  assert.match(err({ Frequency: 'Weekly', Weekday: 1, StartDate: '2026-01-01', EndMode: 'EndDate', EndDate: '2031-01-01' }), /more than 240/);
  assert.match(err({ Frequency: 'MonthEnd', Interval: 13, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 1 }), /from 1 to 12/);
});

test('describe and description placeholders', () => {
  assert.equal(S.describeSchedule(S.normalizeSchedule({ Frequency: 'MonthlyWeekday', Nth: -1, Weekday: 5, Interval: 2, StartDate: '2026-10-01', EndMode: 'Count', RunCount: 6 })),
    'The last Friday of every 2 months, from 2026-10-01, 6 runs');
  assert.equal(S.expandText('Rent {MONTH} ({date}), FY {YEAR}', '2026-10-31'), 'Rent Oct-2026 (2026-10-31), FY 2026');
});

test('today in Asia/Dubai (UTC+4)', () => {
  assert.equal(S.todayIn('Asia/Dubai', new Date('2026-09-30T20:30:00Z')), '2026-10-01');
  assert.equal(S.todayIn('Asia/Dubai', new Date('2026-09-30T19:59:00Z')), '2026-09-30');
});

const L = (dr, cr) => ({ Debit: dr || 0, Credit: cr || 0 });
const sum = (plan, i) => Math.round(Object.values(plan).reduce((s, a) => s + a[i], 0) * 100) / 100;
const balanced = (lines, amounts) => {
  const side = d => Math.round(amounts.reduce((s, a, i) => s + ((lines[i].Debit > 0) === d ? a : 0), 0) * 100);
  return side(true) === side(false);
};

test('fixed: every open date gets the lines as entered', () => {
  const plan = S.installments('Fixed', [L(500), L(0, 500)], [], ['2026-10-31', '2026-11-30']);
  assert.deepEqual(plan, { '2026-10-31': [500, 500], '2026-11-30': [500, 500] });
});

test('spread: 12,000 over 12 → 1,000 each; 10,000 over 3 → rounding on the last', () => {
  const d12 = Array.from({ length: 12 }, (_, i) => 'd' + String(i).padStart(2, '0'));
  const p = S.installments('Spread', [L(12000), L(0, 12000)], [], d12);
  assert.ok(Object.values(p).every(a => a[0] === 1000 && a[1] === 1000));
  const lines = [L(10000), L(0, 10000)];
  const q = S.installments('Spread', lines, [], ['a', 'b', 'c']);
  assert.deepEqual(q, { a: [3333.33, 3333.33], b: [3333.33, 3333.33], c: [3333.34, 3333.34] });
});

test('spread: every installment balances and every line total is exact (uneven split lines)', () => {
  const lines = [L(100), L(0, 50), L(0, 50)];
  const p = S.installments('Spread', lines, [], ['a', 'b', 'c']);
  Object.values(p).forEach(a => assert.ok(balanced(lines, a), JSON.stringify(a)));
  assert.deepEqual([sum(p, 0), sum(p, 1), sum(p, 2)], [100, 50, 50]);
  const lines2 = [L(1000), L(0, 333.33), L(0, 333.33), L(0, 333.34)];
  const p2 = S.installments('Spread', lines2, [], Array.from({ length: 7 }, (_, i) => 'd' + i));
  Object.values(p2).forEach(a => assert.ok(balanced(lines2, a), JSON.stringify(a)));
  assert.deepEqual([0, 1, 2, 3].map(i => sum(p2, i)), [1000, 333.33, 333.33, 333.34]);
});

test('spread: what is already released is taken off; over-released refuses', () => {
  const p = S.installments('Spread', [L(1200), L(0, 1200)], [400, 400], ['a', 'b']);
  assert.deepEqual(p, { a: [400, 400], b: [400, 400] });
  assert.throws(() => S.installments('Spread', [L(300), L(0, 300)], [400, 400], ['a']), /already been posted/);
  assert.deepEqual(S.installments('Spread', [L(300), L(0, 300)], [300, 300], []), {});
});

test('spread with a fixed base: posting a run does not move the rounding off the last date', () => {
  const lines = [L(10000), L(0, 10000)];
  const base = S.spreadBase(lines, [], 3);
  assert.deepEqual(base, [3333.33, 3333.33]);
  // After the first run posted 3,333.33, the two open dates stay 3,333.33 then 3,333.34.
  assert.deepEqual(S.installments('Spread', lines, [3333.33, 3333.33], ['b', 'c'], base), { b: [3333.33, 3333.33], c: [3333.34, 3333.34] });
  // Without the base, the rest is re-divided (what an edit or a skip does on purpose).
  assert.deepEqual(S.installments('Spread', lines, [3333.33, 3333.33], ['b', 'c']), { b: [3333.34, 3333.34], c: [3333.33, 3333.33] });
  // A base that no longer fits (the total was lowered) is ignored.
  assert.deepEqual(S.installments('Spread', [L(3000), L(0, 3000)], [], ['a', 'b'], [4000, 4000]), { a: [1500, 1500], b: [1500, 1500] });
});
