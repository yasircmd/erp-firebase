// MIS, the pure core (owner, 2026-11-08; docs/modules/MIS.md, Q427-Q434):
// periods and the four comparisons, variations, GL figures by account and
// month, the P&L and Balance Sheet groups, the ratios and stock cover. No
// database here, so every figure is unit-tested (unit/misCalc.test.js).
// New development, hand-written.
'use strict';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pad = n => String(n).padStart(2, '0');

// ---------- periods ----------
// A month is 'YYYY-MM'. A period is { from, to, label } with yyyy-mm-dd dates.
const monthOf = date => String(date || '').slice(0, 7);
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
}
const lastDay = month => { const [y, m] = month.split('-').map(Number); return month + '-' + pad(new Date(Date.UTC(y, m, 0)).getUTCDate()); };
const monthPeriod = month => ({ from: month + '-01', to: lastDay(month), label: month, months: [month] });
function monthsBetween(from, to) {
  const out = [];
  for (let m = from; m <= to && out.length < 240; m = addMonths(m, 1)) out.push(m);
  return out;
}
// The financial year's first month for a month, the year starting in fyStartMonth (1-12).
function yearStart(month, fyStartMonth) {
  const [y, m] = month.split('-').map(Number);
  const s = Number(fyStartMonth) || 1;
  return (m >= s ? y : y - 1) + '-' + pad(s);
}

// The four comparisons (Q429). mode: 'prevMonth' (the default), 'lastYear'
// (the same month a year before), 'ytd' (year to date against the same
// stretch of the year before) or 'budget' (the same period, against the
// budget). Returns { current, compare, mode }; compare.budget for 'budget'.
const MODES = Object.freeze(['prevMonth', 'lastYear', 'ytd', 'budget']);
function periods(month, mode, fyStartMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Choose a month (yyyy-mm).');
  const m = MODES.includes(mode) ? mode : 'prevMonth';
  if (m === 'ytd') {
    const start = yearStart(month, fyStartMonth);
    const months = monthsBetween(start, month);
    const prior = months.map(x => addMonths(x, -12));
    return { mode: m, current: { from: start + '-01', to: lastDay(month), label: start + ' to ' + month, months },
      compare: { from: prior[0] + '-01', to: lastDay(prior[prior.length - 1]), label: prior[0] + ' to ' + prior[prior.length - 1], months: prior } };
  }
  const current = monthPeriod(month);
  if (m === 'lastYear') return { mode: m, current, compare: monthPeriod(addMonths(month, -12)) };
  if (m === 'budget') return { mode: m, current, compare: Object.assign(monthPeriod(month), { budget: true, label: month + ' budget' }) };
  return { mode: m, current, compare: monthPeriod(addMonths(month, -1)) };
}

// ---------- variation ----------
// sense: 'up' (more is better: sales, profit), 'down' (less is better:
// expenses) or 'none'. pct is null when the comparison is 0.
function variance(current, compare, sense) {
  const c = round2(current), p = round2(compare);
  const abs = round2(c - p);
  const pct = p === 0 ? null : round2((abs / Math.abs(p)) * 100);
  const good = sense === 'up' ? abs > 0 : sense === 'down' ? abs < 0 : null;
  return { current: c, compare: p, abs, pct, good: abs === 0 ? null : good };
}

// ---------- GL figures ----------
// From posted journal entries: { accountId: { 'YYYY-MM': debit - credit } }.
function glBuckets(entries) {
  const out = {};
  (entries || []).forEach(e => {
    if (e.Status && e.Status !== 'Posted') return;
    const m = monthOf(e.JVDate);
    (e.Lines || []).forEach(l => {
      const a = l.AccountID; if (!a) return;
      const b = out[a] || (out[a] = {});
      b[m] = round2((b[m] || 0) + (Number(l.Debit) || 0) - (Number(l.Credit) || 0));
    });
  });
  return out;
}
// Debit minus credit of accounts over months (a movement) or up to a month's end (a balance).
const movement = (buckets, accountIds, months) => round2(accountIds.reduce((t, a) => t + months.reduce((s, m) => s + ((buckets[a] || {})[m] || 0), 0), 0));
const balanceTo = (buckets, accountIds, month) => round2(accountIds.reduce((t, a) => t + Object.keys(buckets[a] || {}).reduce((s, m) => s + (m <= month ? buckets[a][m] : 0), 0), 0));

// The accounts of each P&L and Balance Sheet group, from the account type.
// coa: { id: { AccountType, IsPostable, CompanyID, Status } }.
const PL_TYPES = Object.freeze({ Revenue: 'revenue', COGS: 'cogs', Expense: 'expenses' });
const BS_TYPES = Object.freeze({ Asset: 'assets', Liability: 'liabilities', Equity: 'equity' });
function accountsByGroup(coa, companyId) {
  const g = { revenue: [], cogs: [], expenses: [], assets: [], liabilities: [], equity: [] };
  Object.keys(coa || {}).forEach(id => {
    const a = coa[id];
    if (!a || a.IsPostable !== true) return;
    if (a.CompanyID && companyId && a.CompanyID !== companyId) return;
    const k = PL_TYPES[a.AccountType] || BS_TYPES[a.AccountType];
    if (k) g[k].push(id);
  });
  return g;
}

// The P&L of a set of months: revenue, cost of sales, gross profit,
// expenses, net profit (credits positive for revenue).
function profitAndLoss(buckets, groups, months) {
  const revenue = round2(-movement(buckets, groups.revenue, months));
  const cogs = movement(buckets, groups.cogs, months);
  const expenses = movement(buckets, groups.expenses, months);
  const gross = round2(revenue - cogs);
  return { revenue, cogs, grossProfit: gross, expenses, netProfit: round2(gross - expenses) };
}

// The Balance Sheet at a month's end. Equity includes the profit not yet
// closed into it (every P&L account's balance to date).
function balanceSheet(buckets, groups, month) {
  const assets = balanceTo(buckets, groups.assets, month);
  const liabilities = round2(-balanceTo(buckets, groups.liabilities, month));
  const unclosed = round2(-balanceTo(buckets, groups.revenue.concat(groups.cogs, groups.expenses), month));
  const equity = round2(-balanceTo(buckets, groups.equity, month) + unclosed);
  return { assets, liabilities, equity, unclosedProfit: unclosed, check: round2(assets - liabilities - equity) };
}

// ---------- ratios (Q432) ----------
// map: { currentAssets: [ids], currentLiabilities, inventory, cash,
// receivables, payables }, the ratio map (seeded from the chart, editable).
const RATIOS = Object.freeze([
  { key: 'current', label: 'Current ratio', unit: 'x', sense: 'up' },
  { key: 'quick', label: 'Quick ratio', unit: 'x', sense: 'up' },
  { key: 'grossMargin', label: 'Gross margin', unit: '%', sense: 'up' },
  { key: 'netMargin', label: 'Net margin', unit: '%', sense: 'up' },
  { key: 'debtorDays', label: 'Debtor days', unit: 'days', sense: 'down' },
  { key: 'creditorDays', label: 'Creditor days', unit: 'days', sense: 'none' },
  { key: 'stockDays', label: 'Stock days', unit: 'days', sense: 'down' },
  { key: 'debtToEquity', label: 'Debt to equity', unit: 'x', sense: 'down' },
  { key: 'returnOnAssets', label: 'Return on assets', unit: '%', sense: 'up' }
]);
const div = (a, b) => (b ? round2(a / b) : null);
// months: the period's months (its P&L); month: its end (the balances); days in it.
function ratios(buckets, groups, map, months, month) {
  const bal = ids => balanceTo(buckets, ids || [], month);
  const ca = bal(map.currentAssets), cl = -bal(map.currentLiabilities), inv = bal(map.inventory);
  const ar = bal(map.receivables), ap = -bal(map.payables);
  const pl = profitAndLoss(buckets, groups, months);
  const bs = balanceSheet(buckets, groups, month);
  const days = months.length * 30.4;
  const pct = (a, b) => (b ? round2((a / b) * 100) : null);
  return {
    current: div(ca, cl), quick: div(ca - inv, cl),
    grossMargin: pct(pl.grossProfit, pl.revenue), netMargin: pct(pl.netProfit, pl.revenue),
    debtorDays: pl.revenue ? round2((ar / pl.revenue) * days) : null,
    creditorDays: pl.cogs ? round2((ap / pl.cogs) * days) : null,
    stockDays: pl.cogs ? round2((inv / pl.cogs) * days) : null,
    debtToEquity: div(bs.liabilities, bs.equity), returnOnAssets: pct(pl.netProfit, bs.assets)
  };
}

// The ratio map's seed from the chart (Q432): cash and bank accounts
// (CashBank), inventory (items' accounts), receivables and payables (the
// parties' control accounts) are current; the rest of the assets and
// liabilities are left for Finance to class. Ids only.
function seedRatioMap(coa, companyId, { inventoryIds = [], receivableIds = [], payableIds = [] } = {}) {
  const groups = accountsByGroup(coa, companyId);
  const cash = groups.assets.filter(id => coa[id].CashBank === 'Cash' || coa[id].CashBank === 'Bank');
  const inv = groups.assets.filter(id => inventoryIds.includes(id));
  const ar = groups.assets.filter(id => receivableIds.includes(id));
  const ap = groups.liabilities.filter(id => payableIds.includes(id));
  const uniq = a => [...new Set(a)].sort();
  return { currentAssets: uniq(cash.concat(inv, ar)), currentLiabilities: uniq(ap), inventory: inv, cash, receivables: ar, payables: ap };
}

// ---------- stock cover (Q431) ----------
// days of cover = on hand ÷ (moved ÷ days). No movement: non-moving (with
// stock) or nothing. thresholds: { fastDays: 30, slowDays: 90 }.
function stockCover(onHand, moved, days, thresholds) {
  const t = Object.assign({ fastDays: 30, slowDays: 90 }, thresholds || {});
  const q = Number(onHand) || 0, out = Number(moved) || 0;
  if (q <= 0) return { cover: null, class: out > 0 ? 'fast' : 'none' };
  if (out <= 0) return { cover: null, class: 'nonMoving' };
  const cover = round2(q / (out / days));
  return { cover, class: cover < t.fastDays ? 'fast' : cover > t.slowDays ? 'slow' : 'normal' };
}

module.exports = {
  round2, monthOf, addMonths, lastDay, monthsBetween, yearStart, MODES, periods, variance,
  glBuckets, movement, balanceTo, accountsByGroup, profitAndLoss, balanceSheet,
  RATIOS, ratios, seedRatioMap, stockCover
};
