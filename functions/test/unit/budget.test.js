// Budget and forecast's calculations (docs/modules/BUDGET.md, Q338-Q345):
// the year's months and label; natural signs; an actual line counted
// against the most specific budget line that fits, else "not budgeted";
// the P&L on the year alone, without the year-end closing entry; the
// balance sheet as movements (from the actual opening) or closing
// balances; year to date; favourable or not; seeds from last year; spread.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/budgetCalc');

const ACC = { REV: { AccountType: 'Revenue' }, RENT: { AccountType: 'Expense' }, CASH: { AccountType: 'Asset' }, LOAN: { AccountType: 'Liability' }, RE: { AccountType: 'Equity' } };
const zero = () => Array(12).fill(0);
const at = (i, v) => { const a = zero(); a[i] = v; return a; };
const je = (date, lines, type) => ({ JVDate: date, VoucherType: type || 'JV', Lines: lines });
const L = (AccountID, Debit, Credit, CostCenterID, ProjectID) => ({ AccountID, Debit, Credit, CostCenterID, ProjectID });

test('the year: twelve months from its start; FY 2026 or FY 2026-27', () => {
  assert.deepEqual([C.monthsOf('2026-04')[0], C.monthsOf('2026-04')[11], C.monthsOf('2026-01')[11]], ['2026-04', '2027-03', '2026-12']);
  assert.deepEqual([C.yearLabel('2026-01'), C.yearLabel('2026-04'), C.yearLabel('2099-04')], ['FY 2026', 'FY 2026-27', 'FY 2099-00']);
  assert.equal(C.addMonths('2026-04', -12), '2025-04');
  assert.deepEqual([C.versionLabel(0), C.versionLabel(2)], ['Original', 'Revision 2']);
});

test('amounts: twelve, rounded, blanks as 0; anything else refused', () => {
  assert.deepEqual(C.amountsOf(['', 1.006, '2', null, 0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 4), [0, 1.01, 2, 0]);
  assert.throws(() => C.amountsOf([1, 2]), /twelve/);
  assert.throws(() => C.amountsOf(['x', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), /not a number/);
});

test('an actual line counts against the most specific budget line that fits; the rest is the company line, else not budgeted', () => {
  const index = new Set(['RENT|CC1|P1', 'RENT|CC1|', 'RENT||', 'REV||P2']);
  assert.equal(C.lineFor(index, 'RENT', 'CC1', 'P1'), 'RENT|CC1|P1');
  assert.equal(C.lineFor(index, 'RENT', 'CC1', 'P9'), 'RENT|CC1|');
  assert.equal(C.lineFor(index, 'RENT', 'CC2', ''), 'RENT||', 'a cost centre not budgeted: the company line');
  assert.equal(C.lineFor(index, 'REV', 'CC1', 'P2'), 'REV||P2', 'project only');
  assert.equal(C.lineFor(index, 'REV', 'CC1', ''), null, 'no line fits');
});

test('the P&L: the year\'s own activity in natural signs, not earlier years nor the year-end close; not budgeted shown apart', () => {
  const budget = { YearStart: '2026-04', Lines: [
    { AccountID: 'REV', Amounts: at(0, 1000) },
    { AccountID: 'RENT', CostCenterID: 'CC1', Amounts: at(0, 300) }] };
  const entries = [
    je('2026-03-31', [L('RENT', 999, 0, 'CC1')]), // last year
    je('2026-04-10', [L('CASH', 1200, 0), L('REV', 0, 1200)]),
    je('2026-04-15', [L('RENT', 250, 0, 'CC1'), L('RENT', 40, 0, 'CC2'), L('CASH', 0, 290)]),
    je('2026-05-02', [L('REV', 50, 0)]), // a credit note
    je('2027-03-31', [L('REV', 1250, 0), L('RE', 0, 1250)], 'YearEndClose'),
    je('2027-04-01', [L('RENT', 77, 0, 'CC1')]) // next year
  ];
  const rows = C.compare(budget, ACC, entries);
  const by = k => rows.find(r => C.keyOf(r) === k);
  assert.deepEqual([by('REV||').Actual[0], by('REV||').Actual[1], by('REV||').Actual[11]], [1200, -50, 0]);
  assert.equal(by('RENT|CC1|').Actual[0], 250);
  assert.deepEqual([by('RENT|CC2|').Budgeted, by('RENT|CC2|').Actual[0]], [false, 40], 'CC2 not budgeted (no company line for rent)');
  assert.equal(rows.some(r => r.AccountID === 'CASH' || r.AccountID === 'RE'), false, 'a P&L budget: the balance sheet is not "not budgeted"');
  const t = C.totals(by('REV||'), 1);
  assert.deepEqual([t.MonthBudget, t.MonthActual, t.YtdBudget, t.YtdActual, t.YearBudget], [0, -50, 1000, 1150, 1000]);
});

test('the balance sheet: movements from the actual opening, or closing balances against the actual balance', () => {
  const entries = [
    je('2025-12-31', [L('CASH', 500, 0), L('LOAN', 0, 500)]),
    je('2026-01-20', [L('CASH', 0, 100), L('LOAN', 100, 0)]),
    je('2026-02-20', [L('CASH', 0, 100), L('LOAN', 100, 0)])
  ];
  const mv = C.compare({ YearStart: '2026-01', BalanceSheetMethod: 'Movements', Lines: [{ AccountID: 'LOAN', Amounts: Array(12).fill(-100) }] }, ACC, entries);
  const loan = mv.find(r => r.AccountID === 'LOAN');
  assert.deepEqual([loan.Measure, loan.Opening, loan.Actual[0], loan.Actual[1], loan.BudgetBalance[0], loan.BudgetBalance[11]], ['flow', 500, -100, -100, 400, -700]);
  assert.equal(mv.find(r => r.AccountID === 'CASH').Budgeted, false, 'with a balance-sheet line, the others show as not budgeted');
  const cl = C.compare({ YearStart: '2026-01', BalanceSheetMethod: 'Closing', Lines: [{ AccountID: 'LOAN', Amounts: [450, 380].concat(Array(10).fill(300)) }] }, ACC, entries);
  const l2 = cl.find(r => r.AccountID === 'LOAN');
  assert.deepEqual([l2.Measure, l2.Actual[0], l2.Actual[1], l2.Actual[11]], ['balance', 400, 300, 300]);
  const t = C.totals(l2, 1);
  assert.deepEqual([t.YtdBudget, t.YtdActual, t.YearBudget], [380, 300, 300], 'a balance: the month\'s, not a sum');
});

test('favourable: more revenue, less cost; the balance sheet neither', () => {
  assert.deepEqual([C.favour('Revenue', 100, 120), C.favour('Revenue', 100, 90), C.favour('Expense', 100, 90), C.favour('COGS', 100, 130), C.favour('Asset', 1, 9), C.favour('Expense', 5, 5)], [1, -1, 1, -1, 0, 0]);
});

test('the approval amount: the year\'s budgeted costs', () => {
  assert.equal(C.approvalAmount([{ AccountType: 'Expense', Amounts: Array(12).fill(10) }, { AccountType: 'COGS', Amounts: at(3, 5) }, { AccountType: 'Revenue', Amounts: at(0, 999) }, { AccountType: 'Asset', Amounts: at(0, 50) }]), 125);
});

test('seeds: last year\'s actuals by month (+%), per cost centre or per account; last year\'s budget (+%)', () => {
  const entries = [je('2025-04-05', [L('RENT', 100, 0, 'CC1'), L('RENT', 50, 0, 'CC2'), L('CASH', 0, 150)]), je('2025-06-01', [L('REV', 0, 1000)]), je('2026-03-31', [L('REV', 1000, 0)], 'YearEndClose')];
  const dim = C.seedFromActuals('2025-04', ACC, entries, 10, true);
  assert.deepEqual(dim.map(l => [C.keyOf(l), l.Amounts[0], l.Amounts[2]]).sort(), [['RENT|CC1|', 110, 0], ['RENT|CC2|', 55, 0], ['REV||', 0, 1100]]);
  const flat = C.seedFromActuals('2025-04', ACC, entries, 0, false);
  assert.deepEqual(flat.find(l => l.AccountID === 'RENT').Amounts[0], 150);
  assert.deepEqual(C.seedFromBudget([{ AccountID: 'RENT', CostCenterID: 'CC1', Amounts: at(0, 100) }], -5)[0].Amounts[0], 95);
});

test('spread: evenly or by a pattern, always adding up to the amount', () => {
  const even = C.spread(1000);
  assert.deepEqual([even[0], even[11], C.round2(even.reduce((s, v) => s + v, 0))], [83.33, 83.37, 1000]);
  const p = C.spread(1200, [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual([p[2], p[3], p[11], p[0]], [300, 300, 600, 0]);
  assert.deepEqual(C.spread(120, zero()), Array(12).fill(10), 'an empty pattern: evenly');
});

test('a forecast starts from the actuals through its month and the budget after; a P&L actual not budgeted joins, the balance sheet doesn\'t', () => {
  const budget = { YearStart: '2026-01', Lines: [{ AccountID: 'REV', Amounts: Array(12).fill(100) }, { AccountID: 'RENT', CostCenterID: 'CC1', Amounts: Array(12).fill(30) }] };
  const rows = C.compare(budget, ACC, [je('2026-01-05', [L('REV', 0, 90), L('CASH', 90, 0)]), je('2026-02-05', [L('RENT', 45, 0, 'CC2'), L('CASH', 0, 45)])]);
  const lines = C.forecastStart(rows, 1); // actuals through February
  const by = k => lines.find(l => C.keyOf(l) === k);
  assert.deepEqual(by('REV||').Amounts.slice(0, 3), [90, 0, 100]);
  assert.deepEqual(by('RENT|CC1|').Amounts.slice(0, 3), [0, 0, 30]);
  assert.deepEqual(by('RENT|CC2|').Amounts.slice(0, 3), [0, 45, 0], 'not budgeted: its actuals, nothing ahead');
  assert.equal(lines.some(l => l.AccountID === 'CASH'), false);
  assert.equal(C.forecastStart(rows, -1).find(l => l.AccountID === 'REV').Amounts[0], 100, 'no actuals yet: all budget');
});

test('a forecast saved: its actual months as made, whatever is sent; a line with actuals kept; a new line without actuals', () => {
  const stored = [{ AccountID: 'REV', CostCenterID: '', ProjectID: '', Amounts: [90, 80].concat(Array(10).fill(100)) },
    { AccountID: 'RENT', CostCenterID: 'CC1', ProjectID: '', Amounts: [0, 0].concat(Array(10).fill(30)) }];
  const sent = [{ AccountID: 'REV', CostCenterID: '', ProjectID: '', Amounts: [999, 999].concat(Array(10).fill(120)) },
    { AccountID: 'RENT', CostCenterID: 'CC2', ProjectID: '', Amounts: [5, 5].concat(Array(10).fill(10)) }];
  const out = C.lockActuals(stored, sent, 1);
  assert.deepEqual(out[0].Amounts.slice(0, 3), [90, 80, 120]);
  assert.deepEqual(out[1].Amounts.slice(0, 3), [0, 0, 10]);
  assert.throws(() => C.lockActuals(stored, [sent[1]], 1), /has actuals to date/);
  assert.equal(C.lockActuals(stored, sent.slice(0, 1).concat([stored[1]]), 1).length, 2, 'the rent line without actuals may go too: here kept');
});

test('the forecast beside Budget vs Actual: on its row, or a row of its own; the year\'s forecast summed', () => {
  const rows = C.compare({ YearStart: '2026-01', Lines: [{ AccountID: 'REV', Amounts: Array(12).fill(100) }] }, ACC, []);
  C.attachForecast(rows, [{ AccountID: 'REV', Amounts: Array(12).fill(110) }, { AccountID: 'RENT', CostCenterID: 'CC9', Amounts: at(5, 50) }], ACC);
  const rev = rows.find(r => r.AccountID === 'REV'), rent = rows.find(r => r.AccountID === 'RENT');
  assert.deepEqual([rev.YearForecast, rent.YearForecast, rent.Budgeted, rent.AccountType], [1320, 50, false, 'Expense']);
});
