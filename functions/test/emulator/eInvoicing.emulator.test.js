// UAE e-invoicing, ready to send (owner, 2026-10-16; docs/modules/
// E_INVOICING.md, decisions 225-229): the switch and start date in Sales
// Invoice Configuration; a posted invoice of a company with it on gets its
// PINT AE document, checked and stored, never sent while no ASP is
// connected; a customer without a TRN is not e-invoiced; missing data
// leaves it Not ready until fixed and checked again; a Sales Return is a
// credit note naming its invoice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-09-10';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const settings = (extra, uid) => call(uid || 'u-admin', 'saveEInvoiceSettings', Object.assign({ companyId: 'C1', enabled: true, startDate: '2026-09-01', aspName: '' }, extra));
const invoice = async (customerId, date, extra) => {
  const s = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: Object.assign({ InvoiceDate: date || D, Description: 'Services', CompanyID: 'C1', CustomerID: customerId, CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 1000, Description: 'Consulting', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 5 }, extra) }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  return s.invoiceId;
};
const einv = (kind, id) => val('eInvoices/' + kind + '_' + id);

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.companies.C1, { TaxNumbers: [{ Type: 'TRN', Number: '100000000000003' }], AddressLine1: '1 Sample Street', City: 'Dubai', Country: 'UAE', OutputTaxAccountID: 'A-VATOUT' });
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Sample Buyer', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 30, TaxRegistrationNumber: '100000000000010', AddressLine1: '2 Test Road', Country: 'UAE' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Walk-in', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0 }
  };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } } };
  await reset(f);
});

test('off by default: a posted invoice has no e-invoice; the settings need the right and a start date', async () => {
  const id = await invoice('CU1');
  assert.equal(await einv('Invoice', id), null);
  assert.deepEqual((await call('u-admin', 'getEInvoice', { kind: 'Invoice', id })), { enabled: false, record: null });
  assert.match(await err(settings({}, 'u-viewer')), /permission to change Sales Invoice Configuration/);
  assert.match(await err(settings({ startDate: '' })), /Enter the date e-invoicing starts/);
  ok(await settings({ aspName: '' }));
  const s = await call('u-admin', 'getEInvoiceSettings', { companyId: 'C1' });
  assert.deepEqual([s.Enabled, s.StartDate, s.CompanyTrn, s.CompanyTrnValid], [true, '2026-09-01', '100000000000003', true]);
});

test('on: a posted invoice gets its PINT AE document, ready, not sent (no ASP); a customer with no TRN is not e-invoiced; before the start date, none', async () => {
  const id = await invoice('CU1');
  const r = await einv('Invoice', id);
  assert.deepEqual([r.Status, r.SendStatus, r.Issues || [], r.Total], ['Ready', 'NotSent', [], 1050]);
  assert.match(r.SendNote, /no ASP is connected yet/);
  assert.match(r.Xml, /<cbc:ID>CINV-[\d-]+<\/cbc:ID>/);
  assert.match(r.Xml, /<cbc:DueDate>2026-10-10<\/cbc:DueDate>/, 'the invoice date + 30 days of terms');
  assert.match(r.Xml, /<cbc:TaxAmount currencyID="AED">50.00<\/cbc:TaxAmount>/);
  const b2c = await invoice('CU2');
  assert.equal((await einv('Invoice', b2c)).Status, 'NotApplicable');
  const early = await invoice('CU1', '2026-08-20');
  assert.equal(await einv('Invoice', early), null);
});

test('missing data: Not ready, with what is missing; fixed, Check again makes it ready', async () => {
  await rtdb.ref('customers/CU1/AddressLine1').set('');
  const id = await invoice('CU1');
  const r = await einv('Invoice', id);
  assert.deepEqual([r.Status, r.Issues], ['NotReady', ['The customer\'s address is missing (Customer Master).']]);
  await rtdb.ref('customers/CU1/AddressLine1').set('2 Test Road');
  const again = ok(await call('u-admin', 'rebuildEInvoice', { kind: 'Invoice', id }));
  assert.equal(again.record.Status, 'Ready');
});

test('a Sales Return is a credit note naming its invoice', async () => {
  ok(await call('u-admin', 'saveInvoiceStockSettings', { companyId: 'C1', directStock: true }));
  const s = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Goods', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [], ItemLines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 4, UnitPrice: 60, Description: 'Steel sheet' }], ItemSalesTypeID: 'ST1', Discount: 0, TaxPercent: 5 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  const r = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: D, Description: 'One back', CompanyID: 'C1', CustomerID: 'CU1', SourceInvoiceID: s.invoiceId,
    Lines: [{ SourceDNID: inv.AutoDeliveryNoteID, SourceDNLineNo: 1, Quantity: 1, WarehouseID: 'WH1' }] }));
  ok(await call('u-admin', 'postSalesReturn', { returnId: r.returnId }));
  const cn = await einv('CreditNote', r.returnId);
  assert.equal(cn.Status, 'Ready', JSON.stringify(cn.Issues));
  assert.match(cn.Xml, /<CreditNote [\s\S]*<cbc:CreditNoteTypeCode>381[\s\S]*<cbc:ID>CINV-[\d-]+<\/cbc:ID><\/cac:InvoiceDocumentReference>/);
  assert.match(cn.Xml, /<cbc:PayableAmount currencyID="AED">63.00<\/cbc:PayableAmount>/, '60 + 5% VAT');
  assert.equal((await call('u-admin', 'getEInvoice', { kind: 'CreditNote', id: r.returnId })).record.Status, 'Ready');
});
