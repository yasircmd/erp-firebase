// No entry dated after the current month (owner, 2026-11-06; docs/modules/
// UX_ROUND3.md item 3, Q411); payroll up to 12 months ahead.
const test = require('node:test');
const assert = require('node:assert/strict');
const lock = require('../../src/periodLock');

test('the latest date: this month\'s end; payroll\'s types 12 months on', () => {
  assert.equal(lock.latestDate('', '2026-11-06'), '2026-11-30');
  assert.equal(lock.latestDate('JV', '2026-02-10'), '2026-02-28');
  assert.equal(lock.latestDate('Payroll', '2026-11-06'), '2027-11-30');
  assert.equal(lock.latestDate('PayrollPayment', '2026-12-31'), '2027-12-31');
  for (const t of ['Payroll', 'PayrollPayment', 'PayrollLoan', 'PayrollProvision', 'FinalSettlement']) assert.ok(lock.PAYROLL_TYPES.includes(t), t);
  assert.ok(!lock.PAYROLL_TYPES.includes('FADepreciation'));
});

test('a date after the limit is refused, saying why; the limit itself and before are not', () => {
  const end = lock.latestDate('');
  const next = new Date(Date.parse(end + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  assert.doesNotThrow(() => lock.assertNotPostDated(end, 'X'));
  assert.doesNotThrow(() => lock.assertNotPostDated('2020-01-01', 'X'));
  assert.doesNotThrow(() => lock.assertNotPostDated('', 'X'), 'no date: the other checks speak');
  assert.throws(() => lock.assertNotPostDated(next, 'The entry'), new RegExp('The entry: the date ' + next + ' is after ' + end + ', the end of this month'));
  assert.doesNotThrow(() => lock.assertNotPostDated(next, 'Payroll', 'Payroll'), 'payroll goes further');
  assert.throws(() => lock.assertNotPostDated(lock.monthEndFrom(end, 13), 'Payroll', 'Payroll'), /12 months ahead/);
});
