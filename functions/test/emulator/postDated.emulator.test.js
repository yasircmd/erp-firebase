// No entry dated after this month (owner, 2026-11-06; docs/modules/
// UX_ROUND3.md item 3, Q411): a JV (and Cash & Bank) draft, a stock or sales
// document through its store (a ported module's save included), a quotation;
// and posting, whatever saved the date. Its due / expected dates stay free.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, put, val } = require('./_helpers');
const lock = require('../../src/periodLock');

test.after(async () => { await app.delete(); });
const today = new Date().toISOString().slice(0, 10);
const end = lock.latestDate('');
const nextMonth = new Date(Date.parse(end + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const refusal = /is after .*the end of this month/;
const outcome = p => p.then(r => (r && r.success === false ? { ok: false, error: r.error } : { ok: true, r }), e => ({ ok: false, error: e.message }));

test('a JV draft: this month\'s last day saved; the next month refused', async () => {
  await reset(baseFixture());
  const jv = date => outcome(call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: 'Accrual', CompanyID: 'C1',
    Lines: [{ AccountCode: '1000', Debit: 40, Description: 'a' }, { AccountCode: '1100', Credit: 40, Description: 'b' }] } }));
  assert.equal((await jv(end)).ok, true);
  const r = await jv(nextMonth);
  assert.equal(r.ok, false); assert.match(r.error, refusal);
});

test('a Sales Order through the ported save and its store: refused after the month; its delivery date free', async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  await reset(f);
  const so = (SODate, RequestedDeliveryDate) => outcome(call('u-admin', 'saveDraftSalesOrder', { header: { SODate, RequestedDeliveryDate, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 1, UnitPrice: 10 }] } }));
  const ok = await so(today, '2027-06-30');
  assert.equal(ok.ok, true, ok.error);
  const bad = await so(nextMonth, '');
  assert.equal(bad.ok, false); assert.match(bad.error, refusal);
  // An order saved with such a date before the rule keeps it through other changes (its store lets an unchanged date be).
  await firestore.collection('salesOrders').doc('SO-OLD').set({ CompanyID: 'C1', CustomerID: 'CU1', SODate: nextMonth, Status: 'Draft', Lines: [] });
  await require('../../src/salesStore').salesOrders.update('SO-OLD', { Description: 'changed' });
  assert.equal((await val('salesOrders/SO-OLD')).Description, 'changed');
});

test('a quotation: its date this month or before; Valid until free', async () => {
  const f = baseFixture();
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  await reset(f);
  const q = (QuoteDate, ValidUntil) => outcome(call('u-admin', 'saveQuotation', { quotation: { CompanyID: 'C1', CustomerID: 'CU1', QuoteDate, ValidUntil, Lines: [{ ItemCode: 'RM-001', Quantity: 1, UnitPrice: 5 }] } }));
  assert.equal((await q(today, '2027-12-31')).ok, true);
  const r = await q(nextMonth, '2027-12-31');
  assert.equal(r.ok, false); assert.match(r.error, refusal);
});

test('posting: a document dated after the month is not posted, however it was saved', async () => {
  await reset(baseFixture());
  await firestore.collection('journalEntries').doc('JV-F').set({ CompanyID: 'C1', JVDate: nextMonth, Status: 'Draft', VoucherType: 'JV', Description: 'x', JVNumber: '',
    Lines: [{ AccountID: 'A-CASH', AccountCode: '1000', Debit: 10, Credit: 0 }, { AccountID: 'A-BANK', AccountCode: '1100', Debit: 0, Credit: 10 }], CurrencyCode: '' });
  const r = await outcome(call('u-admin', 'postJournalEntry', { jvId: 'JV-F' }));
  assert.equal(r.ok, false); assert.match(r.error, refusal);
});
