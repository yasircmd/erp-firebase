// Long jobs take the posting lock per step, not for the whole run
// (docs/modules/LOCKING.md, step 3, Q424; owner, 2026-11-07): a depreciation
// run interrupted after its first chunk is resumed: the chunk already written
// is skipped (checked under the lock, per chunk), every asset depreciated
// once, one GL entry; a second Post meanwhile finds it posted; a JV posts too.
// (The emulator serves one function's calls one at a time, so a true race of
// two Posts is not reproduced here; the check under the lock is what guards it.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const N = 230; // two chunks of 200
const PERIOD = '2026-01';

function fixture() {
  const f = baseFixture();
  const acc = (code, name, type) => ({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true });
  Object.assign(f.coa, { 'A-VEHAD': acc('1690', 'Acc. Depreciation Vehicles', 'Asset'), 'A-DEP': acc('6200', 'Depreciation Expense', 'Expense') });
  f.orgUnits.PC1 = { Type: 'ProfitCenter', Code: 'PC1', Name: 'Trading', Status: 'Active', CompanyID: 'C1' };
  return f;
}
// An interrupted run as postFaDepreciation leaves it: Status Posting, its first chunk (200 assets) written.
async function seedRun() {
  const lines = [];
  for (let i = 0; i < N; i++) {
    const id = 'AS' + String(i).padStart(4, '0');
    const written = i < 200;
    await firestore.collection('faAssets').doc(id).set({ CompanyID: 'C1', AssetNumber: 'FA-' + id, Status: 'Active',
      Areas: { BOOK: { AccDep: written ? 10 : 0, AccDepScheduled: written ? 10 : 0, LastDepPeriod: written ? PERIOD : '' } } });
    if (written) await firestore.collection('faTransactions').doc('FAR-T_' + id).set({ AssetID: id, CompanyID: 'C1', Area: 'BOOK', Type: 'Depreciation', Period: PERIOD, AccDepDelta: 10, RunID: 'FAR-T' });
    lines.push({ AssetID: id, AssetNumber: 'FA-' + id, Amount: 10, Current: 10, CatchUp: 0, CatchUpFrom: '', PrevLastDepPeriod: '',
      ExpenseAccountID: 'A-DEP', AccumAccountID: 'A-VEHAD', CostCenterID: 'CC1', ProfitCenterID: 'PC1', FullyDepreciated: false });
  }
  await firestore.collection('faRuns').doc('FAR-T').set({ CompanyID: 'C1', Area: 'BOOK', Period: PERIOD, Status: 'Posting', Lines: lines, PostingDate: '2026-01-31',
    Total: N * 10, ChunksDone: [0], PrevLastPostedPeriod: '', CreatedAt: '2026-02-01T00:00:00Z', CreatedBy: 'test' });
  await firestore.collection('faPeriods').doc('C1_BOOK_' + PERIOD).set({ CompanyID: 'C1', Area: 'BOOK', Period: PERIOD, Status: 'Posting', RunID: 'FAR-T' });
  await firestore.collection('faRunState').doc('C1').set({ CompanyID: 'C1', RunInProgress: 'FAR-T' });
}

test('a run interrupted after its first chunk resumes: that chunk skipped, every asset once, one GL entry; a second Post finds it posted', async () => {
  await reset(fixture());
  await seedRun();
  const post = () => call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: PERIOD }).catch(e => ({ error: e.message }));
  const jv = async () => {
    const s = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-01-15', Description: 'Meanwhile', CompanyID: 'C1',
      Lines: [{ AccountCode: '1000', Debit: 5, Description: 'a' }, { AccountCode: '1100', Credit: 5, Description: 'b' }] } });
    return call('u-admin', 'postJournalEntry', { jvId: s.jvId });
  };
  const [r1, r2, j] = await Promise.all([post(), post(), jv()]);
  assert.ok([r1, r2].every(r => r.success || /already been posted/.test(r.error || '')), JSON.stringify([r1, r2]));
  assert.equal(j.success, true, j.error);
  const run = (await firestore.collection('faRuns').doc('FAR-T').get()).data();
  assert.equal(run.Status, 'Posted');
  assert.deepEqual([...run.ChunksDone].sort(), [0, 1]);
  const assets = await firestore.collection('faAssets').get();
  const accDep = assets.docs.map(d => d.data().Areas.BOOK.AccDep);
  assert.equal(accDep.filter(v => v === 10).length, N, 'each asset depreciated once: ' + JSON.stringify([...new Set(accDep)]));
  assert.equal((await firestore.collection('faTransactions').where('RunID', '==', 'FAR-T').get()).size, N);
  const gl = await firestore.collection('journalEntries').where('FixedAssetRunID', '==', 'FAR-T').get();
  assert.equal(gl.size, 1, 'one GL entry');
  assert.equal(gl.docs[0].data().TotalDebit, N * 10);
  assert.equal((await firestore.collection('faRunState').doc('C1').get()).data().RunInProgress, '');
});
