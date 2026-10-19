// No reader downloads a whole moved collection (docs/modules/
// TRANSACTIONS_FIRESTORE.md: T2 Sales Orders, Customer Invoices,
// reservations; T3 Vendor Invoices, Purchase Orders, requisitions; T4
// Job Orders, PDCs; T5 approval instances): each
// asks its store / movedPaths for what it needs (query, where, whereAny,
// get, getMany). Stock transactions: stockReads.test.js. The
// few that must see everything are listed here with their reason; a new
// whole-collection read fails this test until it is narrowed or listed.
//   node --test functions/test/unit/movedReads.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '../../src');

const PATHS = ['salesOrders', 'customerInvoices', 'stock/reservations', 'vendorInvoices', 'purchaseOrders', 'purchaseRequisitions', 'inventoryPurchaseRequisitions',
  'jobOrderBatches', 'jobOrderLines', 'pdcCheques', 'approvalInstances'];
// file: why it reads a whole moved collection (store.all()).
const ALLOWED = {
  'coaUsage.js': 'whether an account was ever used: every document, by nature',
  'coaRenumber.js': 'every stored copy of a renumbered account\'s code is rewritten',
  'docStore.js': 'all() itself, and the RTDB-path adapter (Data Reset clears and counts through it)',
  'movedPaths.js': 'where() on a collection still in RTDB reads it whole, as before'
};
// Ported lists that show every document the user's companies hold, newest
// first (the company filter is a user's list of companies, not one value).
const PORTED_WHOLE = {
  customerInvoices: ['getCustomerInvoiceEntries'], salesOrders: ['getSalesOrderEntries'], 'stock/reservations': [],
  vendorInvoices: ['getVendorInvoiceEntries'], purchaseOrders: ['getPurchaseOrderEntries'],
  purchaseRequisitions: ['getPurchaseRequisitionEntries'], inventoryPurchaseRequisitions: ['getInventoryPurchaseRequisitionEntries'],
  // Production's batch picker reads every batch only when no company is given.
  jobOrderBatches: ['getJobOrderBatches', 'getJobOrderLinesFlat', 'getEligibleJobOrderBatchesForProduction'], jobOrderLines: ['getJobOrderLinesFlat'], pdcCheques: [],
  // The Approval Tracker reads every approval only when no module is chosen.
  approvalInstances: ['getApprovalHistory']
};

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

test('no hand-written reader downloads a whole moved collection', () => {
  const found = [];
  files.forEach(f => {
    if (ALLOWED[f]) return;
    const s = read(f);
    PATHS.forEach(p => {
      if (new RegExp("rtdb\\.ref\\(['`]" + p.replace('/', '\\/') + "['`]\\)").test(s)) found.push(f + ': rtdb ' + p);
      if (new RegExp("val\\(['`]" + p.replace('/', '\\/') + "['`]\\)").test(s)) found.push(f + ': val(' + p + ')');
    });
    if (/\b(salesOrders|customerInvoices|reservations|vendorInvoices|purchaseOrders|purchaseRequisitions|inventoryPurchaseRequisitions|jobOrderBatches|jobOrderLines|pdcCheques|approvalInstances|moved|store)\.all\(\)/.test(s)) found.push(f + ': all()');
  });
  assert.deepEqual(found, [], 'narrow the read with the store\'s query / get / getMany or movedPaths.where, or list it in ALLOWED with its reason');
});

test('the RTDB paths are not read by the hand-written code at all: they are in Firestore', () => {
  const found = [];
  files.forEach(f => {
    const s = read(f);
    PATHS.forEach(p => { if (new RegExp("rtdb\\.ref\\(['`]" + p.replace('/', '\\/') + "\\/").test(s)) found.push(f + ': ' + p + '/…'); });
  });
  assert.deepEqual(found, []);
});

test('only the listed ported lists read a whole moved collection', () => {
  const s = read('legacy/codegs.js');
  const fnAt = i => (s.slice(0, i).match(/(?:async )?function (\w+)\(/g) || []).pop().replace(/(async )?function |\(/g, '');
  PATHS.forEach(p => {
    const at = [...s.matchAll(new RegExp("firebaseDbRequest_\\('" + p.replace('/', '\\/') + "', 'get'", 'g'))].map(m => fnAt(m.index));
    assert.deepEqual(at.sort(), PORTED_WHOLE[p].slice().sort(), p + ': patch it to queryMovedAny_ / getMovedMany_ (tools/legacy-port/patches.js), or list it');
  });
});
