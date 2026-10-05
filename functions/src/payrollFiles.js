// Payroll payment files (owner, 2026-10-04; docs/modules/HR_PAYROLL.md,
// step 4): "WPS SIF can not fix a standard one, bank and each company might
// vary." So the file is built from a format each company sets up: delimited
// or fixed width, a header, one record per employee paid by bank and a
// trailer, each an ordered list of fields (fixed text, or a payroll value
// with its formatting). Free of Firebase: the screen's preview, the
// download and the tests share it.
'use strict';

// The values a field can take, by group (the screen lists them).
const SOURCES = {
  TEXT: ['Fixed text', 'text'],
  EMP_NO: ['Employee no.', 'employee'], EMP_NAME: ['Employee name', 'employee'], WPS_ID: ['WPS person ID', 'employee'],
  ROUTING: ['Bank routing code', 'employee'], IBAN: ['Account no. / IBAN', 'employee'], BANK: ['Bank name', 'employee'],
  NET: ['Net pay', 'amount'], FIXED: ['Fixed part (net less the variable part)', 'amount'], VARIABLE: ['Variable part (overtime, bonus, commission, one-offs, arrears)', 'amount'],
  DAYS: ['Days in the period', 'number'], UNPAID_DAYS: ['Unpaid and absent days', 'number'],
  MONTH: ['Payroll month', 'date'], PERIOD_START: ['Period start', 'date'], PERIOD_END: ['Period end', 'date'], PAY_DATE: ['Payment date', 'date'], CREATED: ['File created (date and time)', 'date'],
  COUNT: ['Number of employees', 'number'], TOTAL: ['Total paid', 'amount'],
  EMPLOYER: ['Employer ID (this format)', 'value'], BANK_CODE: ['Bank code (this format)', 'value'], CURRENCY: ['Currency (this format)', 'value'], REFERENCE: ['Reference (this format)', 'value']
};
const RECORDS = ['Header', 'Employee', 'Trailer'];
const DATE_RX = /^[yMdHms\-/.: ]{1,20}$/;
const pad2 = n => String(n).padStart(2, '0');

// A date (yyyy-mm-dd, or a Date for the creation time) by a pattern of
// yyyy yy MM dd HH mm ss.
function formatDate(v, pattern) {
  let y, mo, d, h = 0, mi = 0, s = 0;
  // A Date is read as UTC: the caller passes the time already in the company's zone.
  if (v instanceof Date) { y = v.getUTCFullYear(); mo = v.getUTCMonth() + 1; d = v.getUTCDate(); h = v.getUTCHours(); mi = v.getUTCMinutes(); s = v.getUTCSeconds(); } else {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(v || ''));
    if (!m) return '';
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3] || 1);
  }
  return String(pattern || 'yyyy-MM-dd').replace(/yyyy|yy|MM|dd|HH|mm|ss/g, t => ({ yyyy: String(y), yy: String(y).slice(2), MM: pad2(mo), dd: pad2(d), HH: pad2(h), mm: pad2(mi), ss: pad2(s) })[t]);
}

// One field's text.
function fieldText(f, ctx) {
  const kind = (SOURCES[f.Source] || [])[1];
  let v;
  if (f.Source === 'TEXT') v = f.Text || '';
  else if (kind === 'date') v = formatDate(ctx[f.Source], f.Format);
  else if (kind === 'amount') v = (Number(ctx[f.Source]) || 0).toFixed(f.Decimals == null || f.Decimals === '' ? 2 : Number(f.Decimals));
  else if (kind === 'number') v = String(Math.round((Number(ctx[f.Source]) || 0) * 100) / 100);
  else v = ctx[f.Source] == null ? '' : String(ctx[f.Source]);
  if (f.Upper) v = v.toUpperCase();
  return v;
}
function recordText(fields, ctx, fmt) {
  if (fmt.Type === 'Fixed') {
    return fields.map(f => {
      const w = Number(f.Width) || 0, v = fieldText(f, ctx);
      if (!w) return v;
      const ch = f.PadChar === '0' ? '0' : ' ';
      return (f.Pad === 'Left' ? v.padStart(w, ch) : v.padEnd(w, ch)).slice(0, w);
    }).join('');
  }
  const dl = fmt.Delimiter === 'TAB' ? '\t' : (fmt.Delimiter || ',');
  return fields.map(f => { const v = fieldText(f, ctx); return v.includes(dl) || v.includes('"') ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(dl);
}

// Each employee's file values from their payslip.
function employeeValues(slip, emp, days) {
  const net = Math.max(0, slip.Net);
  const variable = slip.Lines.filter(l => l.Kind === 'Earning' && (l.Source === 'Input' || l.Source === 'Arrears' || l.Source === 'AccrualPayout')).reduce((t, l) => t + l.Amount, 0);
  const v = Math.round(Math.min(Math.max(0, variable), net) * 100) / 100;
  return { EMP_NO: slip.EmployeeNo, EMP_NAME: slip.EmployeeName, WPS_ID: emp.WpsPersonID || '', ROUTING: emp.BankRoutingCode || '', IBAN: emp.IBAN || '', BANK: emp.BankName || '',
    NET: net, VARIABLE: v, FIXED: Math.round((net - v) * 100) / 100, DAYS: days, UNPAID_DAYS: slip.UnpaidDays || 0 };
}

// The file. x: { format, month 'yyyy-mm', payDate, created (Date), rows
// [employee values] }. Returns { fileName, content, count, total }.
function buildFile(x) {
  const fmt = x.format, vals = fmt.Values || {};
  const end = x.month + '-' + pad2(new Date(Date.UTC(Number(x.month.slice(0, 4)), Number(x.month.slice(5, 7)), 0)).getUTCDate());
  const total = Math.round(x.rows.reduce((t, r) => t + r.NET, 0) * 100) / 100;
  const base = { MONTH: x.month + '-01', PERIOD_START: x.month + '-01', PERIOD_END: end, PAY_DATE: x.payDate, CREATED: x.created, COUNT: x.rows.length, TOTAL: total,
    EMPLOYER: vals.EmployerID || '', BANK_CODE: vals.BankCode || '', CURRENCY: vals.Currency || '', REFERENCE: vals.Reference || '' };
  const recs = fmt.Records || {};
  const lines = [];
  if ((recs.Header || []).length) lines.push(recordText(recs.Header, base, fmt));
  x.rows.forEach(r => lines.push(recordText(recs.Employee || [], Object.assign({}, base, r), fmt)));
  if ((recs.Trailer || []).length) lines.push(recordText(recs.Trailer, base, fmt));
  const eol = fmt.LineEnd === 'LF' ? '\n' : '\r\n';
  // The name: {SOURCE} or {SOURCE:pattern}, e.g. {EMPLOYER}{CREATED:yyMMddHHmmss}.
  const name = String(fmt.FileName || 'payroll-{MONTH:yyyy-MM}').replace(/\{([A-Z_]+)(?::([^}]*))?\}/g, (m, src, pat) =>
    SOURCES[src] ? fieldText({ Source: src, Format: pat || undefined, Decimals: 0 }, base) : m).replace(/[^A-Za-z0-9._-]/g, '');
  return { fileName: name + (fmt.Extension ? '.' + fmt.Extension : ''), content: lines.join(eol) + eol, count: x.rows.length, total };
}

// A format as saved: checked and cleaned (bad() throws).
function cleanFormat(d, bad) {
  const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 100);
  const out = { Name: t(d.Name, 80), Bank: t(d.Bank, 80), Type: t(d.Type, 10) || 'Delimited', Delimiter: t(d.Delimiter, 3) || ',', Extension: t(d.Extension, 5).replace(/^\./, ''),
    FileName: t(d.FileName, 120), LineEnd: d.LineEnd === 'LF' ? 'LF' : 'CRLF', Active: d.Active !== false,
    Values: { EmployerID: t((d.Values || {}).EmployerID, 40), BankCode: t((d.Values || {}).BankCode, 40), Currency: t((d.Values || {}).Currency, 10), Reference: t((d.Values || {}).Reference, 60) }, Records: {} };
  if (!out.Name) bad('Name the format.');
  if (!['Delimited', 'Fixed'].includes(out.Type)) bad('A file is delimited or fixed width.');
  if (out.Type === 'Delimited' && !(out.Delimiter === 'TAB' || out.Delimiter.length === 1)) bad('The delimiter is one character, or TAB.');
  if (out.Extension && !/^[A-Za-z0-9]{1,5}$/.test(out.Extension)) bad('The file extension is letters and digits (e.g. SIF, csv).');
  RECORDS.forEach(rec => {
    const fields = Array.isArray((d.Records || {})[rec]) ? d.Records[rec] : [];
    if (fields.length > 60) bad('At most 60 fields in a record.');
    out.Records[rec] = fields.map((f, i) => {
      const where = rec + ' record, field ' + (i + 1) + ': ';
      const o = { Source: t(f.Source, 20), Text: t(f.Text, 100), Format: t(f.Format, 20), Decimals: f.Decimals === '' || f.Decimals == null ? null : Number(f.Decimals),
        Width: f.Width === '' || f.Width == null ? null : Number(f.Width), Pad: f.Pad === 'Left' ? 'Left' : 'Right', PadChar: f.PadChar === '0' ? '0' : ' ', Upper: f.Upper === true };
      if (!SOURCES[o.Source]) bad(where + 'choose what it holds.');
      if (rec !== 'Employee' && SOURCES[o.Source][1] === 'employee') bad(where + 'employee values go in the employee record.');
      if (rec !== 'Employee' && ['NET', 'FIXED', 'VARIABLE', 'DAYS', 'UNPAID_DAYS'].includes(o.Source)) bad(where + 'an employee\'s pay goes in the employee record.');
      if (o.Format && !DATE_RX.test(o.Format)) bad(where + 'a date pattern uses yyyy, yy, MM, dd, HH, mm, ss.');
      if (o.Decimals != null && !(o.Decimals >= 0 && o.Decimals <= 4)) bad(where + 'decimals are 0 to 4.');
      if (out.Type === 'Fixed' && !(o.Width >= 1 && o.Width <= 200)) bad(where + 'a fixed-width field needs its width (1 to 200).');
      return o;
    });
  });
  if (!out.Records.Employee.length) bad('The employee record needs at least one field.');
  return out;
}

// The UAE WPS SIF, as a starting point each company adjusts to its bank:
// one EDR per employee and the SCR trailer.
const F = (Source, more) => Object.assign({ Source, Text: '', Format: '', Decimals: null, Width: null, Pad: 'Right', PadChar: ' ', Upper: false }, more || {});
const WPS_SIF = {
  Name: 'UAE WPS SIF', Bank: '', Type: 'Delimited', Delimiter: ',', Extension: 'SIF', FileName: '{EMPLOYER}{CREATED:yyMMddHHmmss}', LineEnd: 'CRLF', Active: true,
  Values: { EmployerID: '', BankCode: '', Currency: 'AED', Reference: '' },
  Records: {
    Header: [],
    Employee: [F('TEXT', { Text: 'EDR' }), F('WPS_ID'), F('ROUTING'), F('IBAN'), F('PERIOD_START', { Format: 'yyyy-MM-dd' }), F('PERIOD_END', { Format: 'yyyy-MM-dd' }),
      F('DAYS'), F('FIXED', { Decimals: 2 }), F('VARIABLE', { Decimals: 2 }), F('UNPAID_DAYS')],
    Trailer: [F('TEXT', { Text: 'SCR' }), F('EMPLOYER'), F('BANK_CODE'), F('CREATED', { Format: 'yyyy-MM-dd' }), F('CREATED', { Format: 'HHmm' }), F('MONTH', { Format: 'MMyyyy' }),
      F('COUNT'), F('TOTAL', { Decimals: 2 }), F('CURRENCY'), F('REFERENCE')]
  }
};

module.exports = { SOURCES, RECORDS, formatDate, buildFile, employeeValues, cleanFormat, WPS_SIF };
