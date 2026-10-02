// Gmail-style list paging for the document list screens (owner,
// 2026-10-02; docs/modules/LIST_PAGING.md). generate.js runs it on the
// generated screens (Production, Physical Count); the hand screens below
// were converted with it once, and Purchase Order by hand. A list now loads 100 at a time
// through the shell's createListPager ("Load next 100"), and search and
// filters also ask the server, which searches every entry. Every pattern
// must match exactly once, so a changed screen fails loudly instead of
// silently skipping the conversion.
const SCREENS = {
  PRODUCTION: { prefix: 'prd', fn: 'getProductionEntries', noun: 'Production Entries' },
  PHYSICALCOUNT: { prefix: 'pc', fn: 'getPhysicalCountEntries', noun: 'Counts' },
  // Hand screens, converted once (kept here so the conversion is on record).
  MATERIALISSUE: { prefix: 'mi', fn: 'getMaterialIssueEntries', noun: 'Material Issues', hand: true },
  WAREHOUSEMOVEMENT: { prefix: 'wm', fn: 'getWarehouseMovementEntries', noun: 'Warehouse Movements', hand: true },
  GRN: { prefix: 'grn', fn: 'getGrnEntries', noun: 'GRNs', hand: true, extra: { InvoiceStatus: 'invoice-filter' } },
  STOCKADJUSTMENT: { prefix: 'adj', fn: 'getStockAdjustmentEntries', noun: 'Stock Adjustments', hand: true },
  JV: { prefix: 'jv', fn: 'getJournalEntries', noun: 'entries', hand: true },
  CBT: { prefix: 'cbt', fn: 'getCbtEntries', noun: 'transactions', hand: true,
    filters: { CompanyID: 'company-filter', VoucherType: 'type-filter', Status: 'status-filter' }, exactDate: 'date-filter' }
};
const DEFAULT_FILTERS = { CompanyID: 'company-filter', Status: 'status-filter', from: 'from-filter', to: 'to-filter' };

function once(s, from, to, mod) {
  const n = typeof from === 'string' ? s.split(from).length - 1 : (s.match(new RegExp(from.source, 'g')) || []).length;
  if (n !== 1) throw new Error(mod + ': list paging pattern found ' + n + ' times: ' + String(from).slice(0, 80));
  return s.replace(from, () => to);
}

function toListPaging(html, mod) {
  const c = SCREENS[mod];
  if (!c) return html;
  const p = c.prefix;
  const filters = Object.assign({}, c.filters || DEFAULT_FILTERS, c.extra || {});
  const v = id => `document.getElementById('${p}-${id}').value`;
  const filterLines = [`search: ${v('search-input')}`]
    .concat(Object.keys(filters).map(k => `${k}: ${v(filters[k])}`))
    .concat(c.exactDate ? [`from: ${v(c.exactDate)}`, `to: ${v(c.exactDate)}`] : []);
  let s = html;

  // The list's load: the pager, with the same handling of what arrives.
  s = once(s, `  function fetchAndRenderList(limit) {
    currentLimit = limit || currentLimit;
    rpc
      .withSuccessHandler(result => {
`, `  // Gmail-style paging; search and filters run on the server over every
  // entry (docs/modules/LIST_PAGING.md).
  const listPager = createListPager({
    notice: '${p}-list-notice', noun: '${c.noun}',
    fetch: (page, ok, fail) => rpc.withSuccessHandler(ok).withFailureHandler(fail).${c.fn}({ page: page }),
    filters: () => ({
      ${filterLines.join(',\n      ')}
    }),
    onLoad: result => {
`, mod);
  s = once(s, new RegExp(`      \\}\\)\\n      \\.withFailureHandler\\(err => alert\\(err\\.message \\|\\| '[^']*'\\)\\)\\n      \\.${c.fn}\\(\\{ limit: currentLimit \\}\\);\\n  \\}\\n`),
    `    }
  });
  // A report's drill-down opens one entry directly ('all' was the old "load
  // everything, then find it").
  function fetchAndRenderList(limit) {
    if (limit === 'all' && pendingOpenEntryId) listPager.open(pendingOpenEntryId);
    else listPager.reload();
  }
`, mod);
  s = once(s, /  let currentLimit = 100;\n/, '', mod);

  // The notice is the pager's now.
  s = once(s, new RegExp(`\\n    const notice = document\\.getElementById\\('${p}-list-notice'\\);\\n    if \\(entriesTotal > entries\\.length\\) \\{\\n[\\s\\S]*?\\n    \\} else \\{\\n      notice\\.classList\\.add\\('hidden'\\);\\n    \\}\\n`), '', mod);

  // Search and filters: show what's loaded at once, and ask the server.
  s = once(s, `document.getElementById('${p}-search-input').addEventListener('input', renderList);`,
    `document.getElementById('${p}-search-input').addEventListener('input', () => { renderList(); listPager.reloadSoon(); });`, mod);
  const changeIds = Object.values(filters).filter(id => !(c.extra && Object.values(c.extra).includes(id))).concat(c.exactDate ? [c.exactDate] : []);
  for (const id of changeIds) {
    s = once(s, `document.getElementById('${p}-${id}').addEventListener('change', renderList);`,
      `document.getElementById('${p}-${id}').addEventListener('change', () => { renderList(); listPager.reload(); });`, mod);
  }
  if (mod === 'GRN') {
    s = once(s, `    // Finding pending ones must not miss older GRNs: load them all first.
    document.getElementById('grn-invoice-filter').addEventListener('change', () => {
      if (document.getElementById('grn-invoice-filter').value && entriesTotal > entries.length) fetchAndRenderList('all'); else renderList();
    });`, `    // The server finds pending ones among all GRNs, not just those loaded.
    document.getElementById('grn-invoice-filter').addEventListener('change', () => { renderList(); listPager.reload(); });`, mod);
  }
  return s;
}

module.exports = { toListPaging, LIST_PAGING_SCREENS: SCREENS };
