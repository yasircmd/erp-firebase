// Compact Add / Edit forms for the master screens (owner, 2026-10-02;
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
  ITEMMASTER: { prefix: 'im', notes: 5 },
  VENDORMASTER: { prefix: 'ven', notes: 1 },
  CUSTOMERMASTER: { prefix: 'cus', notes: 1 }
};

function style(p) {
  const m = '#' + p + '-modal', f = '#' + p + '-form';
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
  return style(c.prefix) + html.slice(0, start) + form + html.slice(end);
}

module.exports = { toCompactForms, SCREENS };
