// MIS report builder, the pure engine (docs/modules/MIS.md, phase 4,
// Q446-Q449): filters, a list, a grouping by one or two fields with totals,
// a pivot, sorting, limits and the spec's checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../../src/misQuery');

const F = { date: { label: 'Date', type: 'date' }, month: { label: 'Month', type: 'month' }, customer: { label: 'Customer', type: 'text' },
  rep: { label: 'Sales rep', type: 'text' }, qty: { label: 'Quantity', type: 'number' }, amount: { label: 'Amount', type: 'number' } };
const L = [
  { date: '2026-10-03', month: '2026-10', customer: 'Alpha', rep: 'Asha', qty: 2, amount: 100 },
  { date: '2026-10-20', month: '2026-10', customer: 'Beta', rep: 'Ben', qty: 1, amount: 50 },
  { date: '2026-11-02', month: '2026-11', customer: 'Alpha', rep: 'Asha', qty: 4, amount: 220 },
  { date: '2026-11-15', month: '2026-11', customer: 'Gamma', rep: '', qty: 3, amount: 90 },
  { date: '2026-11-28', month: '2026-11', customer: 'Beta', rep: 'Ben', qty: 1, amount: 60 }
];

test('filters: text without case, numbers, dates and months, between', () => {
  const f = (filters) => Q.applyFilters(L, Q.cleanSpec({ view: 'list', columns: ['customer'], filters }, F).filters, F).map(r => r.amount);
  assert.deepEqual(f([{ field: 'customer', op: 'eq', value: 'alpha' }]), [100, 220]);
  assert.deepEqual(f([{ field: 'customer', op: 'contains', value: 'ET' }]), [50, 60]);
  assert.deepEqual(f([{ field: 'amount', op: 'gt', value: '90' }]), [100, 220]);
  assert.deepEqual(f([{ field: 'date', op: 'between', value: '2026-10-15', to: '2026-11-10' }]), [50, 220]);
  assert.deepEqual(f([{ field: 'date', op: 'eq', value: '2026-11' }]), [220, 90, 60], 'a date equal to a month: that month');
  assert.deepEqual(f([{ field: 'month', op: 'ne', value: '2026-11' }, { field: 'rep', op: 'eq', value: 'asha' }]), [100]);
});

test('a list with its totals; sorted; limited', () => {
  const r = Q.run(L, { view: 'list', columns: ['customer', 'amount'], sort: { by: 1, dir: 'desc' }, limit: 2 }, F);
  assert.deepEqual(r.rows, [['Alpha', 220], ['Alpha', 100]]);
  assert.deepEqual([r.totals, r.count, r.truncated], [['', 520], 5, true]);
});

test('grouped by one and two fields, with sum, count, average, lowest and highest; "(none)" for a blank', () => {
  const r = Q.run(L, { view: 'group', groupBy: ['rep'], measures: [{ field: 'amount', agg: 'sum' }, { agg: 'count' }, { field: 'qty', agg: 'avg' }] }, F);
  assert.deepEqual(r.columns.map(c => c.label), ['Sales rep', 'Total amount', 'Count', 'Average quantity']);
  assert.deepEqual(r.rows, [['(none)', 90, 1, 3], ['Asha', 320, 2, 3], ['Ben', 110, 2, 1]]);
  assert.deepEqual(r.totals, ['Total', 520, 5, 2.2]);
  const two = Q.run(L, { view: 'group', groupBy: ['month', 'customer'], measures: [{ field: 'amount', agg: 'max' }], sort: { by: 2, dir: 'desc' } }, F);
  assert.deepEqual(two.rows[0], ['2026-11', 'Alpha', 220]);
  assert.equal(two.rows.length, 5);
  assert.deepEqual(Q.asReportRows(r).map(x => [x.label, x.current]), [['(none)', 90], ['Asha', 320], ['Ben', 110]]);
});

test('a pivot: rows × columns with its row and column totals', () => {
  const r = Q.run(L, { view: 'pivot', pivot: { rows: 'customer', cols: 'month', measure: { field: 'amount', agg: 'sum' } } }, F);
  assert.deepEqual(r.columns.map(c => c.label), ['Customer', '2026-10', '2026-11', 'Total']);
  assert.deepEqual(r.rows, [['Alpha', 100, 220, 320], ['Beta', 50, 60, 110], ['Gamma', null, 90, 90]]);
  assert.deepEqual(r.totals, ['Total', 150, 370, 520]);
  assert.equal(r.figure, 'Total amount');
});

test('the spec\'s checks', () => {
  const bad = (spec, re) => assert.throws(() => Q.cleanSpec(spec, F), re);
  bad({ view: 'list', columns: [] }, /Choose the columns/);
  bad({ view: 'list', columns: ['nope'] }, /Unknown field for a column: nope/);
  bad({ view: 'group', groupBy: ['rep', 'customer', 'month'], measures: [{ agg: 'count' }] }, /one or two fields/);
  bad({ view: 'group', groupBy: ['rep'], measures: [{ field: 'customer', agg: 'sum' }] }, /is not a number: count it/);
  bad({ view: 'group', groupBy: ['rep'], measures: [] }, /at least one total/);
  bad({ view: 'pivot', pivot: { rows: 'rep', cols: 'rep', measure: { agg: 'count' } } }, /must be different/);
  bad({ view: 'list', columns: ['rep'], filters: [{ field: 'customer', op: 'gt', value: 'a' }] }, /is text/);
  bad({ view: 'list', columns: ['rep'], filters: [{ field: 'amount', op: 'between', value: '1' }] }, /both ends/);
  assert.equal(Q.cleanSpec({ view: 'list', columns: ['rep'], limit: 99999 }, F).limit, 500);
});
