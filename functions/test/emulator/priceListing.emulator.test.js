// PRICELISTING through its screen's callables.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, today } = require('./_helpers');

test.before(async () => {
  const f = baseFixture();
  f.currencies = { 'CUR-AED': { Code: 'AED', Name: 'UAE Dirham', Symbol: 'AED', IsDefault: true, Status: 'Active' } };
  await reset(f);
});
test.after(async () => { await app.delete(); });

const state = {};

test('create a price list mapped to Local; second Local list for same company refused', async () => {
  assert.ok((await call('u-admin', 'getActiveCurrencies')).some(c => c.Code === 'AED'));
  const r = await call('u-admin', 'savePriceList', { header: { CompanyID: 'C1', Name: 'Retail 2026', CurrencyID: 'CUR-AED', CustomerClassificationMapping: 'Local' } });
  assert.equal(r.success, true, JSON.stringify(r));
  state.pl = r.priceListId;
  const dup = await call('u-admin', 'savePriceList', { header: { CompanyID: 'C1', Name: 'Retail B', CurrencyID: 'CUR-AED', CustomerClassificationMapping: 'Local' } });
  assert.match(dup.error, /is already mapped to Local for this company/);
  assert.ok((await call('u-admin', 'getPriceLists')).some(p => p.PriceListID === state.pl || p.Name === 'Retail 2026'));
});

test('lines: add, validate price/item, list, deactivate', async () => {
  const r = await call('u-admin', 'savePriceListLine', { lineData: { PriceListID: state.pl, ItemCode: 'RM-001', UnitPrice: 12.5, EffectiveFrom: today } });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal((await call('u-admin', 'savePriceListLine', { lineData: { PriceListID: state.pl, ItemCode: 'RM-001', UnitPrice: 0, EffectiveFrom: today } })).error, 'Unit price must be greater than zero.');
  assert.equal((await call('u-admin', 'savePriceListLine', { lineData: { PriceListID: state.pl, ItemCode: 'NOPE', UnitPrice: 1, EffectiveFrom: today } })).error, 'Item not found or inactive: NOPE');
  const lines = await call('u-admin', 'getPriceListLines', { priceListId: state.pl });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].UnitPrice, 12.5);
  assert.equal((await call('u-admin', 'deactivatePriceListLine', { lineId: r.lineId })).success, true);
});

test('permissions; deactivate/reactivate list', async () => {
  assert.equal((await call('u-viewer', 'savePriceList', { header: { CompanyID: 'C1', Name: 'x', CurrencyID: 'CUR-AED' } })).error, 'You do not have permission to modify Price Listing.');
  assert.equal((await call('u-admin', 'deactivatePriceList', { priceListId: state.pl })).success, true);
  assert.equal((await val('priceLists/' + state.pl)).Status, 'Inactive');
  assert.equal((await call('u-admin', 'reactivatePriceList', { priceListId: state.pl })).success, true);
});
