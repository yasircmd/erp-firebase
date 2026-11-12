// Module Builder, phase 4 (MODULE_BUILDER.md, Q481-Q488): a variant's
// definition checked (its original, its own prefix, labels, hidden fields never
// a required one, defaults, extra fields); its registry entry (the original's
// rights, storage and an approvals row where the original has one); the
// variant a request runs in.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/builtDefinitions');
const V = require('../../src/variantContext');
const { BASES } = require('../../src/variantSpec');

const ROOM_INVOICE = { id: 'X_RINV', label: 'Room Invoice', kind: 'variant', base: 'CUSTOMERINVOICE', numbering: { prefix: 'rinv' },
  labels: { customer: 'Guest', description: 'Stay' }, hidden: ['division', 'branch'], defaults: { description: 'Room charges' },
  fields: [{ key: 'room', label: 'Room', type: 'text' }, { key: 'nights', label: 'Nights', type: 'number' }] };

test('a variant: its original, its own prefix, labels, hidden (never required) fields, defaults, extra fields', () => {
  const v = B.cleanDefinition(ROOM_INVOICE, []);
  assert.deepEqual([v.kind, v.base, v.numbering.prefix, v.labels, v.hidden, v.defaults, v.fields.map(f => f.key), v.printTitle],
    ['variant', 'CUSTOMERINVOICE', 'RINV', { customer: 'Guest', description: 'Stay' }, ['division', 'branch'], { description: 'Room charges' }, ['room', 'nights'], 'Room Invoice']);
  const no = (x, re) => assert.throws(() => B.cleanDefinition(Object.assign({}, ROOM_INVOICE, x), []), re);
  no({ base: 'GRN' }, /ERP document it is a variant of/);
  no({ numbering: { prefix: 'R' } }, /prefix of 2 to 8/);
  no({ numbering: { prefix: BASES.CUSTOMERINVOICE.prefix() } }, /is the Customer Invoice's/);
  no({ base: 'SALESORDER', numbering: { prefix: 'SO' }, labels: {}, hidden: [], defaults: {} }, /is the Sales Order's/);
  no({ hidden: ['customer'] }, /Customer is required on a Customer Invoice/);
  no({ hidden: ['nope'] }, /not a field of the Customer Invoice/);
  no({ labels: { vendor: 'Supplier' } }, /not a field of the Customer Invoice a variant may change/);
  no({ fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }] }, /used twice/);
  // Every original's spec: its keys unique, its prefix there.
  Object.entries(BASES).forEach(([id, b]) => {
    assert.equal(new Set(b.fields.map(f => f.key)).size, b.fields.length, id + ' keys');
    assert.ok(String(b.prefix()).length >= 2, id + ' prefix');
  });
});

test('its registry entry: the original\'s rights and storage, an approvals row only where the original has one', () => {
  const reg = [{ id: 'CUSTOMERINVOICE', label: 'Customer Invoice Processing', capabilities: ['access', 'draft', 'post', 'taxcode'] },
    { id: 'SALESORDER', label: 'Sales Order', capabilities: ['access', 'draft', 'post'] }];
  const defaults = {}, gate = [{ ModuleID: 'CUSTOMERINVOICE', Label: 'Customer Invoice Processing' }], storage = { CUSTOMERINVOICE: { type: 'rtdb', path: 'customerInvoices' } };
  const rinv = B.cleanDefinition(ROOM_INVOICE, []);
  const so = B.cleanDefinition({ id: 'X_EVENTSO', label: 'Event Order', kind: 'variant', base: 'SALESORDER', numbering: { prefix: 'EVO' } }, []);
  B.applyToRegistry([rinv, so], reg, defaults, gate, storage);
  assert.deepEqual(reg.filter(m => m.built).map(m => [m.id, m.base, m.capabilities.join('/')]), [['X_RINV', 'CUSTOMERINVOICE', 'access/draft/post/taxcode'], ['X_EVENTSO', 'SALESORDER', 'access/draft/post']]);
  assert.deepEqual(storage.X_RINV, storage.CUSTOMERINVOICE);
  assert.deepEqual(gate.filter(g => g.built).map(g => g.ModuleID), ['X_RINV'], 'a Sales Order has no approvals, so its variant has none');
  assert.deepEqual(Object.keys(defaults.X_RINV), ['access', 'draft', 'post', 'taxcode']);
  B.applyToRegistry([], reg, defaults, gate, storage);
  assert.deepEqual([reg.length, gate.length, 'X_RINV' in storage], [2, 1, false], 'no longer published: taken out');
});

test('the variant a request runs in: only for its original, only inside the request', async () => {
  assert.equal(V.current(), null);
  await V.runWithVariant({ id: 'X_RINV', base: 'CUSTOMERINVOICE', prefix: 'RINV' }, async () => {
    await new Promise(r => setTimeout(r, 1));
    assert.equal(V.forBase('CUSTOMERINVOICE').id, 'X_RINV');
    assert.equal(V.forBase('VENDORINVOICE'), null, 'another module keeps its own rights');
  });
  assert.equal(V.current(), null);
  assert.equal(await V.runWithVariant(null, async () => V.current()), null);
});
