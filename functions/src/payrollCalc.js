// Payroll arithmetic (docs/modules/HR_PAYROLL.md), free of Firebase so the
// payroll run, the setup's examples and the tests share it.
//   - The daily rate (owner point 1, per company): monthly ÷ 30; ÷ the
//     month's actual days; or × 12 ÷ the year's days (365, or 366 in a
//     leap year).
//   - The overtime hourly rate (owner point 3): the base (the basic, or
//     the gross of the elements counted in it) ÷ the days (the company's
//     daily-rate days, or a fixed number) ÷ the hours in a working day (the
//     employee's schedule, or a fixed number) × the weightage.
'use strict';
const METHODS = {
  DIV30: 'Monthly ÷ 30',
  MONTHDAYS: 'Monthly ÷ the month\'s days (28-31)',
  YEARDAYS: 'Monthly × 12 ÷ the year\'s days (365/366)'
};
const daysInMonth = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const daysInYear = month => { const y = Number(month.slice(0, 4)); return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365; };
// The days a month's pay is divided by, for a month 'yyyy-mm'.
function divisor(method, month) {
  if (method === 'MONTHDAYS') return daysInMonth(month);
  if (method === 'YEARDAYS') return daysInYear(month) / 12;
  return 30;
}
function dailyRate(monthly, method, month) { return monthly / divisor(method, month); }
const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = n => String(Math.round(n * 10000) / 10000);
function dailyText(monthly, method, month) {
  if (method === 'YEARDAYS') return fmt(monthly) + ' × 12 ÷ ' + daysInYear(month) + ' = ' + fmt(dailyRate(monthly, method, month));
  return fmt(monthly) + ' ÷ ' + divisor(method, month) + ' = ' + fmt(dailyRate(monthly, method, month));
}
// cfg: { Base: 'Basic' | 'Gross', DaysMode: 'Company' | 'Fixed', FixedDays,
// HoursMode: 'Schedule' | 'Fixed', FixedHours, Weightage }.
// ctx: { basic, gross, method, month, hoursPerDay }.
function overtimeRate(cfg, ctx) {
  const base = cfg.Base === 'Gross' ? ctx.gross : ctx.basic;
  const days = cfg.DaysMode === 'Fixed' ? cfg.FixedDays : divisor(ctx.method, ctx.month);
  const hours = cfg.HoursMode === 'Fixed' ? cfg.FixedHours : ctx.hoursPerDay;
  const rate = base / days / hours * cfg.Weightage;
  const text = fmt(base) + ' (' + (cfg.Base === 'Gross' ? 'gross' : 'basic') + ') ÷ ' + trim(days) + ' days ÷ ' + trim(hours) + ' hours × ' + cfg.Weightage + ' = ' + fmt(rate) + ' an hour';
  return { rate, text, days, hours };
}
// The account an element posts to for a company: its override, else the group's (decision 3).
const accountFor = (el, companyId) => (el.GLByCompany || {})[companyId] || el.GLAccountID || '';
module.exports = { accountFor, METHODS, divisor, dailyRate, dailyText, overtimeRate, daysInMonth, daysInYear };
