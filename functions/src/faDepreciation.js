// Fixed Assets depreciation engine (docs/modules/FIXED_ASSETS.md →
// Depreciation engine). Pure functions: no database, no clock. The
// server hands in an asset's valuation for one area and its
// transactions; this returns what is due.
//
// Methods:
//   SL  — straight line. The charge for a period is the remaining
//         depreciable amount × this period's share of the remaining
//         life. Unchanged, that is (cost − residual) ÷ life months per
//         full month (120,000 over 10 years = 1,000 a month). After an
//         addition, additional depreciation or a change of estimate the
//         lower/higher remainder spreads over the remaining life.
//   WDV — written down value. Rate % a year on the NBV at the start of
//         the fiscal (calendar) year, or on the cost in the year of
//         capitalization, spread evenly over the months. Additions
//         count from the month they're dated in.
// Both: pro-rata by day in the first and last month of the life (a start
// on 17 March charges 15/31 of March); the last month of the life
// charges whatever depreciable amount is left; nothing is ever charged
// beyond cost − residual; amounts are rounded to 2 decimals per month.
'use strict';

const METHODS = ['SL', 'WDV', 'None'];
// Transaction types whose cost delta is new cost in the year for WDV.
const COST_IN_TYPES = ['Capitalization', 'Addition', 'AuCSettlement'];

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const isPeriod = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');

function periodOf(date) { return String(date).substring(0, 7); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-12
function parts(date) { return date.split('-').map(Number); }
function firstDay(period) { return period + '-01'; }
function lastDay(period) {
  const [y, m] = period.split('-').map(Number);
  return period + '-' + String(daysInMonth(y, m)).padStart(2, '0');
}
function nextPeriod(period) {
  let [y, m] = period.split('-').map(Number);
  m += 1; if (m > 12) { m = 1; y += 1; }
  return y + '-' + String(m).padStart(2, '0');
}
function prevPeriod(period) {
  let [y, m] = period.split('-').map(Number);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return y + '-' + String(m).padStart(2, '0');
}

// Start date + N months, the same day (clamped to the month's end).
function addMonths(date, months) {
  const [y, m, d] = parts(date);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return ny + '-' + String(nm).padStart(2, '0') + '-' + String(nd).padStart(2, '0');
}

// End of the useful life: the first day NOT depreciated.
function lifeEndDate(startDate, lifeMonths) { return addMonths(startDate, lifeMonths); }

// Share (0–1) of month `period` inside [start, end): days in the life
// that fall in the month ÷ days in the month.
function periodFactor(period, start, end) {
  const [y, m] = period.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const from = start > firstDay(period) ? parts(start)[2] : 1;
  const endInMonth = periodOf(end) === period;
  if (end <= firstDay(period) || start > lastDay(period)) return 0;
  const to = endInMonth ? parts(end)[2] - 1 : dim; // last day included
  return Math.max(0, to - from + 1) / dim;
}

// Remaining life from the start of `period`, in months (fractional).
function remainingFactor(period, start, end) {
  let total = 0;
  for (let p = period; p <= periodOf(end); p = nextPeriod(p)) total += periodFactor(p, start, end);
  return total;
}

// Cost and accumulated depreciation from the transactions dated on or
// before `date` (every delta is signed, reversals included).
function balancesAt(txns, date, beforeOnly) {
  let cost = 0; let accDep = 0;
  (txns || []).forEach(t => {
    if (beforeOnly ? t.Date < date : t.Date <= date) {
      cost += Number(t.CostDelta) || 0;
      accDep += Number(t.AccDepDelta) || 0;
    }
  });
  return { cost: round2(cost), accDep: round2(accDep) };
}

// Checks a valuation the way saving an asset does. Returns an error
// message, or '' when it's usable.
function validateValuation(v, classKind) {
  const method = v.Method;
  if (!METHODS.includes(method)) return 'Select a depreciation method.';
  const depreciates = classKind !== 'Land' && classKind !== 'AuC';
  if (!depreciates) return method === 'None' ? '' : 'A ' + classKind + ' asset is not depreciated: its method must be None.';
  if (method === 'None') return 'Select a depreciation method (Straight Line or Written Down Value).';
  const life = Number(v.UsefulLifeMonths);
  if (!(Number.isInteger(life) && life > 0 && life <= 1200)) return 'Useful life is required (1 to 1,200 months).';
  if (method === 'WDV') {
    const rate = Number(v.WdvRate);
    if (!(rate > 0 && rate < 100)) return 'The WDV rate is required (more than 0% and less than 100% a year).';
  }
  const residual = Number(v.ResidualValue) || 0;
  if (residual < 0) return 'Residual value cannot be negative.';
  if (v.DepStartDate && !isDate(v.DepStartDate)) return 'Depreciation start date is not a valid date.';
  return '';
}

// NBV the WDV rate applies to in the year of `period`: NBV at the start
// of the year (including simulated charges of earlier years), plus cost
// that came in during the year up to the period's end. A take-over dated
// in the year brings its own YearStartNBV (or its NBV on the day).
function wdvBase(txns, period, simulatedBefore) {
  const year = period.substring(0, 4);
  const yearStart = year + '-01-01';
  const end = lastDay(period);
  const before = balancesAt(txns, yearStart, true);
  let base = before.cost - before.accDep - simulatedBefore;
  (txns || []).forEach(t => {
    if (t.Date < yearStart || t.Date > end) return;
    if (COST_IN_TYPES.includes(t.Type)) base += Number(t.CostDelta) || 0;
    if (t.Type === 'TakeOver') {
      base += t.YearStartNBV != null && t.YearStartNBV !== '' ? Number(t.YearStartNBV)
        : (Number(t.CostDelta) || 0) - (Number(t.AccDepDelta) || 0);
    }
  });
  return Math.max(0, base);
}

// The scheduled depreciation due for an asset up to and including
// `period`, one entry per period not yet depreciated (the earlier ones
// are catch-up). asset: { valuation: { Method, UsefulLifeMonths,
// WdvRate, ResidualValue, DepStartDate }, txns: [{ Type, Date,
// CostDelta, AccDepDelta, YearStartNBV? }], lastDepPeriod }.
function computeScheduled(asset, period) {
  const v = asset.valuation || {};
  const out = { periods: [], total: 0, current: 0, catchUp: 0, opening: null, closing: null, fullyDepreciated: false };
  if (!isPeriod(period) || !['SL', 'WDV'].includes(v.Method) || !isDate(v.DepStartDate)) return out;
  const life = Number(v.UsefulLifeMonths);
  if (!(life > 0)) return out;
  const start = v.DepStartDate;
  const end = lifeEndDate(start, life);
  const residual = round2(Number(v.ResidualValue) || 0);
  const rate = (Number(v.WdvRate) || 0) / 100;
  const txns = asset.txns || [];

  let p = periodOf(start);
  if (asset.lastDepPeriod && nextPeriod(asset.lastDepPeriod) > p) p = nextPeriod(asset.lastDepPeriod);
  const endBal = balancesAt(txns, lastDay(period));
  out.opening = { cost: endBal.cost, accDep: endBal.accDep, nbv: round2(endBal.cost - endBal.accDep) };

  let simulated = 0;
  const simulatedByPeriod = [];
  for (; p <= period; p = nextPeriod(p)) {
    const bal = balancesAt(txns, lastDay(p));
    const remaining = round2(bal.cost - residual - bal.accDep - simulated);
    let charge = 0;
    if (remaining > 0) {
      const f = periodFactor(p, start, end);
      // The last month of the life (or any month after it) takes what's left.
      const rm = remainingFactor(p, start, end);
      if (rm <= f + 1e-9) {
        charge = remaining;
      } else if (f > 0) {
        if (v.Method === 'SL') {
          charge = round2(remaining * f / rm);
        } else {
          const simulatedBeforeYear = simulatedByPeriod.filter(x => x.period < p.substring(0, 4) + '-01').reduce((s, x) => s + x.amount, 0);
          charge = round2(wdvBase(txns, p, simulatedBeforeYear) * rate / 12 * f);
        }
      }
      charge = Math.min(Math.max(0, charge), remaining);
    }
    charge = round2(charge);
    simulated = round2(simulated + charge);
    simulatedByPeriod.push({ period: p, amount: charge });
    out.periods.push({ period: p, amount: charge });
  }
  out.total = round2(simulated);
  out.current = out.periods.length && out.periods[out.periods.length - 1].period === period ? out.periods[out.periods.length - 1].amount : 0;
  out.catchUp = round2(out.total - out.current);
  const accDep = round2(endBal.accDep + out.total);
  out.closing = { cost: endBal.cost, accDep: accDep, nbv: round2(endBal.cost - accDep) };
  out.fullyDepreciated = endBal.cost > 0 && round2(endBal.cost - residual - accDep) <= 0;
  return out;
}

// The most additional depreciation an asset can take on `date`:
// NBV − residual.
function maxAdditional(asset, date) {
  const bal = balancesAt(asset.txns, date);
  const residual = round2(Number((asset.valuation || {}).ResidualValue) || 0);
  return Math.max(0, round2(bal.cost - residual - bal.accDep));
}

module.exports = {
  METHODS, round2, isDate, isPeriod, periodOf, firstDay, lastDay, nextPeriod, prevPeriod, addMonths, lifeEndDate,
  periodFactor, remainingFactor, balancesAt, validateValuation, computeScheduled, maxAdditional
};
