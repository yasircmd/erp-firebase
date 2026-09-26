// SALESRETURN (docs/modules/SALES_RETURN.md) through its screen's
// callables: returnable invoices and lines, draft (warehouse per line),
// post (stock In at the cost it left at; GL: Dr Sales Returns, Cr
// Discount Given, Dr Output Tax, Cr AR tagged and settling its invoice,
// Dr Inventory / Cr Sales COGS), a paid invoice's open credit, approval
// (and the rollback to Rejected when the commit fails), reversal (stock
// out at the current average cost, revenue side mirrored, and its
// guards), the Customer Invoice reversal guard, the Sales Returns account
// per Sales Type (split by type; required on save), the ledger rebuild,
// validation and access.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture, val } = require('./_helpers');

const D = '2026-09-10';
function fixture() {
  const f = baseFixture();
  f.users['u-root'] = { status: 'Active', role: 'ADMIN', username: 'root', fullName: 'Root', AssignedCompanies: ['C1'] };
  f.coa['A-DISCG'] = { AccountCode: '5300', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.coa['A-SRET'] = { AccountCode: '410000', AccountName: 'Sales Returns & Discounts', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.coa['A-SRETX'] = { AccountCode: '410100', AccountName: 'Sales Returns — Export', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISCG', OutputTaxAccountID: 'A-VATOUT' });
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.orgUnits.WH3 = { Type: 'Warehouse', Code: 'WH3', Name: 'Returns Bay', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.WH9 = { Type: 'Warehouse', Code: 'WH9', Name: 'C2 Store', Status: 'Active', CompanyID: 'C2' };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Other', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' }
  };
  f.salesTypes = {
    ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' },
    ST2: { Name: 'Export', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRETX', Status: 'Active', CompanyID: 'C1' }
  };
  const at = n => '2026-09-0' + n + 'T00:00:00Z';
  const line = (wh, dir, qty, cost, extra) => Object.assign({ LineNo: 1, ItemID: 'I1', ItemCode: 'RM-001', ItemName: 'Steel Sheet', WarehouseID: wh,
    Direction: dir, Quantity: qty, UnitCost: cost, TotalValue: qty * cost, CostCenterID: 'CC1', Description: 'Line' }, extra || {});
  const tx = (type, n, extra, lines) => Object.assign({ TransactionType: type, Status: 'Posted', CompanyID: 'C1', TransactionNumber: type + '-' + n,
    TransactionDate: D, Description: type + ' ' + n, CreatedAt: at(n), PostedAt: at(n), Lines: lines }, extra);
  // Stock built from real movements, so the ledger rebuild reproduces it.
  // WH1: in 30 @30, N1 delivers 10 @30, in 10 @45 → 30 @35. WH2: in 10 @12, N2 delivers 5 → 5 @12.
  f.stock = {
    transactions: {
      G1: tx('GRN', 1, { VendorID: 'V1' }, [line('WH1', 'In', 30, 30)]),
      N1: tx('DeliveryNote', 2, { CustomerID: 'CU1' }, [line('WH1', 'Out', 10, 30, { UnitPrice: 50 })]),
      G2: tx('GRN', 3, { VendorID: 'V1' }, [line('WH1', 'In', 10, 45)]),
      G3: tx('GRN', 4, { VendorID: 'V1' }, [line('WH2', 'In', 10, 12)]),
      N2: tx('DeliveryNote', 5, { CustomerID: 'CU1' }, [line('WH2', 'Out', 5, 12, { UnitPrice: 20 })]),
      N3: tx('DeliveryNote', 6, { CustomerID: 'CU1' }, [line('WH2', 'Out', 1, 12, { UnitPrice: 20 })])
    },
    ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 }, WH2: { Quantity: 4, AvgCost: 12, TotalValue: 48 } } }
  };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r.success, true, r.error); return r; };
const err = async (p) => (await p.catch(e => e)).message;
const rec = (id) => val('stock/transactions/' + id);
const glDoc = async (id) => (await firestore.collection('journalEntries').doc(id).get()).data();
const jvLines = async (jvId) => (await call('u-admin', 'getJournalEntryDetail', { jvId })).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();
const ledger = async (wh) => { const l = await val('stock/ledger/I1/' + wh); return l ? [l.Quantity, l.AvgCost, l.TotalValue] : null; };

// Invoice for N1 (10 × 50 = 500) + N2 (5 × 20 = 100): subtotal 600,
// discount 60, tax 5% on 540 = 27, total 567 — through its real flow.
async function invoice(n2SalesType) {
  const s = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: {
    InvoiceDate: D, Description: 'Invoice 9', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [{ DeliveryNoteID: 'N1', SalesTypeID: 'ST1' }, { DeliveryNoteID: 'N2', SalesTypeID: n2SalesType || 'ST1' }],
    DirectLines: [], Discount: 60, TaxPercent: 5 } }));
  const p = ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  return { id: s.invoiceId, ref: 'CustomerInvoice:' + s.invoiceId, number: p.invoiceNumber };
}
const draft = (inv, lines, extra, uid) => call(uid || 'u-admin', 'saveSalesReturnDraft', Object.assign({
  TransactionDate: D, Description: 'Customer returned damaged sheets', Reference: 'RMA-4', CompanyID: 'C1', CustomerID: 'CU1', SourceInvoiceID: inv.id,
  Lines: lines.map(([dn, qty, wh]) => ({ SourceDNID: dn, SourceDNLineNo: 1, Quantity: qty, WarehouseID: wh }))
}, extra || {}));
const postReturn = (returnId, uid) => call(uid || 'u-admin', 'postSalesReturn', { returnId });
const reverse = (returnId) => call('u-admin', 'reverseSalesReturn', { returnId, reversalDate: D });
const openItems = async () => (await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' }))
  .map(i => [i.Number, i.Side, i.Amount, i.Outstanding]);
const returnable = async () => (await call('u-admin', 'getReturnableCustomerInvoices', { companyId: 'C1', customerId: 'CU1' }))
  .map(i => [i.TransactionNumber, i.Outstanding, i.Lines.map(l => [l.SourceDNNumber, l.ReturnableQuantity])]);
const cbt = (type, amount, allocations) => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: type, SelectedAccountCode: '1100', JVDate: D,
  Description: type, CompanyID: 'C1', CostCenterID: 'CC1',
  OppositeLines: [{ AccountCode: '1200', Amount: amount, Description: type, PartyType: 'Customer', PartyID: 'CU1', Allocations: allocations }] } });

test('post: stock back at the cost it left at, GL at the invoice price to Sales Returns, invoice settled', async () => {
  await reset(fixture());
  const inv = await invoice();
  assert.deepEqual(await returnable(), [[inv.number, 567, [['DeliveryNote-2', 10], ['DeliveryNote-5', 5]]]]);

  const s = ok(await draft(inv, [['N1', 4]]));
  let r = await rec(s.returnId);
  // 4 × 50 = 200; discount 60 × 200/600 = 20; tax 5% of 180 = 9; total 189. Cost 4 × 30 = 120.
  assert.deepEqual([r.Status, r.ReturnValue, r.DiscountAmount, r.TaxAmount, r.Total, r.CostValue, r.Lines[0].WarehouseID, r.CostCenterID],
    ['Draft', 200, 20, 9, 189, 120, 'WH1', 'CC1']);

  const p = ok(await postReturn(s.returnId));
  assert.match(p.returnNumber, /^CRN-26-01-\d{6}$/);
  r = await rec(s.returnId);
  assert.deepEqual([r.Status, r.AllocatedToInvoice, r.Lines[0].Direction, r.Lines[0].UnitCost], ['Posted', 189, 'In', 30]);
  assert.deepEqual(await jvLines(r.LinkedJVID), [['1200', 0, 189], ['1300', 120, 0], ['2200', 9, 0], ['410000', 200, 0], ['5000', 0, 120], ['5300', 0, 20]]);
  // 30 @35 (1050) + 4 @30 (120) = 34 worth 1170.
  assert.deepEqual(await ledger('WH1'), [34, 34.4118, 1170]);

  const gl = await glDoc(r.LinkedJVID);
  assert.deepEqual([gl.VoucherType, gl.PartyKeys, gl.AllocatedRefs, gl.AllocatedRefTypes], ['SalesReturn', ['Customer:CU1'], [inv.ref], ['CustomerInvoice']]);
  assert.deepEqual([gl.Lines[1].PartyID, gl.Lines[1].Allocations], ['CU1', [{ RefType: 'Against', RefID: inv.ref, Amount: 189, RefNumber: inv.number }]]);

  assert.deepEqual(await openItems(), [[inv.number, 'Dr', 567, 378]]);
  const listed = (await call('u-admin', 'getCustomerInvoiceEntries', { limit: 'all' })).entries.find(e => e.CustomerInvoiceID === inv.id);
  assert.deepEqual([listed.Outstanding, listed.PaymentStatus], [378, 'Partly paid']);
  assert.deepEqual(await returnable(), [[inv.number, 378, [['DeliveryNote-2', 6], ['DeliveryNote-5', 5]]]]);

  assert.match(await err(draft(inv, [['N1', 7]])), /only 6 left to return \(delivered 10, already returned 4\)/);
  assert.match((await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: inv.id, reversalDate: D })).error,
    new RegExp('Sales Returns posted against it \\(' + p.returnNumber + '\\) — reverse those first'));
  assert.deepEqual((await call('u-admin', 'getSalesReturnEntries', {})).entries.map(e => e.TransactionNumber), [p.returnNumber]);
});

test('sales types: each line is debited to its own Sales Type\'s Sales Returns account, and mirrored on reversal', async () => {
  await reset(fixture());
  const inv = await invoice('ST2'); // N1 sold as Goods, N2 as Export
  const s = ok(await draft(inv, [['N1', 4], ['N2', 2]]));
  ok(await postReturn(s.returnId));
  const r = await rec(s.returnId);
  assert.deepEqual(r.Lines.map(l => l.SalesTypeID), ['ST1', 'ST2']);
  // 4 × 50 = 200 to Goods returns, 2 × 20 = 40 to Export returns.
  const returnsLines = async (jvId) => (await jvLines(jvId)).filter(l => l[0].startsWith('410'));
  assert.deepEqual(await returnsLines(r.LinkedJVID), [['410000', 200, 0], ['410100', 40, 0]]);
  const rv = ok(await reverse(s.returnId));
  assert.deepEqual(await returnsLines((await rec(rv.returnId)).LinkedJVID), [['410000', 0, 200], ['410100', 0, 40]]);
});

test('a chosen warehouse; reversal takes stock out at the current average cost and mirrors the rest; guards', async () => {
  await reset(fixture());
  const inv = await invoice();
  // Into the Returns Bay: 2 × 20 = 40, discount 4, tax 1.8, total 37.8, cost 2 × 12 = 24.
  const a = ok(await draft(inv, [['N2', 2, 'WH3']]));
  ok(await postReturn(a.returnId));
  assert.deepEqual(await ledger('WH3'), [2, 12, 24]);

  // Back to WH1 at 30 while WH1 averages 35: reversing takes it out at the new average.
  const b = ok(await draft(inv, [['N1', 4]]));
  ok(await postReturn(b.returnId));
  const original = await rec(b.returnId);
  const r = ok(await reverse(b.returnId));
  const rev = await rec(r.returnId);
  assert.deepEqual([rev.Status, rev.ReversalOfReturnID, rev.Lines[0].Direction, rev.Lines[0].UnitCost, rev.CostValue], ['Posted', b.returnId, 'Out', 34.4118, 137.65]);
  assert.equal((await rec(b.returnId)).ReversedByReturnID, r.returnId);
  assert.deepEqual(await jvLines(rev.LinkedJVID), [['1200', 189, 0], ['1300', 0, 137.65], ['2200', 0, 9], ['410000', 0, 200], ['5000', 137.65, 0], ['5300', 20, 0]]);
  const [oGl, rGl] = [await glDoc(original.LinkedJVID), await glDoc(rev.LinkedJVID)];
  assert.deepEqual([oGl.ReversedByJV, rGl.ReversalOfJV, rGl.PartyKeys, rGl.AllocatedRefs], [rev.LinkedJVID, original.LinkedJVID, ['Customer:CU1'], []]);
  assert.deepEqual(await ledger('WH1'), [30, 34.4117, 1032.35]);
  assert.deepEqual(await openItems(), [[inv.number, 'Dr', 567, 529.2]], 'only the Returns Bay note still counts');

  assert.match(await err(reverse(b.returnId)), /already been reversed/);
  assert.match(await err(reverse(r.returnId)), /reversal entry cannot itself be reversed/);
  // Goods that have left the Returns Bay can't be "un-returned".
  await rtdb.ref('stock/ledger/I1/WH3').set({ Quantity: 1, AvgCost: 12, TotalValue: 12 });
  assert.match(await err(reverse(a.returnId)), /insufficient stock for RM-001 at this warehouse — available 1, requested 2/);
  await rtdb.ref('stock/ledger/I1/WH3').set({ Quantity: 2, AvgCost: 12, TotalValue: 24 });
  ok(await reverse(a.returnId));
  assert.deepEqual(await openItems(), [[inv.number, 'Dr', 567, 567]]);
  ok(await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: inv.id, reversalDate: D }));
  assert.match(await err(draft(inv, [['N1', 1]])), /no longer a posted, unreversed invoice/);
});

test('invoice already paid: the note is an open credit (New Ref); refund and reversal guards', async () => {
  await reset(fixture());
  const inv = await invoice();
  const receipt = ok(await cbt('Bank Receipt', 567, [{ RefType: 'Against', RefID: inv.ref, Amount: 567 }]));
  ok(await call('u-admin', 'postJournalEntry', { jvId: receipt.jvId }));

  // 5 × 20 = 100; discount 10; tax 4.5; total 94.5 — all of it owed back to the customer.
  const s = ok(await draft(inv, [['N2', 5]]));
  const p = ok(await postReturn(s.returnId));
  const r = await rec(s.returnId);
  assert.deepEqual([r.AllocatedToInvoice, r.Total], [0, 94.5]);
  assert.deepEqual((await glDoc(r.LinkedJVID)).AllocatedRefs, []);
  assert.deepEqual(await openItems(), [[p.returnNumber, 'Cr', 94.5, 94.5]]);

  // Refunded by bank payment against the open credit (the receivables line is line 2).
  const refund = ok(await cbt('Bank Payment', 94.5, [{ RefType: 'Against', RefID: 'NewRef:' + r.LinkedJVID + ':2', Amount: 94.5 }]));
  const refundPost = ok(await call('u-admin', 'postJournalEntry', { jvId: refund.jvId }));
  assert.deepEqual(await openItems(), []);

  assert.match(await err(reverse(s.returnId)), new RegExp('settled by ' + refundPost.jvNumber + ' — reverse that first'));
  assert.match((await call('u-admin', 'reverseJournalEntry', { jvId: r.LinkedJVID, reversalDate: D })).error, /posted by SalesReturn — reverse it from that module/);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: refund.jvId, reversalDate: D }));
  // With the receipt reversed too, only the return stops the invoice being reversed.
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: receipt.jvId, reversalDate: D }));
  assert.match((await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: inv.id, reversalDate: D })).error,
    new RegExp('Sales Returns posted against it \\(' + p.returnNumber + '\\)'));
  ok(await reverse(s.returnId));
  assert.deepEqual(await openItems(), [[inv.number, 'Dr', 567, 567]]);
  ok(await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: inv.id, reversalDate: D }));
});

test('approval: gated post, nothing moves until approved; a failed commit returns the note to Rejected', async () => {
  const f = fixture();
  f.approvalConfigurations = { SALESRETURN: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { SALESRETURN: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const inv = await invoice();
  const s = ok(await draft(inv, [['N1', 1]]));
  assert.deepEqual(await postReturn(s.returnId), { success: true, status: 'PendingApproval' });
  let r = await rec(s.returnId);
  assert.equal((await val('approvalInstances/' + r.ApprovalInstanceID)).Amount, 47.25); // 50 − 5 + 2.25
  assert.deepEqual(await ledger('WH1'), [30, 35, 1050], 'no stock moved yet');
  ok(await call('u-approver', 'decideSalesReturnApproval', { returnId: s.returnId, levelNumber: 1, decision: 'Approved', reason: '' }));
  assert.equal((await rec(s.returnId)).Status, 'Posted');
  assert.equal((await ledger('WH1'))[0], 31);

  const t = ok(await draft(inv, [['N1', 1]]));
  await postReturn(t.returnId);
  ok(await call('u-approver', 'decideSalesReturnApproval', { returnId: t.returnId, levelNumber: 1, decision: 'Rejected', reason: 'Not received yet' }));
  r = await rec(t.returnId);
  assert.deepEqual([r.Status, r.RejectionReason], ['Rejected', 'Not received yet']);
  ok(await draft(inv, [['N1', 2]], { ReturnID: t.returnId }));

  await postReturn(t.returnId);
  await rtdb.ref('salesTypes/ST1/SalesReturnsAccountID').remove();
  assert.match(await err(call('u-approver', 'decideSalesReturnApproval', { returnId: t.returnId, levelNumber: 1, decision: 'Approved', reason: '' })),
    /Posting failed: Sales Type "Goods" has no Sales Returns Account\. Set one in Sales Invoice Configuration/);
  r = await rec(t.returnId);
  assert.equal(r.Status, 'Rejected');
  assert.equal((await val('approvalInstances/' + r.ApprovalInstanceID)).Status, 'Pending');
  assert.equal((await ledger('WH1'))[0], 31, 'nothing moved');
});

test('validation, warehouses, missing account, delete, company scoping and access', async () => {
  await reset(fixture());
  const inv = await invoice();
  assert.match(await err(draft(inv, [])), /Enter a quantity to return on at least one line/);
  assert.match(await err(draft(inv, [['N1', 1], ['N1', 1]])), /listed twice/);
  assert.match(await err(draft(inv, [['N1', 0.5]])), /PCS does not allow decimal quantities/);
  assert.match(await err(draft(inv, [['N3', 1]])), /that Delivery Note line is not on this invoice/);
  assert.match(await err(draft(inv, [['N1', 1]], { CustomerID: 'CU2' })), /different company or customer/);
  assert.match(await err(draft(inv, [['N1', 1, 'CC1']])), /Line 1: warehouse not found/);
  assert.match(await err(draft(inv, [['N1', 1, 'WH9']])), /that warehouse belongs to a different company/);
  assert.match(await err(draft(inv, [['N1', 1]], {}, 'u-viewer')), /permission to create or edit/);
  assert.match(await err(draft(inv, [['N1', 1]], {}, 'u-other')), /do not have access to that company/);

  // No Sales Returns account: refused at post, still a draft.
  const s = ok(await draft(inv, [['N1', 1]]));
  assert.match(await err(postReturn(s.returnId, 'u-viewer')), /permission to post/);
  await rtdb.ref('salesTypes/ST1/SalesReturnsAccountID').remove();
  assert.match(await err(postReturn(s.returnId)), /Sales Type "Goods" has no Sales Returns Account/);
  await rtdb.ref('salesTypes/ST1/SalesReturnsAccountID').set('A-VATOUT');
  await rtdb.ref('coa/A-VATOUT/Status').set('Inactive');
  assert.match(await err(postReturn(s.returnId)), /Sales Type "Goods": its Sales Returns Account is no longer valid/);
  assert.equal((await rec(s.returnId)).Status, 'Draft');

  // A delivery line with no recorded cost can't be returned into stock.
  await rtdb.ref('stock/transactions/N2/Lines/0/UnitCost').set(0);
  assert.match(await err(draft(inv, [['N2', 1]])), /left DeliveryNote-5 at no recorded cost/);

  assert.deepEqual((await call('u-other', 'getSalesReturnEntries', {})).entries, []);
  assert.match(await err(call('u-other', 'getReturnableCustomerInvoices', { companyId: 'C1', customerId: 'CU1' })), /do not have access to that company/);
  assert.equal((await call('u-viewer', 'getSalesReturnEntries', {})).entries.length, 1);
  ok(await call('u-admin', 'deleteSalesReturnDraft', { returnId: s.returnId }));
  assert.equal(await rec(s.returnId), null);
});

test('Sales Type stores its Sales Returns account (required, Revenue, same company); the ledger rebuild replays returns and their reversals', async () => {
  await reset(fixture());
  const saveType = (extra) => call('u-admin', 'saveSalesType', { data: Object.assign({ SalesTypeID: 'ST1', Name: 'Goods', GLAccountID: 'A-REV', CompanyID: 'C1' }, extra) });
  assert.deepEqual(await saveType({}), { success: false, error: 'Select a Sales Returns account.' });
  assert.deepEqual(await saveType({ SalesReturnsAccountID: 'NOPE' }), { success: false, error: 'Sales Returns account must be an active, postable account.' });
  assert.deepEqual(await saveType({ SalesReturnsAccountID: 'A-DISCG' }), { success: false, error: 'Sales Returns account must be a Revenue-type account.' });
  await rtdb.ref('coa/A-SRETX/CompanyID').set('C2');
  assert.deepEqual(await saveType({ SalesReturnsAccountID: 'A-SRETX' }), { success: false, error: 'Sales Returns account is restricted to a different company.' });
  await rtdb.ref('coa/A-SRETX/CompanyID').remove();
  ok(await saveType({ SalesReturnsAccountID: 'A-SRET' }));
  assert.equal((await val('salesTypes/ST1')).SalesReturnsAccountID, 'A-SRET');
  // Company Master no longer has one.
  ok(await call('u-admin', 'saveCompany', { companyData: Object.assign({ CompanyID: 'C1' }, await val('companies/C1'), { SalesReturnsAccountID: 'A-SRET' }) }));
  assert.equal((await val('companies/C1')).SalesReturnsAccountID, undefined);

  const inv = await invoice();
  const a = ok(await draft(inv, [['N1', 4], ['N2', 2, 'WH3']]));
  ok(await postReturn(a.returnId));
  const b = ok(await draft(inv, [['N1', 1]]));
  ok(await postReturn(b.returnId));
  ok(await reverse(b.returnId));
  const live = await val('stock/ledger/I1');
  const strip = (l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, [v.Quantity, v.AvgCost, v.TotalValue]]));
  await rtdb.ref('stock/ledger/I1/WH1').set({ Quantity: 999, AvgCost: 1, TotalValue: 999 });
  ok(await call('u-root', 'recalculateStockLedger', { confirmPhrase: 'DELETE' }));
  assert.deepEqual(strip(await val('stock/ledger/I1')), strip(live));
  assert.deepEqual(strip(live).WH3, [2, 12, 24]);
});
