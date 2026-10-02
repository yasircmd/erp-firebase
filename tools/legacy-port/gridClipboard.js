// Copy / Paste of entry-screen line grids with column headings (owner,
// 2026-10-02; docs/modules/LINE_GRIDS.md). Copy always puts the column
// headings on top (an empty grid copies just the headings, instead of
// "Nothing to copy yet."), so the copy is a labelled table in Excel; a
// paste whose first row is the headings skips that row. generate.js runs it
// on the generated screens (Physical Count, Production, BOM); the hand
// screens below were converted with it once (kept here so the conversion
// is on record). Delivery Note already copied its headings; it only stops
// refusing an empty copy (it has no grid paste). Every pattern must match
// exactly once, so a changed screen fails loudly.
const SCREENS = {
  PHYSICALCOUNT: ['Item Code', 'Warehouse', 'Description', 'UOM', 'Counted', 'Batch No.', 'Cost Ctr', 'Profit Ctr'],
  PRODUCTION: ['Item Code', 'Warehouse', 'Description', 'UOM', 'Quantity', 'Unit Cost', 'Batch No.', 'Expiry Date', 'Cost Ctr', 'Profit Ctr'],
  BOM: ['Component Item Code', 'Quantity', 'Scrap %'],
  // Hand screens, converted once.
  JV: { hand: true, headings: ['Account Code', 'Description', 'Debit', 'Credit', 'Cost Ctr', 'Profit Ctr'] },
  CBT: { hand: true, headings: ['Account Code', 'Description', 'Amount', 'Cost Ctr', 'Profit Ctr'] },
  GRN: { hand: true, headings: ['Item Code', 'Warehouse', 'Description', 'UOM', 'Quantity', 'Unit Cost', 'Batch No.', 'Expiry Date', 'Cost Ctr', 'Profit Ctr'] },
  MATERIALISSUE: { hand: true, headings: ['Item Code', 'Warehouse', 'Description', 'UOM', 'Quantity', 'Batch No.', 'Cost Ctr', 'Profit Ctr'] },
  WAREHOUSEMOVEMENT: { hand: true, headings: ['Item Code', 'From Location', 'To Location', 'Description', 'UOM', 'Quantity', 'Batch No.', 'Cost Ctr', 'Profit Ctr'] },
  STOCKADJUSTMENT: { hand: true, headings: ['Item Code', 'Direction', 'Warehouse', 'Description', 'UOM', 'Quantity', 'Batch No.', 'Cost Ctr', 'Profit Ctr'] },
  DELIVERYNOTE: { hand: true, copyOnly: true }
};

function once(s, from, to, mod) {
  const n = typeof from === 'string' ? s.split(from).length - 1 : (s.match(new RegExp(from.source, 'g')) || []).length;
  if (n !== 1) throw new Error(mod + ': grid clipboard pattern found ' + n + ' times: ' + String(from).slice(0, 80));
  return s.replace(from, to);
}

function toGridClipboard(html, mod) {
  const c = SCREENS[mod];
  if (!c) return html;
  let s = html;
  if (c.copyOnly) {
    return once(s, "    if (!rows.length) { alert('Nothing to copy yet.'); return; }\n", '', mod);
  }
  const headings = Array.isArray(c) ? c : c.headings;
  s = once(s, /\n(  (?:async )?function handleCopyButton\(\) \{)/, (m, fn) => `
  // Copy puts the column headings on top; a paste starting with them skips
  // that row (owner, 2026-10-02; docs/modules/LINE_GRIDS.md).
  const COPY_HEADINGS = ${JSON.stringify(headings)};
  function isHeadingRow(rowText) {
    const key = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9%]/g, '');
    const heads = COPY_HEADINGS.map(key);
    const cells = String(rowText || '').split('\\t').map(key).filter(Boolean);
    return cells.length > 0 && (cells[0] === heads[0] || cells.filter(v => heads.includes(v)).length >= 2);
  }

${fn}`, mod);
  s = once(s, "    const text = rows.join('\\n');\n    if (!text) { alert('Nothing to copy yet.'); return; }\n",
    "    const text = [COPY_HEADINGS.join('\\t')].concat(rows).join('\\n');\n", mod);
  s = once(s, /(\n\s*const rows = text\.replace\(\/\\r\/g, ''\)\.split\('\\n'\)\.filter\([^\n]*\);\n)/,
    (m, line) => line + "    if (rows.length && isHeadingRow(rows[0])) rows.shift(); // the copied headings row\n", mod);
  return s;
}

module.exports = { toGridClipboard, SCREENS };
