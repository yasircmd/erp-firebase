// Lists globals a ported screen uses that the OLD Index.html defined but
// the new public/index.html does not, plus element IDs it reads that
// neither it nor the shell defines.
const fs = require('fs'), path = require('path');
const GAS = process.argv[2]; const mods = require('./modules.json').modules;
const oldIdx = fs.readFileSync(path.join(GAS, 'Index.html'), 'utf8');
const newIdx = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const defs = s => new Set([...s.matchAll(/function\s+(\w+)\s*\(|window\.(\w+)\s*=|^\s{0,6}(?:const|let|var)\s+(\w+)\s*=/gm)].map(m => m[1] || m[2] || m[3]));
const od = defs(oldIdx), nd = defs(newIdx);
const ids = s => new Set([...s.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
const shellIds = ids(newIdx);
for (const m of mods) {
  const s = fs.readFileSync(path.join(__dirname, '../../screens', m + '.html'), 'utf8');
  const own = defs(s); const ownIds = ids(s);
  const missing = [...od].filter(x => !nd.has(x) && !own.has(x) && x.length > 3 && new RegExp('(^|[^.\\w])' + x + '\\s*\\(').test(s));
  const badIds = [...new Set([...s.matchAll(/getElementById\('([\w-]+)'\)/g)].map(x => x[1]))].filter(i => !ownIds.has(i) && !shellIds.has(i));
  console.log(m.padEnd(30), missing.length ? 'MISSING GLOBALS: ' + missing.join(',') : 'globals ok', badIds.length ? '| unknown ids: ' + badIds.join(',') : '');
}
