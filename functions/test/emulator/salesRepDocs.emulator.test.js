// The sales rep on the customer and the sales documents (owner,
// 2026-11-08; docs/modules/MIS.md, phase 1c, Q435-Q438): the rep set in the
// Customer Master (checked; an import leaves it); the reps a picker offers;
// a Sales Order takes the customer's rep, may be given another or none
// while a draft, never one who is not an active rep of its company; a
// Delivery Note takes its order's rep, the invoice its Delivery Note's, a
// direct invoice the customer's, a Sales Return its invoice's; a quotation
// the customer's; the customer's rep changed later leaves the documents
// made as they are; and MIS "Sales by rep" counts each document's own rep.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = new Date().toISOString().slice(0, 8) + '01';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const failed = r => { assert.equal(r && r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const NOT_A_REP = /must be an active sales rep of the company/;

function fixture() {
  const f = baseFixture();
  f.coa['A-SRET'] = { AccountCode: '410000', AccountName: 'Sales Returns', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customerClassifications = { CL: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Walk Inn', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 }
  };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-SRET', Status: 'Active', CompanyID: 'C1' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 30, TotalValue: 1500 } } } };
  // Reps: E1, E2 of C1; E3 left the rep list (inactive); E9 a rep of C2.
  f.salesReps = { E1: { CompanyID: 'C1', Active: true, RepCode: 'AA' }, E2: { CompanyID: 'C1', Active: true, RepCode: 'BB' },
    E3: { CompanyID: 'C1', Active: false, RepCode: 'CC' }, E9: { CompanyID: 'C2', Active: true, RepCode: 'ZZ' } };
  return f;
}
const customer = async (id, extra) => call('u-admin', 'saveCustomer', { customerData: Object.assign({}, await val('customers/' + id), { CustomerID: id }, extra || {}) });
const soSave = header => call('u-admin', 'saveDraftSalesOrder', { header: Object.assign({ SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
  Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 10, UnitPrice: 50 }] }, header || {}) });
const rep = async path => (await val(path)).SalesRepEmployeeID;

test('the customer\'s rep, the documents\' reps along the chain, and Sales by rep', async () => {
  await reset(fixture());
  const emp = (id, name, co) => firestore.collection('employees').doc(id).set({ EmployeeNo: id, FullName: name, CompanyID: co, Status: 'Active' });
  await Promise.all([emp('E1', 'Asha Khan', 'C1'), emp('E2', 'Ben Cole', 'C1'), emp('E3', 'Cy Dean', 'C1'), emp('E9', 'Zed Ray', 'C2')]);

  // The picker: the company's active reps, by name.
  const ch = await call('u-admin', 'getSalesRepChoices', { companyId: 'C1' });
  assert.deepEqual(ch.reps.map(r => [r.EmployeeID, r.Name, r.RepCode]), [['E1', 'Asha Khan', 'AA'], ['E2', 'Ben Cole', 'BB']]);
  await assert.rejects(call('u-other', 'getSalesRepChoices', { companyId: 'C1' }), /access to that company/);

  // Customer Master: set, checked; a save without the field (an import) leaves it.
  ok(await customer('CU1', { SalesRepEmployeeID: 'E1' }));
  assert.equal(await rep('customers/CU1'), 'E1');
  assert.match(failed(await customer('CU1', { SalesRepEmployeeID: 'E3' })), NOT_A_REP, 'an inactive rep');
  assert.match(failed(await customer('CU1', { SalesRepEmployeeID: 'E9' })), NOT_A_REP, 'a rep of another company');
  const c = await val('customers/CU1'); delete c.SalesRepEmployeeID;
  ok(await call('u-admin', 'saveCustomer', { customerData: Object.assign(c, { CustomerID: 'CU1', Phone: '0501112222' }) }));
  assert.equal(await rep('customers/CU1'), 'E1', 'kept when not sent');

  // Sales Order: the customer's by default; another or none while a draft; checked.
  const so = ok(await soSave());
  assert.equal(await rep('salesOrders/' + so.soId), 'E1');
  assert.match(failed(await soSave({ SOID: so.soId, SalesRepEmployeeID: 'E9' })), NOT_A_REP);
  ok(await soSave({ SOID: so.soId, SalesRepEmployeeID: 'E2' }));
  ok(await soSave({ SOID: so.soId, Description: 'edited by an older screen' }));
  assert.equal(await rep('salesOrders/' + so.soId), 'E2', 'a draft keeps its rep when the field is not sent');
  const none = ok(await soSave({ SalesRepEmployeeID: '' }));
  assert.equal(await rep('salesOrders/' + none.soId), '', 'none, chosen');
  ok(await call('u-admin', 'confirmSalesOrder', { soId: so.soId }));
  assert.match(failed(await soSave({ SOID: so.soId, SalesRepEmployeeID: 'E1' })), /Only a Draft Sales Order/, 'fixed once confirmed');

  // The customer's rep changed: the order made stays E2 (Q438).
  ok(await customer('CU1', { SalesRepEmployeeID: 'E1' }));
  assert.equal(await rep('salesOrders/' + so.soId), 'E2');

  // Delivery Note from the order: the order's rep; the invoice from it: the Delivery Note's.
  const lineId = (await val('salesOrders/' + so.soId)).Lines[0].LineID;
  const dn = ok(await call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ SourceSOID: so.soId, SourceSOLineID: lineId, Quantity: 4, Description: 'Ship' }] } }));
  assert.equal(await rep('stock/transactions/' + dn.dnId), 'E2');
  ok(await call('u-admin', 'postDeliveryNote', { dnId: dn.dnId }));
  const inv = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Goods', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [{ DeliveryNoteID: dn.dnId, SalesTypeID: 'ST1' }], DirectLines: [], Discount: 0, TaxPercent: 0 } }));
  assert.equal(await rep('customerInvoices/' + inv.invoiceId), 'E2');
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv.invoiceId }));

  // A direct invoice: the customer's rep (E1 now); changed while a draft.
  const direct = { InvoiceDate: D, Description: 'Service', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    DirectLines: [{ AccountCode: '4000', Amount: 300, Description: 'Service', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 };
  const inv2 = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: direct }));
  assert.equal(await rep('customerInvoices/' + inv2.invoiceId), 'E1');
  assert.match(failed(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: Object.assign({}, direct, { InvoiceID: inv2.invoiceId, SalesRepEmployeeID: 'E3' }) })), NOT_A_REP);
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv2.invoiceId }));

  // The Sales Return takes its invoice's rep (E2), whatever is sent.
  const ret = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: D, Description: 'Returned', CompanyID: 'C1', CustomerID: 'CU1', SourceInvoiceID: inv.invoiceId,
    SalesRepEmployeeID: 'E1', Lines: [{ SourceDNID: dn.dnId, SourceDNLineNo: 1, Quantity: 1, WarehouseID: 'WH1' }] }));
  assert.equal(await rep('stock/transactions/' + ret.returnId), 'E2');
  ok(await call('u-admin', 'postSalesReturn', { returnId: ret.returnId }));

  // A quotation: the customer's rep by default, another chosen, checked.
  const q = { CompanyID: 'C1', CustomerID: 'CU1', QuoteDate: D, ValidUntil: D, Lines: [{ ItemCode: 'RM-001', Quantity: 1, UnitPrice: 50 }] };
  const qt = await call('u-admin', 'saveQuotation', { quotation: q });
  assert.equal((await firestore.collection('quotations').doc(qt.quotationId).get()).data().SalesRepEmployeeID, 'E1');
  await assert.rejects(call('u-admin', 'saveQuotation', { quotation: Object.assign({}, q, { QuotationID: qt.quotationId, SalesRepEmployeeID: 'E9' }) }), NOT_A_REP);
  await call('u-admin', 'saveQuotation', { quotation: Object.assign({}, q, { QuotationID: qt.quotationId, SalesRepEmployeeID: 'E2' }) });
  assert.equal((await firestore.collection('quotations').doc(qt.quotationId).get()).data().SalesRepEmployeeID, 'E2');

  // Sales by rep, this month: E2 200 less the return 50 = 150; E1 300.
  const r = await call('u-admin', 'runMisReport', { type: 'salesByRep', companyId: 'C1', month: D.slice(0, 7), mode: 'prevMonth' });
  assert.deepEqual(r.rows.map(x => [x.key, x.label, x.current]), [['E1', 'Asha Khan', 300], ['E2', 'Ben Cole', 150], ['total', 'Total', 450]]);
  await assert.rejects(call('u-admin', 'runMisReport', { type: 'salesByRep', companyId: 'C1', month: D.slice(0, 7), mode: 'budget' }), /not a budget/);
});

test('the Sales reps tab no longer assigns customers: it lists the rep\'s, set in Customer Master', async () => {
  await reset(fixture());
  await firestore.collection('employees').doc('E1').set({ EmployeeNo: 'E1', FullName: 'Asha Khan', CompanyID: 'C1', Status: 'Active' });
  ok(await customer('CU2', { SalesRepEmployeeID: 'E1' }));
  ok(await call('u-admin', 'saveSalesRep', { companyId: 'C1', employeeId: 'E1', repCode: 'AA', active: true, isManager: false, customerIds: ['CU1'] }));
  assert.equal(await rep('customers/CU2'), 'E1', 'not taken off by the rep\'s save');
  assert.equal((await val('customers/CU1')).SalesRepEmployeeID, undefined, 'not given by it either');
  const list = await call('u-admin', 'getSalesReps', { companyId: 'C1' });
  assert.deepEqual(list.reps.find(x => x.EmployeeID === 'E1').Customers, ['CU2']);
  void rtdb;
});
