// VENDORMASTER through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val } = require('./_helpers');

test.before(async () => { await reset(baseFixture()); });
test.after(async () => { await app.delete(); });

const good = { VendorName: 'Gulf Steel Trading', Category: 'RawMaterialSupplier', CompanyID: 'C1', Classification: 'Local',
  TradePayablesAccountID: 'A-AP', PaymentTermsDays: 30, Email: 'ap@gulfsteel.test' };

test('create vendor: generated code, listed', async () => {
  const r = await call('u-admin', 'saveVendor', { vendorData: good });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.ok(r.vendorCode);
  const list = await call('u-admin', 'getVendors');
  const v = list.find(x => x.VendorName === 'Gulf Steel Trading');
  assert.ok(v);
  assert.equal(v.PaymentTermsDays, 30);
});

test('validation rules', async () => {
  const cases = [
    [{ Classification: 'Foreign', Country: '' }, 'Select a country for a Foreign vendor.'],
    [{ Classification: 'Nope' }, 'Select Local or Foreign.'],
    [{ TradePayablesAccountID: 'A-INV' }, 'Trade Payables account must be a Liability-type account.'],
    [{ Email: 'not-an-email' }, 'Enter a valid email address.'],
    [{ Category: 'Wizard' }, 'Unknown vendor category.'],
    [{ PaymentTermsDays: -1 }, 'Payment terms (days) must be zero or more.']
  ];
  for (const [delta, msg] of cases) {
    const r = await call('u-admin', 'saveVendor', { vendorData: { ...good, ...delta } });
    assert.equal(r.error, msg, JSON.stringify(delta));
  }
});

test('permissions, company access, deactivate/reactivate', async () => {
  assert.equal((await call('u-viewer', 'saveVendor', { vendorData: good })).error, 'You do not have permission to modify Vendor Master Data.');
  assert.equal((await call('u-other', 'saveVendor', { vendorData: good })).error, 'You do not have access to that company.');
  assert.equal((await call('u-admin', 'deactivateVendor', { vendorId: 'V1' })).success, true);
  assert.equal((await val('vendors/V1')).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivateVendor', { vendorId: 'V1' })).success, true);
  assert.equal((await val('vendors/V1')).Status, 'Active');
});
