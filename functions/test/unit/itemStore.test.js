// The item store, step 1 (docs/modules/ITEMS_FIRESTORE.md, QI1): a document
// reads only its own items. These readers must never read the whole
// catalogue again (21 MB and about 2 s at 50,000 items).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lineItemIds } = require('../../src/itemStore');

const SRC = path.join(__dirname, '../../src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const WHOLE = /ref\('items'\)\.(get|once)\(|firebaseDbRequest_\('items', 'get'/;

// Hand-written document readers: no whole read anywhere in the file.
const FILES = ['grn.js', 'materialIssue.js', 'stockAdjustment.js', 'warehouseMovement.js', 'purchaseReturn.js', 'salesReturn.js',
  'purchaseTax.js', 'salesTax.js', 'budgetCheck.js', 'productionPosting.js', 'builtActions.js'];
// Ported document readers (patched): no whole read in the function.
const PORTED = ['saveBom', 'saveProductionDraft', 'commitProductionPosting_', 'reverseProduction', 'saveDeliveryNoteDraft', 'commitDeliveryNotePosting_',
  'reverseDeliveryNote', 'savePhysicalCountDraft', 'postPhysicalCount', 'commitPhysicalCountPosting_', 'reversePhysicalCount',
  'saveDraftInventoryPurchaseRequisition', 'savePriceListLine', 'saveDraftSalesOrder', 'confirmSalesOrder', 'claimStockForSalesOrderLine',
  'saveDraftJobOrderBatch', 'saveDraftPurchaseOrder', 'commitVendorInvoicePosting_', 'executeVendorInvoiceReversal_'];

test('the document readers never read the whole catalogue', () => {
  assert.deepEqual(FILES.filter(f => WHOLE.test(read(f))), []);
  const code = read('legacy/codegs.js');
  const body = fn => { const i = code.indexOf('\nasync function ' + fn + '('); assert.ok(i >= 0, fn); return code.slice(i, code.indexOf('\n}\n', i)); };
  assert.deepEqual(PORTED.filter(fn => WHOLE.test(body(fn))), []);
  // quotations.js: its documents (priced, orderForRep) by code; its portal price list is a picker (step 2).
  const q = read('quotations.js');
  assert.equal((q.match(/ref\('items'\)\.get\(/g) || []).length, 1);
  assert.match(q.slice(q.indexOf('async function portalQuoteItems(')), /^async function portalQuoteItems\([\s\S]*?ref\('items'\)\.get\(/);
});

test('the ids a document\'s lines name: each once, none blank, none a path', () => {
  assert.deepEqual(lineItemIds([{ ItemID: 'I1' }, { ItemID: 'I2' }, { ItemID: 'I1' }, { ItemID: '' }, {}, null, { CategoryID: 'C1' }]), ['I1', 'I2']);
  assert.deepEqual(lineItemIds({ a: { ItemID: ' I3 ' } }), ['I3'], 'lines kept as an object, trimmed');
  assert.deepEqual(lineItemIds([{ ItemID: 'a/b' }, { ItemID: 'x.y' }, { ItemID: 'ok' }]), ['ok'], 'never a path or an invalid key');
});
