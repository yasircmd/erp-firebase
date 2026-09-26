// Depreciation engine (functions/src/faDepreciation.js). Pure functions,
// no emulators: node --test functions/test/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/faDepreciation');

const cap = (date, cost) => ({ Type: 'Capitalization', Date: date, CostDelta: cost, AccDepDelta: 0 });
const asset = (valuation, txns, lastDepPeriod) => ({ valuation, txns: txns || [], lastDepPeriod: lastDepPeriod || '' });

// Posts the scheduled run for every period from..to, as the run does:
// one Depreciation transaction per period dated its last day.
function runThrough(a, from, to) {
  const charges = [];
  for (let p = from; p <= to; p = E.nextPeriod(p)) {
    const r = E.computeScheduled(a, p);
    if (r.total) a.txns.push({ Type: 'Depreciation', Date: E.lastDay(p), CostDelta: 0, AccDepDelta: r.total });
    a.lastDepPeriod = p;
    charges.push(r.total);
  }
  return charges;
}
const sum = xs => E.round2(xs.reduce((s, x) => s + x, 0));
const accDep = a => E.balancesAt(a.txns, '9999-12-31').accDep;

test('the brief: 120,000 over 10 years straight line = 1,000 a month, never beyond cost', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 120000)]);
  const first = E.computeScheduled(a, '2026-01');
  assert.deepEqual([first.total, first.current, first.catchUp], [1000, 1000, 0]);
  assert.deepEqual([first.opening.nbv, first.closing.nbv], [120000, 119000]);
  const charges = runThrough(a, '2026-01', '2036-06');
  assert.equal(sum(charges.slice(0, 12)), 12000, 'annual 12,000');
  assert.ok(charges.slice(0, 120).every(c => c === 1000), 'every month 1,000');
  assert.equal(accDep(a), 120000);
  assert.ok(charges.slice(120).every(c => c === 0), 'nothing after the life');
  assert.equal(E.computeScheduled(a, '2036-07').fullyDepreciated, true);
});

test('pro-rata by day: start on 17 March charges 15/31 of March, the rest after the last full month', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-03-17' }, [cap('2026-03-17', 120000)]);
  const charges = runThrough(a, '2026-03', '2036-04');
  assert.equal(charges[0], 483.87);
  assert.equal(charges[1], 1000);
  assert.equal(charges[120], E.round2(120000 - sum(charges.slice(0, 120))), 'March 2036 takes the remainder');
  assert.ok(Math.abs(charges[120] - 516.13) < 0.02, 'about 16/31 of a month: ' + charges[120]);
  assert.equal(charges[121], 0);
  assert.equal(accDep(a), 120000);
});

test('residual value: depreciates down to it, never below', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 36, ResidualValue: 1000, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 10000)]);
  const charges = runThrough(a, '2026-01', '2029-06');
  assert.equal(charges[0], 250);
  assert.equal(accDep(a), 9000);
  assert.ok(charges.slice(36).every(c => c === 0));
});

test('cap: a WDV charge larger than what is left above the residual is cut to it', () => {
  const a = asset({ Method: 'WDV', WdvRate: 40, UsefulLifeMonths: 60, ResidualValue: 9100, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 10000)]);
  assert.deepEqual(runThrough(a, '2026-01', '2026-05'), [333.33, 333.33, 233.34, 0, 0]);
  assert.equal(accDep(a), 900);
  assert.equal(E.computeScheduled(a, '2026-06').fullyDepreciated, true);
});

test('rounding never leaves or adds a cent: the remainder is re-spread each month', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 3, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 1000)]);
  const charges = runThrough(a, '2026-01', '2026-04');
  assert.deepEqual(charges, [333.33, 333.34, 333.33, 0]);
  assert.equal(sum(charges), 1000);
});

test('WDV: 25% a year on the NBV at the start of each year', () => {
  const a = asset({ Method: 'WDV', WdvRate: 25, UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 100000)]);
  const y1 = runThrough(a, '2026-01', '2026-12');
  assert.ok(y1.every(c => c === 2083.33));
  const y2 = runThrough(a, '2027-01', '2027-12');
  assert.ok(y2.every(c => c === 1562.5), 'on 75,000.04: ' + y2[0]);
});

test('WDV: first year pro-rata from the start date; end of life charges what is left', () => {
  const a = asset({ Method: 'WDV', WdvRate: 20, UsefulLifeMonths: 24, ResidualValue: 500, DepStartDate: '2026-07-16' }, [cap('2026-07-16', 12000)]);
  const charges = runThrough(a, '2026-07', '2028-09');
  assert.equal(charges[0], E.round2(12000 * 0.2 / 12 * 16 / 31));
  assert.equal(charges[1], 200);
  assert.equal(accDep(a), 11500, 'down to the residual at the end of the life');
  assert.equal(charges[24], E.round2(11500 - sum(charges.slice(0, 24))));
  assert.ok(charges.slice(25).every(c => c === 0));
});

test('catch-up: a back-dated asset gets the missed months in one go', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 120000)]);
  const r = E.computeScheduled(a, '2026-04');
  assert.deepEqual(r.periods.map(p => p.period), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.deepEqual([r.total, r.current, r.catchUp], [4000, 1000, 3000]);
  a.lastDepPeriod = '2026-02';
  a.txns.push({ Type: 'Depreciation', Date: '2026-02-28', CostDelta: 0, AccDepDelta: 2000 });
  assert.deepEqual([E.computeScheduled(a, '2026-04').catchUp, E.computeScheduled(a, '2026-04').current], [1000, 1000]);
});

test('additional depreciation lowers the rest of the straight-line schedule', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 120000)]);
  runThrough(a, '2026-01', '2026-12');
  assert.equal(E.maxAdditional(a, '2027-01-10'), 108000);
  a.txns.push({ Type: 'AdditionalDepreciation', Date: '2027-01-10', CostDelta: 0, AccDepDelta: 10800 });
  const next = runThrough(a, '2027-01', '2036-01');
  assert.equal(next[0], 900, '97,200 over the remaining 108 months');
  assert.equal(accDep(a), 120000);
  assert.equal(E.maxAdditional(a, '2036-02-01'), 0);
});

test('an addition spreads over the remaining life', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 120000)]);
  runThrough(a, '2026-01', '2030-12');
  a.txns.push({ Type: 'Addition', Date: '2031-01-05', CostDelta: 12000, AccDepDelta: 0 });
  assert.equal(E.computeScheduled(a, '2031-01').total, 1200, '72,000 over 60 months');
});

test('change of estimate: a longer life spreads the remainder further', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 120000)]);
  runThrough(a, '2026-01', '2026-12');
  a.valuation.UsefulLifeMonths = 180;
  assert.equal(E.computeScheduled(a, '2027-01').total, E.round2(108000 / 168));
});

test('take-over: continues from the given accumulated depreciation and last period', () => {
  const t = { Type: 'TakeOver', Date: '2030-12-31', CostDelta: 120000, AccDepDelta: 60000 };
  const a = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [t], '2030-12');
  const r = E.computeScheduled(a, '2031-01');
  assert.deepEqual([r.total, r.catchUp], [1000, 0]);
  const w = asset({ Method: 'WDV', WdvRate: 25, UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2024-01-01' },
    [{ Type: 'TakeOver', Date: '2026-06-30', CostDelta: 100000, AccDepDelta: 52343.75, YearStartNBV: 56250 }], '2026-06');
  assert.equal(E.computeScheduled(w, '2026-07').total, E.round2(56250 * 0.25 / 12), 'WDV uses the year-start NBV');
});

test('nothing before the depreciation start, and nothing for method None', () => {
  const a = asset({ Method: 'SL', UsefulLifeMonths: 60, ResidualValue: 0, DepStartDate: '2026-05-01' }, [cap('2026-05-01', 6000)]);
  assert.equal(E.computeScheduled(a, '2026-04').total, 0);
  assert.equal(E.computeScheduled(a, '2026-04').periods.length, 0);
  assert.equal(E.computeScheduled(asset({ Method: 'None', DepStartDate: '2026-01-01' }, [cap('2026-01-01', 5)]), '2026-02').total, 0);
});

test('valuation checks', () => {
  assert.equal(E.validateValuation({ Method: 'SL', UsefulLifeMonths: 120 }, 'Tangible'), '');
  assert.match(E.validateValuation({ Method: 'SL' }, 'Tangible'), /Useful life is required/);
  assert.match(E.validateValuation({ Method: 'WDV', UsefulLifeMonths: 60 }, 'Tangible'), /WDV rate is required/);
  assert.match(E.validateValuation({ Method: '' }, 'Tangible'), /Select a depreciation method/);
  assert.match(E.validateValuation({ Method: 'None' }, 'Tangible'), /Straight Line or Written Down Value/);
  assert.equal(E.validateValuation({ Method: 'None' }, 'Land'), '');
  assert.match(E.validateValuation({ Method: 'SL', UsefulLifeMonths: 12 }, 'AuC'), /must be None/);
  assert.match(E.validateValuation({ Method: 'SL', UsefulLifeMonths: 12, ResidualValue: -1 }, 'Tangible'), /cannot be negative/);
});

test('date helpers', () => {
  assert.equal(E.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(E.addMonths('2026-03-17', 120), '2036-03-17');
  assert.equal(E.lastDay('2028-02'), '2028-02-29');
  assert.equal(E.nextPeriod('2026-12'), '2027-01');
  assert.equal(E.prevPeriod('2026-01'), '2025-12');
  assert.equal(E.periodFactor('2026-03', '2026-03-17', '2036-03-17'), 15 / 31);
});

test('retirement: the retirement month counts the days before the date; earlier unposted months in full', () => {
  const posted = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' },
    [cap('2026-01-01', 120000), { Type: 'Depreciation', Date: '2026-02-28', CostDelta: 0, AccDepDelta: 2000 }], '2026-02');
  const r = E.computeToDate(posted, '2026-03-16');
  assert.deepEqual([r.current, r.catchUp, r.total, r.closing.accDep, r.closing.nbv], [483.87, 0, 483.87, 2483.87, 117516.13]);
  assert.equal(E.computeToDate(posted, '2026-03-01').total, 0, 'retired on the 1st: nothing for that month');

  const fresh = asset({ Method: 'SL', UsefulLifeMonths: 120, ResidualValue: 0, DepStartDate: '2026-01-01' }, [cap('2026-01-01', 120000)]);
  const c = E.computeToDate(fresh, '2026-03-16');
  assert.deepEqual([c.catchUp, c.current, c.total], [2000, 483.87, 2483.87]);
  assert.deepEqual(c.periods.map(p => p.period), ['2026-01', '2026-02', '2026-03']);
});

test('retirement: nothing before the depreciation start; the brief\'s NBV example', () => {
  const later = asset({ Method: 'SL', UsefulLifeMonths: 60, ResidualValue: 0, DepStartDate: '2026-06-01' }, [cap('2026-05-20', 6000)]);
  assert.equal(E.computeToDate(later, '2026-05-25').total, 0);
  // Cost 6,000, 4,000 depreciated up to February: retired 1 March, NBV 2,000.
  const t = asset({ Method: 'SL', UsefulLifeMonths: 60, ResidualValue: 0, DepStartDate: '2023-03-01' },
    [{ Type: 'TakeOver', Date: '2026-02-28', CostDelta: 6000, AccDepDelta: 4000 }], '2026-02');
  const r = E.computeToDate(t, '2026-03-01');
  assert.deepEqual([r.total, r.closing.accDep, r.closing.nbv], [0, 4000, 2000]);
});
