// The Technical Reference (owner, 2026-11-07; docs/modules/TECH_REFERENCE.md,
// Q421): built from the repository on every release; the Deploy workflow
// runs this and refuses a release whose reference can't account for the
// code (a function without its file, a module without its screen, a screen
// in no module, the Architecture overview missing, a part too large).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildTechRef, toParts, header, dataPaths, PART_LIMIT } = require('../../../tools/techref/build');

const ref = buildTechRef();
const byId = (list, key, v) => list.find(x => x[key] === v);

test('the reference accounts for the code: no issues', () => {
  assert.deepEqual(ref.issues, []);
});

test('every function and module is in the catalogue, linked', () => {
  const index = require(path.join(__dirname, '../../index.js'));
  assert.equal(ref.catalogue.functions.length, Object.keys(index).length);
  ref.catalogue.functions.forEach(f => assert.match(f.file, /^functions\/src\/.+\.js$/, f.name));
  const { MODULE_REGISTRY } = require('../../src/moduleRegistry');
  assert.deepEqual(ref.catalogue.modules.map(m => m.id).sort(), MODULE_REGISTRY.map(m => m.id).sort());
  // One module followed through: its screen, its own functions, their file, its data, its docs and tests.
  const cjv = byId(ref.catalogue.modules, 'id', 'CJV');
  assert.equal(cjv.screen, 'screens/CJV.html');
  assert.ok(cjv.ownFunctions.includes('saveCorrectionJvDraft'));
  assert.ok(cjv.files.includes('functions/src/correctionJv.js'));
  assert.ok(cjv.data.includes('firestore:journalEntries'), 'a collection named through a constant');
  assert.deepEqual(cjv.help, ['correction-jv']);
  assert.ok(cjv.docs.includes('docs/modules/CORRECTION_JV.md'));
  assert.ok(cjv.tests.includes('emulator/correctionJv.emulator.test.js') && cjv.tests.includes('ui/correctionJv.ui.js'));
  const fn = byId(ref.catalogue.functions, 'name', 'postJournalEntry');
  assert.equal(fn.file, 'functions/src/journal.js');
  assert.ok(['JV', 'CBT', 'CJV'].every(s => fn.screens.includes(s)));
  const gl = byId(ref.catalogue.files, 'file', 'functions/src/glWriting.js');
  assert.ok(gl.requiredBy.includes('functions/src/journal.js'));
  assert.match(byId(ref.catalogue.files, 'file', 'functions/src/correctionJv.js').header, /^Correction JV \(CJV\)/, 'a file\'s header comment');
  const rec = byId(ref.catalogue.data, 'key', 'rtdb:recurringJournals');
  assert.deepEqual(rec.indexOn, ['Status'], 'the RTDB index from database.rules.json');
  assert.ok(byId(ref.catalogue.modules, 'id', 'DEVELOPER').firmOnly);
});

test('the documents: the Architecture overview first after the project files, every design doc rendered', () => {
  const ids = ref.documents.map(d => d.id);
  assert.deepEqual(ids.slice(0, 3), ['CLAUDE.md', 'README.md', 'docs/ARCHITECTURE.md']);
  assert.ok(ids.includes('docs/modules/CORRECTION_JV.md'));
  const readme = byId(ref.documents, 'id', 'README.md');
  assert.match(readme.html, /<pre><code>/, 'fenced code kept');
  assert.doesNotMatch(readme.html, /```/);
});

test('the release parts: each under the limit, every document and section in one', () => {
  const parts = toParts(ref, 'abc1234');
  const meta = JSON.parse(parts.meta);
  assert.equal(meta.commit, 'abc1234');
  assert.equal(meta.documents.length, ref.documents.length);
  meta.documents.forEach(d => assert.equal(JSON.parse(parts[d.part]).id, d.id));
  ['modules', 'functions', 'files', 'data', 'screens', 'tests', 'deploySets'].forEach(k => assert.ok(parts['cat_' + k], k));
  Object.entries(parts).forEach(([k, v]) => assert.ok(Buffer.byteLength(v, 'utf8') <= PART_LIMIT, k));
  const searched = Object.keys(parts).filter(k => /^search\d+$/.test(k)).flatMap(k => JSON.parse(parts[k]).map(x => x.id));
  assert.deepEqual(searched.sort(), ref.documents.map(d => d.id).sort());
});

test('the extraction helpers', () => {
  assert.equal(header("'use strict';\n// One.\n// Two.\nconst x = 1;"), 'One.\nTwo.');
  assert.equal(header('<!-- A screen.\n     More. -->\n<div>'), 'A screen.\nMore.');
  assert.deepEqual(dataPaths("firestore.collection('quotations'); rtdb.ref('coa/' + id); rtdb.ref('stock/ledger'); x.collection(COL)", { COL: 'bankDetails' }),
    { firestore: ['bankDetails', 'quotations'], rtdb: ['coa', 'stock/ledger'] });
});
