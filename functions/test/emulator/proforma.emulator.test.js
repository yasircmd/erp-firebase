// Proforma Invoice from a Sales Order (owner, 2026-10-24; docs/modules/
// UX_ROUND2.md item 22, decision Q275): its own PI number, from Numbering,
// given on the first print and kept, so every reprint shows the same one.
// Any saved order (a draft too); a cancelled one, the wrong company or no
// access to Sales Orders is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, val, patch } = require('./_helpers');

test.after(async () => { await app.delete(); });

const so = (extra) => Object.assign({ Status: 'Draft', CompanyID: 'C1', CustomerID: 'CU1', SONumber: '', SODate: '2026-10-20',
  Lines: [{ LineID: 'L1', ItemCode: 'RM-000001', OrderedQuantity: 2, UnitPrice: 50, LineTotal: 100 }] }, extra);

test.beforeEach(async () => {
  const f = baseFixture();
  f.salesOrders = { SO1: so({}), SO2: so({ Status: 'Reserved', SONumber: 'SO-26-01-000001', SODate: '2025-12-30' }), SO3: so({ Status: 'Cancelled' }), SO4: so({ CompanyID: 'C2' }) };
  await reset(f);
});

test('the first print gives a PI number from Numbering; reprints keep it', async () => {
  const first = await call('u-admin', 'issueProformaNumber', { soId: 'SO1' });
  assert.match(first.proformaNumber, /^PI-26-\d+-000001$/);
  assert.equal((await val('salesOrders/SO1')).ProformaNumber, first.proformaNumber, 'kept on the order');
  assert.deepEqual(await call('u-admin', 'issueProformaNumber', { soId: 'SO1' }), first, 'the same on every reprint');
  // Its own series, by the order's date: the next order the next number.
  assert.match((await call('u-admin', 'issueProformaNumber', { soId: 'SO2' })).proformaNumber, /^PI-25-\d+-000001$/);
  // A draft save (the ported save merges) keeps it.
  await patch('salesOrders/SO1', { Description: 'changed' });
  assert.equal((await call('u-admin', 'issueProformaNumber', { soId: 'SO1' })).proformaNumber, first.proformaNumber);
});

test('refused: a cancelled order, another company\'s, an unknown one, no access', async () => {
  await assert.rejects(call('u-admin', 'issueProformaNumber', { soId: 'SO3' }), /cancelled Sales Order has no Proforma/);
  await assert.rejects(call('u-admin', 'issueProformaNumber', { soId: 'SO4' }), /not assigned to this Sales Order's company/);
  await assert.rejects(call('u-admin', 'issueProformaNumber', { soId: 'NOPE' }), /Save it first/);
  const f = baseFixture();
  f.salesOrders = { SO1: so({}) };
  f.permissions.SALESORDER = { access: ['Admin'], write: ['Admin'] };
  await reset(f);
  await assert.rejects(call('u-viewer', 'issueProformaNumber', { soId: 'SO1' }), /do not have access to Sales Orders/);
  assert.equal((await val('salesOrders/SO1')).ProformaNumber, undefined, 'nothing given');
});
