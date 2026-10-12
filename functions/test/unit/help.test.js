// Help is kept current with the ERP (docs/modules/HELP.md, decision 149).
// The Deploy workflow runs this before every deploy ("Check help"):
//   - every module in the registry belongs to a help area;
//   - in an area that is written, every module has a page;
//   - no page is behind its module: a page records a fingerprint of its
//     screen and the files it names, and a change to them stops the deploy
//     until the page is updated or confirmed (node tools/help/stamp.js);
//   - the published site (public/help/) is exactly what the pages build to.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const help = require(path.join(__dirname, '../../../tools/help/lib'));
const { render } = require(path.join(__dirname, '../../../tools/help/markdown'));

test('help: every module has an area, written areas have their pages, no page is behind its code', () => {
  assert.deepEqual(help.check(), []);
});

test('help: public/help/ is built from help/pages (run node tools/help/build.js)', () => {
  assert.deepEqual(help.staleOutput(), []);
});

test('help pages: text is escaped (a page cannot inject HTML or script into the public site)', () => {
  const { html } = render('## A <b>title</b>\n\nSome <script>alert(1)</script> & "quotes" `<code>`\n\n- <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot; <code>&lt;code&gt;<\/code>/);
});

test('help pages: the Markdown the pages use', () => {
  const { html, headings, links } = render('## One\n\n1. a **b**\n   - c\n2. [d](x.html#y)\n\n> note\n\n| A | B |\n|---|---|\n| 1 | 2 |');
  assert.equal(html, '<h2 id="one">One</h2>\n<ol><li>a <strong>b</strong><ul><li>c</li></ul></li><li><a href="x.html#y">d</a></li></ol>\n' +
    '<div class="note"><p>note</p></div>\n<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.deepEqual(headings, [{ level: 2, text: 'One', id: 'one' }]);
  assert.deepEqual(links, ['x.html#y']);
});
