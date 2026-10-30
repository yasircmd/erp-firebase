// A small Markdown converter for the help pages (docs/modules/HELP.md): the
// subset the pages use, no dependency. Blocks: ## / ### headings,
// paragraphs, "- " and "1. " lists (a nested level by two spaces), "> "
// notes, | tables |. Inline: **bold**, *italic*, `code`, [text](link).
'use strict';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, href) => '<a href="' + href + '">' + t + '</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[i] + '</code>');
}

const slugify = t => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Returns { html, headings: [{ level, text, id }], links: [href] }.
function render(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [], headings = [], links = [];
  let i = 0;
  const listItem = l => l.match(/^(\s*)(-|\d+\.)\s+(.*)$/);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      const level = m[1].length, text = inline(m[2]), id = slugify(m[2]);
      headings.push({ level, text: m[2], id });
      out.push('<h' + level + ' id="' + id + '">' + text + '</h' + level + '>');
      i++; continue;
    }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push('<div class="note">' + render(buf.join('\n')).html + '</div>');
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(rows[0]), body = rows.slice(rows[1] && /^\|[\s:-]+\|/.test(rows[1]) ? 2 : 1);
      out.push('<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + cells(r).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (listItem(line) && !listItem(line)[1]) {
      // A list, with one nested level (items indented by two or more spaces).
      const html = [];
      const open = (ordered) => (ordered ? '<ol>' : '<ul>'), close = (ordered) => (ordered ? '</ol>' : '</ul>');
      const topOrdered = /\d/.test(listItem(line)[2]);
      html.push(open(topOrdered));
      // An item's text is gathered whole before it is formatted, so **bold**
      // can run over a line break, as in a paragraph.
      let nested = null, item = null;
      const flushItem = () => { if (item !== null) { html.push('<li>' + inline(item) + (nested ? open(nested.ordered) + nested.items.map(t => '<li>' + inline(t) + '</li>').join('') + close(nested.ordered) : '') + '</li>'); item = null; nested = null; } };
      while (i < lines.length) {
        const l = lines[i], lm = listItem(l);
        if (lm && !lm[1]) { flushItem(); item = lm[3]; i++; continue; }
        if (lm && lm[1]) {
          if (!nested) nested = { ordered: /\d/.test(lm[2]), items: [] };
          nested.items.push(lm[3]); i++; continue;
        }
        if (l.trim() && /^\s+\S/.test(l) && item !== null) { // continuation of an item
          if (nested) nested.items[nested.items.length - 1] += ' ' + l.trim();
          else item += ' ' + l.trim();
          i++; continue;
        }
        break;
      }
      flushItem();
      html.push(close(topOrdered));
      out.push(html.join(''));
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|\||-\s|\d+\.\s)/.test(lines[i])) buf.push(lines[i++].trim());
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  const html = out.join('\n');
  html.replace(/href="([^"]+)"/g, (m, h) => { links.push(h); return m; });
  return { html, headings, links };
}

module.exports = { render, esc, slugify };
