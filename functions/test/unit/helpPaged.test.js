// What's new in pages of 30 (owner, 2026-11-06; docs/modules/UX_ROUND3.md
// item 6, Q412): the latest 30 entries on whats-new.html, then whats-new-2,
// ... each entry still under its date, with Newer / Older links; each part
// searchable and in the sitemap.
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../../tools/help/lib');

test('a paged page: N entries a part, newest first, under their dates; the intro on each part', () => {
  const p = { slug: 'news', meta: { paged: '2' }, body: 'Intro line.\n\n## 03/01\n\n- **A** first\n  more of A\n- **B**\n\n## 02/01\n\n- **C**\n' };
  const parts = lib.pagedParts(p);
  assert.deepEqual(parts.map(x => x.slug), ['news', 'news-2']);
  assert.match(parts[0].body, /^Intro line\.\n\n## 03\/01\n\n- \*\*A\*\* first\n  more of A\n- \*\*B\*\*\n$/);
  assert.match(parts[1].body, /^Intro line\.\n\n## 02\/01\n\n- \*\*C\*\*\n$/);
  assert.match(parts[0].pager, /Page 1 of 2 · <a href="news-2.html">Older changes/);
  assert.match(parts[1].pager, /<a href="news.html">&larr; Newer changes<\/a> · Page 2 of 2/);
  assert.deepEqual(lib.pagedParts({ slug: 'x', meta: {}, body: 'b' }).map(x => x.slug), ['x'], 'a page without paged: one part');
});

test('What\'s new: 30 a page; every entry on exactly one page; the parts built, searchable and in the sitemap', () => {
  const wn = lib.pages().find(p => p.slug === 'whats-new');
  const parts = lib.pagedParts(wn);
  const count = s => (s.match(/^- /gm) || []).length;
  assert.equal(count(wn.body), parts.reduce((t, x) => t + count(x.body), 0), 'no entry lost or doubled');
  parts.forEach((x, i) => assert.ok(count(x.body) <= 30 && (i === parts.length - 1 || count(x.body) === 30), x.slug));
  assert.ok(parts.length >= 2);
  const files = lib.build();
  parts.forEach(x => {
    assert.ok(files['public/help/' + x.slug + '.html'], x.slug + ' built');
    assert.match(files['public/help/sitemap.xml'], new RegExp('/help/' + x.slug + '\\.html'));
  });
  const search = JSON.parse(files['public/help/search.json']);
  assert.deepEqual(search.pages.filter(s => s.slug.startsWith('whats-new')).map(s => s.slug), parts.map(x => x.slug));
});
