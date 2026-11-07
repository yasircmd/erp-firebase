// Markdown for the Technical Reference (docs/modules/TECH_REFERENCE.md):
// the Help's converter (tools/help/markdown.js) plus what the repository's
// documents use and the Help pages don't: "# " titles, ``` fenced code and
// "####" headings. A fenced block is kept verbatim (escaped) in <pre>.
'use strict';
const help = require('../help/markdown');

function render(md) {
  const out = [];
  const headings = [];
  let inCode = false;
  let buffer = '';
  const flush = () => {
    if (!buffer.trim()) { buffer = ''; return; }
    // "# Title" -> "## Title"; "####" -> "###" (the Help converter knows ## and ###).
    const text = buffer.replace(/^# (.*)$/gm, '## $1').replace(/^#{4,6} (.*)$/gm, '### $1');
    const r = help.render(text);
    out.push(r.html); headings.push(...r.headings);
    buffer = '';
  };
  String(md).replace(/\r\n/g, '\n').split('\n').forEach(line => {
    if (/^```/.test(line)) {
      if (inCode) { out.push('<pre><code>' + help.esc(buffer.replace(/\n$/, '')) + '</code></pre>'); buffer = ''; inCode = false; }
      else { flush(); inCode = true; }
      return;
    }
    buffer += line + '\n';
  });
  if (inCode) out.push('<pre><code>' + help.esc(buffer) + '</code></pre>'); else flush();
  return { html: out.join('\n'), headings };
}

// The plain text of a document, for the search.
const plain = md => String(md).replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>|]/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

module.exports = { render, plain, esc: help.esc };
