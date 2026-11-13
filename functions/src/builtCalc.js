// Module Builder, phase 6 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q497): calculated fields, a fixed set of operations worked out on the
// server. No scripts: a definition is data. New development, hand-written.
//
// A calculated field: { key, label, type: 'calc', op, of: [refs], value?, by?,
// match?, skip? }, its value kept with the record like any number.
//   product     of: 2-5 refs              a × b × ...
//   sum         of: 2-5 refs              a + b + ...
//   difference  of: [a, b]                a − b
//   percent     of: [base, rate] or [base] with value (a fixed rate)   base × rate / 100
//   days        of: [from, to] (dates)    the days from one to the other
//   previous    of: [ref], by: a header link, (lines) match: a line field,
//               skip: statuses not counted
//               the same field summed over this module's earlier documents
//               with the same link (a contract's earlier claims), for a line
//               the lines with the same match value.
// A ref is a field of the same table defined before it ('key'); on a line,
// 'h:key' is a header field that is not calculated; on the header, 't:key' is
// a line total. So nothing can depend on itself.
'use strict';

const OPS = Object.freeze({ product: 'a × b', sum: 'a sum', difference: 'a − b', percent: 'a percentage', days: 'days between two dates', previous: 'earlier documents\' total' });
const NUM = ['number', 'amount', 'calc'];
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
function bad(msg) { const e = new Error(msg); e.code = 'invalid-argument'; throw e; }

// Is a field a number in sums, reports and actions (numbers, amounts, calculated fields).
const isNumeric = f => Boolean(f) && NUM.includes(f.type);
// Is it money (2 places): an amount, or a calculated field worked from one.
const isMoney = f => Boolean(f) && (f.type === 'amount' || (f.type === 'calc' && f.money === true));

// A calc field's own settings, checked for their form (cleanField calls it);
// its refs are checked against the definition by checkDefinition.
function cleanCalc(f, at) {
  const op = text(f.op, 12);
  if (!OPS[op]) bad(at + ': choose what it works out (' + Object.keys(OPS).join(', ') + ').');
  const of = (Array.isArray(f.of) ? f.of : String(f.of || '').split(',')).map(r => text(r, 34)).filter(Boolean);
  const n = of.length;
  if ((op === 'product' || op === 'sum') && (n < 2 || n > 5)) bad(at + ': ' + OPS[op] + ' needs 2 to 5 fields.');
  if ((op === 'difference' || op === 'days') && n !== 2) bad(at + ': ' + OPS[op] + ' needs 2 fields.');
  if (op === 'previous' && n !== 1) bad(at + ': choose the one field it totals.');
  const out = { op, of };
  if (op === 'percent') {
    if (n === 1) {
      const v = Number(f.value);
      if (!Number.isFinite(v) || f.value === '' || f.value == null) bad(at + ': give the percentage, or a second field with it.');
      out.value = v;
    } else if (n !== 2) bad(at + ': a percentage needs its base and its rate (a field or a fixed value).');
  }
  if (op === 'previous') {
    out.by = text(f.by, 31);
    if (!out.by) bad(at + ': choose the link it totals by (for example the contract).');
    out.match = text(f.match, 31);
    out.skip = (Array.isArray(f.skip) ? f.skip : String(f.skip || '').split(',')).map(s => text(s, 30)).filter(Boolean);
  }
  return out;
}

// The refs of every calc checked against the definition, in order; each calc
// gets `money`. Throws the first mistake.
function checkDefinition(def) {
  const head = def.fields, lines = (def.lines && def.lines.enabled) ? def.lines.fields : [];
  const kindOf = (f, table) => (f ? (f.type === 'date' ? 'date' : isNumeric(f) ? (isMoney(f) ? 'money' : 'number') : 'other') : null);
  const resolve = (ref, table, upTo) => {
    // table: 'head' | 'line'; upTo: the fields of the same table defined before this one.
    if (table === 'line' && ref.startsWith('h:')) {
      const f = head.find(x => x.key === ref.slice(2));
      return f && f.type !== 'calc' ? { f, kind: kindOf(f) } : null;
    }
    if (table === 'head' && ref.startsWith('t:')) {
      const f = lines.find(x => x.key === ref.slice(2));
      return f && isNumeric(f) ? { f, kind: isMoney(f) ? 'money' : 'number' } : null;
    }
    const f = upTo.find(x => x.key === ref);
    return f ? { f, kind: kindOf(f) } : null;
  };
  const checkTable = (fields, table) => fields.forEach((f, i) => {
    if (f.type !== 'calc') return;
    const at = (table === 'line' ? 'Line field ' : 'Field ') + (i + 1) + ' (' + f.label + ')';
    // `previous` reads values already kept on earlier documents, so it may name
    // any field of its table but itself; the others only fields before them.
    const before = f.op === 'previous' ? fields.filter(x => x !== f) : fields.slice(0, i);
    const refs = f.of.map(r => {
      const x = resolve(r, table, before);
      if (!x) bad(at + ': "' + r + '" is not ' + (table === 'line' ? 'a line field before it, h:<header field> or' : 'a field before it, t:<line field> or') + ' a field it can use.');
      return x;
    });
    if (f.op === 'days') {
      if (refs.some(x => x.kind !== 'date')) bad(at + ': days between needs two date fields.');
      f.money = false;
    } else {
      if (refs.some(x => x.kind !== 'number' && x.kind !== 'money')) bad(at + ': ' + OPS[f.op] + ' works on number, amount or calculated fields.');
      f.money = f.op === 'percent' ? refs[0].kind === 'money' : refs.some(x => x.kind === 'money');
    }
    if (f.op === 'previous') {
      if (table === 'line' ? /^[ht]:/.test(f.of[0]) : /^h:/.test(f.of[0])) bad(at + ': earlier documents\' total sums ' + (table === 'line' ? 'a field of its own lines.' : 'a header field or a line total (t:).'));
      if (def.kind !== 'document') bad(at + ': earlier documents\' total is for a document.');
      const link = head.find(x => x.key === f.by);
      if (!link || link.type !== 'link') bad(at + ': it totals by a link field of the header (for example the contract).');
      if (table === 'line') {
        const m = lines.find(x => x.key === f.match);
        if (!m || m.type === 'calc') bad(at + ': choose the line field that matches a line to the earlier documents\' lines.');
      } else if (f.match) bad(at + ': only a line field matches by a line field.');
      const names = (def.statuses || []).map(s => s.name);
      f.skip.forEach(s => { if (!names.includes(s)) bad(at + ': "' + s + '" is not one of its statuses.'); });
    }
  });
  // The lines first: a header calc may use a line total, a line never a header calc.
  checkTable(lines, 'line');
  checkTable(head, 'head');
  // `previous` is money when the field it sums is (known only once all are checked).
  const moneyOf = (ref, table) => isMoney(table === 'head' && ref.startsWith('t:') ? lines.find(x => x.key === ref.slice(2)) : (table === 'head' ? head : lines).find(x => x.key === ref));
  lines.forEach(f => { if (f.type === 'calc' && f.op === 'previous') f.money = moneyOf(f.of[0], 'line'); });
  head.forEach(f => { if (f.type === 'calc' && f.op === 'previous') f.money = moneyOf(f.of[0], 'head'); });
  return def;
}

// The value a ref names. row: the same table's values; headRow, totals.
function refValue(ref, row, headRow, totals) {
  if (ref.startsWith('h:')) return (headRow || {})[ref.slice(2)];
  if (ref.startsWith('t:')) return (totals || {})[ref.slice(2)];
  return row[ref];
}
const num = v => Number(v) || 0;
const dayNo = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? Date.parse(v + 'T00:00:00Z') / 86400000 : null);

// One calc's value. prev: what `previous` adds (a number).
function valueOf(f, row, headRow, totals, prev) {
  const vals = f.of.map(r => refValue(r, row, headRow, totals));
  let v;
  switch (f.op) {
    case 'product': v = vals.reduce((p, x) => p * num(x), 1); break;
    case 'sum': v = vals.reduce((s, x) => s + num(x), 0); break;
    case 'difference': v = num(vals[0]) - num(vals[1]); break;
    case 'percent': v = num(vals[0]) * (vals.length > 1 ? num(vals[1]) : f.value) / 100; break;
    case 'days': { const a = dayNo(vals[0]), b = dayNo(vals[1]); v = a == null || b == null ? 0 : b - a; break; }
    case 'previous': v = num(prev); break;
    default: v = 0;
  }
  return f.money ? round2(v) : Math.round(v * 1e6) / 1e6;
}

// The totals of the lines' numeric fields.
function totalsOf(def, lines) {
  const totals = {};
  ((def.lines && def.lines.enabled) ? def.lines.fields : []).filter(isNumeric).forEach(f => {
    const t = lines.reduce((s, l) => s + num(l[f.key]), 0);
    totals[f.key] = isMoney(f) ? round2(t) : Math.round(t * 1e6) / 1e6;
  });
  return totals;
}

// Work out every calc of a record: the lines' (with the header's own values),
// the totals, then the header's. prev: { head: { key: n }, lines: { key: { matchValue: n } } }.
// Returns { fields, lines, totals } (new objects).
function apply(def, fields, lines, prev) {
  const p = prev || { head: {}, lines: {} };
  const head = Object.assign({}, fields);
  const lf = (def.lines && def.lines.enabled) ? def.lines.fields : [];
  const outLines = (lines || []).map(l => {
    const row = Object.assign({}, l);
    lf.forEach(f => {
      if (f.type !== 'calc') return;
      const prevOf = f.op === 'previous' ? ((p.lines || {})[f.key] || {})[matchValue(row[f.match])] : 0;
      row[f.key] = valueOf(f, row, head, null, prevOf);
    });
    return row;
  });
  const totals = totalsOf(def, outLines);
  def.fields.forEach(f => { if (f.type === 'calc') head[f.key] = valueOf(f, head, null, totals, f.op === 'previous' ? (p.head || {})[f.key] : 0); });
  return { fields: head, lines: outLines, totals };
}

// A line's match value across documents: a link by its id, others as text.
const matchValue = v => (v && typeof v === 'object' ? String(v.id || '') : String(v == null ? '' : v));

// The `previous` calcs of a definition.
const previousCalcs = def => ({
  head: def.fields.filter(f => f.type === 'calc' && f.op === 'previous'),
  lines: ((def.lines && def.lines.enabled) ? def.lines.fields : []).filter(f => f.type === 'calc' && f.op === 'previous')
});

// What `previous` adds, from the earlier documents (records already read):
// each counted unless its status is skipped, earlier than this one by date,
// then by when it was made. me: { RecordID, Date, CreatedAt, Fields }.
function previousFrom(def, me, records) {
  const pc = previousCalcs(def), out = { head: {}, lines: {} };
  const earlier = r => r.RecordID !== me.RecordID && (String(r.Date) < String(me.Date) || (String(r.Date) === String(me.Date) && String(r.CreatedAt || '') < String(me.CreatedAt || '￿')));
  const linkId = (fields, k) => matchValue((fields || {})[k]);
  const counted = f => records.filter(r => earlier(r) && !f.skip.includes(r.Status) && linkId(r.Fields, f.by) && linkId(r.Fields, f.by) === linkId(me.Fields, f.by));
  pc.head.forEach(f => {
    const ref = f.of[0];
    out.head[f.key] = round2(counted(f).reduce((s, r) => s + num(ref.startsWith('t:') ? (r.Totals || {})[ref.slice(2)] : (r.Fields || {})[ref]), 0));
  });
  pc.lines.forEach(f => {
    const m = {};
    counted(f).forEach(r => (r.Lines || []).forEach(l => { const k = matchValue(l[f.match]); m[k] = round2((m[k] || 0) + num(l[f.of[0]])); }));
    out.lines[f.key] = m;
  });
  return out;
}

module.exports = { OPS, isNumeric, isMoney, cleanCalc, checkDefinition, apply, totalsOf, previousCalcs, previousFrom, matchValue, valueOf };
