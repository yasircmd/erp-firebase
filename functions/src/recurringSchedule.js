// Recurring Journal Entries: the schedule and amount engine (roadmap #7,
// docs/modules/RECURRING_JOURNAL.md). Pure functions, no database, so the
// date and rounding rules are unit-tested on their own
// (functions/test/unit/recurringSchedule.test.js).
//
// Dates are 'YYYY-MM-DD' strings, handled in UTC so a server's own time
// zone never shifts a day. "Today" is the owner's time zone (Asia/Dubai).
'use strict';

const TIME_ZONE = 'Asia/Dubai';
const MAX_RUNS = 240;
const FREQUENCIES = ['MonthlyDay', 'MonthEnd', 'Weekly', 'MonthlyWeekday'];
const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; // ISO 1..7
const NTH_LABELS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round2 = n => Math.round(n * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d + 'T00:00:00Z')) &&
  new Date(d + 'T00:00:00Z').toISOString().substring(0, 10) === d;
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d); // m is 1..12
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1..12
const isoWeekday = dateStr => { const w = new Date(dateStr + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

function todayIn(timeZone, now) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now || new Date());
}

const int = v => (v === '' || v == null ? NaN : Number(v));

// A service-period schedule (amount mode Period, owner 2026-09-27): runs at
// every month end from the month the service starts to the month it ends,
// the last one at that month's end.
function periodSchedule(raw) {
  const r = raw || {};
  const from = String(r.ServiceFrom || '').trim();
  const to = String(r.ServiceTo || '').trim();
  if (!isDate(from)) throw new Error('Service period: the start date is required.');
  if (!isDate(to)) throw new Error('Service period: the end date is required.');
  if (to < from) throw new Error('Service period: the end date is before the start date.');
  const s = { Frequency: 'MonthEnd', Interval: 1, StartDate: from, EndMode: 'EndDate', EndDate: monthEndOf(to), ServiceFrom: from, ServiceTo: to };
  scheduleDates(s); // refuses more than MAX_RUNS
  return s;
}

const monthEndOf = d => ymd(Number(d.substring(0, 4)), Number(d.substring(5, 7)), daysIn(Number(d.substring(0, 4)), Number(d.substring(5, 7))));
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// The service days a month-end run covers: from the later of the service
// start and the 1st of its month, to the earlier of the service end and
// the run date.
function periodDays(s, date) {
  if (!s || !s.ServiceFrom) return 0;
  const first = date.substring(0, 8) + '01';
  const start = s.ServiceFrom > first ? s.ServiceFrom : first;
  const end = s.ServiceTo < date ? s.ServiceTo : date;
  return end < start ? 0 : dayDiff(start, end) + 1;
}

// Checks and normalizes a schedule as the screen sends it. Throws a
// message the user can act on. mode 'Period' builds it from the service
// period instead.
function normalizeSchedule(raw, mode) {
  if (mode === 'Period') return periodSchedule(raw);
  const r = raw || {};
  const s = { Frequency: String(r.Frequency || '').trim() };
  if (!FREQUENCIES.includes(s.Frequency)) throw new Error('Choose how often the entry runs.');
  s.Interval = r.Interval === undefined || r.Interval === '' ? 1 : int(r.Interval);
  const maxInterval = s.Frequency === 'Weekly' ? 52 : 12;
  if (!Number.isInteger(s.Interval) || s.Interval < 1 || s.Interval > maxInterval) {
    throw new Error('"Every" must be a whole number from 1 to ' + maxInterval + '.');
  }
  if (s.Frequency === 'MonthlyDay') {
    s.Day = int(r.Day);
    if (!Number.isInteger(s.Day) || s.Day < 1 || s.Day > 31) throw new Error('Day of the month must be from 1 to 31.');
  }
  if (s.Frequency === 'Weekly' || s.Frequency === 'MonthlyWeekday') {
    s.Weekday = int(r.Weekday);
    if (!Number.isInteger(s.Weekday) || s.Weekday < 1 || s.Weekday > 7) throw new Error('Choose a weekday.');
  }
  if (s.Frequency === 'MonthlyWeekday') {
    s.Nth = int(r.Nth);
    if (![1, 2, 3, 4, -1].includes(s.Nth)) throw new Error('Choose which weekday of the month (first to fourth, or last).');
  }
  s.StartDate = String(r.StartDate || '').trim();
  if (!isDate(s.StartDate)) throw new Error('Start date is required.');
  s.EndMode = String(r.EndMode || '').trim();
  if (s.EndMode === 'EndDate') {
    s.EndDate = String(r.EndDate || '').trim();
    if (!isDate(s.EndDate)) throw new Error('End date is required.');
    if (s.EndDate < s.StartDate) throw new Error('The end date is before the start date.');
  } else if (s.EndMode === 'Count') {
    s.RunCount = int(r.RunCount);
    if (!Number.isInteger(s.RunCount) || s.RunCount < 1 || s.RunCount > MAX_RUNS) {
      throw new Error('Number of runs must be a whole number from 1 to ' + MAX_RUNS + '.');
    }
  } else {
    throw new Error('Choose how the period ends: an end date or a number of runs.');
  }
  const dates = scheduleDates(s);
  if (!dates.length) throw new Error('This schedule has no run dates between the start and end dates.');
  return s;
}

// The run date in month (y, m) for a monthly frequency.
function monthlyDate(s, y, m) {
  const last = daysIn(y, m);
  if (s.Frequency === 'MonthEnd') return ymd(y, m, last);
  if (s.Frequency === 'MonthlyDay') return ymd(y, m, Math.min(s.Day, last));
  // MonthlyWeekday
  if (s.Nth === -1) {
    const lastDay = ymd(y, m, last);
    return addDays(lastDay, -((isoWeekday(lastDay) - s.Weekday + 7) % 7));
  }
  const first = ymd(y, m, 1);
  return addDays(first, (s.Weekday - isoWeekday(first) + 7) % 7 + 7 * (s.Nth - 1));
}

// Every run date of a (normalized) schedule, in order. Refuses a
// schedule of more than MAX_RUNS dates.
function scheduleDates(s) {
  const out = [];
  const within = d => d >= s.StartDate && (s.EndMode !== 'EndDate' || d <= s.EndDate);
  const done = () => s.EndMode === 'Count' && out.length >= s.RunCount;
  const tooMany = () => { throw new Error('This schedule has more than ' + MAX_RUNS + ' runs — shorten the period.'); };
  if (s.Frequency === 'Weekly') {
    let d = addDays(s.StartDate, (s.Weekday - isoWeekday(s.StartDate) + 7) % 7);
    while (within(d) && !done()) {
      out.push(d);
      if (out.length > MAX_RUNS) tooMany();
      d = addDays(d, 7 * s.Interval);
    }
    return out;
  }
  const y0 = Number(s.StartDate.substring(0, 4));
  const m0 = Number(s.StartDate.substring(5, 7)) - 1;
  for (let k = 0; !done(); k += s.Interval) {
    const y = y0 + Math.floor((m0 + k) / 12);
    const m = ((m0 + k) % 12) + 1;
    const d = monthlyDate(s, y, m);
    if (d < s.StartDate) continue;
    if (!within(d)) break;
    out.push(d);
    if (out.length > MAX_RUNS) tooMany();
  }
  return out;
}

function describeSchedule(s) {
  if (s.ServiceFrom) {
    return 'Month end, by days of the service period ' + s.ServiceFrom + ' to ' + s.ServiceTo + ' (' + (dayDiff(s.ServiceFrom, s.ServiceTo) + 1) + ' days)';
  }
  const every = n => (s.Interval > 1 ? 'every ' + s.Interval + ' ' + n + 's' : 'every ' + n);
  let what;
  if (s.Frequency === 'MonthEnd') what = 'Month end, ' + every('month');
  else if (s.Frequency === 'MonthlyDay') what = 'Day ' + s.Day + ' of ' + every('month');
  else if (s.Frequency === 'Weekly') what = WEEKDAYS[s.Weekday] + ', ' + every('week');
  else what = 'The ' + NTH_LABELS[s.Nth] + ' ' + WEEKDAYS[s.Weekday] + ' of ' + every('month');
  const until = s.EndMode === 'EndDate' ? ' to ' + s.EndDate : ', ' + s.RunCount + ' run' + (s.RunCount === 1 ? '' : 's');
  return what + ', from ' + s.StartDate + until;
}

// {MONTH} → Oct-2026, {DATE} → 2026-10-31, {YEAR} → 2026.
function expandText(text, date) {
  const y = date.substring(0, 4);
  const mon = MONTHS[Number(date.substring(5, 7)) - 1];
  return String(text || '').replace(/\{MONTH\}/gi, mon + '-' + y).replace(/\{DATE\}/gi, date).replace(/\{YEAR\}/gi, y);
}

const lineAmount = l => round2((Number(l.Debit) || 0) + (Number(l.Credit) || 0));
const isDebit = l => (Number(l.Debit) || 0) > 0;

// Per-line amounts for each open date.
//   lines:     the template lines (Debit/Credit = per run for Fixed, the
//              total to release for Spread)
//   released:  per line, what live posted runs have already released
//   openDates: the dates still to post, in order
// Fixed: every date gets the lines' amounts. Spread: what is still to
// release is shared equally over the open dates; each installment is
// balanced by putting any rounding cent on the largest line of the
// lighter side, and the last date takes exactly what remains (so it's
// balanced too, and the line totals are exact).
// base: the installment fixed when the template was last saved,
// activated or had a date skipped (spreadBase). With it, posting a run
// doesn't re-divide what's left, so the rounding stays on the last date.
// Period (by service days): what's left is shared over the open dates in
// proportion to the days each covers (weights: date → days). base is then
// the stored per-date plan (periodBase), used while it still adds up.
function installments(mode, lines, released, openDates, base, weights) {
  const out = {};
  if (!openDates.length) return out;
  if (mode === 'Period') return periodInstallments(lines, released, openDates, base, weights || {});
  if (mode !== 'Spread') {
    openDates.forEach(d => { out[d] = lines.map(lineAmount); });
    return out;
  }
  const remaining = lines.map((l, i) => round2(lineAmount(l) - (Number(released[i]) || 0)));
  remaining.forEach((r, i) => {
    if (r < -0.005) throw new Error('Line ' + (i + 1) + ': ' + (Number(released[i]) || 0).toFixed(2) + ' has already been posted, more than its total of ' + lineAmount(lines[i]).toFixed(2) + '.');
  });
  const m = openDates.length;
  const fits = b => Array.isArray(b) && b.length === lines.length &&
    remaining.every((r, i) => (Number(b[i]) || 0) >= 0 && r - (Number(b[i]) || 0) * (m - 1) > -0.005);
  const each = fits(base) ? base.map(b => round2(Number(b) || 0)) : equalShare(lines, remaining, m);
  const given = lines.map(() => 0);
  openDates.forEach((d, j) => {
    const amounts = j === m - 1 ? remaining.map((r, i) => round2(r - given[i])) : each.slice();
    if (j < m - 1) amounts.forEach((a, i) => { given[i] = round2(given[i] + a); });
    amounts.forEach((a, i) => {
      if (a < -0.005) throw new Error('Line ' + (i + 1) + ': the amount left to spread is too small for this many runs.');
    });
    out[d] = amounts;
  });
  return out;
}

function remainingOf(lines, released) {
  const remaining = lines.map((l, i) => round2(lineAmount(l) - (Number(released[i]) || 0)));
  remaining.forEach((r, i) => {
    if (r < -0.005) throw new Error('Line ' + (i + 1) + ': ' + (Number(released[i]) || 0).toFixed(2) + ' has already been posted, more than its total of ' + lineAmount(lines[i]).toFixed(2) + '.');
  });
  return remaining;
}

// Puts a run's rounding difference on the largest line of the lighter side.
function balance(lines, amounts) {
  const side = debit => round2(amounts.reduce((s, a, i) => s + (isDebit(lines[i]) === debit ? a : 0), 0));
  const diff = round2(side(true) - side(false));
  if (diff === 0) return amounts;
  const lighterDebit = diff < 0;
  let best = -1;
  amounts.forEach((a, i) => { if (isDebit(lines[i]) === lighterDebit && (best < 0 || a > amounts[best])) best = i; });
  amounts[best] = round2(amounts[best] + Math.abs(diff));
  return amounts;
}

function periodInstallments(lines, released, openDates, base, weights) {
  const remaining = remainingOf(lines, released);
  const m = openDates.length;
  const out = {};
  // The stored plan, while it still covers these dates and adds up to what's left.
  const fits = base && !Array.isArray(base) && typeof base === 'object' && openDates.every(d => Array.isArray(base[d]) && base[d].length === lines.length) &&
    remaining.every((r, i) => Math.abs(openDates.reduce((s, d) => s + (Number(base[d][i]) || 0), 0) - r) < 0.005 && openDates.every(d => (Number(base[d][i]) || 0) >= 0));
  const total = openDates.reduce((s, d) => s + (Number(weights[d]) || 0), 0);
  if (!fits && !(total > 0)) throw new Error('None of the open dates covers any day of the service period.');
  const given = lines.map(() => 0);
  let cum = 0;
  openDates.forEach((d, j) => {
    let amounts;
    if (j === m - 1) {
      amounts = remaining.map((r, i) => round2(r - given[i]));
    } else if (fits) {
      amounts = base[d].map(a => round2(Number(a) || 0));
    } else {
      // Cumulative rounding: each line's running total tracks its exact share.
      cum += Number(weights[d]) || 0;
      amounts = balance(lines, remaining.map((r, i) => Math.max(0, round2(r * cum / total - given[i]))));
    }
    if (j < m - 1) amounts.forEach((a, i) => { given[i] = round2(given[i] + a); });
    amounts.forEach((a, i) => { if (a < -0.005) throw new Error('Line ' + (i + 1) + ': the amount left is too small for these dates.'); });
    out[d] = amounts;
  });
  return out;
}

// One balanced installment of what's left over m dates: each line's share
// rounded to the cent, any difference put on the largest line of the
// lighter side.
function equalShare(lines, remaining, m) {
  const amounts = remaining.map(r => round2(r / m));
  const side = debit => round2(amounts.reduce((s, a, i) => s + (isDebit(lines[i]) === debit ? a : 0), 0));
  const diff = round2(side(true) - side(false));
  if (diff !== 0) {
    const lighterDebit = diff < 0;
    let best = -1;
    amounts.forEach((a, i) => { if (isDebit(lines[i]) === lighterDebit && (best < 0 || a > amounts[best])) best = i; });
    amounts[best] = round2(amounts[best] + Math.abs(diff));
  }
  return amounts;
}

// The installment to fix for a spread template now (see installments).
// Period: the per-date plan to store (see installments).
function periodBase(lines, released, openDates, weights) {
  return periodInstallments(lines, released, openDates, null, weights);
}

function spreadBase(lines, released, openCount) {
  if (!openCount) return [];
  return equalShare(lines, lines.map((l, i) => round2(lineAmount(l) - (Number(released[i]) || 0))), openCount);
}

module.exports = {
  TIME_ZONE, MAX_RUNS, FREQUENCIES, WEEKDAYS,
  round2, isDate, addDays, todayIn, normalizeSchedule, scheduleDates, describeSchedule, expandText,
  lineAmount, installments, spreadBase, periodBase, periodDays, monthEndOf
};
