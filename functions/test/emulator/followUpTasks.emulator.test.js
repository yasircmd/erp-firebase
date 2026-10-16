// Tier 3, wave 1 (owner, 2026-10-16; docs/modules/UX_TIER3.md, A and B):
// a delivery waiting for its invoice is a Home task for the Invoicing team
// (else its maker) until a posted invoice includes it; PDCs coming due go to
// the Treasury team, some days before the cheque date, where one is set.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, reset, baseFixture, rtdb } = require('./_helpers');

test.after(async () => { await app.delete(); });

const today = new Date().toISOString().slice(0, 10);
const day = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dn = over => Object.assign({ TransactionType: 'DeliveryNote', TransactionNumber: 'DN-1', TransactionDate: day(-1), CompanyID: 'C1', CustomerID: 'CU1',
  Status: 'Posted', CreatedBy: 'admin', UpdatedAt: day(-1) + 'T08:00:00.000Z', Lines: [] }, over || {});
const deliveries = async uid => (await call(uid, 'getMyFollowUpTasksForUser')).filter(t => t.ModuleID === 'DELIVERYNOTE').map(t => t.DocumentNumber);
const pdcs = async uid => (await call(uid, 'getPdcsDueForUser', { today })).map(p => p.DocumentNumber);
const pdc = (n, date) => ({ Direction: 'Received', TransactionNumber: n, Status: 'Pending', ChequeDate: date, ChequeNumber: '1' + n.slice(-2), CompanyID: 'C1', PartyName: 'Beta Trading', Amount: 100 });

test('A: a posted delivery not invoiced: its maker\'s task while no team is set; the team\'s once one is; gone once a posted invoice includes it', async () => {
  const f = baseFixture();
  f.customers = Object.assign(f.customers || {}, { CU1: Object.assign({}, (f.customers || {}).CU1, { CustomerName: 'Beta Trading' }) });
  f.stock = { transactions: {
    D1: dn(), D2: dn({ TransactionNumber: 'DN-2', Status: 'Draft' }), D3: dn({ TransactionNumber: 'DN-3', MatchedToInvoiceID: 'INV1' }),
    D4: dn({ TransactionNumber: 'DN-4', ReversedByDeliveryNoteID: 'D9' }), D5: dn({ TransactionNumber: 'DN-5', CreatedBy: 'other' })
  } };
  await reset(f);
  assert.deepEqual(await deliveries('u-admin'), ['DN-1'], 'the maker; not a draft, invoiced or reversed one');
  const t = (await call('u-admin', 'getMyFollowUpTasksForUser')).find(x => x.DocumentNumber === 'DN-1');
  assert.equal(t.Description, 'To invoice: Beta Trading');
  assert.deepEqual(await deliveries('u-approver'), []);
  // The Invoicing team for company C1: only the team, the maker no longer.
  await rtdb.ref('approvalConfigurations/DELIVERYNOTE').set({ Enabled: false, ScopeType: 'Company', GateType: 'Flat' });
  await call('u-admin', 'saveFollowUpTeam', { moduleId: 'DELIVERYNOTE', scopeKey: 'C1', userIds: ['u-approver'] });
  assert.deepEqual((await deliveries('u-approver')).sort(), ['DN-1', 'DN-5']);
  assert.deepEqual(await deliveries('u-admin'), []);
  // On a draft invoice it stays; matched to a posted one it goes.
  await rtdb.ref('customerInvoices/INV2').set({ Status: 'Draft', SourceDeliveryNotes: [{ DeliveryNoteID: 'D1' }] });
  assert.ok((await deliveries('u-approver')).includes('DN-1'));
  await rtdb.ref('stock/transactions/D1/MatchedToInvoiceID').set('INV2');
  assert.deepEqual(await deliveries('u-approver'), ['DN-5']);
  // A user without Delivery Note access gets none.
  await rtdb.ref('permissions/DELIVERYNOTE/access').set(['Viewer']);
  assert.deepEqual(await deliveries('u-approver'), []);
});

test('B: PDCs due: everyone who may post, from the cheque date, until a Treasury team is set; then only the team, 3 days before; the days are a setting', async () => {
  const f = baseFixture();
  f.pdcCheques = { P1: pdc('PDC-01', day(-1)), P2: pdc('PDC-02', day(2)), P3: pdc('PDC-03', day(5)), P4: Object.assign(pdc('PDC-04', day(0)), { Status: 'Cleared' }) };
  await reset(f);
  assert.deepEqual(await pdcs('u-admin'), ['PDC-01'], 'no team: from the cheque date, as before');
  assert.deepEqual(await pdcs('u-approver'), ['PDC-01']);
  await rtdb.ref('approvalConfigurations/PDCRECEIVED').set({ Enabled: false, ScopeType: 'Company', GateType: 'Flat' });
  const setup = await call('u-admin', 'getFollowUpTeams', { moduleId: 'PDCRECEIVED' });
  assert.equal(setup.daysBefore, 3, 'the default');
  await call('u-admin', 'saveFollowUpTeam', { moduleId: 'PDCRECEIVED', scopeKey: 'C1', userIds: ['u-approver'] });
  assert.deepEqual(await pdcs('u-approver'), ['PDC-01', 'PDC-02'], 'the team: up to 3 days ahead');
  assert.deepEqual(await pdcs('u-admin'), [], 'only the team once one is set');
  await assert.rejects(call('u-admin', 'saveFollowUpTeam', { moduleId: 'PDCRECEIVED', scopeKey: 'C1', userIds: ['u-approver'], daysBefore: 99 }), /whole number from 0 to 60/);
  await call('u-admin', 'saveFollowUpTeam', { moduleId: 'PDCRECEIVED', scopeKey: 'C1', userIds: ['u-approver'], daysBefore: 7 });
  assert.equal((await call('u-admin', 'getFollowUpTeams', { moduleId: 'PDCISSUED' })).daysBefore, 7, 'one setting for both');
  assert.deepEqual(await pdcs('u-approver'), ['PDC-01', 'PDC-02', 'PDC-03']);
  // A team member without the post right still sees it (they act on it); a Viewer outside the team doesn't.
  assert.deepEqual(await pdcs('u-viewer'), []);
});
