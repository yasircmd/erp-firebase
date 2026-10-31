// Budget and forecast, the calculations (owner, 2026-10-30;
// docs/modules/BUDGET.md, Q338-Q345). New development, hand-written, pure:
// no reads, so every rule here is unit-tested on its own.
//
// Amounts are in the base currency and in each account's natural sign:
// income, liabilities and equity count up on the credit side, costs and
// assets on the debit side, so a budget is typed as people think of it
// (revenue 100,000, rent 12,000) and "more" means more of that account.
'use strict';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const PL_TYPES = ['Revenue', 'COGS', 'Expense'];
const CREDIT_TYPES = ['Revenue', 'Liability', 'Equity'];
const isPL = type => PL_TYPES.includes(type);
// +1 when the account grows with debits, -1 when it grows with credits.
const signOf = type => (CREDIT_TYPES.includes(type) ? -1 : 1);
const natural = (type, debit, credit) => signOf(type) * ((Number(debit) || 0) - (Number(credit) || 0));

function addMonths(m, n) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mo / 12), mm = ((mo % 12) + 12) % 12 + 1;
  return yy + '-' + String(mm).padStart(2, '0');
}
// The twelve periods (yyyy-mm) of the financial year starting at yearStart.
const monthsOf = yearStart => Array.from({ length: 12 }, (_, i) => addMonths(yearStart, i));
// "FY 2026" for January to December; "FY 2026-27" for April to March.
const yearLabel = yearStart => (yearStart.slice(5, 7) === '01' ? 'FY ' + yearStart.slice(0, 4) : 'FY ' + yearStart.slice(0, 4) + '-' + String(Number(yearStart.slice(0, 4)) + 1).slice(2));
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return m + '-' + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0'); };
const keyOf = l => [l.AccountID, l.CostCenterID || '', l.ProjectID || ''].join('|');
const versionLabel = v => (v ? 'Revision ' + v : 'Original');

// A budget line's twelve amounts, rounded; anything else refused.
function amountsOf(raw) {
  const a = Array.isArray(raw) ? raw : [];
  if (a.length !== 12) throw new Error('Each budget line needs twelve monthly amounts.');
  return a.map(v => {
    if (v === '' || v == null) return 0;
    const n = Number(v);
    if (!isFinite(n)) throw new Error('A budget amount is not a number: ' + v);
    return round2(n);
  });
}

// The total the approval levels are judged by: the year's budgeted costs
// (cost of sales and expenses), the spending the budget allows.
const approvalAmount = lines => round2(lines.filter(l => l.AccountType === 'COGS' || l.AccountType === 'Expense')
  .reduce((s, l) => s + l.Amounts.reduce((a, b) => a + b, 0), 0));

// Which budget line an actual GL line counts against: the most specific one
// of its account that fits (cost centre and project, then cost centre, then
// project, then the account's company-wide line). A line without a cost
// centre or project is the company's: everything not budgeted finer (Q339).
// null: the account has no budget line that fits ("not budgeted").
function lineFor(index, accountId, costCenterId, projectId) {
  const cc = costCenterId || '', pj = projectId || '';
  const tries = [[cc, pj], [cc, ''], ['', pj], ['', '']];
  for (const [c, p] of tries) {
    if ((c && !cc) || (p && !pj)) continue;
    const k = [accountId, c, p].join('|');
    if (index.has(k)) return k;
  }
  return null;
}

// Budget against actual, per budget line, plus the actuals no line takes.
//   budget:  { YearStart, Lines: [{ AccountID, CostCenterID, ProjectID, Amounts[12] }],
//              BalanceSheetMethod: 'Movements' | 'Closing' }
//   accounts: { id: { AccountType } }
//   entries: posted GL entries of the company up to the year's end
//            ({ JVDate, VoucherType, Lines: [{ AccountID, Debit, Credit, CostCenterID, ProjectID }] })
// Each row: Budget[12], Actual[12] and, for a balance-sheet line, Opening
// (its actual balance when the year began) and Measure:
//   'flow'     P&L lines and balance-sheet movements: month amounts, summed for the year to date;
//   'balance'  balance-sheet lines budgeted as closing balances: the balance at each month's end.
// With movements, a balance-sheet row also carries BudgetBalance[12]: the
// actual opening plus the budgeted movements, so the plan starts from reality (Q344).
function compare(budget, accounts, entries) {
  const months = monthsOf(budget.YearStart);
  const first = months[0], end = lastDay(months[11]);
  const method = budget.BalanceSheetMethod === 'Closing' ? 'Closing' : 'Movements';
  const rows = new Map();
  const typeOf = id => (accounts[id] || {}).AccountType || '';
  const row = (k, l, budgeted) => {
    if (!rows.has(k)) {
      const type = typeOf(l.AccountID);
      rows.set(k, { AccountID: l.AccountID, CostCenterID: l.CostCenterID || '', ProjectID: l.ProjectID || '', AccountType: type,
        Budgeted: budgeted, Budget: Array(12).fill(0), Actual: Array(12).fill(0), Opening: 0,
        Measure: !isPL(type) && method === 'Closing' ? 'balance' : 'flow' });
    }
    return rows.get(k);
  };
  const index = new Set();
  (budget.Lines || []).forEach(l => { const k = keyOf(l); index.add(k); row(k, l, true).Budget = l.Amounts.slice(); });
  // A budget of the P&L alone is compared on the P&L: the balance sheet's actuals are not "not budgeted".
  const withBalanceSheet = (budget.Lines || []).some(l => !isPL(typeOf(l.AccountID)));

  for (const e of entries) {
    const date = String(e.JVDate || '');
    if (!date || date > end) continue;
    const before = date < first;
    const mi = before ? -1 : months.indexOf(date.slice(0, 7));
    for (const l of e.Lines || []) {
      const type = typeOf(l.AccountID);
      if (!type) continue;
      const pl = isPL(type);
      if (!pl && !withBalanceSheet) continue;
      // The P&L counts the year's own activity: not the years before, not the year-end closing entry.
      if (pl && (before || e.VoucherType === 'YearEndClose')) continue;
      const amount = natural(type, l.Debit, l.Credit);
      if (!amount) continue;
      const k = lineFor(index, l.AccountID, l.CostCenterID, l.ProjectID) || keyOf({ AccountID: l.AccountID, CostCenterID: l.CostCenterID, ProjectID: l.ProjectID });
      const r = row(k, l, index.has(k));
      if (before) r.Opening += amount; else r.Actual[mi] += amount;
    }
  }

  return [...rows.values()].map(r => {
    const out = Object.assign({}, r, { Opening: round2(r.Opening), Actual: r.Actual.map(round2), Budget: r.Budget.map(round2) });
    if (!isPL(r.AccountType)) {
      if (r.Measure === 'balance') {
        // The actual balance at each month's end, to compare with the budgeted closing balance.
        let bal = out.Opening;
        out.Actual = out.Actual.map(m => (bal = round2(bal + m)));
      } else {
        let bal = out.Opening;
        out.BudgetBalance = out.Budget.map(m => (bal = round2(bal + m)));
      }
    }
    return out;
  });
}

// The year to date and the full year of a row, through month index i (0-11).
function totals(row, i) {
  const sum = (a, n) => round2(a.slice(0, n).reduce((s, v) => s + v, 0));
  if (row.Measure === 'balance') {
    return { MonthBudget: row.Budget[i], MonthActual: row.Actual[i], YtdBudget: row.Budget[i], YtdActual: row.Actual[i], YearBudget: row.Budget[11] };
  }
  return { MonthBudget: row.Budget[i], MonthActual: row.Actual[i], YtdBudget: sum(row.Budget, i + 1), YtdActual: sum(row.Actual, i + 1), YearBudget: sum(row.Budget, 12) };
}

// Better or worse than budget: more revenue is better, more cost is worse;
// the balance sheet is neither. 1 favourable, -1 unfavourable, 0 neither.
function favour(type, budget, actual) {
  const diff = round2(actual - budget);
  if (!diff || !isPL(type)) return 0;
  return (type === 'Revenue' ? diff > 0 : diff < 0) ? 1 : -1;
}

// A new budget from the year before: its actuals (or its budget's lines),
// month by month, changed by pct (10 = 10% more). byDimension keeps the cost
// centre and project; otherwise one line per account. P&L accounts only,
// as balances don't repeat; a closing-balance budget starts from scratch.
function seedFromActuals(prevYearStart, accounts, entries, pct, byDimension) {
  const months = monthsOf(prevYearStart);
  const f = 1 + (Number(pct) || 0) / 100;
  const lines = new Map();
  for (const e of entries) {
    const mi = months.indexOf(String(e.JVDate || '').slice(0, 7));
    if (mi < 0 || e.VoucherType === 'YearEndClose') continue;
    for (const l of e.Lines || []) {
      const type = (accounts[l.AccountID] || {}).AccountType;
      if (!isPL(type)) continue;
      const line = { AccountID: l.AccountID, CostCenterID: byDimension ? l.CostCenterID || '' : '', ProjectID: byDimension ? l.ProjectID || '' : '' };
      const k = keyOf(line);
      if (!lines.has(k)) lines.set(k, Object.assign(line, { Amounts: Array(12).fill(0) }));
      lines.get(k).Amounts[mi] += natural(type, l.Debit, l.Credit);
    }
  }
  return [...lines.values()].map(l => Object.assign(l, { Amounts: l.Amounts.map(v => round2(v * f)) }))
    .filter(l => l.Amounts.some(v => v));
}
const seedFromBudget = (prevLines, pct) => {
  const f = 1 + (Number(pct) || 0) / 100;
  return (prevLines || []).map(l => ({ AccountID: l.AccountID, CostCenterID: l.CostCenterID || '', ProjectID: l.ProjectID || '', Amounts: l.Amounts.map(v => round2(v * f)) }));
};

// An annual amount over twelve months: evenly, or in the proportions of a
// pattern (last year's months). The cents left by rounding go to the last
// month, so the twelve always add up to the amount.
function spread(annual, pattern) {
  const total = round2(annual);
  const p = Array.isArray(pattern) && pattern.length === 12 ? pattern.map(v => Number(v) || 0) : null;
  const base = p && p.reduce((s, v) => s + v, 0) ? p : Array(12).fill(1);
  const sum = base.reduce((s, v) => s + v, 0);
  const out = base.map(v => round2(total * v / sum));
  out[11] = round2(total - out.slice(0, 11).reduce((s, v) => s + v, 0));
  return out;
}

// ---------- Forecasts (step B2; Q341, Q346-Q347) ----------
// A forecast is the expected year: the actual months through `a` (a month
// index, -1 for none), then the months ahead, started from the budget
// (Q347) and changed by hand. The P&L only.

// A new forecast's lines, from compare()'s rows: each P&L line of the
// budget, and each P&L actual not budgeted, with its actuals through a and
// its budget after.
function forecastStart(rows, a) {
  return rows.filter(r => isPL(r.AccountType))
    .map(r => ({ budgeted: r.Budgeted, line: { AccountID: r.AccountID, CostCenterID: r.CostCenterID || '', ProjectID: r.ProjectID || '',
      Amounts: Array.from({ length: 12 }, (_, i) => round2(i <= a ? r.Actual[i] : r.Budget[i])) } }))
    .filter(x => x.budgeted || x.line.Amounts.some(v => v))
    .map(x => x.line);
}

// The lines as saved: the actual months are the forecast's own (as made),
// whatever is sent; a line with actuals can't be dropped (its months ahead
// can be set to 0); a new line has no actuals.
function lockActuals(stored, incoming, a) {
  const was = new Map((stored || []).map(l => [keyOf(l), l]));
  const out = (incoming || []).map(l => {
    const old = was.get(keyOf(l));
    return Object.assign({}, l, { Amounts: l.Amounts.map((v, i) => (i <= a ? (old ? old.Amounts[i] : 0) : v)) });
  });
  const kept = new Set(out.map(keyOf));
  const lost = (stored || []).find(l => !kept.has(keyOf(l)) && l.Amounts.slice(0, a + 1).some(v => v));
  if (lost) throw new Error((lost.AccountCode || lost.AccountID) + ' has actuals to date: set its months ahead to 0 instead of removing it.');
  return out;
}

// The forecast beside Budget vs Actual's rows: each row's Forecast[12] and
// YearForecast; a forecast line no row has comes as a row of its own.
function attachForecast(rows, lines, accounts) {
  const byKey = new Map(rows.map(r => [keyOf(r), r]));
  (lines || []).forEach(l => {
    let r = byKey.get(keyOf(l));
    if (!r) {
      const type = (accounts[l.AccountID] || {}).AccountType || '';
      r = { AccountID: l.AccountID, CostCenterID: l.CostCenterID || '', ProjectID: l.ProjectID || '', AccountType: type, Budgeted: false,
        Budget: Array(12).fill(0), Actual: Array(12).fill(0), Opening: 0, Measure: 'flow' };
      rows.push(r); byKey.set(keyOf(l), r);
    }
    r.Forecast = l.Amounts.map(round2);
  });
  rows.forEach(r => { r.YearForecast = r.Forecast ? round2(r.Forecast.reduce((s, v) => s + v, 0)) : null; });
  return rows;
}

module.exports = { round2, isPL, signOf, natural, addMonths, monthsOf, yearLabel, lastDay, keyOf, versionLabel, amountsOf, approvalAmount, lineFor, compare, totals, favour, seedFromActuals, seedFromBudget, spread, forecastStart, lockActuals, attachForecast };
