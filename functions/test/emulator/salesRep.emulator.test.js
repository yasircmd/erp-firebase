// Sales reps in the Employee Portal (owner, 2026-10-16; docs/modules/
// SALES_REP_PORTAL.md, decisions 230-236): the office marks an employee a
// sales rep with their customers and cash account; in the portal the rep
// sees only their customers (a sales manager all), with balances; an order
// is a draft Sales Order at the customer's price list (the price never the
// phone's) which the office confirms; a collection is a draft Cash Receipt
// to the rep's cash account, or a draft PDC Received, which the office posts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.catch(e => ({ success: false, error: e.message })); assert.equal(r.success, false, 'expected a refusal: ' + JSON.stringify(r)); return r.error; };
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const saveRep = (data, uid) => call(uid || 'u-admin', 'saveSalesRep', Object.assign({ companyId: 'C1', active: true, isManager: false, cashAccountId: '', customerIds: [] }, data));

test.before(async () => {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Corner Shop', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0, Phone: '0500000001' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Market Stall', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 0 }
  };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: '' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 60, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.stock = { ledger: { I1: { WH1: { Quantity: 30, AvgCost: 35, TotalValue: 1050 } } } };
  Object.assign(f.companies.C1, { PdcReceivedClearingAccountID: 'A-PDCR' });
  f.coa['A-PDCR'] = { AccountCode: '1250', AccountName: 'PDC Received Clearing', AccountType: 'Asset', Status: 'Active', IsPostable: true };
  await reset(f);
  const emp = (id, no, name, uid) => firestore.collection('employees').doc(id).set({ EmployeeNo: no, FullName: name, CompanyID: 'C1', Status: 'Active', UserUID: uid, CostCenterID: 'CC1' });
  await emp('E1', 'EMP-0001', 'Sam Seller', 'u-viewer');
  await emp('E2', 'EMP-0002', 'Mia Manager', 'u-approver');
});

test('not a rep: no Sales tab and no sales actions; the office sets reps with the right', async () => {
  assert.equal((await ess('u-viewer', 'me')).me.SalesRep, null);
  assert.match(await err(ess('u-viewer', 'salesHome')), /You are not set up as a sales rep/);
  assert.match(await err(saveRep({ employeeId: 'E1' }, 'u-viewer')), /permission to change Sales Invoice Configuration/);
  assert.match(await err(saveRep({ employeeId: 'E1', cashAccountId: 'A-AR' })), /Choose a cash account of the company/);
  ok(await saveRep({ employeeId: 'E1', cashAccountId: 'A-CASH', customerIds: ['CU1'] }));
  assert.equal((await val('customers/CU1')).SalesRepEmployeeID, 'E1');
  const list = await call('u-admin', 'getSalesReps', { companyId: 'C1' });
  assert.deepEqual(list.reps.map(r => [r.EmployeeID, r.Customers]), [['E1', ['CU1']]]);
  assert.ok(list.cashAccounts.some(a => a.AccountID === 'A-CASH'));
});

test('the rep sees only their customers, with balances; items at the price list with the stock free to sell', async () => {
  assert.deepEqual((await ess('u-viewer', 'me')).me.SalesRep, { IsManager: false });
  const h = await ess('u-viewer', 'salesHome');
  assert.deepEqual(h.customers.map(c => [c.CustomerID, c.Balance, c.Phone]), [['CU1', 0, '0500000001']]);
  assert.match(await err(ess('u-viewer', 'salesItems', { customerId: 'CU2' })), /not one of yours/);
  const it = await ess('u-viewer', 'salesItems', { customerId: 'CU1' });
  assert.deepEqual(it.items.map(i => [i.ItemCode, i.UnitPrice, i.Stock.map(s => [s.WarehouseID, s.Free])]), [['RM-001', 60, [['WH1', 30]]]]);
});

test('an order: a draft Sales Order at the price list, which the office confirms', async () => {
  assert.match(await err(ess('u-viewer', 'salesOrder', { customerId: 'CU1', lines: [] })), /Add at least one item/);
  const r = ok(await ess('u-viewer', 'salesOrder', { customerId: 'CU1', note: 'Deliver Monday', lines: [{ ItemCode: 'RM-001', Quantity: 2, WarehouseID: 'WH1', UnitPrice: 1 }] }));
  const so = await val('salesOrders/' + r.soId);
  assert.deepEqual([so.Status, so.CustomerID, so.Total, so.Lines[0].UnitPrice, so.CostCenterID, so.SalesRepEmployeeID, so.Description], ['Draft', 'CU1', 120, 60, 'CC1', 'E1', 'Deliver Monday'], 'the price list\'s price, not the phone\'s');
  assert.match(so.CreatedBy, /^Portal: EMP-0001 Sam Seller$/);
  ok(await call('u-admin', 'confirmSalesOrder', { soId: r.soId }));
  assert.equal((await val('salesOrders/' + r.soId)).Status, 'Confirmed');
});

test('collections: cash a draft Cash Receipt to the rep\'s cash account, a cheque a draft PDC; the office posts', async () => {
  const cash = ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cash', amount: '50' }));
  const e = (await firestore.collection('journalEntries').doc(cash.jvId).get()).data();
  assert.deepEqual([e.Status, e.VoucherType, e.SelectedAccountCode], ['Draft', 'Cash Receipt', '1000']);
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.PartyID || '']).sort(), [['1000', 50, 0, ''], ['1200', 0, 50, 'CU1']]);
  ok(await call('u-admin', 'postJournalEntry', { jvId: cash.jvId }));
  assert.match(await err(ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cheque', amount: '70', cheque: { number: '', date: '2026-11-01', bank: 'Sample Bank' } })), /Enter the cheque number/);
  const chq = ok(await ess('u-viewer', 'salesCollect', { customerId: 'CU1', method: 'Cheque', amount: '70', cheque: { number: '900001', date: '2026-11-01', bank: 'Sample Bank' } }));
  const p = await val('pdcCheques/' + chq.pdcId);
  assert.deepEqual([p.Status, p.Direction, p.PartyID, p.Amount, p.ChequeNumber, p.DraweeBank], ['Draft', 'Received', 'CU1', 70, '900001', 'Sample Bank']);
  const h = await ess('u-viewer', 'salesHome');
  assert.deepEqual(h.activity.map(a => [a.Kind, a.Amount, a.Status]).sort(), [['Cash', 50, 'Posted'], ['Cheque', 70, 'Draft'], ['Order', 120, 'Confirmed']]);
  assert.equal(h.customers[0].Balance, -50, 'nothing invoiced yet: the posted cash is an advance (the cheque is a draft)');
});

test('a sales manager sees all the company\'s customers', async () => {
  ok(await saveRep({ employeeId: 'E2', isManager: true }));
  const h = await ess('u-approver', 'salesHome');
  assert.deepEqual(h.customers.map(c => c.CustomerID), ['CU1', 'CU2']);
  assert.equal(h.isManager, true);
});
