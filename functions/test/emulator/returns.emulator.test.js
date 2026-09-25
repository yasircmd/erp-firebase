// Purchase Return / Debit Note and Sales Return / Credit Note
// (docs/modules/PURCHASE_RETURN.md, SALES_RETURN.md), plus the Vendor and
// Customer Account Statements (VENDOR_SOA.md, CUSTOMER_SOA.md): returns
// against a posted invoice at the invoiced price with the discount share
// and tax, stock out/in, the WAC difference, automatic settlement of the
// invoice (and a New Ref beyond it), value lines, the caps, the invoice
// reversal guard, reversal with its guards, approvals, access, and the
// statements' running balance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-DISC': { AccountCode: '4100', AccountName: 'Discount Received', AccountType: 'Revenue', Status: 'Active', IsPostable: true },
    'A-DISCG': { AccountCode: '5300', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SRET': { AccountCode: '4150', AccountName: 'Sales Returns & Discounts', AccountType: 'Revenue', Status: 'Active', IsPostable: true },
    'A-RND': { AccountCode: '6900', AccountName: 'Round Off', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-FRT': { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  Object.assign(f.companies.C1, {
    DiscountReceivedAccountID: 'A-DISC', InputTaxAccountID: 'A-VATIN', RoundOffAccountID: 'A-RND',
    DiscountGivenAccountID: 'A-DISCG', OutputTaxAccountID: 'A-VATOUT'
  });
  f.vendors.V1.PaymentTermsDays = 30;
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 15 } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
// The return and statement callables throw (as grn.js does); this gives the message.
const err = async (promise) => { try { await promise; } catch (e) { return e.message; } return 'no error'; };
const gl = async (id) => (await firestore.collection('journalEntries').doc(id).get()).data();
const glLines = (e) => e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();
const qty = async (wh) => ((await val('stock/ledger/I1/' + wh)) || { Quantity: 0 }).Quantity;
const outstanding = async (partyType, partyId) => (await call('u-admin', 'getPartyOpenItems', { partyType, partyId, companyId: 'C1' }))
  .map(i => [i.ItemType, i.Side, i.Amount, i.Outstanding]);

async function receive(q, cost) {
  const g = ok(await call('u-admin', 'saveGrnDraft', { TransactionDate: D, Description: 'Receipt', CompanyID: 'C1', VendorID: 'V1',
    Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', EnteredUOMID: 'UOM-PCS', EnteredQuantity: q, UnitCost: cost, Description: 'Steel' }] }));
  ok(await call('u-admin', 'postGrn', { grnId: g.grnId }));
  return g.grnId;
}
// 10 @ 20 received and billed: subtotal 200, discount 20, tax 5% on 180 = 9, total 189.
async function billedPurchase() {
  const grnId = await receive(10, 20);
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Bill 1', VendorRefNumber: 'ACME-1',
    CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [{ GRNID: grnId }], DirectLines: [], Discount: 20, TaxPercent: 5 } }));
  const p = ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  return { invoiceId: s.invoiceId, number: p.invoiceNumber, grnId };
}
const pr = (invoiceId, lines, extra) => call('u-admin', 'savePurchaseReturnDraft', Object.assign({
  TransactionDate: D, Description: 'Damaged', CompanyID: 'C1', CostCenterID: 'CC1', SourceInvoiceID: invoiceId, Lines: lines
}, extra || {}));

test('purchase return: returnable lines, amounts, stock out, GL, invoice settled', async () => {
  await reset(fixture());
  const inv = await billedPurchase();
  const list = await call('u-admin', 'getVendorInvoicesForReturn', { companyId: 'C1', partyId: 'V1' });
  assert.deepEqual(list.map(i => i.InvoiceID), [inv.invoiceId]);
  const src = await call('u-admin', 'getPurchaseReturnSource', { invoiceId: inv.invoiceId });
  assert.deepEqual(src.Lines.map(l => [l.SourceKey, l.Quantity, l.Returnable, l.UnitPrice]), [[inv.grnId + ':1', 10, 10, 20]]);

  const s = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 4 }]));
  let doc = await val('stock/transactions/' + s.returnId);
  // goods 80, discount share 20 × 80/200 = 8, tax 5% × 72 = 3.6, total 75.6
  assert.deepEqual([doc.Status, doc.GoodsValue, doc.Discount, doc.TaxAmount, doc.Total], ['Draft', 80, 8, 3.6, 75.6]);

  const p = ok(await call('u-admin', 'postPurchaseReturn', { returnId: s.returnId }));
  assert.match(p.number, /^DBN-26-01-/);
  assert.equal(p.settled, 75.6);
  assert.equal(await qty('WH1'), 6);
  doc = await val('stock/transactions/' + s.returnId);
  assert.equal(doc.Status, 'Posted');
  const e = await gl(doc.LinkedJVID);
  assert.deepEqual(glLines(e), [['1300', 0, 80], ['1400', 0, 3.6], ['2000', 75.6, 0], ['4100', 8, 0]]);
  const ap = e.Lines.find(l => l.AccountCode === '2000');
  assert.deepEqual([ap.PartyID, ap.Allocations.map(a => [a.RefType, a.Amount])], ['V1', [['Against', 75.6]]]);
  assert.deepEqual(await outstanding('Vendor', 'V1'), [['VendorInvoice', 'Cr', 189, 113.4]]);
  const bills = (await call('u-admin', 'getVendorInvoiceEntries', { limit: 'all' })).entries;
  assert.equal(bills.find(b => b.VendorInvoiceID === inv.invoiceId).PaymentStatus, 'Partly paid');
  assert.equal((await call('u-admin', 'getPurchaseReturnSource', { invoiceId: inv.invoiceId })).Lines[0].Returnable, 6);
  assert.equal((await call('u-admin', 'getPurchaseReturnEntries', {})).total, 1);
});

test('purchase return: WAC difference to Material Consumption; value lines; caps', async () => {
  await reset(fixture());
  const inv = await billedPurchase();
  await receive(10, 30); // WH1: 20 units, WAC 25
  const s = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 2 }],
    { ValueLines: [{ AccountCode: '6100', Description: 'Freight overcharged', Amount: 10 }] }));
  const p = ok(await call('u-admin', 'postPurchaseReturn', { returnId: s.returnId }));
  const doc = await val('stock/transactions/' + s.returnId);
  // goods 40 (disc share 4), value 10, tax 5% × 46 = 2.3, total 48.3; stock leaves at WAC 25 = 50, so 10 more to Consumption.
  assert.deepEqual([doc.GoodsValue, doc.Discount, doc.ValueTotal, doc.TaxAmount, doc.Total], [40, 4, 10, 2.3, 48.3]);
  assert.deepEqual(glLines(await gl(doc.LinkedJVID)), [['1300', 0, 50], ['1400', 0, 2.3], ['2000', 48.3, 0], ['4100', 4, 0], ['5100', 10, 0], ['6100', 0, 10]]);
  assert.ok(p.number);

  assert.match(await err(pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 9 }])), /has only 8 left to return \(10 on .*, 2 already returned\)/);
  assert.match(await err(pr(inv.invoiceId, [], { ValueLines: [{ AccountCode: '6100', Description: 'x', Amount: 200 }] })), /would exceed the invoice total 189.00/);
  assert.match(await err(pr(inv.invoiceId, [])), /at least one line/);
  assert.match(await err(pr(inv.invoiceId, [{ SourceKey: 'NOPE:1', Quantity: 1 }])), /not a line of this invoice/);
  assert.match(await err(pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 1 }], { CostCenterID: '' })), /Cost Center/);
  assert.match(await err(pr('NOPE', [{ SourceKey: 'x', Quantity: 1 }])), /Vendor Invoice not found/);
  // 8 more would pass the line cap but not the invoice total (151.20 + 48.30 > 189).
  assert.match(await err(pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 8 }])), /This note \(151.20\) plus earlier notes on the invoice \(48.30\) would exceed/);
  // Not enough stock left in the warehouse: caught at post.
  const big = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 7 }]));
  await rtdb.ref('stock/ledger/I1/WH1').update({ Quantity: 3 });
  assert.match(await err(call('u-admin', 'postPurchaseReturn', { returnId: big.returnId })), /insufficient stock/);
  assert.equal((await val('stock/transactions/' + big.returnId)).Status, 'Draft');
});

test('purchase return: beyond a paid invoice becomes a New Ref; reversal guards and release', async () => {
  await reset(fixture());
  const inv = await billedPurchase();
  // Pay the bill in full first.
  const pay = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: D, Description: 'Pay', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: 189, Description: 'Pay', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: 'VendorInvoice:' + inv.invoiceId, Amount: 189 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: pay.jvId }));
  const s = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 4 }]));
  const p = ok(await call('u-admin', 'postPurchaseReturn', { returnId: s.returnId }));
  assert.equal(p.settled, 0);
  assert.deepEqual(await outstanding('Vendor', 'V1'), [['NewRef', 'Dr', 75.6, 75.6]], 'the vendor now owes 75.60');

  // Invoice reversal is refused while the return stands.
  assert.match((await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: inv.invoiceId, reversalDate: D })).error, /posted return \(debit\/credit note\)/);

  // Use the debit note's New Ref against a second bill, which blocks reversing the note.
  const doc = await val('stock/transactions/' + s.returnId);
  const inv2 = await billedPurchase();
  const settle = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: D, Description: 'Offset debit note', CompanyID: 'C1', Lines: [
    { AccountCode: '2000', Debit: 75.6, Credit: 0, Description: 'x', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: 'VendorInvoice:' + inv2.invoiceId, Amount: 75.6 }] },
    { AccountCode: '2000', Debit: 0, Credit: 75.6, Description: 'x', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: 'NewRef:' + doc.LinkedJVID + ':1', Amount: 75.6 }] }] } }));
  const settlePost = ok(await call('u-admin', 'postJournalEntry', { jvId: settle.jvId }));
  assert.match(await err(call('u-admin', 'requestReversePurchaseReturn', { returnId: s.returnId, reversalDate: D })), new RegExp('settled by ' + settlePost.jvNumber));
  // The JV can't reverse the note's GL entry either.
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: doc.LinkedJVID, reversalDate: D })).error, /posted by PurchaseReturn — reverse it from that module/);

  ok(await call('u-admin', 'reverseJournalEntry', { jvId: settle.jvId, reversalDate: D }));
  const before = await qty('WH1');
  const r = ok(await call('u-admin', 'requestReversePurchaseReturn', { returnId: s.returnId, reversalDate: D }));
  assert.equal(r.status, 'Posted');
  assert.equal(await qty('WH1'), before + 4);
  assert.equal((await val('stock/transactions/' + s.returnId)).ReversedByReturnID, r.returnId);
  const rev = await val('stock/transactions/' + r.returnId);
  assert.deepEqual(glLines(await gl(rev.LinkedJVID)), [['1300', 80, 0], ['1400', 3.6, 0], ['2000', 0, 75.6], ['4100', 0, 8]]);
  assert.equal((await gl(doc.LinkedJVID)).ReversedByJV, rev.LinkedJVID);
  assert.deepEqual((await outstanding('Vendor', 'V1')).map(i => i[0]), ['VendorInvoice'], 'only bill 2 remains open; the New Ref is gone');
  assert.match(await err(call('u-admin', 'requestReversePurchaseReturn', { returnId: r.returnId })), /cannot itself be reversed/);
  assert.match(await err(call('u-admin', 'requestReversePurchaseReturn', { returnId: s.returnId })), /already been reversed/);
  // With the return reversed, the first invoice can be reversed again.
  assert.equal((await call('u-admin', 'getPurchaseReturnSource', { invoiceId: inv.invoiceId })).Lines[0].Returnable, 10);
});

test('purchase return: approval gate for posting and reversal', async () => {
  const f = fixture();
  f.approvalConfigurations = { PURCHASERETURN: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { PURCHASERETURN: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const inv = await billedPurchase();
  const s = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 1 }]));
  assert.equal((await call('u-admin', 'postPurchaseReturn', { returnId: s.returnId })).status, 'PendingApproval');
  assert.equal(await qty('WH1'), 10, 'nothing moves while pending');
  assert.match(await err(call('u-approver', 'decidePurchaseReturnApproval', { returnId: s.returnId, levelNumber: 1, decision: 'Rejected', reason: '' })), /reason is required/);
  ok(await call('u-approver', 'decidePurchaseReturnApproval', { returnId: s.returnId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.equal((await val('stock/transactions/' + s.returnId)).Status, 'Posted');
  assert.equal(await qty('WH1'), 9);

  assert.equal((await call('u-admin', 'requestReversePurchaseReturn', { returnId: s.returnId, reversalDate: D })).status, 'PendingReversalApproval');
  const pending = await val('stock/transactions/' + s.returnId);
  const rej = ok(await call('u-approver', 'decidePurchaseReturnReversalApproval', { returnId: s.returnId, levelNumber: 1, decision: 'Rejected', reason: 'Keep it' }));
  assert.equal(rej.status, 'Rejected');
  assert.equal((await val('stock/transactions/' + s.returnId)).Status, 'Posted');
  assert.ok(pending.ReversalApprovalInstanceID);
  assert.equal((await call('u-admin', 'requestReversePurchaseReturn', { returnId: s.returnId, reversalDate: D })).status, 'PendingReversalApproval');
  ok(await call('u-approver', 'decidePurchaseReturnReversalApproval', { returnId: s.returnId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.ok((await val('stock/transactions/' + s.returnId)).ReversedByReturnID);
  assert.equal(await qty('WH1'), 10);
});

test('purchase return: access and company scoping; delete', async () => {
  await reset(fixture());
  const inv = await billedPurchase();
  await assert.rejects(call('u-viewer', 'savePurchaseReturnDraft', { TransactionDate: D, Description: 'x', CompanyID: 'C1', CostCenterID: 'CC1', SourceInvoiceID: inv.invoiceId, Lines: [] }), /permission/);
  await assert.rejects(call('u-other', 'savePurchaseReturnDraft', { TransactionDate: D, Description: 'x', CompanyID: 'C1', CostCenterID: 'CC1', SourceInvoiceID: inv.invoiceId, Lines: [] }), /do not have access to that company/);
  const s = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 1 }]));
  await assert.rejects(call('u-viewer', 'postPurchaseReturn', { returnId: s.returnId }), /permission/);
  assert.equal((await call('u-other', 'getPurchaseReturnEntries', {})).total, 0);
  assert.equal((await call('u-viewer', 'getPurchaseReturnEntries', {})).total, 1);
  ok(await call('u-admin', 'deletePurchaseReturnDraft', { returnId: s.returnId }));
  assert.equal(await val('stock/transactions/' + s.returnId), null);
});

// ---------- Sales Return ----------

// Stock 10 @ 20 in WH1; a posted Delivery Note of 4 @ price 50 (cost 20)
// seeded as posted; invoiced with discount 20 and tax 5%: subtotal 200,
// net 180, tax 9, total 189.
async function billedSale() {
  await receive(10, 20);
  await rtdb.ref('stock/ledger/I1/WH1').update({ Quantity: 6, TotalValue: 120 });
  await rtdb.ref('stock/transactions/DN1').set({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'DN-26-01-000001',
    TransactionDate: D, Description: 'Delivery', PostedAt: new Date().toISOString(), CreatedAt: new Date().toISOString(), Lines: [{ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 4, UnitPrice: 50, UnitCost: 20, TotalValue: 80, CostCenterID: 'CC1', Direction: 'Out' }] });
  const s = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Invoice 1', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [{ DeliveryNoteID: 'DN1', SalesTypeID: 'ST1' }], DirectLines: [], Discount: 20, TaxPercent: 5 } }));
  const p = ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  return { invoiceId: s.invoiceId, number: p.invoiceNumber };
}
const sr = (invoiceId, lines, extra) => call('u-admin', 'saveSalesReturnDraft', Object.assign({
  TransactionDate: D, Description: 'Returned by customer', CompanyID: 'C1', CostCenterID: 'CC1', SourceInvoiceID: invoiceId, Lines: lines
}, extra || {}));

test('sales return: Sales Returns account setting, stock back to a chosen warehouse, GL, settlement', async () => {
  await reset(fixture());
  const inv = await billedSale();
  assert.deepEqual(await call('u-admin', 'getSalesReturnSettings', { companyId: 'C1' }), { SalesReturnsAccountID: '', canEdit: true });
  const s = ok(await sr(inv.invoiceId, [{ SourceKey: 'DN1:1', Quantity: 1, WarehouseID: 'WH2' }]));
  assert.match(await err(call('u-admin', 'postSalesReturn', { returnId: s.returnId })), /no valid Sales Returns account/);
  await assert.rejects(call('u-admin', 'setSalesReturnsAccount', { companyId: 'C1', accountId: 'A-AR' }), /Revenue-type/);
  await assert.rejects(call('u-viewer', 'setSalesReturnsAccount', { companyId: 'C1', accountId: 'A-SRET' }), /permission/);
  ok(await call('u-admin', 'setSalesReturnsAccount', { companyId: 'C1', accountId: 'A-SRET' }));

  const p = ok(await call('u-admin', 'postSalesReturn', { returnId: s.returnId }));
  assert.match(p.number, /^CRN-26-01-/);
  const doc = await val('stock/transactions/' + s.returnId);
  // goods 50, discount share 20 × 50/200 = 5, tax 5% × 45 = 2.25, total 47.25
  assert.deepEqual([doc.GoodsValue, doc.Discount, doc.TaxAmount, doc.Total], [50, 5, 2.25, 47.25]);
  assert.equal(await qty('WH2'), 1);
  assert.equal((await val('stock/ledger/I1/WH2')).AvgCost, 20, 'back at the cost the DN took out');
  assert.deepEqual(glLines(await gl(doc.LinkedJVID)), [['1200', 0, 47.25], ['1300', 20, 0], ['2200', 2.25, 0], ['4150', 50, 0], ['5100', 0, 20], ['5300', 0, 5]]);
  assert.deepEqual(await outstanding('Customer', 'CU1'), [['CustomerInvoice', 'Dr', 189, 141.75]]);
  assert.equal((await call('u-admin', 'getSalesReturnSource', { invoiceId: inv.invoiceId })).Lines[0].Returnable, 3);

  // Reversal takes the stock out of WH2 again and restores the invoice.
  assert.match((await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: inv.invoiceId, reversalDate: D })).error, /posted return/);
  ok(await call('u-admin', 'requestReverseSalesReturn', { returnId: s.returnId, reversalDate: D }));
  assert.equal(await qty('WH2'), 0);
  assert.deepEqual(await outstanding('Customer', 'CU1'), [['CustomerInvoice', 'Dr', 189, 189]]);
});

test('sales return: value-only credit note', async () => {
  await reset(fixture());
  const inv = await billedSale();
  await rtdb.ref('companies/C1/SalesReturnsAccountID').set('A-SRET');
  const s = ok(await sr(inv.invoiceId, [], { ValueLines: [{ AccountCode: '4150', Description: 'Price correction', Amount: 30 }] }));
  const p = ok(await call('u-admin', 'postSalesReturn', { returnId: s.returnId }));
  const doc = await val('stock/transactions/' + s.returnId);
  assert.deepEqual([doc.GoodsValue, doc.Discount, doc.TaxAmount, doc.Total], [0, 0, 1.5, 31.5]);
  assert.deepEqual(glLines(await gl(doc.LinkedJVID)), [['1200', 0, 31.5], ['2200', 1.5, 0], ['4150', 30, 0]]);
  assert.ok(p.number);
  assert.equal(await qty('WH1'), 6, 'no stock moves');
});

test('account statements: running ledger, opening balance, access', async () => {
  await reset(fixture());
  const inv = await billedPurchase(); // bill 189
  const s = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 4 }]));
  ok(await call('u-admin', 'postPurchaseReturn', { returnId: s.returnId })); // debit note 75.6
  const pay = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: '2026-09-20', Description: 'Pay', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2000', Amount: 100, Description: 'Part payment', PartyType: 'Vendor', PartyID: 'V1', Allocations: [{ RefType: 'Against', RefID: 'VendorInvoice:' + inv.invoiceId, Amount: 100 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: pay.jvId }));

  const st = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' });
  assert.deepEqual(st.Rows.map(r => [r.Type, r.Debit, r.Credit, r.Balance]), [
    ['Vendor Invoice', 0, 189, 189], ['Debit Note', 75.6, 0, 113.4], ['Bank Payment', 100, 0, 13.4]
  ]);
  assert.deepEqual([st.Opening, st.TotalDebit, st.TotalCredit, st.Closing, st.PartyName], [0, 175.6, 189, 13.4, 'Acme Metals']);
  const later = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1', fromDate: '2026-09-15' });
  assert.deepEqual([later.Opening, later.Rows.length, later.Closing], [113.4, 1, 13.4]);
  const before = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1', toDate: '2026-09-15' });
  assert.equal(before.Closing, 113.4);

  // Customer side: receivable, debit-positive.
  await rtdb.ref('customerInvoices/CI1').set({ Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'CINV-1', InvoiceDate: D, Total: 500 });
  await rtdb.ref('customerInvoices/CI2').set({ Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU1', TransactionNumber: 'CINV-2', InvoiceDate: D, Total: 500, ReversalOfInvoiceID: 'CI1' });
  const cst = await call('u-viewer', 'getPartyStatement', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' });
  assert.deepEqual(cst.Rows.map(r => [r.Type, r.Debit, r.Credit]).sort(), [['Customer Invoice', 500, 0], ['Invoice Reversal', 0, 500]]);
  assert.equal(cst.Closing, 0);

  assert.deepEqual((await call('u-admin', 'getStatementParties', { partyType: 'Vendor' })).map(p => p.PartyID), ['V1']);
  await assert.rejects(call('u-other', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' }), /do not have access to that company/);
  await rtdb.ref('permissions/VENDORSOA/access').set(['Admin']);
  await assert.rejects(call('u-viewer', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V1', companyId: 'C1' }), /do not have access to the Vendor Account Statement/);
});

test('Data Reset\'s stock ledger rebuild replays returns and their reversals exactly', async () => {
  const f = fixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.permissions.DATARESET = { access: ['ADMIN'], write: ['ADMIN'] };
  await reset(f);
  const inv = await billedPurchase();
  const a = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 4 }]));
  ok(await call('u-admin', 'postPurchaseReturn', { returnId: a.returnId }));
  await receive(10, 30);
  const b = ok(await pr(inv.invoiceId, [{ SourceKey: inv.grnId + ':1', Quantity: 2 }]));
  ok(await call('u-admin', 'postPurchaseReturn', { returnId: b.returnId }));
  ok(await call('u-admin', 'requestReversePurchaseReturn', { returnId: a.returnId, reversalDate: D }));
  const live = await val('stock/ledger');
  const r = await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' });
  assert.equal(r.success, true, r.error);
  const rebuilt = await val('stock/ledger');
  const strip = (l) => JSON.parse(JSON.stringify(l, (k, v) => (k === 'UpdatedAt' ? undefined : v)));
  assert.deepEqual(strip(rebuilt), strip(live));
});
