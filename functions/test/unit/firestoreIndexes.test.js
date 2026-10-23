// Firestore composite indexes (owner, 2026-10-23): a query that filters on
// one field and sorts on another needs one, and a client corporate's project
// has only what firestore.indexes.json gives it (the emulators do not check).
// Every orderBy in the functions is listed here with the query it serves, and
// the file must have an index that serves it; the rules release deploys the
// file to this project and to every client corporate (docs/ONBOARDING.md).
//   node --test functions/test/unit/firestoreIndexes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const INDEXES = JSON.parse(read('firestore.indexes.json')).indexes;

// The journal lists: VoucherType and CompanyID (== or in), newest first.
const JOURNAL_LIST = { collection: 'journalEntries', equality: ['VoucherType', 'CompanyID'], order: [['CreatedAt', 'DESCENDING']] };
// Each sorted query in functions/src: the file, a piece of the line, the query.
const SORTED = [
  { file: 'journal.js', has: "orderBy('CreatedAt', 'desc')", query: JOURNAL_LIST },
  { file: 'journal.js', has: "firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, where, [['CreatedAt', 'DESCENDING']]", query: JOURNAL_LIST },
  { file: 'journal.js', has: "firestoreQuery_(FIRESTORE_JOURNAL_ENTRIES_COLLECTION, narrowed, [['CreatedAt', 'DESCENDING']]", query: JOURNAL_LIST },
  // The firm's Support queue, sorted with no filter: a single-field index.
  { file: 'support.js', has: "collection(ISSUES).orderBy('UpdatedAt', 'desc')", query: { collection: 'supportIssues', equality: [], order: [['UpdatedAt', 'DESCENDING']] } }
];

// An index serves the query when its fields are the query's equality fields
// (in any order), then its sort fields in their directions. A sort on one
// field with no filter is served by Firestore's own single-field index.
function served(indexes, q) {
  if (!q.equality.length && q.order.length === 1) return true;
  return indexes.some(ix => {
    if (ix.collectionGroup !== q.collection || ix.queryScope !== 'COLLECTION') return false;
    const f = ix.fields;
    if (f.length !== q.equality.length + q.order.length) return false;
    const eq = f.slice(0, q.equality.length);
    const sorted = f.slice(q.equality.length);
    return eq.every(x => q.equality.includes(x.fieldPath)) && new Set(eq.map(x => x.fieldPath)).size === q.equality.length &&
      sorted.every((x, i) => x.fieldPath === q.order[i][0] && x.order === q.order[i][1]);
  });
}

// Every line in functions/src (not the legacy runtime, which only defines the
// helper) that sorts a Firestore query.
function sortedQueries() {
  const dir = path.join(REPO, 'functions/src');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, path.join(dir, f)])
    .concat(fs.readdirSync(path.join(dir, 'legacy')).filter(f => f.endsWith('.js') && f !== 'runtime.js').map(f => ['legacy/' + f, path.join(dir, 'legacy', f)]));
  const found = [];
  files.forEach(([name, file]) => fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const sorts = /\.orderBy\(/.test(line) || /firestoreQuery_\([^,]+,[^,]+,\s*\[\[/.test(line);
    if (sorts && !/^\s*\/\//.test(line)) found.push({ file: name, line: i + 1, text: line.trim() });
  }));
  return found;
}

test('every sorted Firestore query in the functions is listed here', () => {
  const found = sortedQueries();
  assert.ok(found.length >= 5, 'found the sorted queries: ' + found.length);
  const unlisted = found.filter(q => !SORTED.some(s => s.file === q.file && q.text.includes(s.has))).map(q => q.file + ':' + q.line + ' ' + q.text);
  assert.deepEqual(unlisted, [], 'add each to SORTED with its query, and its index to firestore.indexes.json');
});

test('firestore.indexes.json serves every sorted query', () => {
  const missing = SORTED.filter(s => !served(INDEXES, s.query)).map(s => s.file + ': ' + JSON.stringify(s.query));
  assert.deepEqual(missing, [], 'add a composite index for each');
});

test('the check knows what an index serves', () => {
  const ix = [{ collectionGroup: 'c', queryScope: 'COLLECTION', fields: [{ fieldPath: 'A', order: 'ASCENDING' }, { fieldPath: 'B', order: 'ASCENDING' }, { fieldPath: 'T', order: 'DESCENDING' }] }];
  assert.equal(served(ix, { collection: 'c', equality: ['B', 'A'], order: [['T', 'DESCENDING']] }), true, 'equality fields in any order');
  assert.equal(served(ix, { collection: 'c', equality: ['A', 'B'], order: [['T', 'ASCENDING']] }), false, 'the wrong direction');
  assert.equal(served(ix, { collection: 'c', equality: ['A'], order: [['T', 'DESCENDING']] }), false, 'a missing field');
  assert.equal(served(ix, { collection: 'd', equality: ['A', 'B'], order: [['T', 'DESCENDING']] }), false, 'another collection');
  assert.equal(served([], { collection: 'c', equality: [], order: [['T', 'DESCENDING']] }), true, 'one sort, no filter');
});

test('the rules release deploys the indexes, here and to every client, which grants the right to', () => {
  assert.equal(JSON.parse(read('firebase.json')).firestore.indexes, 'firestore.indexes.json');
  assert.match(read('tools/deploy-rules.sh'), /--only database,firestore:rules,firestore:indexes,storage/);
  assert.match(read('tools/release-corporates.js'), /'database,firestore:rules,firestore:indexes'/);
  assert.match(read('docs/ONBOARDING.md'), /roles\/datastore\.indexAdmin/);
});
