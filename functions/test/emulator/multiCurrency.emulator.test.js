// Foreign currency for customers and vendors (owner, 2026-10-16; docs/modules/
// MULTI_CURRENCY.md, decisions 211-218), phase 1: rates by effective date,
// typed by whoever has the right; a USD customer's invoice in USD, posted in
// base with each line's USD amount and rate; a receipt in base settling it
// in USD at another rate, the difference posted to Exchange Gain / Loss; the
// statement and the aging in USD with the base beside them, reconciling to
// the GL; the party's currency fixed once used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });
const D = '2026-09-10', PAY = '2026-09-20';
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
let INV;

test.before(async () => {
  const f = baseFixture();
  f.currencies = { CUR1: { Code: 'AED', Name: 'UAE Dirham', IsDefault: true, Status: 'Active' }, CUR2: { Code: 'USD', Name: 'US Dollar', IsDefault: false, Status: 'Active' } };
  f.coa['A-FX'] = { AccountCode: '4950', AccountName: 'Exchange Gain / Loss', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Global Imports', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', DefaultCurrency: 'USD', PaymentTermsDays: 30 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Local Trading', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0 }
  };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  await reset(f);
});

test('rates by effective date: typed by whoever has the right; the latest on or before a date applies', async () => {
  const save = (data, uid) => call(uid || 'u-admin', 'saveExchangeRate', Object.assign({ code: 'USD' }, data));
  assert.match(await err(save({ effectiveDate: '2026-09-01', rate: 3.67 }, 'u-viewer')), /permission to enter exchange rates/);
  assert.match(await err(save({ code: 'AED', effectiveDate: '2026-09-01', rate: 1 })), /base currency/);
  assert.match(await err(save({ effectiveDate: '2026-09-01', rate: 0 })), /more than 0/);
  ok(await save({ effectiveDate: '2026-09-01', rate: 3.6725 }));
  ok(await save({ effectiveDate: '2026-09-15', rate: 3.7 }));
  const on = d => call('u-admin', 'getExchangeRateOn', { code: 'USD', date: d });
  assert.deepEqual([(await on('2026-09-10')).Rate, (await on('2026-09-15')).Rate, (await on('2026-12-31')).Rate], [3.6725, 3.7, 3.7]);
  assert.match(await err(on('2026-08-31')), /No exchange rate for USD on or before 2026-08-31/);
  assert.equal((await on('2026-08-31').catch(() => null)), null);
  assert.deepEqual((await call('u-admin', 'getExchangeRates', {})).rates.USD.map(r => r.Rate), [3.7, 3.6725]);
});

test('a USD customer\'s invoice: in USD, at the rate on its date (another rate needs a reason); posted in base, each line keeping its USD amount', async () => {
  const draft = extra => call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: Object.assign({ InvoiceDate: D, Description: 'Consulting', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 1000, Description: 'Consulting', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 }, extra || {}) });
  assert.match(await err(draft({ ExchangeRate: 3.65 })), /differs from the USD rate on 2026-09-10 \(3.6725\): give the reason/);
  const s = ok(await draft());
  INV = s.invoiceId;
  const inv = await val('customerInvoices/' + INV);
  assert.deepEqual([inv.CurrencyCode, inv.ExchangeRate, inv.Total, inv.TotalBase], ['USD', 3.6725, 1000, 3672.5]);
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: INV }));
  const e = await jv((await val('customerInvoices/' + INV)).LinkedJVID);
  const ar = e.Lines.find(l => l.AccountCode === '1200'), rev = e.Lines.find(l => l.AccountCode === '4000');
  assert.deepEqual([ar.Debit, ar.FcCurrency, ar.FcDebit, ar.FcRate, rev.Credit, rev.FcCredit], [3672.5, 'USD', 1000, 3672.5 / 1000, 3672.5, 1000]);
  assert.equal(e.TotalDebit, e.TotalCredit);
  const items = await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' });
  const item = (items.items || items).find(i => i.RefID === 'CustomerInvoice:' + INV);
  assert.deepEqual([item.Outstanding, item.Currency, item.Rate], [1000, 'USD', 3.6725]);
});

test('a receipt into the AED bank settling the invoice in USD at another rate: the exchange difference posts to Exchange Gain / Loss', async () => {
  const receipt = line => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Receipt', SelectedAccountCode: '1100', JVDate: PAY, Description: 'Global Imports pays', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [Object.assign({ AccountCode: '1200', Amount: '3700', Description: 'Receipt', CostCenterID: 'CC1', PartyType: 'Customer', PartyID: 'CU1',
      Allocations: [{ RefType: 'Against', RefID: 'CustomerInvoice:' + INV, Amount: 1000 }] }, line)] } });
  assert.match(await err(receipt({})), /Global Imports is invoiced in USD: enter the line's USD amount and its rate/);
  assert.match(await err(receipt({ FcCurrency: 'USD', FcAmount: 1000 })), /set the company's Exchange Gain \/ Loss account in Currency Configuration/);
  ok(await call('u-admin', 'saveFxSettings', { companyId: 'C1', gainLossAccountId: 'A-FX', costCenterId: 'CC1' }));
  const d = ok(await receipt({ FcCurrency: 'USD', FcAmount: 1000 }));
  const p = ok(await call('u-admin', 'postJournalEntry', { jvId: d.jvId }));
  const e = await jv(d.jvId);
  // 1,000 USD at 3.70 = 3,700 received for 3,672.50 invoiced: a gain of 27.50.
  const fx = e.Lines.filter(l => l.FxAdjustment).map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']);
  assert.deepEqual(fx, [['1200', 27.5, 0, 'CU1'], ['4950', 0, 27.5, '']]);
  assert.equal(e.TotalDebit, e.TotalCredit);
  const items = await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' });
  assert.equal(((items.items || items).find(i => i.RefID === 'CustomerInvoice:' + INV) || { Outstanding: 0 }).Outstanding, 0);
  assert.ok(p.jvNumber);
});

test('the statement in USD with the base beside it, reconciling to the GL; the aging in base at each item\'s rate', async () => {
  const s = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1', fromDate: '2026-09-01', toDate: '2026-09-30' });
  assert.deepEqual([s.Currency, s.BaseCurrency, s.Closing, s.BaseClosing], ['USD', 'AED', 0, 0]);
  assert.deepEqual(s.Rows.map(r => [r.Debit, r.Credit, r.BaseAmount]), [[1000, 0, 3672.5], [0, 1000, 3700]]);
  assert.deepEqual([s.Reconciliation.status, s.Reconciliation.Difference], ['shared', undefined], 'CU2 shares 1200: not comparable by party');
  // An open USD invoice for the aging.
  const s2 = ok(await call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: { InvoiceDate: '2026-09-16', Description: 'More consulting', CompanyID: 'C1', CustomerID: 'CU1', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [{ AccountCode: '4000', Amount: 200, Description: 'Consulting', SalesTypeID: 'ST1' }], Discount: 0, TaxPercent: 0 } }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s2.invoiceId }));
  const a = await call('u-admin', 'getPartyAging', { partyType: 'Customer', companyId: 'C1', asOf: '2026-09-30', basis: 'due' });
  const row = a.Rows.find(r => r.PartyID === 'CU1');
  assert.deepEqual([row.Currency, row.FcNet, row.Net], ['USD', 200, 740], '200 USD at 3.70 = 740 AED');
});

test('the party\'s currency is fixed once it has invoices or payments', async () => {
  const r = await call('u-admin', 'saveCustomer', { customerData: Object.assign({}, (await val('customers/CU1')), { CustomerID: 'CU1', DefaultCurrency: 'AED' }) });
  assert.match(r.error, /already has invoices or payments in USD: its currency can't change/);
  // A customer with nothing yet may change.
  const r2 = await call('u-admin', 'saveCustomer', { customerData: Object.assign({}, (await val('customers/CU2')), { CustomerID: 'CU2', DefaultCurrency: 'USD' }) });
  assert.equal(r2.success, true, r2.error);
  assert.equal((await val('customers/CU2')).DefaultCurrency, 'USD');
});
