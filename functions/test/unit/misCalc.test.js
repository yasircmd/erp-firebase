// MIS, the pure core (docs/modules/MIS.md): periods and the four
// comparisons, variations, GL figures, P&L, Balance Sheet, ratios, the ratio
// map's seed and stock cover.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../src/misCalc');

test('periods: the four comparisons; months across a year end; the financial year start', () => {
  assert.deepEqual(M.periods('2026-01', 'prevMonth').compare, { from: '2025-12-01', to: '2025-12-31', label: '2025-12', months: ['2025-12'] });
  assert.deepEqual(M.periods('2026-03', 'lastYear').compare.months, ['2025-03']);
  assert.equal(M.periods('2024-02', 'prevMonth').current.to, '2024-02-29', 'a leap year');
  const ytd = M.periods('2026-05', 'ytd', 4);
  assert.deepEqual(ytd.current.months, ['2026-04', '2026-05'], 'the year starting in April');
  assert.deepEqual(ytd.compare.months, ['2025-04', '2025-05']);
  assert.deepEqual(M.periods('2026-02', 'ytd', 4).current.months[0], '2025-04', 'Feb is in the year that started last April');
  assert.equal(M.periods('2026-05', 'budget').compare.budget, true);
  assert.equal(M.periods('2026-05', 'nonsense').mode, 'prevMonth', 'the default');
  assert.throws(() => M.periods('May', 'prevMonth'), /Choose a month/);
});

test('variance: absolute and %; good by the measure\'s sense; no % against nothing', () => {
  assert.deepEqual(M.variance(1200, 1000, 'up'), { current: 1200, compare: 1000, abs: 200, pct: 20, good: true });
  assert.deepEqual(M.variance(1200, 1000, 'down'), { current: 1200, compare: 1000, abs: 200, pct: 20, good: false }, 'expenses up is bad');
  assert.equal(M.variance(-50, -100, 'up').pct, 50, '% of the size of the comparison');
  assert.equal(M.variance(10, 0, 'up').pct, null);
  assert.equal(M.variance(5, 5, 'up').good, null);
});

// A small chart: cash, receivables, stock, payables, capital, sales, cost of sales, rent.
const COA = {
  CASH: { AccountType: 'Asset', IsPostable: true, CashBank: 'Cash' }, AR: { AccountType: 'Asset', IsPostable: true },
  INV: { AccountType: 'Asset', IsPostable: true }, VAN: { AccountType: 'Asset', IsPostable: true },
  AP: { AccountType: 'Liability', IsPostable: true }, CAP: { AccountType: 'Equity', IsPostable: true },
  SALES: { AccountType: 'Revenue', IsPostable: true }, COGS: { AccountType: 'COGS', IsPostable: true }, RENT: { AccountType: 'Expense', IsPostable: true },
  HEAD: { AccountType: 'Asset', IsPostable: false }, OTHERCO: { AccountType: 'Asset', IsPostable: true, CompanyID: 'C2' }
};
const je = (date, lines, status) => ({ JVDate: date, Status: status || 'Posted', Lines: lines.map(([a, d, c]) => ({ AccountID: a, Debit: d, Credit: c })) });
const ENTRIES = [
  je('2026-01-01', [['CASH', 10000, 0], ['CAP', 0, 10000]]),                       // capital
  je('2026-01-05', [['INV', 4000, 0], ['AP', 0, 4000]]),                           // stock bought on credit
  je('2026-01-10', [['AR', 3000, 0], ['SALES', 0, 3000], ['COGS', 1800, 0], ['INV', 0, 1800]]),
  je('2026-01-20', [['RENT', 500, 0], ['CASH', 0, 500]]),
  je('2026-02-10', [['CASH', 5000, 0], ['SALES', 0, 5000], ['COGS', 2000, 0], ['INV', 0, 2000]]),
  je('2026-02-15', [['RENT', 500, 0], ['CASH', 0, 500]]),
  je('2026-02-20', [['RENT', 9999, 0], ['CASH', 0, 9999]], 'Draft')               // not posted: ignored
];

test('GL buckets, P&L of a period, Balance Sheet at a month end that balances', () => {
  const b = M.glBuckets(ENTRIES);
  assert.equal(b.RENT['2026-02'], 500, 'the draft is ignored');
  const g = M.accountsByGroup(COA, 'C1');
  assert.ok(!g.assets.includes('HEAD') && !g.assets.includes('OTHERCO'), 'postable accounts of the company only');
  assert.deepEqual(M.profitAndLoss(b, g, ['2026-01']), { revenue: 3000, cogs: 1800, grossProfit: 1200, expenses: 500, netProfit: 700 });
  assert.deepEqual(M.profitAndLoss(b, g, ['2026-01', '2026-02']).netProfit, 3200);
  const bs = M.balanceSheet(b, g, '2026-02');
  assert.deepEqual(bs, { assets: 17200, liabilities: 4000, equity: 13200, unclosedProfit: 3200, check: 0 });
  assert.equal(M.balanceSheet(b, g, '2026-01').check, 0);
});

test('ratios from the ratio map; nothing to divide by gives none', () => {
  const b = M.glBuckets(ENTRIES), g = M.accountsByGroup(COA, 'C1');
  const map = { currentAssets: ['CASH', 'AR', 'INV'], currentLiabilities: ['AP'], inventory: ['INV'], cash: ['CASH'], receivables: ['AR'], payables: ['AP'] };
  const r = M.ratios(b, g, map, ['2026-02'], '2026-02');
  // At Feb end: cash 14,000 (10,000 − 500 + 5,000 − 500; the draft ignored), AR 3,000, stock 200, AP 4,000.
  assert.equal(r.current, M.round2((14000 + 3000 + 200) / 4000));
  assert.equal(r.quick, M.round2((14000 + 3000) / 4000));
  assert.equal(r.grossMargin, 60, '(5,000 − 2,000) ÷ 5,000');
  assert.equal(r.netMargin, 50, '(3,000 − 500) ÷ 5,000');
  assert.equal(r.debtToEquity, M.round2(4000 / 13200));
  const empty = M.ratios({}, g, map, ['2026-02'], '2026-02');
  assert.deepEqual([empty.current, empty.grossMargin, empty.stockDays], [null, null, null]);
  assert.equal(M.RATIOS.length, 9);
});

test('the ratio map\'s seed: cash and bank, inventory, the parties\' accounts current; the rest for Finance', () => {
  const s = M.seedRatioMap(COA, 'C1', { inventoryIds: ['INV'], receivableIds: ['AR'], payableIds: ['AP'] });
  assert.deepEqual(s, { currentAssets: ['AR', 'CASH', 'INV'], currentLiabilities: ['AP'], inventory: ['INV'], cash: ['CASH'], receivables: ['AR'], payables: ['AP'] });
  assert.ok(!s.currentAssets.includes('VAN'), 'a van is not current');
});

test('stock cover: fast under 30 days, slow over 90, non-moving with no movement', () => {
  assert.deepEqual(M.stockCover(100, 180, 90, {}), { cover: 50, class: 'normal' }, '100 ÷ (180 ÷ 90 a day) = 50 days');
  assert.equal(M.stockCover(20, 180, 90).class, 'fast');
  assert.equal(M.stockCover(500, 180, 90).class, 'slow');
  assert.equal(M.stockCover(50, 0, 90).class, 'nonMoving');
  assert.equal(M.stockCover(0, 0, 90).class, 'none');
  assert.equal(M.stockCover(100, 180, 90, { fastDays: 60, slowDays: 120 }).class, 'fast', 'the company\'s own thresholds');
});
