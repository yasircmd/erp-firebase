#!/usr/bin/env node
// Lazy loading (docs/modules/PERFORMANCE.md, P2): which module each function
// lives in, so a function's instance loads only that module when it starts,
// not the whole codebase (index.js, the top).
//
// Run at every functions deploy (firebase.json, "predeploy"), on the very
// source being deployed, so the map can't be out of date. Writes
// functions/lazy-exports.json (not committed: .gitignore).
//
// How: load index.js as it is (every function), then find, for each export,
// a module under functions/src that exports the very same function object.
// A function not found stays out of the map: its instance loads everything,
// as before (slower, still correct).
//   node tools/build-lazy-exports.js            writes the map
//   node tools/build-lazy-exports.js --check    builds it and reports only
const path = require('path');
const fs = require('fs');

const FUNCTIONS = path.join(__dirname, '..', 'functions');
const OUT = path.join(FUNCTIONS, 'lazy-exports.json');

function buildMap() {
  // Loading index.js only defines the functions; nothing reaches a database.
  if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = 'lazy-exports-build';
  const index = require(path.join(FUNCTIONS, 'index.js'));
  const src = path.join(FUNCTIONS, 'src') + path.sep;
  const owners = new Map(); // function object -> every [relative file, key] exporting it
  Object.keys(require.cache).filter(f => f.startsWith(src)).sort().forEach(file => {
    const ex = require.cache[file].exports;
    if (!ex || typeof ex !== 'object') return;
    const rel = './' + path.relative(FUNCTIONS, file).split(path.sep).join('/');
    Object.keys(ex).forEach(key => {
      const v = ex[key];
      if (typeof v !== 'function') return;
      if (!owners.has(v)) owners.set(v, []);
      owners.get(v).push([rel, key]);
    });
  });
  const map = {};
  const missing = [];
  Object.keys(index).sort().forEach(name => {
    const all = owners.get(index[name]);
    if (!all) { missing.push(name); return; }
    // Its own name first (in path order), else the first module exporting it.
    map[name] = all.find(o => o[1] === name) || all[0];
  });
  return { map, missing, count: Object.keys(index).length };
}

if (require.main === module) {
  const { map, missing, count } = buildMap();
  if (!process.argv.includes('--check')) fs.writeFileSync(OUT, JSON.stringify(map) + '\n');
  console.log('lazy exports: ' + Object.keys(map).length + ' of ' + count + ' functions mapped' +
    (missing.length ? '; loading everything (as before): ' + missing.join(', ') : '') +
    (process.argv.includes('--check') ? ' (check only)' : ' -> functions/lazy-exports.json'));
}

module.exports = { buildMap, OUT };
