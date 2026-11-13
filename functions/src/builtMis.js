// Module Builder, phase 5 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q489-Q492): built modules in the MIS report builder. New development,
// hand-written.
//
// Every published built module is a data set (Q489): x:<X_ID>, one row per
// record (a master: all its records as they are today, it has no date; a
// document: those dated in the report's months); a document with lines is a
// second one, xl:<X_ID>, a row per line with the header repeated (Q490). A
// link to a built master brings that master's fields as columns, one level
// deep (Q491); a link to the ERP's records its code and name (the label kept
// on the value). A variant (phase 4) is not a data set of its own: its
// documents are in Sales and Purchase lines, with a Variant column and its
// extra fields (Q492, misBuilder.js through variantColumns here). Rights as
// the other data sets (Q448): MIS access and the module's own access.
'use strict';
const { firestore } = require('./firebaseAdmin');

const ID = /^xl?:X_[A-Z][A-Z0-9_]{1,30}$/;
const { isNumeric } = require('./builtCalc');
const typeOf = f => (isNumeric(f) ? 'number' : f.type === 'date' ? 'date' : 'text');
// A built value as a report value, by its field's type.
function valueOf(f, v) {
  if (v == null || v === '') return isNumeric(f) ? 0 : '';
  if (f.type === 'link') return typeof v === 'object' ? String(v.label || v.id || '') : String(v);
  if (f.type === 'yesno') return v ? 'Yes' : 'No';
  if (isNumeric(f)) return Number(v) || 0;
  return String(v);
}

// The columns of a built master linked by `link` (one level), keyed under it.
function linkColumns(link, master, prefix) {
  const out = {};
  if (!master) return out;
  out[prefix + link.key + '__code'] = { label: link.label + ' · Code', type: 'text' };
  out[prefix + link.key + '__name'] = { label: link.label + ' · Name', type: 'text' };
  master.fields.filter(f => f.type !== 'longtext').forEach(f => { out[prefix + link.key + '__' + f.key] = { label: link.label + ' · ' + f.label, type: typeOf(f) }; });
  return out;
}
function fieldColumns(fields, prefix, defsById) {
  const out = {};
  fields.forEach(f => {
    if (f.type === 'longtext') return;
    out[prefix + f.key] = { label: f.label, type: typeOf(f) };
    if (f.type === 'link' && defsById[f.target] && defsById[f.target].kind === 'master') Object.assign(out, linkColumns(f, defsById[f.target], prefix));
  });
  return out;
}

// The data sets of the published definitions: { id: { title, module, built: { id, lines }, fields } }.
function datasetsOf(defs) {
  const byId = Object.fromEntries((defs || []).map(d => [d.id, d]));
  const out = {};
  (defs || []).filter(d => d.kind === 'master' || d.kind === 'document').forEach(d => {
    const head = d.kind === 'master'
      ? { code: { label: 'Code', type: 'text' }, name: { label: 'Name', type: 'text' }, active: { label: 'Active', type: 'text' } }
      : { number: { label: 'Number', type: 'text' }, date: { label: 'Date', type: 'date' }, month: { label: 'Month', type: 'month' }, status: { label: 'Status', type: 'text' } };
    const fields = Object.assign({}, head, fieldColumns(d.fields, 'f_', byId));
    if (d.kind === 'document' && d.lines && d.lines.enabled) {
      const totals = {};
      d.lines.fields.filter(isNumeric).forEach(f => { totals['t_' + f.key] = { label: d.lines.label + ' · ' + f.label + ' (total)', type: 'number' }; });
      out['x:' + d.id] = { title: d.label, module: d.id, built: { id: d.id, lines: false }, fields: Object.assign({}, fields, totals) };
      out['xl:' + d.id] = { title: d.label + ' – ' + (d.lines.label || 'lines').toLowerCase(), module: d.id, built: { id: d.id, lines: true },
        fields: Object.assign({}, fields, fieldColumns(d.lines.fields, 'l_', byId)) };
    } else out['x:' + d.id] = { title: d.label, module: d.id, built: { id: d.id, lines: false }, fields };
  });
  return out;
}

// The rows of a built data set for a company over `months` (a master: all of its records).
async function rowsOf(ds, defs, companyId, months) {
  const byId = Object.fromEntries((defs || []).map(d => [d.id, d]));
  const def = byId[ds.built.id];
  if (!def) return [];
  const recs = (await firestore.collection('builtRecords').where('ModuleID', '==', def.id).get()).docs.map(x => x.data())
    .filter(r => !def.companyScoped || (r.CompanyID || '') === companyId)
    .filter(r => def.kind === 'master' || months.includes(String(r.Date || '').slice(0, 7)));
  // The built masters linked from this module (header or lines), read once.
  const masters = {};
  for (const f of def.fields.concat((def.lines || {}).fields || [])) {
    if (f.type !== 'link' || !byId[f.target] || byId[f.target].kind !== 'master' || masters[f.target]) continue;
    masters[f.target] = {};
    (await firestore.collection('builtRecords').where('ModuleID', '==', f.target).get()).docs.forEach(x => { masters[f.target][x.id] = x.data(); });
  }
  const put = (row, fields, values, prefix) => fields.forEach(f => {
    if (f.type === 'longtext') return;
    const v = (values || {})[f.key];
    row[prefix + f.key] = valueOf(f, v);
    const m = f.type === 'link' && masters[f.target];
    if (m) {
      const linked = m[v && typeof v === 'object' ? v.id : v] || null;
      row[prefix + f.key + '__code'] = linked ? linked.Code || '' : '';
      row[prefix + f.key + '__name'] = linked ? linked.Name || '' : '';
      byId[f.target].fields.filter(g => g.type !== 'longtext').forEach(g => { row[prefix + f.key + '__' + g.key] = valueOf(g, linked ? (linked.Fields || {})[g.key] : null); });
    }
  });
  const out = [];
  recs.forEach(r => {
    const head = def.kind === 'master' ? { code: r.Code || '', name: r.Name || '', active: r.Active === false ? 'Off' : 'Active' }
      : { number: r.Number || '', date: r.Date || '', month: String(r.Date || '').slice(0, 7), status: r.Status || '' };
    put(head, def.fields, r.Fields, 'f_');
    if (!ds.built.lines) {
      if (def.kind === 'document' && def.lines && def.lines.enabled) def.lines.fields.filter(isNumeric).forEach(f => { head['t_' + f.key] = Number((r.Totals || {})[f.key]) || 0; });
      out.push(head);
      return;
    }
    (r.Lines || []).forEach(l => { const row = Object.assign({}, head); put(row, def.lines.fields, l, 'l_'); out.push(row); });
  });
  return out;
}

// Q492: the variants of an original as columns of its lines' data set:
// { fields: { variant, v_<X_ID>__<key> ... }, rowValues(doc) }.
function variantColumns(defs, base) {
  const vs = (defs || []).filter(d => d.kind === 'variant' && d.base === base);
  const fields = { variant: { label: 'Variant', type: 'text' } };
  vs.forEach(v => v.fields.filter(f => f.type !== 'longtext').forEach(f => { fields['v_' + v.id + '__' + f.key] = { label: v.label + ' · ' + f.label, type: typeOf(f) }; }));
  const rowValues = doc => {
    const out = { variant: (doc && doc.Variant) ? doc.VariantLabel || doc.Variant : '' };
    vs.forEach(v => v.fields.filter(f => f.type !== 'longtext').forEach(f => {
      out['v_' + v.id + '__' + f.key] = doc && doc.Variant === v.id ? valueOf(f, (doc.VariantFields || {})[f.key]) : (typeOf(f) === 'number' ? 0 : '');
    }));
    return out;
  };
  return { fields, rowValues };
}

module.exports = { ID, datasetsOf, rowsOf, variantColumns, valueOf };
