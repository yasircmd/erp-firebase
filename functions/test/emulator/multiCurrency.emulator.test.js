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
  f.coa['A-PDCI'] = { AccountCode: '2150', AccountName: 'PDC Issued Clearing', AccountType: 'Liability', Status: 'Active', IsPostable: true };
  f.companies.C1.PdcIssuedClearingAccountID = 'A-PDCI';
  f.coa['G-BANK'] = { AccountCode: '110000', AccountName: 'Banks', AccountType: 'Asset', Status: 'Active', IsPostable: false, OwnCashBank: 'Bank', CashBank: 'Bank' };
  f.coa['A-USDB'] = { AccountCode: '110002', AccountName: 'USD account', AccountType: 'Asset', Status: 'Active', IsPostable: true, ParentAccountID: 'G-BANK', CashBank: 'Bank' };
  f.coa['A-OBC'] = { AccountCode: '3900', AccountName: 'Opening Balance Clearing', AccountType: 'Equity', Status: 'Active', IsPostable: true };
  f.coa['A-FX'] = { AccountCode: '4950', AccountName: 'Exchange Gain / Loss', AccountType: 'Revenue', Status: 'Active', IsPostable: true };
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Global Imports', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', DefaultCurrency: 'USD', PaymentTermsDays: 30 },
    CU2: { CustomerCode: 'C002', CustomerName: 'Local Trading', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0 }
  };
  f.customerClassifications = { CL: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.salesTypes = { ST1: { Name: 'Services', GLAccountID: 'A-REV', SalesReturnsAccountID: 'A-REV', Status: 'Active', CompanyID: 'C1' } };
  // For the item lines, the return and the vendor side.
  f.customers.CU3 = { CustomerCode: 'C003', CustomerName: 'Export Buyer', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR', Classification: 'Retail', PaymentTermsDays: 0, DefaultCurrency: 'USD' };
  f.items.I1.SalesCogsAccountID = 'A-COGS';
  f.coa['A-FRT'] = { AccountCode: '6100', AccountName: 'Freight', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.vendors.V9 = { VendorCode: 'V009', VendorName: 'Overseas Supplier', Status: 'Active', CompanyID: 'C1', TradePayablesAccountID: 'A-AP9', DefaultCurrency: 'USD' };
  f.coa['A-AP9'] = { AccountCode: '2010', AccountName: 'Payables - foreign', AccountType: 'Liability', Status: 'Active', IsPostable: true };
  const sl = (dir, extra) => Object.assign({ ItemID: 'I1', ItemCode: 'RM-001', WarehouseID: 'WH1', Direction: dir, Quantity: 2, UnitCost: 35, LineNo: 1 }, extra || {});
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } }, transactions: {
    N3: { TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: 'C1', CustomerID: 'CU3', TransactionNumber: 'DN-3', TransactionDate: D, Description: 'Delivery', Lines: [sl('Out', { UnitPrice: 50 })] },
    G9: { TransactionType: 'GRN', Status: 'Posted', CompanyID: 'C1', VendorID: 'V9', TransactionNumber: 'GRN-9', TransactionDate: D, Description: 'Receipt', Lines: [sl('In')] } } };
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
  assert.match(await err(receipt({})), /Global Imports is invoiced in USD: enter the line's USD amount beside its amount/);
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

const jvLines = async id => (await jv(id)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.FcCurrency ? (l.FcDebit || l.FcCredit) : '']).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));

test('a USD customer: Delivery Notes made separately stay in base; item lines in USD; a return at the invoice\'s rate, the stock in base', async () => {
  ok(await call('u-admin', 'saveInvoiceStockSettings', { companyId: 'C1', directStock: true }));
  const save = extra => call('u-admin', 'saveCustomerInvoiceDraft', { invoiceData: Object.assign({ InvoiceDate: D, Description: 'Export sale', CompanyID: 'C1', CustomerID: 'CU3', CostCenterID: 'CC1',
    SourceDeliveryNotes: [], DirectLines: [], ItemSalesTypeID: 'ST1', Discount: 0, TaxPercent: 0 }, extra) });
  assert.match(await err(save({ SourceDeliveryNotes: [{ DeliveryNoteID: 'N3', SalesTypeID: 'ST1' }] })), /invoiced in USD: for now a USD invoice takes item lines and direct lines/);
  const s = ok(await save({ ItemLines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', Quantity: 4, UnitPrice: 60, Description: 'Steel sheet' }] }));
  ok(await call('u-admin', 'postCustomerInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('customerInvoices/' + s.invoiceId);
  // 240 USD at 3.6725 = 881.40; the delivery's COGS at average cost, in base.
  assert.deepEqual([inv.Total, inv.TotalBase], [240, 881.4]);
  assert.deepEqual(await jvLines(inv.LinkedJVID), [['1200', 881.4, 0, 240], ['4000', 0, 881.4, 240]]);
  const dn = await val('stock/transactions/' + inv.AutoDeliveryNoteID);
  assert.deepEqual(await jvLines(dn.LinkedJVID), [['1300', 0, 140, ''], ['5000', 140, 0, '']]);
  const r = ok(await call('u-admin', 'saveSalesReturnDraft', { TransactionDate: PAY, Description: 'One back', CompanyID: 'C1', CustomerID: 'CU3', SourceInvoiceID: s.invoiceId,
    Lines: [{ SourceDNID: inv.AutoDeliveryNoteID, SourceDNLineNo: 1, Quantity: 1, WarehouseID: 'WH1' }] }));
  ok(await call('u-admin', 'postSalesReturn', { returnId: r.returnId }));
  const ret = await val('stock/transactions/' + r.returnId);
  // 60 USD at the invoice's 3.6725 = 220.35 (not the 3.70 of the return's date); the stock back at 35.
  assert.deepEqual(await jvLines(ret.LinkedJVID), [['1200', 0, 220.35, 60], ['1300', 35, 0, ''], ['4000', 220.35, 0, 60], ['5000', 0, 35, '']]);
  const st = await call('u-admin', 'getPartyStatement', { partyType: 'Customer', partyId: 'CU3', companyId: 'C1', fromDate: '2026-09-01', toDate: '2026-09-30' });
  assert.deepEqual([st.Currency, st.Closing, st.BaseClosing], ['USD', 180, 661.05]);
});

test('a USD vendor: GRNs stay in base; direct lines in USD; the reversal mirrors the USD amounts', async () => {
  const save = extra => call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: Object.assign({ InvoiceDate: D, Description: 'Freight bill', VendorRefNumber: 'OS-1', CompanyID: 'C1', VendorID: 'V9', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: 500, Description: 'Sea freight', CostCenterID: 'CC1' }] }, extra) });
  assert.match(await err(save({ SourceGRNs: [{ GRNID: 'G9' }] })), /invoiced in USD: for now a USD invoice takes direct lines only/);
  const s = ok(await save({}));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const inv = await val('vendorInvoices/' + s.invoiceId);
  assert.deepEqual([inv.CurrencyCode, inv.Total, inv.TotalBase], ['USD', 500, 1836.25]);
  assert.deepEqual(await jvLines(inv.LinkedJVID), [['2010', 0, 1836.25, 500], ['6100', 1836.25, 0, 500]]);
  const r = ok(await call('u-admin', 'requestReverseVendorInvoice', { invoiceId: s.invoiceId, reversalDate: PAY }));
  const rev = await val('vendorInvoices/' + r.invoiceId);
  assert.deepEqual([rev.CurrencyCode, rev.ExchangeRate, rev.TotalBase], ['USD', 3.6725, 1836.25], 'the reversal keeps the invoice\'s rate');
  const e = await jv(rev.LinkedJVID);
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.FcDebit, l.FcCredit]).sort(), [['2010', 1836.25, 0, 500, 0], ['6100', 0, 1836.25, 0, 500]]);
});

test('paying a USD vendor from the AED bank at a better rate: the gain posts to Exchange Gain / Loss, the bill settled in USD', async () => {
  const s = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: D, Description: 'Handling', VendorRefNumber: 'OS-2', CompanyID: 'C1', VendorID: 'V9', CostCenterID: 'CC1',
    SourceGRNs: [], DirectLines: [{ AccountCode: '6100', Amount: 100, Description: 'Handling', CostCenterID: 'CC1' }] } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: s.invoiceId }));
  const d = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: PAY, Description: 'Pay Overseas Supplier', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '2010', Amount: '365', FcCurrency: 'USD', FcAmount: 100, Description: 'Payment', CostCenterID: 'CC1', PartyType: 'Vendor', PartyID: 'V9',
      Allocations: [{ RefType: 'Against', RefID: 'VendorInvoice:' + s.invoiceId, Amount: 100 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: d.jvId }));
  const e = await jv(d.jvId);
  // 100 USD owed at 3.6725 = 367.25, paid with 365: a gain of 2.25.
  assert.deepEqual(e.Lines.filter(l => l.FxAdjustment).map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']), [['2010', 2.25, 0, 'V9'], ['4950', 0, 2.25, '']]);
  assert.equal(e.TotalDebit, e.TotalCredit);
  const st = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V9', companyId: 'C1', fromDate: '2026-09-01', toDate: '2026-09-30' });
  assert.deepEqual([st.Currency, st.Closing, st.BaseClosing, st.Rows.length], ['USD', 0, 0, 4], 'the exchange line is base only, not a statement row');
  assert.deepEqual([st.Reconciliation.status, st.Reconciliation.Balance, st.Reconciliation.Difference], ['ok', 0, 0], 'V9 alone on 2010: the base agrees with the GL');
});

test('a JV line of a USD vendor takes its USD amount; the opening documents of a USD vendor in USD at their rate', async () => {
  const jvDraft = fc => call('u-admin', 'saveJournalDraft', { jvData: { JVDate: PAY, Description: 'Freight credit', CompanyID: 'C1', Lines: [
    Object.assign({ AccountCode: '2010', Debit: 37, Credit: 0, Description: 'Credit note', PartyType: 'Vendor', PartyID: 'V9', Allocations: [{ RefType: 'New', Amount: fc ? 10 : 37 }] }, fc ? { FcCurrency: 'USD', FcAmount: 10 } : {}),
    { AccountCode: '6100', Debit: 0, Credit: 37, Description: 'Credit note', CostCenterID: 'CC1' }] } }).catch(e => ({ success: false, error: e.message }));
  assert.match((await jvDraft(false)).error, /Overseas Supplier is invoiced in USD: enter the line's USD amount beside its amount/);
  const j = ok(await jvDraft(true));
  ok(await call('u-admin', 'postJournalEntry', { jvId: j.jvId }));
  const line = (await jv(j.jvId)).Lines.find(l => l.AccountCode === '2010');
  assert.deepEqual([line.Debit, line.FcCurrency, line.FcDebit, line.FcRate], [37, 'USD', 10, 3.7]);

  ok(await call('u-admin', 'saveOpeningBalanceSettings', { companyId: 'C1', openingDate: '31/12/2025', clearingAccountId: 'A-OBC' }));
  const head = ['Party Type', 'Party', 'Document Type', 'Document No', 'Document Date', 'Due Date', 'Amount', 'Description', 'Rate'];
  const text = rows => [head].concat(rows).map(r => r.join('\t')).join('\n');
  const c = await call('u-admin', 'checkOpeningBalances', { kind: 'INVOICES', companyId: 'C1', text: text([
    ['Vendor', 'V009', 'Invoice', 'OS-0', '01/12/2025', '', '100', '', ''], ['Vendor', 'V001', 'Invoice', 'AC-0', '01/12/2025', '', '100', '', '3.6']]) });
  assert.deepEqual(c.issues.map(i => i.row + ' ' + i.column + ': ' + i.message), [
    '1 Rate: No USD rate on or before the document date: enter one in Currency Configuration → Rates, or give the rate here.',
    '2 Rate: Only a party in a foreign currency takes a rate.']);
  const p = ok(await call('u-admin', 'postOpeningBalances', { kind: 'INVOICES', companyId: 'C1', text: text([['Vendor', 'V009', 'Invoice', 'OS-0', '01/12/2025', '', '100', '', '3.67']]) }));
  const e = (await firestore.collection('journalEntries').where('OpeningBatchID', '==', p.batchId).get()).docs[0].data();
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.FcCurrency || '', l.FcCredit || 0]).sort(), [['2010', 0, 367, 'USD', 100], ['3900', 367, 0, '', 0]]);
  const items = await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V9', companyId: 'C1' });
  const item = (items.items || items).find(i => i.Number === 'OS-0');
  assert.deepEqual([item.Outstanding, item.Currency, item.Rate], [100, 'USD', 3.67]);
});

test('a PDC to a USD vendor: its USD amount settles the bill, the difference to Exchange Gain / Loss; the bounce undoes both', async () => {
  const items = async () => { const r = await call('u-admin', 'getPartyOpenItems', { partyType: 'Vendor', partyId: 'V9', companyId: 'C1' }); return r.items || r; };
  const item = (await items()).find(i => i.Number === 'OS-0');
  const data = extra => Object.assign({ Direction: 'Issued', CompanyID: 'C1', PartyID: 'V9', TransactionDate: PAY, ChequeDate: '2026-10-15', ChequeNumber: '700001',
    BankAccountID: 'A-BANK', Amount: 365, Description: 'Opening bill', CostCenterID: 'CC1', Allocations: [{ RefType: 'Against', RefID: item.RefID, Amount: 100 }] }, extra);
  const setup = await call('u-admin', 'getPdcSetup', { direction: 'Issued', companyId: 'C1' });
  assert.equal(setup.parties.find(x => x.PartyID === 'V9').Currency, 'USD');
  assert.match(await err(call('u-admin', 'savePdcDraft', data({}))), /Overseas Supplier is invoiced in USD: enter the cheque's USD amount too/);
  const s = ok(await call('u-admin', 'savePdcDraft', data({ FcAmount: 100 })));
  ok(await call('u-admin', 'postPdc', { pdcId: s.pdcId }));
  const pdc = await val('pdcCheques/' + s.pdcId);
  assert.deepEqual([pdc.FcCurrency, pdc.FcAmount], ['USD', 100]);
  const e = await jv(pdc.LinkedJVID || pdc.JVIDs[0]);
  // 100 USD owed at 3.67 = 367, paid with a cheque of 365: a gain of 2.
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.FxAdjustment ? 'fx' : '']).sort(), [['2010', 2, 0, 'fx'], ['2010', 365, 0, ''], ['2150', 0, 365, ''], ['4950', 0, 2, 'fx']]);
  assert.equal(((await items()).find(i => i.Number === 'OS-0') || { Outstanding: 0 }).Outstanding, 0);
  ok(await call('u-admin', 'bouncePdc', { pdcId: s.pdcId, date: PAY, reason: 'Stopped' }));
  assert.equal((await items()).find(i => i.Number === 'OS-0').Outstanding, 100, 'the bounce reopens the bill in USD');
  const st = await call('u-admin', 'getPartyStatement', { partyType: 'Vendor', partyId: 'V9', companyId: 'C1', fromDate: '2025-01-01', toDate: '2026-09-30' });
  assert.deepEqual([st.Closing, st.BaseClosing, st.Reconciliation.Difference], [90, 330, 0], 'the opening bill (100 USD, 367) less the JV credit (10 USD, 37)');
});

test('a bank account in USD: its vouchers in USD at the voucher\'s rate; a transfer into it takes its USD amount; its ledger in USD; its currency fixed once used', async () => {
  const acct = async (id, extra) => call('u-admin', 'saveAccount', { accountData: Object.assign({}, await val('coa/' + id), { AccountID: id }, extra) });
  assert.match((await acct('A-FRT', { Currency: 'USD' })).error, /Only a cash or bank account \(one that takes postings\) has a currency of its own/);
  ok(await acct('A-USDB', { Currency: 'USD' }));
  assert.equal((await val('coa/A-USDB')).Currency, 'USD');
  // Global Imports' open USD invoice of 200 (at 3.70), received into the USD account at 3.75.
  const open = await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' });
  const bill = (open.items || open).find(i => i.Outstanding === 200 && i.Currency === 'USD');
  const receipt = extra => call('u-admin', 'saveCbtDraft', { cbtData: Object.assign({ VoucherType: 'Bank Receipt', SelectedAccountCode: '110002', JVDate: PAY, Description: 'USD receipt', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [{ AccountCode: '1200', Amount: '200', Description: 'Receipt', CostCenterID: 'CC1', PartyType: 'Customer', PartyID: 'CU1', Allocations: [{ RefType: 'Against', RefID: bill.RefID, Amount: 200 }] }] }, extra) });
  assert.match((await receipt({ ExchangeRate: 3.75 })).error, /differs from the USD rate on 2026-09-20 \(3.7\): give the reason/);
  const d = ok(await receipt({ ExchangeRate: 3.75, ExchangeRateReason: 'Bank rate' }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: d.jvId }));
  const e = await jv(d.jvId);
  assert.deepEqual([e.LedgerCurrency, e.ExchangeRate, e.ExchangeRateReason], ['USD', 3.75, 'Bank rate']);
  // 200 USD at 3.75 = 750 for a bill booked at 740: a gain of 10.
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.FcCurrency ? (l.FcDebit || l.FcCredit) : '', l.FxAdjustment ? 'fx' : '']).sort(),
    [['110002', 750, 0, 200, ''], ['1200', 0, 750, 200, ''], ['1200', 10, 0, 0, 'fx'], ['4950', 0, 10, '', 'fx']]);
  assert.match((await acct('A-USDB', { Currency: '' })).error, /already has postings in USD, so its currency can't change/);

  const transfer = extra => call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Fund Transfer', SelectedAccountCode: '1100', JVDate: PAY, Description: 'Buy USD', CompanyID: 'C1', CostCenterID: 'CC1',
    OppositeLines: [Object.assign({ AccountCode: '110002', Amount: '370', Description: 'To the USD account' }, extra)] } });
  assert.match((await transfer({})).error, /Account 110002 is in USD: enter the USD amount it receives/);
  const t = ok(await transfer({ FcAmount: 100 }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: t.jvId }));
  const to = (await jv(t.jvId)).Lines.find(l => l.AccountCode === '110002');
  assert.deepEqual([to.Debit, to.FcDebit, to.FcRate], [370, 100, 3.7]);

  const gl = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-USDB', FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.deepEqual([gl.account.Currency, gl.closingBalance, gl.fcClosing, gl.rows.map(r => r.FcBalance)], ['USD', 1120, 300, [200, 300]]);
});
