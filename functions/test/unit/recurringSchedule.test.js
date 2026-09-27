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

// Spread by service period (owner, 2026-09-27): days in that month — a
// run's weight is the days it covers ÷ the days in its month.
const period = (from, to) => {
  const s = S.normalizeSchedule({ ServiceFrom: from, ServiceTo: to }, 'Period');
  const d = S.scheduleDates(s);
  const w = {}; d.forEach(x => { w[x] = S.periodWeight(s, x); });
  const days = {}; d.forEach(x => { days[x] = S.periodDays(s, x); });
  return { s, d, w, days };
};

test('service period: month ends from the start month to the end month, days per run', () => {
  const { s, d, w, days } = period('2026-09-16', '2027-09-15');
  assert.equal(d.length, 13);
  assert.deepEqual([d[0], d[12]], ['2026-09-30', '2027-09-30'], 'the last run is at the end month\'s end');
  assert.deepEqual([days['2026-09-30'], days['2026-10-31'], days['2027-02-28'], days['2027-09-30']], [15, 31, 28, 15]);
  assert.deepEqual([w['2026-09-30'], w['2026-10-31'], w['2027-02-28'], w['2027-09-30']], [0.5, 1, 1, 0.5], 'share of each month');
  assert.equal(S.periodMonths(s), 12);
  assert.equal(S.describeSchedule(s), 'Month end, by days in each month of the service period 2026-09-16 to 2027-09-15 (12 months)');
  assert.deepEqual(period('2026-10-05', '2026-10-20').days, { '2026-10-31': 16 }, 'within one month: one run');
  assert.throws(() => S.normalizeSchedule({ ServiceFrom: '2026-10-05', ServiceTo: '2026-10-01' }, 'Period'), /end date is before/);
  assert.throws(() => S.normalizeSchedule({ ServiceFrom: '', ServiceTo: '2026-10-01' }, 'Period'), /start date is required/);
});

test('service period: 12,000 for 16 Sep – 15 Sep → 500, 1,000 × 11, 500; other starts; balance', () => {
  const { d, w } = period('2026-09-16', '2027-09-15');
  const lines = [L(12000), L(0, 12000)];
  const p = S.installments('Period', lines, [], d, null, w);
  assert.deepEqual(p['2026-09-30'], [500, 500]);
  assert.ok(d.slice(1, 12).every(x => p[x][0] === 1000), 'every full month 1,000, February too');
  assert.deepEqual(p['2027-09-30'], [500, 500]);
  // A 5 Oct start: 27/31 of October, then 4/31 of the last October.
  const o = period('2026-10-05', '2027-10-04');
  const q0 = S.installments('Period', lines, [], o.d, null, o.w);
  assert.deepEqual([q0['2026-10-31'][0], q0['2027-02-28'][0], q0['2027-10-31'][0]], [870.97, 1000, 129.03]);
  assert.equal(sum(q0, 0), 12000);
  // 15 Feb – 30 Apr 2027: half of February (14/28), March, April → 2.5 months.
  const f = period('2027-02-15', '2027-04-30');
  assert.deepEqual(S.installments('Period', [L(3000), L(0, 3000)], [], f.d, null, f.w), { '2027-02-28': [600, 600], '2027-03-31': [1200, 1200], '2027-04-30': [1200, 1200] });
  assert.equal(sum(p, 0), 12000);
  Object.values(p).forEach(a => assert.ok(balanced(lines, a)));
  // Uneven credit lines still balance run by run, and every line total is exact.
  const lines2 = [L(10000), L(0, 3333.33), L(0, 6666.67)];
  const q = S.installments('Period', lines2, [], d, null, w);
  Object.values(q).forEach(a => assert.ok(balanced(lines2, a), JSON.stringify(a)));
  assert.deepEqual([0, 1, 2].map(i => sum(q, i)), [10000, 3333.33, 6666.67]);
});

test('service period: a stored plan keeps its amounts after runs post; without it what is left is re-shared by days', () => {
  const { d, w } = period('2026-09-16', '2027-09-15');
  const lines = [L(12000), L(0, 12000)];
  const base = S.periodBase(lines, [], d, w);
  const rest = d.slice(1);
  const posted = base[d[0]];
  const p = S.installments('Period', lines, posted, rest, base, w);
  rest.forEach(x => assert.deepEqual(p[x], base[x]));
  // 1,000: re-sharing what's left after the first run would move November by a cent; the stored plan doesn't.
  const small = [L(1000), L(0, 1000)];
  const b2 = S.periodBase(small, [], d, w);
  const kept = S.installments('Period', small, b2[d[0]], rest, b2, w);
  assert.deepEqual(kept['2026-11-30'], b2['2026-11-30']);
  assert.deepEqual(b2['2026-11-30'], [83.33, 83.33]);
  assert.deepEqual(S.installments('Period', small, b2[d[0]], rest, null, w)['2026-11-30'], [83.34, 83.34], 'without it, the cent moves');
  // A skipped month: the stored plan no longer adds up, so its share goes to the others by days.
  const fewer = rest.filter(x => x !== '2027-02-28');
  const q = S.installments('Period', lines, posted, fewer, base, w);
  assert.equal(Math.round(fewer.reduce((s, x) => s + q[x][0], 0) * 100) / 100, Math.round((12000 - posted[0]) * 100) / 100);
  assert.ok(q['2027-03-31'][0] > base['2027-03-31'][0]);
});
