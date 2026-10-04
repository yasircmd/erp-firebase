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
const money = n => fmt(n);
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

// ---------- one employee's pay for a month (step 2) ----------
// The system deduction lines for leave (decision 13), by code.
const SYSTEM = {
  UNPAIDLV: { Name: 'Unpaid leave', Kind: 'Deduction' },
  ABSENCE: { Name: 'Absence', Kind: 'Deduction' },
  REDUCEDLV: { Name: 'Reduced-pay leave', Kind: 'Deduction' }
};
const round2 = n => Math.round(n * 100) / 100;
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const monthEnd = month => month + '-' + String(daysInMonth(month)).padStart(2, '0');
const dayWord = n => (Math.abs(n) === 1 ? n + ' day' : n + ' days');
// The compensation in force on a date: the latest active version from on or before it.
function versionOn(versions, d) {
  return versions.filter(v => v.Status === 'Active' && v.EffectiveFrom <= d)
    .sort((a, b) => String(b.EffectiveFrom).localeCompare(String(a.EffectiveFrom)) || String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || '')))[0] || null;
}
const amountIn = (v, id) => { const l = v && v.Lines.find(x => x.ElementID === id); return l ? l.Amount : 0; };

// x: { month, method, emp: { JoinDate, LeavingDate }, versions (compensation),
//   elements (by id, with their payroll settings), leave (the leave lines
//   paid in the month), inputs [{ ElementID, Hours, Amount, Note }],
//   hoursPerDay (the employee's schedule at the month's end), system (the
//   system elements by code) }.
// Returns { Lines, Earnings, Deductions, Net, Basic, Gross, Terms, Warnings }.
function computeEmployee(x) {
  const start = x.month + '-01', end = monthEnd(x.month);
  const div = divisor(x.method, x.month);
  const emp = x.emp, els = x.elements || {};
  const first = emp.JoinDate > start ? emp.JoinDate : start;
  const last = emp.LeavingDate && emp.LeavingDate < end ? emp.LeavingDate : end;
  const before = Math.max(0, Math.round((Date.parse(first) - Date.parse(start)) / 86400000));
  const after = Math.max(0, Math.round((Date.parse(end) - Date.parse(last)) / 86400000));
  const ref = versionOn(x.versions || [], last);
  const lines = [], warnings = [];
  const elOf = (id, l) => els[id] || { ElementID: id, Code: l ? l.Code : '?', Name: l ? l.Name : '?', Kind: l ? l.Kind : 'Earning', Nature: 'Fixed', Prorated: true };
  if (!ref) warnings.push('No pay in force for the month: set the employee\'s compensation.');

  // Fixed elements: the monthly amounts at the month's last day employed;
  // days not employed deducted (decision 12), days at other amounts adjusted.
  const ids = [];
  (x.versions || []).filter(v => v.Status === 'Active').forEach(v => v.Lines.forEach(l => { if (!ids.includes(l.ElementID)) ids.push(l.ElementID); }));
  const lineOf = id => { for (const v of x.versions || []) { const l = v.Lines.find(y => y.ElementID === id); if (l) return l; } return null; };
  ids.forEach(id => {
    const l = lineOf(id), el = elOf(id, l);
    const m = amountIn(ref, id);
    let amount = m;
    const parts = [money(m) + ' a month'];
    if (el.Prorated !== false) {
      const rate = m / div;
      if (before) { amount -= before * rate; parts.push('− ' + dayWord(before) + ' before joining × ' + money(rate)); }
      if (after) { amount -= after * rate; parts.push('− ' + dayWord(after) + ' after leaving × ' + money(rate)); }
      const other = {};
      for (let d = first; d <= last; d = addDay(d, 1)) {
        const md = amountIn(versionOn(x.versions || [], d), id);
        if (md !== m) other[md] = (other[md] || 0) + 1;
      }
      Object.keys(other).forEach(k => {
        const adj = other[k] * (Number(k) - m) / div;
        amount += adj;
        parts.push(dayWord(other[k]) + ' at ' + money(Number(k)) + ': ' + (adj < 0 ? '− ' : '+ ') + money(Math.abs(adj)));
      });
    }
    amount = Math.max(0, round2(amount));
    if (!amount && !m) return;
    lines.push({ ElementID: id, Code: el.Code, Name: el.Name, Kind: el.Kind, Source: 'Fixed', Amount: amount, Text: parts.length > 1 ? parts.join(' ') + ' = ' + money(amount) : parts[0] });
  });
  const proratedEarned = round2(lines.filter(l => l.Kind === 'Earning' && elOf(l.ElementID).Prorated !== false).reduce((s, l) => s + l.Amount, 0));

  // Leave (decision 13): what each day's pay rule doesn't pay, on its own line.
  const groups = {};
  (x.leave || []).filter(l => l.Pay !== 'Duty').forEach(l => {
    const v = versionOn(x.versions || [], l.Date);
    if (!v) { warnings.push('No pay in force on ' + l.Date + ' for leave paid this month.'); return; }
    const dmonth = l.Date.slice(0, 7), ddiv = divisor(x.method, dmonth);
    const pct = l.Pay === 'Unpaid' ? 0 : (Number(l.Percent) || 0) / 100;
    let perDay = 0;
    v.Lines.forEach(c => {
      const el = elOf(c.ElementID, c);
      if (el.Kind !== 'Earning' || el.Prorated === false) return;
      const covered = l.Pay === 'Full' ? Boolean(el.InGross) : l.Pay === 'Basic' ? Boolean(el.IsBasic) : l.Pay === 'Elements' ? (l.Elements || []).includes(c.ElementID) : false;
      perDay += c.Amount / ddiv * (1 - (covered ? pct : 0));
    });
    perDay = round2(perDay);
    if (!perDay) return;
    const code = l.Absence ? 'ABSENCE' : l.Pay === 'Unpaid' ? 'UNPAIDLV' : 'REDUCEDLV';
    const thisMonth = dmonth === x.month && !l.Reversal;
    const key = [code, dmonth, perDay, thisMonth ? '' : 'adj'].join('|');
    const g = groups[key] || (groups[key] = { code, dmonth, perDay, thisMonth, days: 0 });
    g.days = round2(g.days + l.Fraction);
  });
  const byCode = {};
  Object.values(groups).forEach(g => {
    const b = byCode[g.code] || (byCode[g.code] = { now: 0, adj: 0, parts: [] });
    const amt = g.days * g.perDay;
    if (g.thisMonth) b.now += amt; else b.adj += amt;
    b.parts.push(dayWord(g.days) + (g.thisMonth ? '' : ' in ' + g.dmonth + (g.days < 0 ? ' (taken back)' : ' (adjustment)')) + ' × ' + money(g.perDay));
  });
  // This month's leave can't take more than the month's prorated pay.
  const now = Object.values(byCode).reduce((s, b) => s + b.now, 0);
  const factor = now > proratedEarned && now > 0 ? proratedEarned / now : 1;
  Object.keys(SYSTEM).forEach(code => {
    const b = byCode[code];
    if (!b) return;
    const amount = round2(b.now * factor + b.adj);
    if (!amount) return;
    const el = (x.system || {})[code] || { ElementID: 'sys-' + code.toLowerCase(), Code: code, Name: SYSTEM[code].Name };
    lines.push({ ElementID: el.ElementID, Code: el.Code, Name: el.Name, Kind: 'Deduction', Source: 'Leave', Amount: amount,
      Text: b.parts.join(' + ') + (factor < 1 && b.now ? ' (limited to the month\'s pay)' : '') + ' = ' + money(amount) });
  });

  // Inputs for the run: overtime hours at the element's rate, or amounts.
  const basic = ref ? (ref.Lines.find(l => (els[l.ElementID] || l).IsBasic) || { Amount: 0 }).Amount : 0;
  const gross = ref ? round2(ref.Lines.filter(l => { const el = elOf(l.ElementID, l); return el.Kind === 'Earning' && el.InGross; }).reduce((s, l) => s + l.Amount, 0)) : 0;
  (x.inputs || []).forEach(i => {
    const el = els[i.ElementID];
    if (!el) { warnings.push('An input\'s pay element no longer exists.'); return; }
    let amount, textOut;
    if (el.Category === 'Overtime' && el.Overtime && el.Overtime.Mode === 'Hours') {
      const ot = overtimeRate(el.Overtime, { basic, gross, method: x.method, month: x.month, hoursPerDay: x.hoursPerDay || 8 });
      const rate = round2(ot.rate); // as shown, so the payslip adds up
      amount = round2(Number(i.Hours) * rate);
      textOut = i.Hours + ' hours × ' + money(rate) + ' (' + ot.text + ')';
    } else { amount = round2(Number(i.Amount)); textOut = money(amount); }
    lines.push({ ElementID: el.ElementID, Code: el.Code, Name: el.Name, Kind: el.Kind, Source: 'Input', Amount: amount, Text: textOut + (i.Note ? ' — ' + i.Note : '') });
  });

  const earnings = round2(lines.filter(l => l.Kind === 'Earning').reduce((s, l) => s + l.Amount, 0));
  const deductions = round2(lines.filter(l => l.Kind === 'Deduction').reduce((s, l) => s + l.Amount, 0));
  const net = round2(earnings - deductions);
  if (net < 0) warnings.push('Negative net: the deductions are ' + money(-net) + ' more than the earnings.');
  return { Lines: lines, Earnings: earnings, Deductions: deductions, Net: net, Basic: basic, Gross: gross, Terms: ref ? ref.Terms || [] : [], Warnings: warnings };
}

module.exports = { accountFor, METHODS, divisor, dailyRate, dailyText, overtimeRate, daysInMonth, daysInYear, SYSTEM, versionOn, computeEmployee, monthEnd };
