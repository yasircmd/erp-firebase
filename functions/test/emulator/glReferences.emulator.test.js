// GL references (owner, 2026-10-06; docs/modules/GL_REFERENCES.md,
// decisions 49-51): finance documents written through the shared posting
// path (Fixed Assets, PDC, Recurring Journal, Opening balances GL, Vendor
// and Customer Invoices) take the finance sequence TXN-, shared with
// Journal Vouchers and Cash & Bank; stock documents keep STK-; payroll
// keeps PRL-. Entries already posted keep their reference. Opening balance
// journals open in Opening Balances from the GL report.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, firestore, rtdb } = require('./_helpers');
const admin = require('firebase-admin');
// src/firebaseAdmin.js initializes the default app only when no app exists;
// _helpers has already made its own (and, loading stockStore, the default
// one too), so the default one is made here only if still missing.
if (!admin.apps.some(a => a.name === '[DEFAULT]')) admin.initializeApp({ projectId: 'erp1-8f4cd', databaseURL: 'https://erp1-8f4cd-default-rtdb.firebaseio.com' });
const { transactionRefFor } = require('../../src/glWriting');
const { moduleIdForEntry } = require('../../src/masterData');

test.after(async () => { await app.delete(); await Promise.all(admin.apps.map(a => a.delete())); });

const OD = '2025-12-31';
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const post = (kind, rows) => call('u-admin', 'postOpeningBalances', { kind, companyId: 'C1', text: tsv(rows) });
const doc = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const ok = r => { assert.equal(r.success, true, JSON.stringify(r)); return r; };
const GL_HEAD = ['Account', 'Debit', 'Credit', 'Description', 'Cost Center', 'Profit Center'];
const STOCK_HEAD = ['Item', 'Warehouse', 'Quantity', 'Unit Cost', 'Batch No', 'Expiry Date'];
const INV_HEAD = ['Party Type', 'Party', 'Document Type', 'Document No', 'Document Date', 'Due Date', 'Amount', 'Description'];

async function ready() {
  const f = baseFixture();
  f.vendors.V1.PaymentTermsDays = 30;
  f.coa['A-OBC'] = { AccountCode: '3900', AccountName: 'Opening Balance Clearing', AccountType: 'Equity', Status: 'Active', IsPostable: true };
  await reset(f);
  ok(await call('u-admin', 'saveOpeningBalanceSettings', { companyId: 'C1', openingDate: OD, clearingAccountId: 'A-OBC' }));
}

test('each voucher type takes its sequence: finance TXN- (shared with JV and CBT), stock STK-, payroll PRL-', async () => {
  await ready();
  await rtdb.ref('gl/transactionRefCounter').set(41);
  await rtdb.ref('stock/counters/transactionRef').set(7);
  const finance = ['FACapitalization', 'FADepreciation', 'FAAdditionalDepreciation', 'FARetirement', 'FAAuCCost', 'FAAuCSettlement',
    'PDCReceived', 'PDCReceivedClear', 'PDCIssued', 'PDCIssuedClear', 'RecurringJV', 'OpeningBalance', 'VendorInvoice', 'CustomerInvoice'];
  const stock = ['GRN', 'MaterialIssue', 'Production', 'WarehouseMovement', 'StockAdjustment', 'PhysicalCount', 'DeliveryNote',
    'PurchaseReturn', 'SalesReturn', 'OpeningStock'];
  const refs = [];
  for (const t of finance) refs.push(await transactionRefFor(t));
  assert.deepEqual(refs, finance.map((t, i) => 'TXN-' + String(42 + i).padStart(8, '0')));
  const stk = [];
  for (const t of stock) stk.push(await transactionRefFor(t));
  assert.deepEqual(stk, stock.map((t, i) => 'STK-' + String(8 + i).padStart(8, '0')));
  assert.match(await transactionRefFor('Payroll'), /^PRL-\d{8}$/);
  assert.equal(await val('gl/transactionRefCounter'), 41 + finance.length);
});

test('opening balances: the GL batch and open invoices take TXN- after Journal Vouchers\'; opening stock keeps STK-; their reversals follow', async () => {
  await ready();
  await rtdb.ref('gl/transactionRefCounter').set(5); // Journal Vouchers and Cash & Bank took TXN-1 to 5
  const txnBefore = 5;
  const gl = ok(await post('GL', [GL_HEAD, ['1000', '500', '', '', '', ''], ['3000', '', '200', '', '', '']]));
  const st = ok(await post('STOCK', [STOCK_HEAD, ['RM-001', 'WH1', '10', '15', '', '']]));
  const inv = ok(await post('INVOICES', [INV_HEAD, ['Vendor', 'V001', 'Invoice', 'P-1', '01/12/2025', '', '300', '']]));
  const glJv = await doc((await val('openingBalances/batches/' + gl.batchId)).JVIDs[0]);
  const stJv = await doc((await val('openingBalances/batches/' + st.batchId)).JVIDs[0]);
  const invJv = await doc((await val('openingBalances/batches/' + inv.batchId)).JVIDs[0]);
  assert.equal(glJv.TransactionRef, 'TXN-' + String(txnBefore + 1).padStart(8, '0'));
  assert.match(stJv.TransactionRef, /^STK-\d{8}$/);
  assert.match(invJv.TransactionRef, /^TXN-\d{8}$/);
  ok(await call('u-admin', 'reverseOpeningBalanceBatch', { batchId: gl.batchId }));
  ok(await call('u-admin', 'reverseOpeningBalanceBatch', { batchId: st.batchId }));
  const rg = await doc((await val('openingBalances/batches/' + gl.batchId)).ReversalJVIDs[0]);
  const rs = await doc((await val('openingBalances/batches/' + st.batchId)).ReversalJVIDs[0]);
  assert.match(rg.TransactionRef, /^TXN-\d{8}$/);
  assert.match(rs.TransactionRef, /^STK-\d{8}$/);
});

test('an entry already posted keeps its STK- reference (decision 51)', async () => {
  await ready();
  const gl = ok(await post('GL', [GL_HEAD, ['1000', '500', '', '', '', '']]));
  const id = (await val('openingBalances/batches/' + gl.batchId)).JVIDs[0];
  await firestore.collection('journalEntries').doc(id).update({ TransactionRef: 'STK-00000003' });
  ok(await post('GL', [GL_HEAD, ['1000', '20', '', '', '', '']]));
  assert.equal((await doc(id)).TransactionRef, 'STK-00000003');
});

test('the GL report sends opening balance journals to Opening Balances, which finds the batch; another company\'s user is refused', async () => {
  await ready();
  assert.equal(moduleIdForEntry({ VoucherType: 'OpeningBalance' }), 'OPENINGBALANCES');
  assert.equal(moduleIdForEntry({ VoucherType: 'OpeningStock' }), 'OPENINGBALANCES');
  const gl = ok(await post('GL', [GL_HEAD, ['1000', '500', '', '', '', '']]));
  const st = ok(await post('STOCK', [STOCK_HEAD, ['RM-001', 'WH1', '2', '15', '', '']]));
  const jvId = (await val('openingBalances/batches/' + gl.batchId)).JVIDs[0];
  const report = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-CASH', FromDate: OD, ToDate: OD } });
  assert.equal(report.rows.find(r => r.JVID === jvId).SourceModule, 'OPENINGBALANCES');
  assert.deepEqual(await call('u-admin', 'findOpeningBatch', { jvId }), { CompanyID: 'C1', BatchID: gl.batchId });
  // Journal Vouchers still refuses it with the module's message, not a missing post right on Opening Balances.
  const jr = await call('u-admin', 'reverseJournalEntry', { jvId, reversalDate: OD });
  assert.match(jr.error, /posted by OpeningBalance — reverse it from that module/);
  const stJv = (await val('openingBalances/batches/' + st.batchId)).JVIDs[0];
  assert.deepEqual(await call('u-admin', 'findOpeningBatch', { jvId: stJv }), { CompanyID: 'C1', BatchID: st.batchId });
  ok(await call('u-admin', 'reverseOpeningBalanceBatch', { batchId: gl.batchId }));
  const rev = (await val('openingBalances/batches/' + gl.batchId)).ReversalJVIDs[0];
  assert.deepEqual(await call('u-admin', 'findOpeningBatch', { jvId: rev }), { CompanyID: 'C1', BatchID: gl.batchId });
  await assert.rejects(call('u-admin', 'findOpeningBatch', { jvId: 'nope' }), /was not posted by an opening balance batch/);
  await assert.rejects(call('u-other', 'findOpeningBatch', { jvId }), /do not have access to that company/);
});
