#!/usr/bin/env node
// The Technical Reference (owner, 2026-11-07; docs/modules/TECH_REFERENCE.md,
// Q419-Q422): the app's technical details for the firm's developers, built
// from the repository itself, so it cannot drift from the code.
//
//   buildTechRef()  -> { meta, catalogue, documents, issues }
//   toParts(ref)    -> { partId: JSON string } (each under Firestore's 1 MiB),
//                      written into the screens release beside the screens
//                      (tools/screen-release.js) and served by techRef.js.
//
// The catalogue (generated):
//   modules   from functions/src/moduleRegistry.js (rights, firm-only, baseline),
//             with their screen, the functions it calls, those functions'
//             files and data, their Help page, the design docs naming them,
//             the tests calling them;
//   functions from index.js and the file that defines each (the deploy's own
//             lazy-exports map, tools/build-lazy-exports.js), the screens and
//             tests that call it;
//   files     every functions/src file: its header comment, what it requires
//             and what requires it, its functions, its data;
//   data      every Firestore collection and RTDB path named in the code, who
//             reads and writes it, its .indexOn (database.rules.json);
//   screens, tests, deploy sets.
// The documents (written): CLAUDE.md, README, docs/*.md (the Architecture
// overview first), docs/modules/*.md, rendered.
//
//   node tools/techref/build.js            prints a summary and any issues
//   node tools/techref/build.js --json F   writes the whole reference to F
//   node tools/techref/build.js --parts F --commit C   writes the release parts (screen-release.js)
'use strict';
const fs = require('fs');
const path = require('path');
const md = require('./markdown');

const REPO = path.join(__dirname, '..', '..');
const FN = path.join(REPO, 'functions');
const rel = p => path.relative(REPO, p).split(path.sep).join('/');
const read = p => fs.readFileSync(p, 'utf8');
const exists = p => fs.existsSync(p);
const list = (dir, ext) => (exists(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort() : []);
const uniq = a => [...new Set(a)].sort();

// The first comment block of a file (its header), as plain lines.
function header(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length && (/^#!/.test(lines[i]) || /^\s*$/.test(lines[i]) || /^'use strict'/.test(lines[i]))) i++;
  if (/^\s*\/\*/.test(lines[i] || '')) {
    for (; i < lines.length; i++) { out.push(lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '')); if (/\*\//.test(lines[i])) break; }
  } else if (/^\s*<!--/.test(lines[i] || '')) {
    for (; i < lines.length; i++) { out.push(lines[i].replace(/^\s*(<!--)?\s*/, '').replace(/\s*-->\s*$/, '')); if (/-->/.test(lines[i])) break; }
  } else {
    for (; i < lines.length && /^\s*\/\//.test(lines[i]); i++) out.push(lines[i].replace(/^\s*\/\/\s?/, ''));
  }
  return out.join('\n').trim();
}

// Data paths a source names: Firestore collections and RTDB refs (literal
// strings only; the first path segment, or two for well-known parents).
function dataPaths(text, constants) {
  const fsCols = [], rtdb = [];
  text.replace(/\.collection\(\s*['"]([A-Za-z0-9_]+)['"]/g, (m, c) => { fsCols.push(c); return m; });
  // A transaction store's own collection (docStore.js: { collection: 'name', ... }).
  text.replace(/\bcollection:\s*['"]([A-Za-z0-9_]+)['"]/g, (m, c) => { fsCols.push(c); return m; });
  // collection(SOME_CONSTANT) / collection(mod.SOME_CONSTANT): the constant's value where the code defines one.
  text.replace(/\.collection\(\s*(?:[A-Za-z_$][\w$]*\.)?([A-Z][A-Z0-9_]+)\s*\)/g, (m, c) => { if (constants && constants[c]) fsCols.push(constants[c]); return m; });
  text.replace(/\.doc\(\s*['"]([A-Za-z0-9_]+)\/[^'"]*['"]/g, (m, c) => { fsCols.push(c); return m; });
  text.replace(/\bref\(\s*['"]([A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)?)[\/'"]/g, (m, c) => { rtdb.push(c.split('/')[0] === 'stock' || c.split('/')[0] === 'openingBalances' ? c : c.split('/')[0]); return m; });
  return { firestore: uniq(fsCols), rtdb: uniq(rtdb) };
}

function loadFunctions() {
  const { buildMap } = require('../build-lazy-exports');
  const { map, missing } = buildMap();
  return { map, missing };
}

function buildTechRef() {
  const issues = [];
  const { MODULE_REGISTRY, DEFAULT_PERMISSIONS } = require(path.join(FN, 'src/moduleRegistry.js'));
  const { BASELINE_MODULES } = require(path.join(FN, 'src/moduleBaseline.js'));
  const portModules = JSON.parse(read(path.join(REPO, 'tools/legacy-port/modules.json')));

  // ---- functions ----
  const { map: fnMap, missing } = loadFunctions();
  missing.forEach(n => issues.push('function ' + n + ': its defining file was not found'));
  const fnNames = Object.keys(fnMap).concat(missing).sort();
  const functions = {};
  fnNames.forEach(n => { functions[n] = { name: n, file: fnMap[n] ? 'functions/' + fnMap[n][0].replace(/^\.\//, '') : '', exportedAs: fnMap[n] ? fnMap[n][1] : '', screens: [], tests: [] }; });
  // A name is "called" where it appears as .name( or 'name' / "name" — screens and tests.
  const calls = text => fnNames.filter(n => text.includes(n) && new RegExp('[.\'"]' + n + '[\'"(]').test(text));

  // ---- files (functions/src) ----
  const srcFiles = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) srcFiles.push(p);
  });
  walk(path.join(FN, 'src'));
  // String constants (const NAME = 'value') anywhere in the source, for collection(NAME).
  const constants = {};
  srcFiles.forEach(p => read(p).replace(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*['"]([A-Za-z0-9_]+)['"]/g, (m, k, v) => { if (!(k in constants)) constants[k] = v; return m; }));
  const files = {};
  srcFiles.sort().forEach(p => {
    const text = read(p);
    const requires = uniq((text.match(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g) || [])
      .map(r => r.match(/['"]([^'"]+)['"]/)[1])
      .map(r => rel(path.resolve(path.dirname(p), r)).replace(/(\.js)?$/, '.js'))
      .filter(r => r.startsWith('functions/src/')));
    files[rel(p)] = { file: rel(p), header: header(text), lines: text.split('\n').length, requires, requiredBy: [], functions: [], data: dataPaths(text, constants),
      generated: /functions\/src\/legacy\//.test(rel(p)) };
  });
  Object.values(files).forEach(f => f.requires.forEach(r => { if (files[r]) files[r].requiredBy.push(f.file); }));
  Object.values(functions).forEach(fn => { if (files[fn.file]) files[fn.file].functions.push(fn.name); });

  // ---- data ----
  const rules = exists(path.join(REPO, 'database.rules.json')) ? read(path.join(REPO, 'database.rules.json')) : '';
  const indexOf = p => {
    const m = rules.match(new RegExp('"' + p.split('/').pop() + '"\\s*:\\s*\\{[^{}]*?"\\.indexOn"\\s*:\\s*(\\[[^\\]]*\\]|"[^"]*")'));
    return m ? m[1].replace(/[\[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean) : [];
  };
  const data = {};
  Object.values(files).forEach(f => {
    [['firestore', f.data.firestore], ['rtdb', f.data.rtdb]].forEach(([kind, ps]) => ps.forEach(p => {
      const key = kind + ':' + p;
      if (!data[key]) data[key] = { key, kind, path: p, files: [], indexOn: kind === 'rtdb' ? indexOf(p) : [] };
      data[key].files.push(f.file);
    }));
  });
  // Moved to Firestore (TRANSACTIONS_FIRESTORE.md): reached by their old RTDB path through movedPaths.js.
  const moved = require(path.join(FN, 'src/movedPaths.js')).PATHS || [];
  Object.values(data).forEach(d => { if (d.kind === 'rtdb' && moved.some(p => p === d.path || p.split('/')[0] === d.path)) d.movedToFirestore = true; });

  // ---- screens ----
  const screens = {};
  list(path.join(REPO, 'screens'), '.html').forEach(f => {
    const id = f.slice(0, -5);
    const text = read(path.join(REPO, 'screens', f));
    const called = calls(text);
    called.forEach(n => functions[n].screens.push(id));
    screens[id] = { id, file: 'screens/' + f, header: header(text), lines: text.split('\n').length, functions: called,
      generated: portModules.modules.includes(id) && !portModules.handScreens.includes(id) };
  });

  // ---- tests ----
  const tests = [];
  [['emulator', '.test.js'], ['ui', '.ui.js'], ['unit', '.test.js']].forEach(([kind, ext]) => list(path.join(FN, 'test', kind), ext).forEach(f => {
    const text = read(path.join(FN, 'test', kind, f));
    const called = calls(text);
    const id = kind + '/' + f;
    called.forEach(n => functions[n].tests.push(id));
    tests.push({ id, kind, file: 'functions/test/' + id, header: header(text), cases: (text.match(/\b(?:test|check)\(\s*['"`]/g) || []).length, functions: called });
  }));

  // ---- help pages and design docs ----
  const helpPages = list(path.join(REPO, 'help/pages'), '.md').map(f => {
    const text = read(path.join(REPO, 'help/pages', f));
    const mods = ((text.match(/^modules:\s*\[([^\]]*)\]/m) || [])[1] || '').split(',').map(s => s.trim()).filter(Boolean);
    return { page: f.slice(0, -3), modules: mods };
  });
  const docFiles = [['CLAUDE.md', 'Project instructions (CLAUDE.md)'], ['README.md', 'README']]
    .concat(['ARCHITECTURE.md'].concat(list(path.join(REPO, 'docs'), '.md').filter(f => f !== 'ARCHITECTURE.md')).map(f => ['docs/' + f, null]))
    .concat(list(path.join(REPO, 'docs/modules'), '.md').map(f => ['docs/modules/' + f, null]))
    .filter(([p]) => exists(path.join(REPO, p)));
  const documents = docFiles.map(([p, title]) => {
    const text = read(path.join(REPO, p));
    const r = md.render(text);
    const t = title || ((text.match(/^#\s+(.*)$/m) || [])[1]) || p;
    return { id: p, title: t, html: r.html, headings: r.headings.map(h => ({ level: h.level, text: h.text, id: h.id })), text: md.plain(text) };
  });
  if (!documents.some(d => d.id === 'docs/ARCHITECTURE.md')) issues.push('docs/ARCHITECTURE.md (the Architecture overview) is missing');

  // ---- modules ----
  const modules = MODULE_REGISTRY.map(m => {
    const screen = screens[m.id];
    const fns = screen ? screen.functions : [];
    // Its own functions: those few screens call (a shared reader like getActiveCompanies is called by dozens).
    const own = fns.filter(n => functions[n].screens.length <= 3);
    const fnFiles = uniq(own.map(n => functions[n].file).filter(Boolean));
    // Its files' data, and the data of the transaction stores they use (stockStore.js, salesStore.js...).
    const dataFiles = uniq(fnFiles.concat(fnFiles.flatMap(f => (files[f] ? files[f].requires.filter(r => /Store\.js$/.test(r)) : []))));
    const fsData = uniq(dataFiles.flatMap(f => (files[f] ? files[f].data.firestore.map(c => 'firestore:' + c) : [])));
    const rtData = uniq(dataFiles.flatMap(f => (files[f] ? files[f].data.rtdb.map(c => 'rtdb:' + c) : [])));
    const word = new RegExp('(^|[^A-Z0-9_])' + m.id + '([^A-Z0-9_]|$)');
    const docs = documents.filter(d => d.id.startsWith('docs/modules/') && word.test(d.text)).map(d => d.id);
    return {
      id: m.id, label: m.label, capabilities: m.capabilities || [], defaults: DEFAULT_PERMISSIONS[m.id] || {},
      firmOnly: !!m.homeOnly, clientOnly: !!m.clientOnly, internal: !!m.internal, baseline: BASELINE_MODULES.includes(m.id),
      screen: screen ? screen.file : '', screenGenerated: screen ? screen.generated : false, functions: fns, ownFunctions: own, files: fnFiles, data: fsData.concat(rtData),
      help: helpPages.filter(h => h.modules.includes(m.id)).map(h => h.page), docs,
      // The tests of the functions only this screen calls; else those of its own functions.
      tests: uniq(tests.filter(t => { const b = t.id.split('/')[1].split('.')[0].toLowerCase(); return b === m.id.toLowerCase() || fnFiles.some(f => path.basename(f, '.js').toLowerCase() === b); }).map(t => t.id)
        .concat((own.some(n => functions[n].screens.length === 1) ? own.filter(n => functions[n].screens.length === 1) : own).flatMap(n => functions[n].tests)))
    };
  });
  modules.forEach(m => { if (!m.screen) issues.push('module ' + m.id + ' has no screen'); });
  Object.keys(screens).forEach(id => { if (!MODULE_REGISTRY.some(m => m.id === id)) issues.push('screen ' + id + ' is in no module'); });

  // ---- deploy sets ----
  const deploySets = list(path.join(REPO, 'tools/deploy-sets'), '.txt').map(f => {
    const lines = read(path.join(REPO, 'tools/deploy-sets', f)).split('\n');
    return { id: f.slice(0, -4), about: lines.filter(l => /^#/.test(l)).map(l => l.replace(/^#\s?/, '')).join(' ').trim(), count: lines.filter(l => l.trim() && !/^#/.test(l)).length };
  }).reverse();

  return {
    meta: { builtAt: new Date().toISOString(), counts: { modules: modules.length, functions: fnNames.length, files: Object.keys(files).length, data: Object.keys(data).length,
      screens: Object.keys(screens).length, tests: tests.length, documents: documents.length, deploySets: deploySets.length } },
    catalogue: { modules, functions: Object.values(functions), files: Object.values(files), data: Object.values(data), screens: Object.values(screens), tests, deploySets },
    documents, issues
  };
}

// The parts written to the release: each catalogue section, the documents'
// list and search text, and one part per document. Firestore keeps up to
// 1 MiB a document; a part that would be larger is refused.
const PART_LIMIT = 900 * 1024;
const SEARCH_CHUNK = 500 * 1024;
function toParts(ref, commit) {
  const parts = {};
  Object.keys(ref.catalogue).forEach(k => { parts['cat_' + k] = JSON.stringify(ref.catalogue[k]); });
  // The documents' text for the search, in parts under the limit.
  let chunk = [], n = 0, size = 0;
  const flushSearch = () => { if (chunk.length) { parts['search' + n++] = JSON.stringify(chunk); chunk = []; size = 0; } };
  ref.documents.forEach(d => {
    const s = JSON.stringify({ id: d.id, text: d.text }).length;
    if (size + s > SEARCH_CHUNK) flushSearch();
    chunk.push({ id: d.id, text: d.text }); size += s;
  });
  flushSearch();
  ref.documents.forEach((d, i) => { parts['doc' + String(i).padStart(3, '0')] = JSON.stringify({ id: d.id, title: d.title, html: d.html, headings: d.headings }); });
  parts.meta = JSON.stringify(Object.assign({ commit: commit || '' }, ref.meta, { issues: ref.issues,
    searchParts: Object.keys(parts).filter(k => /^search\d+$/.test(k)),
    documents: ref.documents.map((d, i) => ({ id: d.id, title: d.title, part: 'doc' + String(i).padStart(3, '0'), headings: d.headings })) }));
  const big = Object.keys(parts).filter(k => Buffer.byteLength(parts[k], 'utf8') > PART_LIMIT);
  if (big.length) throw new Error('Technical Reference parts too large for Firestore: ' + big.join(', '));
  return parts;
}

module.exports = { buildTechRef, toParts, header, dataPaths, PART_LIMIT };

if (require.main === module) {
  const ref = buildTechRef();
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(ref));
  const parts = toParts(ref, arg('--commit'));
  // For the screens release (tools/screen-release.js): the parts, only when the reference is complete.
  if (arg('--parts') && !ref.issues.length) fs.writeFileSync(arg('--parts'), JSON.stringify(parts));
  console.log('Technical Reference: ' + Object.entries(ref.meta.counts).map(([k, v]) => v + ' ' + k).join(', ') + '; ' + Object.keys(parts).length + ' parts, largest ' +
    Math.round(Math.max(...Object.values(parts).map(p => Buffer.byteLength(p, 'utf8'))) / 1024) + ' KB');
  if (ref.issues.length) { console.log('Issues:\n  ' + ref.issues.join('\n  ')); process.exitCode = 1; }
}
