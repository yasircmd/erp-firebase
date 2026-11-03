// Projects on documents, step 2: the sales chain (owner, 2026-11-03;
// docs/modules/PROJECTS_DIMENSIONS.md, Q387-Q390): a Delivery Note keeps
// its project (checked) and posts it; a Customer Invoice's direct line may
// have its own project, the rest the invoice's; a Sales Return takes its
// invoice's project; the Delivery Note an invoice makes for its items takes
// the invoice's; the order lines offered to an invoice carry their order's
// project; and a reversal posts even after its project is closed (Delivery
// Note, Customer and Vendor Invoice: decision 221).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-10-10';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const jvLines = async id => (await firestore.collection('journalEntries').doc(id).get()).data().Lines;
const projectsOf = async id => [...new Set((await jvLines(id)).map(l => l.ProjectID || ''))].sort();
const P = { a: 'PRJ-A', b: 'PRJ-B', x: 'PRJ-X' };
const close = id => rtdb.ref('orgUnits/' + id + '/Status').set('Closed');
const reopen = id => rtdb.ref('orgUnits/' + id + '/Status').set('Active');

function fixture() {
  const f = baseFixture();
  Object.assign(f.orgUnits, {
    [P.a]: { Type: 'Project', Code: 'P-100', Name: 'Tower A', CompanyID: 'C1', Status: 'Active' },
    [P.b]: { Type: 'Project', Code: 'P-200', Name: 'Tower B', CompanyID: '', Status: 'Active' },
    [P.x]: { Type: 'Project', Code: 'P-900', Name: 'Elsewhere', CompanyID: 'C2', Status: 'Active' }
  });
  f.coa['A-SRET'] = { AccountCode: '410000', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 30, TotalValue: 1500 } } } };
  return f;
}
async function order(projectId, qty) {
  const s = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', ProjectID: projectId,
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: qty, UnitPrice: 50 }] } }));
  ok(await call('u-admin', 'confirmSalesOrder', { soId: s.soId }));
  return { soId: s.soId, lineId: (await val('salesOrders/' + s.soId)).Lines[0].LineID };
}
const dnDraft = (o, qty, projectId) => call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', ProjectID: projectId,
  Lines: [{ SourceSOID: o.soId, SourceSOLineID: o.lineId, Quantity: qty, Description: 'Ship' }] } });

test('Delivery Note: its project kept (checked) and on every line it posts; its reversal posts after the project is closed', async () => {
  await reset(fixture());
  const o = await order(P.a, 10);
  assert.match(await err(dnDraft(o, 4, P.x)), /^Project P-900 belongs to another company/);
  const d = ok(await dnDraft(o, 4, P.a));
  assert.equal((await val('stock/transactions/' + d.dnId)).ProjectID, P.a);
  ok(await call('u-admin', 'postDeliveryNote', { dnId: d.dnId }));
  const dn = await val('stock/transactions/' + d.dnId);
  assert.deepEqual(await projectsOf(dn.LinkedJVID), [P.a]);
  await close(P.a);
  ok(await call('u-admin', 'reverseDeliveryNote', { dnId: d.dnId, reversalDate: D }));
  const rev = await val('stock/transactions/' + (await val('stock/transactions/' + d.dnId)).ReversedByDeliveryNoteID);
  assert.deepEqual(await projectsOf(rev.LinkedJVID), [P.a], 'mirrored, though the project is closed now');
  await reopen(P.a);
});

test('Customer Invoice: a direct line\'s own project, the rest the invoice\'s; reversed after the project is closed; a Sales Return takes the invoice\'s project', async () => {
  await reset(fixture());
  const o = await order(P.a, 10);
  const d = ok(await dnDraft(o, 4, P.a));
  ok(await call('u-admin', 'postDeliveryNote', { dnId: d.dnId }));
  const inv = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Stage 1', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', ProjectID: P.a,
    SourceDeliveryNotes: [{ DeliveryNoteID: d.dnId, SalesTypeID: 'ST1' }],
    DirectLines: [{ AccountCode: '4000', Amount: 30, Description: 'Freight for Tower B', SalesTypeID: 'ST1', ProjectID: P.b }], Discount: 0, TaxPercent: 0 } }));
  assert.deepEqual((await val('customerInvoices/' + inv.invoiceId)).DirectLines.map(l => l.ProjectID), [P.b]);
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv.invoiceId }));
  const posted = await val('customerInvoices/' + inv.invoiceId);
  const lines = (await jvLines(posted.LinkedJVID)).map(l => [l.AccountCode, l.Debit, l.Credit, l.ProjectID]).sort((a, b) => (a[0] + a[2]).localeCompare(b[0] + b[2]));
  assert.deepEqual(lines, [['1200', 230, 0, P.a], ['4000', 0, 200, P.a], ['4000', 0, 30, P.b]], 'the direct line\'s revenue on its own project');

  // A return against it: the invoice's project.
  const r = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: D, Description: 'Returned', CompanyID: 'C1', CustomerID: 'CU1', SourceInvoiceID: inv.invoiceId,
    Lines: [{ SourceDNID: d.dnId, SourceDNLineNo: 1, Quantity: 1, WarehouseID: 'WH1' }] }));
  const returnable = await call('u-admin', 'getReturnableCustomerInvoices', { companyId: 'C1', customerId: 'CU1' });
  assert.equal(returnable.find(x => x.CustomerInvoiceID === inv.invoiceId).ProjectID, P.a, 'offered with its project');
  assert.equal((await val('stock/transactions/' + r.returnId)).ProjectID, P.a);
  ok(await call('u-admin', 'postSalesReturn', { returnId: r.returnId }));
  assert.deepEqual(await projectsOf((await val('stock/transactions/' + r.returnId)).LinkedJVID), [P.a]);
  ok(await call('u-admin', 'reverseSalesReturn', { returnId: r.returnId, reversalDate: D }));

  // The invoice reversed after its project is closed.
  await close(P.a);
  ok(await call('u-admin', 'requestReverseCustomerInvoice', { invoiceId: inv.invoiceId, reversalDate: D }));
  const mirror = await val('customerInvoices/' + (await val('customerInvoices/' + inv.invoiceId)).ReversedByInvoiceID);
  assert.deepEqual(await projectsOf(mirror.LinkedJVID), [P.a, P.b]);
  await reopen(P.a);
});

test('a Vendor Invoice reverses after its project is closed', async () => {
  await reset(fixture());
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Bill', VendorRefNumber: 'B-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', ProjectID: P.a,
    SourceGRNs: [], DirectLines: [{ AccountCode: '5100', Amount: 70, Description: 'Labour', CostCenterID: 'CC1' }] } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  await close(P.a);
  ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: D }));
  await reopen(P.a);
});

test('an invoice\'s own Delivery Note (direct stock) takes the invoice\'s project; the order lines offered carry their order\'s project', async () => {
  await reset(fixture());
  ok(await call('u-admin', 'saveInvoiceStockSettings', { companyId: 'C1', directStock: true }));
  const o = await order(P.b, 6);
  const offered = await call('u-admin', 'getInvoiceableOrderLines', { companyId: 'C1', customerId: 'CU1' });
  assert.deepEqual(offered.map(l => [l.SourceSOID || l.SOID, l.ProjectID]), [[o.soId, P.b]]);
  const s = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Counter sale', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', ProjectID: P.b,
    SourceDeliveryNotes: [], DirectLines: [], ItemSalesTypeID: 'ST1', Discount: 0, TaxPercent: 0,
    ItemLines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 2, UnitPrice: 50, Description: 'Steel', SourceSOID: o.soId, SourceSOLineID: o.lineId }] } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  const dn = await val('stock/transactions/' + inv.AutoDeliveryNoteID);
  assert.equal(dn.ProjectID, P.b);
  assert.deepEqual(await projectsOf(dn.LinkedJVID), [P.b]);
});
