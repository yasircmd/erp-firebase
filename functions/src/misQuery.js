// MIS report builder, the pure engine (owner, 2026-11-08; docs/modules/MIS.md,
// phase 4, Q446-Q449): a data set's lines (rows of fields) shaped by a
// spec: filters, then a list of columns, a grouping by one or two fields
// with totals, or a pivot (rows × columns). No database here, so every rule
// is unit-tested (unit/misQuery.test.js). New development, hand-written.
//
// fields: { key: { label, type: 'text'|'date'|'month'|'number' } }
// spec:
//   filters:  [{ field, op: 'eq'|'ne'|'contains'|'gt'|'lt'|'between', value, to }]
//   view:     'list' | 'group' | 'pivot'
//   columns:  [field]                        (list)
//   groupBy:  [field] (1 or 2)               (group)
//   measures: [{ field, agg }]               (group; agg 'sum'|'count'|'avg'|'min'|'max')
//   pivot:    { rows: field, cols: field, measure: { field, agg } }
//   sort:     { by: column index (0-based) , dir: 'asc'|'desc' }
//   limit:    rows shown (1-500)
'use strict';

const OPS = Object.freeze(['eq', 'ne', 'contains', 'gt', 'lt', 'between']);
const AGGS = Object.freeze(['sum', 'count', 'avg', 'min', 'max']);
const VIEWS = Object.freeze(['list', 'group', 'pivot']);
const MAX_LIMIT = 500, MAX_PIVOT_COLS = 24, MAX_FILTERS = 10, MAX_COLUMNS = 12, MAX_MEASURES = 4;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const AGG_LABEL = Object.freeze({ sum: 'Total', count: 'Count', avg: 'Average', min: 'Lowest', max: 'Highest' });

function fail(msg) { const e = new Error(msg); e.code = 'invalid-argument'; throw e; }

// The spec, checked against the data set's fields and cleaned.
function cleanSpec(spec, fields) {
  const s = spec || {};
  const known = f => Object.prototype.hasOwnProperty.call(fields, f);
  const field = (f, what) => { const k = String(f || ''); if (!known(k)) fail('Unknown field' + (what ? ' for ' + what : '') + ': ' + (k || '(none)') + '.'); return k; };
  const filters = (Array.isArray(s.filters) ? s.filters : []).filter(x => x && x.field);
  if (filters.length > MAX_FILTERS) fail('At most ' + MAX_FILTERS + ' filters.');
  const cleanFilters = filters.map(x => {
    const f = field(x.field, 'a filter');
    const op = OPS.includes(x.op) ? x.op : 'eq';
    const t = fields[f].type;
    if ((op === 'gt' || op === 'lt' || op === 'between') && t === 'text') fail('"' + fields[f].label + '" is text: filter it by equals, not equals or contains.');
    if (op === 'contains' && t !== 'text') fail('"' + fields[f].label + '": contains is for text.');
    const out = { field: f, op, value: x.value == null ? '' : String(x.value).slice(0, 120) };
    if (op === 'between') {
      out.to = x.to == null ? '' : String(x.to).slice(0, 120);
      if (out.value === '' || out.to === '') fail('"' + fields[f].label + '": between needs both ends.');
    }
    return out;
  });
  const view = VIEWS.includes(s.view) ? s.view : 'group';
  const out = { filters: cleanFilters, view, limit: Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(s.limit) || 100))) };
  const measure = (m, what) => {
    const agg = AGGS.includes(m && m.agg) ? m.agg : 'sum';
    if (agg === 'count') return { field: m && known(m.field) ? m.field : '', agg };
    const f = field(m && m.field, what);
    if (fields[f].type !== 'number') fail('"' + fields[f].label + '" is not a number: count it instead.');
    return { field: f, agg };
  };
  if (view === 'list') {
    const cols = (Array.isArray(s.columns) ? s.columns : []).map(c => field(c, 'a column'));
    if (!cols.length) fail('Choose the columns to show.');
    if (cols.length > MAX_COLUMNS) fail('At most ' + MAX_COLUMNS + ' columns.');
    out.columns = cols;
  } else if (view === 'group') {
    const by = (Array.isArray(s.groupBy) ? s.groupBy : []).filter(Boolean).map(g => field(g, 'grouping'));
    if (by.length < 1 || by.length > 2) fail('Group by one or two fields.');
    const ms = (Array.isArray(s.measures) ? s.measures : []).map(m => measure(m, 'a total'));
    if (!ms.length) fail('Choose at least one total.');
    if (ms.length > MAX_MEASURES) fail('At most ' + MAX_MEASURES + ' totals.');
    Object.assign(out, { groupBy: by, measures: ms });
  } else {
    const p = s.pivot || {};
    const rows = field(p.rows, 'the pivot\'s rows'), cols = field(p.cols, 'the pivot\'s columns');
    if (rows === cols) fail('The pivot\'s rows and columns must be different fields.');
    out.pivot = { rows, cols, measure: measure(p.measure, 'the pivot\'s figure') };
  }
  const sort = s.sort || {};
  if (sort.by !== undefined && sort.by !== null && sort.by !== '') out.sort = { by: Math.max(0, Math.floor(Number(sort.by) || 0)), dir: sort.dir === 'asc' ? 'asc' : 'desc' };
  return out;
}

// Does a line pass a filter? Text compares without case; dates and months as text (yyyy-mm-dd sorts).
function passes(row, f, fields) {
  const t = fields[f.field].type, v = row[f.field];
  if (t === 'number') {
    const n = Number(v) || 0, a = Number(f.value), b = Number(f.to);
    if (f.op === 'eq') return n === a;
    if (f.op === 'ne') return n !== a;
    if (f.op === 'gt') return n > a;
    if (f.op === 'lt') return n < a;
    return n >= Math.min(a, b) && n <= Math.max(a, b);
  }
  const s = String(v == null ? '' : v), w = String(f.value);
  if (t === 'text') {
    const l = s.toLowerCase(), q = w.toLowerCase();
    if (f.op === 'eq') return l === q;
    if (f.op === 'ne') return l !== q;
    return l.includes(q);
  }
  if (f.op === 'eq') return s === w || (t === 'date' && s.startsWith(w));
  if (f.op === 'ne') return !(s === w || (t === 'date' && s.startsWith(w)));
  if (f.op === 'gt') return s > w;
  if (f.op === 'lt') return s < w;
  const [lo, hi] = [w, String(f.to)].sort();
  return s >= lo && s <= hi + (t === 'date' && hi.length === 7 ? '-31' : '');
}
const applyFilters = (rows, filters, fields) => rows.filter(r => filters.every(f => passes(r, f, fields)));

// One total over lines.
function aggregate(lines, m) {
  if (m.agg === 'count') return lines.length;
  const xs = lines.map(r => Number(r[m.field]) || 0);
  if (!xs.length) return m.agg === 'sum' ? 0 : null;
  if (m.agg === 'sum') return round2(xs.reduce((a, b) => a + b, 0));
  if (m.agg === 'avg') return round2(xs.reduce((a, b) => a + b, 0) / xs.length);
  return round2(m.agg === 'min' ? Math.min(...xs) : Math.max(...xs));
}
const measureLabel = (m, fields) => (m.agg === 'count' ? 'Count' : AGG_LABEL[m.agg] + ' ' + fields[m.field].label.toLowerCase());
const keyOf = v => (v == null || v === '' ? '(none)' : String(v));
function sortRows(rows, sort, numericAt) {
  if (!sort) return rows;
  const i = sort.by, dir = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = a[i], y = b[i];
    const c = numericAt(i) ? (Number(x) || 0) - (Number(y) || 0) : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y));
    return c * dir;
  });
}

// The result: { view, columns: [{ label, type }], rows: [[...]], totals: [...]|null, count, truncated }
// (pivot: also rowTotals, colKeys).
function run(lines, spec, fields) {
  const s = cleanSpec(spec, fields);
  const rows = applyFilters(lines || [], s.filters, fields);
  if (s.view === 'list') {
    const columns = s.columns.map(c => ({ key: c, label: fields[c].label, type: fields[c].type }));
    let out = rows.map(r => s.columns.map(c => r[c] == null ? '' : r[c]));
    out = sortRows(out, s.sort, i => columns[i] && columns[i].type === 'number');
    const totals = columns.map(c => (c.type === 'number' ? round2(rows.reduce((t, r) => t + (Number(r[c.key]) || 0), 0)) : ''));
    return { view: 'list', columns, rows: out.slice(0, s.limit), totals: columns.some(c => c.type === 'number') ? totals : null, count: rows.length, truncated: out.length > s.limit };
  }
  if (s.view === 'group') {
    const groups = new Map();
    rows.forEach(r => {
      const keys = s.groupBy.map(g => keyOf(r[g]));
      const k = JSON.stringify(keys);
      if (!groups.has(k)) groups.set(k, { keys, lines: [] });
      groups.get(k).lines.push(r);
    });
    const columns = s.groupBy.map(g => ({ key: g, label: fields[g].label, type: fields[g].type }))
      .concat(s.measures.map(m => ({ key: m.agg + ':' + m.field, label: measureLabel(m, fields), type: 'number' })));
    let out = [...groups.values()].map(g => g.keys.concat(s.measures.map(m => aggregate(g.lines, m))));
    out = sortRows(out.sort((a, b) => a.slice(0, s.groupBy.length).join('\u0000').localeCompare(b.slice(0, s.groupBy.length).join('\u0000'))), s.sort, i => i >= s.groupBy.length);
    const totals = s.groupBy.map((g, i) => (i ? '' : 'Total')).concat(s.measures.map(m => aggregate(rows, m)));
    return { view: 'group', columns, rows: out.slice(0, s.limit), totals, count: out.length, truncated: out.length > s.limit };
  }
  // pivot: rows × columns, one figure; the most significant columns kept when there are many.
  const p = s.pivot;
  const colTotalsAll = new Map();
  rows.forEach(r => { const c = keyOf(r[p.cols]); colTotalsAll.set(c, (colTotalsAll.get(c) || []).concat([r])); });
  let colKeys = [...colTotalsAll.keys()].sort();
  const colsTruncated = colKeys.length > MAX_PIVOT_COLS;
  if (colsTruncated) colKeys = colKeys.sort((a, b) => colTotalsAll.get(b).length - colTotalsAll.get(a).length).slice(0, MAX_PIVOT_COLS).sort();
  const byRow = new Map();
  rows.forEach(r => { const k = keyOf(r[p.rows]); if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(r); });
  const columns = [{ key: p.rows, label: fields[p.rows].label, type: fields[p.rows].type }]
    .concat(colKeys.map(c => ({ key: 'col:' + c, label: c, type: 'number' })), [{ key: 'total', label: 'Total', type: 'number' }]);
  let out = [...byRow.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, ls]) =>
    [k].concat(colKeys.map(c => { const cell = ls.filter(r => keyOf(r[p.cols]) === c); return cell.length ? aggregate(cell, p.measure) : null; }), [aggregate(ls, p.measure)]));
  out = sortRows(out, s.sort, i => i >= 1);
  const totals = ['Total'].concat(colKeys.map(c => aggregate(colTotalsAll.get(c), p.measure)), [aggregate(rows, p.measure)]);
  return { view: 'pivot', columns, rows: out.slice(0, s.limit), totals, count: out.length, truncated: out.length > s.limit || colsTruncated,
    figure: measureLabel(p.measure, fields), colsTruncated };
}

// A result as MIS report rows ({ key, label, current }) for a chart or dashboard
// tile: the first grouping and the first total (a pivot: its rows and totals).
function asReportRows(result) {
  if (result.view === 'list') return [];
  const last = result.columns.length - 1;
  const at = result.view === 'group' ? result.columns.findIndex(c => c.type === 'number' && /:/.test(c.key)) : last;
  return result.rows.map(r => ({ key: String(r[0]), label: result.view === 'group' && result.columns[1] && !/:/.test(result.columns[1].key) ? r[0] + ' · ' + r[1] : String(r[0]), current: r[at] == null ? 0 : r[at] }));
}

module.exports = { OPS, AGGS, VIEWS, MAX_LIMIT, MAX_PIVOT_COLS, cleanSpec, applyFilters, aggregate, run, asReportRows };
