// MIS report builder, phase 4 (owner, 2026-11-08; docs/modules/MIS.md,
// Q446-Q449): the four data sets from real postings (an order delivered and
// invoiced with a rep, a direct invoice, a vendor bill, journal entries,
// the delivery's stock), grouped, pivoted and listed; the rights (MIS and
// the data set's module); a saved builder report and its rows for a chart
// or dashboard tile.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb, firestore, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = new Date().toISOString().slice(0, 8) + '05';
const M0 = D.slice(0, 7);
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const refused = async p => { const r = await p.then(x => ({ x }), e => ({ error: e.message })); assert.ok(r.error, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const build = (dataset, spec, extra, uid) => call(uid || 'u-admin', 'runMisBuilder', Object.assign({ dataset, companyId: 'C1', month: M0, months: 1, spec }, extra || {}));

test('the four data sets, shaped; the rights; a saved builder report as rows', async () => {
  const f = baseFixture();
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0, SalesRepEmployeeID: 'E1' } };
  f.salesTypes = { ST1: { Name: 'Goods', GLAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.salesReps = { E1: { CompanyID: 'C1', Active: true, RepCode: 'AA' } };
  f.coa['A-DISC'] = { AccountCode: '4100', AccountName: 'Discount Given', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  Object.assign(f.companies.C1, { DiscountGivenAccountID: 'A-DISC' });
  f.stock = { ledger: { I1: { WH1: { Quantity: 50, AvgCost: 30, TotalValue: 1500 } } } };
  await reset(f);
  await firestore.collection('employees').doc('E1').set({ EmployeeNo: 'E1', FullName: 'Asha Khan', CompanyID: 'C1', Status: 'Active' });

  // An order, delivered (4 × 50) and invoiced; a direct invoice (300); a vendor bill (120); a JV.
  const so = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: D, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 10, UnitPrice: 50 }] } }));
  ok(await call('u-admin', 'confirmSalesOrder', { soId: so.soId }));
  const lineId = (await val('salesOrders/' + so.soId)).Lines[0].LineID;
  const dn = ok(await call('u-admin', 'saveDeliveryNoteDraft', { dnData: { TransactionDate: D, Description: 'Delivery', CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1', Lines: [{ SourceSOID: so.soId, SourceSOLineID: lineId, Quantity: 4, Description: 'Ship' }] } }));
  ok(await call('u-admin', 'postDeliveryNote', { dnId: dn.dnId }));
  const inv = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Goods', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [{ DeliveryNoteID: dn.dnId, SalesTypeID: 'ST1' }], DirectLines: [], Discount: 0, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv.invoiceId }));
  const inv2 = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Service', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1', SalesRepEmployeeID: '',
    DirectLines: [{ AccountCode: '4000', Amount: 300, Description: 'Service', SalesTypeID: 'ST1' }], Discount: 30, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: inv2.invoiceId }));
  const vi = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Bill', VendorRefNumber: 'B-1', CompanyID: 'C1', VendorID: 'V1', CostCenterID: 'CC1', SourceGRNs: [],
    DirectLines: [{ AccountCode: '5100', Amount: 120, Description: 'Labour', CostCenterID: 'CC1' }], Discount: 0, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: vi.invoiceId }));

  // Sales lines by rep: Asha 200 (the delivered goods); none 270 (300 less its 30 discount).
  const byRep = await build('sales', { view: 'group', groupBy: ['rep'], measures: [{ field: 'amount', agg: 'sum' }, { field: 'quantity', agg: 'sum' }] });
  assert.deepEqual(byRep.rows, [['(none)', 270, 0], ['Asha Khan', 200, 4]]);
  assert.deepEqual(byRep.totals, ['Total', 470, 4]);
  // A pivot: item × kind; a filtered list.
  const piv = await build('sales', { view: 'pivot', pivot: { rows: 'item', cols: 'kind', measure: { field: 'amount', agg: 'sum' } } });
  assert.deepEqual(piv.columns.map(c => c.label), ['Item', 'Invoice', 'Total']);
  assert.deepEqual(piv.rows.map(r => r[0]), ['(none)', 'RM-001 Steel Sheet']);
  const list = await build('sales', { view: 'list', columns: ['number', 'item', 'amount'], filters: [{ field: 'item', op: 'contains', value: 'steel' }] });
  assert.deepEqual([list.rows.length, list.rows[0][2], list.totals[2]], [1, 200, 200]);

  // Purchase lines; GL lines (revenue credits); stock movements (the delivery out).
  const buy = await build('purchases', { view: 'group', groupBy: ['vendor'], measures: [{ field: 'amount', agg: 'sum' }] });
  assert.deepEqual(buy.rows, [['Acme Metals', 120]]);
  const gl = await build('gl', { view: 'group', groupBy: ['accountType'], measures: [{ field: 'net', agg: 'sum' }] });
  const byType = Object.fromEntries(gl.rows);
  assert.equal(byType.Revenue, -500, 'revenue credited in full: 200 + 300 (the discount is its own expense line)');
  assert.equal(byType.Expense, 150, 'the bill 120 and the discount given 30');
  const stock = await build('stock', { view: 'group', groupBy: ['type', 'direction'], measures: [{ field: 'quantity', agg: 'sum' }, { field: 'value', agg: 'sum' }] });
  assert.deepEqual(stock.rows, [['DeliveryNote', 'Out', -4, -120]]);

  // The rights: MIS access, and the data set's module.
  const ds = await call('u-viewer', 'getMisDatasets', {});
  assert.deepEqual(ds.datasets.map(d => d.id), ['sales', 'purchases', 'gl', 'stock']);
  await rtdb.ref('permissions/CUSTOMERINVOICE/access').set(['Admin']);
  assert.ok(!(await call('u-viewer', 'getMisDatasets', {})).datasets.some(d => d.id === 'sales'));
  assert.match(await refused(build('sales', { view: 'list', columns: ['amount'] }, {}, 'u-viewer')), /needs the CUSTOMERINVOICE module/);
  assert.match(await refused(build('sales', { view: 'list', columns: ['amount'] }, { companyId: 'C2' })), /access to that company/);
  assert.match(await refused(build('sales', { view: 'group', groupBy: ['customer'], measures: [{ field: 'customer', agg: 'sum' }] })), /not a number/);
  await rtdb.ref('permissions/MIS/access').set(['Admin']);
  assert.match(await refused(call('u-viewer', 'getMisDatasets', {})), /access to MIS/);
  await rtdb.ref('permissions/MIS/access').set(['Admin', 'Viewer']);

  // Saved as a builder report; as rows for a chart or tile; shared or not.
  const saved = ok(await call('u-admin', 'saveMisReport', { name: 'Sales by rep (lines)', type: 'builder', companyId: 'C1', chart: 'bar', period: { kind: 'latest' },
    builder: { dataset: 'sales', months: 3, spec: { view: 'group', groupBy: ['rep'], measures: [{ field: 'amount', agg: 'sum' }] } } }));
  assert.match(await refused(call('u-admin', 'saveMisReport', { name: 'x', type: 'builder', companyId: 'C1', builder: { dataset: 'nope' } })), /Choose a data set/);
  const rows = await call('u-admin', 'runSavedMisBuilder', { id: saved.id, month: M0 });
  assert.deepEqual(rows.rows.map(r => [r.label, r.current]), [['(none)', 270], ['Asha Khan', 200]]);
  assert.match(await refused(call('u-viewer', 'runSavedMisBuilder', { id: saved.id, month: M0 })), /not shared with you/);
  const mine = await call('u-admin', 'getMyMisReports', {});
  assert.deepEqual(mine.mine[0].builder.spec.groupBy, ['rep']);
});
