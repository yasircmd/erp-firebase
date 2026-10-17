// One stock posting, all or none (functions/src/stockPosting.js;
// docs/modules/TRANSACTIONS_FIRESTORE.md, T1b): the GL entry, the running
// balances and the documents are one Firestore batch. A posting the
// database refuses at commit time leaves none of them behind; before T1b
// the GL entry was already written by then.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'erp1-8f4cd';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const test = require('node:test');
const assert = require('node:assert/strict');
// Before _helpers: firebaseAdmin.js makes the default app only when no app
// exists yet, and _helpers makes a named one.
const { postStock, postedFields } = require('../../src/stockPosting');
const store = require('../../src/stockStore');
const { app, reset, baseFixture, firestore, today } = require('./_helpers');

test.after(async () => { await app.delete(); });

const user = { uid: 'u-admin', profile: { username: 'admin', role: 'Admin', AssignedCompanies: ['C1'] } };
const gl = id => ({
  type: 'GRN', date: today, description: 'Received ' + id, reference: '',
  lines: [{ AccountCode: '1300', Debit: 25, Credit: 0, Description: 'Steel' }, { AccountCode: '2100', Debit: 0, Credit: 25, Description: 'Steel' }],
  dimensions: { CompanyID: 'C1' }, extra: { SourceTransactionID: id }
});
const draft = { TransactionType: 'GRN', Status: 'Draft', CompanyID: 'C1', TransactionDate: today, Lines: [{ ItemID: 'I1', WarehouseID: 'WH1', Quantity: 5, UnitCost: 5 }] };
const entriesOf = async id => (await firestore.collection('journalEntries').where('SourceTransactionID', '==', id).get()).size;

test('a posting writes its GL entry, its balances and its documents together', async () => {
  await reset(baseFixture());
  const res = await postStock(user, gl('T1'), { 'I1|WH1': { Quantity: 5, AvgCost: 5, TotalValue: 25 } },
    (g, now) => ({ T1: store.applyUpdate(draft, Object.assign(postedFields(g, 'admin', now), { Lines: draft.Lines })) }));
  assert.ok(/^GRN/.test(res.jvNumber), res.jvNumber);
  assert.equal(await entriesOf('T1'), 1);
  const t1 = await store.getTx('T1');
  assert.deepEqual([t1.Status, t1.TransactionNumber, t1.LinkedJVID, t1.TransactionRef], ['Posted', res.jvNumber, res.jvId, res.transactionRef]);
  assert.deepEqual([(await store.getLedgerEntry('I1', 'WH1')).Quantity, (await store.getLedgerEntry('I1', 'WH1')).TotalValue], [5, 25]);
});

test('refused at commit (an original that is gone): no GL entry, no balance, no document is left', async () => {
  await reset(baseFixture());
  await assert.rejects(postStock(user, gl('T2'), { 'I1|WH2': { Quantity: 5, AvgCost: 5, TotalValue: 25 } },
    (g, now) => ({ T2: store.applyUpdate(draft, postedFields(g, 'admin', now)) }),
    // A reversal marks its original's GL entry; this one no longer exists,
    // so the database refuses the whole batch.
    (batch, g) => batch.update(firestore.collection('journalEntries').doc('STKJV-GONE'), { ReversedByJV: g.jvId })));
  assert.equal(await entriesOf('T2'), 0, 'no GL entry');
  assert.equal(await store.getLedgerEntry('I1', 'WH2'), null, 'no balance');
  assert.equal(await store.getTx('T2'), null, 'no document');
});

test('a posting too large for one batch is refused before anything is written', async () => {
  await reset(baseFixture());
  const many = {};
  for (let i = 0; i < 500; i++) many['I' + i + '|WH1'] = { Quantity: 1, AvgCost: 1, TotalValue: 1 };
  await assert.rejects(postStock(user, gl('T3'), many, () => ({ T3: draft })), /too many stock balances at once/);
  assert.equal(await entriesOf('T3'), 0);
  assert.equal(await store.getTx('T3'), null);
});
