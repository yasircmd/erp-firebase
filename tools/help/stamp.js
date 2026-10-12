// Marks help pages as reviewed against the current code: renews each page's
// fingerprint and "reviewed" date, then rebuilds the site. Run it after
// updating a page for a change to its module (or confirming the page needs
// no change):
//   node tools/help/stamp.js <page> [<page> ...]    (page = file name without .md)
// docs/modules/HELP.md, decision 149.
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO, parsePage, fingerprint } = require('./lib');

const slugs = process.argv.slice(2);
if (!slugs.length) { console.error('Usage: node tools/help/stamp.js <page> [<page> ...]'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
slugs.forEach(slug => {
  const file = slug.replace(/\.md$/, '') + '.md', p = path.join(REPO, 'help', 'pages', file);
  if (!fs.existsSync(p)) { console.error('No page help/pages/' + file); process.exit(1); }
  const page = parsePage(file), fp = fingerprint(page);
  let text = fs.readFileSync(p, 'utf8');
  const set = (key, value) => {
    const re = new RegExp('^' + key + ':.*$', 'm');
    text = re.test(text) ? text.replace(re, key + ': ' + value) : text.replace(/^---\n/, '---\n' + key + ': ' + value + '\n');
  };
  set('reviewed', today); set('fingerprint', fp);
  fs.writeFileSync(p, text);
  console.log('help/pages/' + file + ': reviewed ' + today + ', fingerprint ' + fp);
});
require('./build');
