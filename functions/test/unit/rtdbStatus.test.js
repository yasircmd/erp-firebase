// Reading only the records with a given Status (functions/src/rtdbStatus.js):
// each path read that way has its Status index in database.rules.json
// (without it the database refuses the query: "Index not defined"), the
// rules stay deny-all, and a path without an index is refused before any
// read.
//   node --test functions/test/unit/rtdbStatus.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { STATUS_INDEXED_PATHS, withStatus } = require('../../src/rtdbStatus');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../database.rules.json'), 'utf8')).rules;
const nodeAt = p => p.split('/').reduce((n, k) => (n && n[k]) || null, rules);

test('every path read by Status has its Status index', () => {
  STATUS_INDEXED_PATHS.forEach(p => {
    const n = nodeAt(p);
    assert.ok(n && Array.isArray(n['.indexOn']) && n['.indexOn'].includes('Status'), p + ' has no .indexOn Status in database.rules.json');
  });
});

// And no index is left behind for a path no longer read that way: the
// eleven of the documents moved to Firestore (T1–T5) were removed
// 2026-10-24. Each index costs the database work on every write.
test('every Status index in the rules is one a path is read by', () => {
  const indexed = [];
  (function walk(n, at) {
    Object.keys(n).forEach(k => {
      if (k === '.indexOn') indexed.push(at);
      else if (n[k] && typeof n[k] === 'object' && !Array.isArray(n[k])) walk(n[k], at ? at + '/' + k : k);
    });
  })(rules, '');
  assert.deepEqual(indexed.sort(), [...STATUS_INDEXED_PATHS].sort(), 'an index in database.rules.json that no path in rtdbStatus.js uses');
});

test('the rules stay deny-all: an index opens nothing', () => {
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  const opened = [];
  (function walk(n, at) {
    Object.keys(n).forEach(k => {
      if ((k === '.read' || k === '.write') && at) opened.push(at + '/' + k);
      else if (n[k] && typeof n[k] === 'object' && !Array.isArray(n[k])) walk(n[k], at ? at + '/' + k : k);
    });
  })(rules, '');
  assert.deepEqual(opened, []);
});

test('a path without a Status index is refused', async () => {
  await assert.rejects(withStatus('customers', 'Active'), /No Status index for customers/);
});
