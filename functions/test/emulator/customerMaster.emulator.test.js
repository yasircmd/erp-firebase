// CUSTOMERMASTER through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

const good = { CustomerName: 'Emirates Retail LLC', Category: 'Retailer', CompanyID: 'C1', Classification: 'Local',
  TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 45 };

test('classifications seed Local + Export; create customer by classification name or id', async () => {
  const cls = await call('u-admin', 'getActiveCustomerClassifications');
  assert.deepEqual(cls.map(c => c.Name).sort(), ['Export', 'Local']);
  const r = await call('u-admin', 'saveCustomer', { customerData: good });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.ok(r.customerCode);
  const exportId = cls.find(c => c.Name === 'Export').ClassificationID || cls.find(c => c.Name === 'Export').id;
  const ex = await call('u-admin', 'saveCustomer', { customerData: { ...good, CustomerName: 'Oman Imports', Classification: exportId || 'Export', Country: 'Oman' } });
  assert.equal(ex.success, true, JSON.stringify(ex));
  const saved = await val('customers/' + ex.customerId);
  assert.equal(saved.Classification, 'Export');
  assert.equal(saved.Country, 'Oman');
  const list = await call('u-admin', 'getCustomers');
  assert.ok(list.some(c => c.CustomerName === 'Emirates Retail LLC'));
});

test('validation rules', async () => {
  const cases = [
    [{ Classification: 'Export', Country: '' }, 'Select a country for an Export customer.'],
    [{ Classification: 'Martian' }, 'Select a valid, active Classification.'],
    [{ TradeReceivablesAccountID: 'A-AP' }, 'Trade Receivables account must be an Asset-type account.'],
    [{ Category: 'Wizard' }, 'Unknown customer category.'],
    [{ CustomerName: '' }, 'Customer name is required.']
  ];
  for (const [delta, msg] of cases) {
    const r = await call('u-admin', 'saveCustomer', { customerData: { ...good, ...delta } });
    assert.equal(r.error, msg, JSON.stringify(delta));
  }
});

test('permissions, deactivate/reactivate', async () => {
  assert.equal((await call('u-viewer', 'saveCustomer', { customerData: good })).error, 'You do not have permission to modify Customer Master Data.');
  const list = await call('u-admin', 'getCustomers');
  const id = list.find(c => c.CustomerName === 'Emirates Retail LLC').CustomerID;
  assert.equal((await call('u-admin', 'deactivateCustomer', { customerId: id })).success, true);
  assert.equal((await val('customers/' + id)).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateCustomer', { customerId: id })).success, true);
});
