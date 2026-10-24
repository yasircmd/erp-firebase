// Data Reset covers every module (owner, 2026-10-24; docs/modules/DATA_RESET.md):
// every RTDB path and Firestore collection the functions write is cleared by
// a category, or is one Data Reset never offers. A new module's store fails
// here until it is given a category (functions/src/dataReset.js) or listed
// as never offered, so it can't be forgotten again.
//   node --test functions/test/unit/dataResetCoverage.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CATEGORIES, USED_BY } = require('../../src/dataReset');

const SRC = path.join(__dirname, '../../src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).concat(['legacy/codegs.js']);

// Never offered: who may sign in and see what (users, roles, permissions,
// the menu and favourites), the firm's own stores, and system state.
const NEVER = ['users', 'roles', 'permissions', 'tree', 'userFavorites', 'approvalMigrations', 'appState', 'settings', 'system', 'screenReleases',
  'corporateDirectory', 'corporateGroups', 'corporateNotes', 'supportIssues', 'supportCounters', '__documentStorage'];

// Sub-collections, cleared with their documents (recursive delete): a
// payroll run's payslips, a request's or an issue's messages, the document
// storage connection's pending sign-ins.
const SUBCOLLECTIONS = ['slips', 'messages', 'pending'];

// The ported categories' paths (Code.gs DATA_RESET_CATEGORIES, as patched).
function portedPaths() {
  const code = read('legacy/codegs.js');
  const block = code.slice(code.indexOf('const DATA_RESET_CATEGORIES = {'), code.indexOf('...__dataReset.legacyShaped()'));
  return [...block.matchAll(/paths: \[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1].replace(/^firestore:/, '')));
}
const covered = new Set([].concat(
  portedPaths().map(p => p.split('/')[0]), portedPaths(),
  ...Object.values(CATEGORIES).map(c => [].concat(c.fs || [], c.rtdb || [], c.counters || [])),
  // An RTDB root whose paths are all cleared (payroll/counters).
  ...Object.values(CATEGORIES).map(c => [].concat(c.rtdb || [], c.counters || []).map(p => p.split('/')[0])),
  SUBCOLLECTIONS,
  // Moved RTDB paths are Firestore collections now (movedPaths.js).
  ['stockTransactions', 'stockLedger', 'stockReservations'], NEVER));

// The stores the functions name: Firestore collections and RTDB roots, by
// the forms this codebase uses.
function namedStores() {
  const found = {};
  const add = (name, file) => { if (name && !/^[A-Z_]/.test(name)) (found[name] = found[name] || new Set()).add(file); };
  files.forEach(f => {
    const s = read(f);
    for (const m of s.matchAll(/\.collection\(\s*'([a-zA-Z_]+)'/g)) add(m[1], f);
    for (const m of s.matchAll(/\b(?:fs|firestore): '([a-zA-Z_]+)'/g)) add(m[1], f);
    for (const m of s.matchAll(/\b(?:rtdb|db|ref)\.ref\(\s*['`]([a-zA-Z_]+)/g)) add(m[1], f);
    for (const m of s.matchAll(/\bfirebaseDbRequest_\(\s*['`]([a-zA-Z_]+)/g)) add(m[1], f);
    for (const m of s.matchAll(/\bfirestore(?:Get|Set|Update|Add|Delete|Query|Count)_\(\s*'([a-zA-Z_]+)'/g)) add(m[1], f);
    for (const m of s.matchAll(/\bcollection: '([a-zA-Z_]+)'/g)) add(m[1], f);
  });
  return found;
}

test('every store the functions name is cleared by a category, or is never offered', () => {
  const found = namedStores();
  assert.ok(Object.keys(found).length > 60, 'the scan finds the stores: ' + Object.keys(found).length);
  const missing = Object.keys(found).filter(n => !covered.has(n)).map(n => n + ' (' + [...found[n]].join(', ') + ')');
  assert.deepEqual(missing, [], 'give each a category in functions/src/dataReset.js, or add it to NEVER here');
});

test('every category clears something, and every dependency names a category', () => {
  const ported = ['glEntries', 'stockData', 'vendorInvoices', 'customerInvoices', 'openingBalanceBatches', 'boms', 'items', 'itemSubCategories', 'uoms', 'coa',
    'companies', 'orgUnits', 'salesTypes', 'pdcCheques', 'fixedAssets', 'fixedAssetSetup', 'recurringJournals', 'customerClassifications'];
  const keys = new Set(ported.concat(Object.keys(CATEGORIES)));
  Object.entries(CATEGORIES).forEach(([k, c]) => {
    assert.ok((c.fs || []).length + (c.rtdb || []).length > 0, k);
    assert.ok(['transactional', 'master', 'setup'].includes(c.group), k);
    (c.count || []).forEach(x => assert.ok((c.fs || []).concat(c.rtdb || []).includes(x), k + ' counts ' + x));
    assert.ok(!NEVER.some(n => (c.fs || []).concat(c.rtdb || []).includes(n)), k + ' clears a never-offered store');
  });
  Object.entries(USED_BY).forEach(([m, users]) => {
    assert.ok(keys.has(m), m);
    users.forEach(u => assert.ok(keys.has(u), m + ' <- ' + u));
  });
  // A master others use is never browsed one record at a time.
  Object.keys(USED_BY).filter(m => CATEGORIES[m]).forEach(m => assert.ok(!CATEGORIES[m].records, m));
});
