// Compact lists and Add / Edit forms for the master screens (owner, 2026-10-02;
// docs/modules/COMPACT_FORMS.md): less space, like the CBT compact
// (PR #38) did for tables and line grids. generate.js runs it on these
// generated screens. It adds a style block scoped to the screen's own
// form (#<prefix>-modal / #<prefix>-form), so nothing else changes and
// no Hosting deploy is needed, and turns each long grey help note under
// a field into one line: the full text shows on hover (title) and when
// the note is clicked or tapped (it takes focus and opens). Every pattern
// must match, so a changed screen fails loudly instead of silently
// skipping the conversion.
const SCREENS = {
  ITEMMASTER: { prefix: 'im', notes: 5, search: 'im-search-input' },
  VENDORMASTER: { prefix: 'ven', notes: 1, search: 'ven-search' },
  CUSTOMERMASTER: { prefix: 'cus', notes: 1, search: 'cus-search' }
};

function style(p, search) {
  const m = '#' + p + '-modal', f = '#' + p + '-form', b = '#' + p + '-table-body';
  return `<style>
  /* COMPACT FORM (tools/legacy-port/compactForms.js) */
  ${m} > div { padding: 0.9rem 1rem; }
  ${m} > div > :not([hidden]) ~ :not([hidden]) { margin-top: 0.6rem; }
  ${m} > div > div:first-child { padding-bottom: 0.4rem; }
  ${f} > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem; }
  ${f} .gap-4 { gap: 0.4rem 0.75rem; }
  ${f} label.block { margin-bottom: 0.1rem; }
  ${f} :is(input:not([type="checkbox"]), select, textarea) { padding: 0.25rem 0.5rem; }
  ${f} div.py-2.px-3 { padding: 0.25rem 0.5rem; }
  ${f} .rounded-xl.p-4 { padding: 0.5rem 0.75rem; }
  ${f} .rounded-xl.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.35rem; }
  ${f} p.form-note { margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; outline: none; }
  ${f} p.form-note:focus { white-space: normal; overflow: visible; }
  ${f} > div:last-child { padding-top: 0.5rem; }
  /* COMPACT LIST (owner, 2026-10-02): a row is one line. Code, company,
     actions and the rest never wrap; the name keeps room for a normal
     name (only a long one wraps); headers stay on one line; on a narrow
     screen the list scrolls sideways rather than growing tall. The filter
     bar and the action icons are tighter. */
  #module-container table:has(> ${b}) > thead th, #module-container ${b} > tr > td:not(:nth-child(2)) { white-space: nowrap; }
  #module-container ${b} > tr > td { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  #module-container ${b} > tr > td:nth-child(2) { min-width: 14rem; }
  #module-container ${b} button.p-1 { padding: 0.1rem 0.3rem; }
  #module-container div:has(> #${search}) { padding: 0.6rem; gap: 0.6rem; }
  #module-container div:has(> #${search}) > :is(input, select), #module-container #${search} { padding-top: 0.3rem; padding-bottom: 0.3rem; }
</style>
`;
}

function toCompactForms(html, mod) {
  const c = SCREENS[mod];
  if (!c) return html;
  const open = '<form id="' + c.prefix + '-form"';
  const start = html.indexOf(open), end = html.indexOf('</form>', start);
  if (start < 0 || end < 0 || html.split(open).length !== 2) throw new Error(mod + ': compact form: ' + open + ' not found exactly once');
  let n = 0;
  const form = html.slice(start, end).replace(/<p class="text-xs text-slate-500( mt-1)?">([^<]*)<\/p>/g, (m, mt, text) => {
    n++;
    return '<p class="form-note text-xs text-slate-500" tabindex="0" title="' + text.replace(/"/g, '&quot;') + '">' + text + '</p>';
  });
  if (n !== c.notes) throw new Error(mod + ': compact form: ' + n + ' help notes found, expected ' + c.notes);
  if (html.split('id="' + c.search + '"').length !== 2 || html.split('id="' + c.prefix + '-table-body"').length !== 2) throw new Error(mod + ': compact list: search box or table body not found exactly once');
  return style(c.prefix, c.search) + html.slice(0, start) + form + html.slice(end);
}

module.exports = { toCompactForms, SCREENS };
