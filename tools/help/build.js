// Builds public/help/ (and public/robots.txt) from help/pages/*.md:
//   node tools/help/build.js
// Commit the result; the Deploy workflow's "Check help" step refuses a
// deploy when the built site is out of date or a page is behind its module
// (docs/modules/HELP.md, decision 149). Hosting publishes it.
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO, OUT_DIR, build } = require('./lib');

const files = build();
const dir = path.join(REPO, OUT_DIR);
fs.mkdirSync(dir, { recursive: true });
fs.readdirSync(dir).forEach(n => { if (!files[OUT_DIR + '/' + n]) fs.unlinkSync(path.join(dir, n)); });
Object.entries(files).forEach(([f, c]) => fs.writeFileSync(path.join(REPO, f), c));
console.log('Built ' + Object.keys(files).length + ' files into ' + OUT_DIR + ' (and public/robots.txt).');
