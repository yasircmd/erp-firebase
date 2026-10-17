// No reader downloads every stock transaction (docs/modules/
// TRANSACTIONS_FIRESTORE.md, T1a and T1c): each asks stockStore for what it
// needs (queryTx, getTx, getTxs). The few that must see everything are
// listed here with their reason; a new whole-collection read fails this
// test until it is narrowed or listed.
//   node --test functions/test/unit/stockReads.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '../../src');

// file: why it reads every stock transaction (or the whole ledger).
const ALLOWED = {
  'coaUsage.js': 'whether an account was ever used: every document, by nature',
  'stockStore.js': 'allTx itself, and the RTDB-path adapter (Data Reset clears and counts through it)'
};
// Ported reports that read the whole running-balance ledger (one small
// entry per item and warehouse), which they show in full.
const LEDGER_WHOLE = ['getStockValuationReport', 'getStockAvailabilityList'];

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).concat(['legacy/codegs.js']);
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

test('no hand-written reader downloads every stock transaction', () => {
  const found = [];
  files.forEach(f => {
    const s = read(f);
    if (ALLOWED[f]) return;
    if (/stockStore\.allTx\(\)/.test(s)) found.push(f + ': stockStore.allTx()');
    if (/rtdb\.ref\(['`]stock\/(transactions|ledger)['`]\)\.get\(\)/.test(s)) found.push(f + ': rtdb stock read');
  });
  assert.deepEqual(found, [], 'narrow the read with stockStore.queryTx / getTx / getTxs, or list it in ALLOWED with its reason');
});

test('no ported function downloads every stock transaction; only the listed ones read the whole ledger', () => {
  const s = read('legacy/codegs.js');
  const fnAt = i => (s.slice(0, i).match(/(?:async )?function (\w+)\(/g) || []).pop().replace(/(async )?function |\(/g, '');
  const tx = [...s.matchAll(/firebaseDbRequest_\('stock\/transactions', 'get'/g)].map(m => fnAt(m.index));
  assert.deepEqual(tx, [], 'a ported function reads every stock transaction: patch it to queryStockTx_ (tools/legacy-port/patches.js)');
  const ledger = [...s.matchAll(/firebaseDbRequest_\('stock\/ledger', 'get'/g)].map(m => fnAt(m.index));
  assert.deepEqual(ledger.sort(), LEDGER_WHOLE.slice().sort());
});
