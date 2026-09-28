// Capital Work in Progress (FAAUC; owner 2026-09-28; docs/modules/
// FIXED_ASSETS.md → Capital Work in Progress): a CWIP created in Fixed
// Asset Master with an AuC class collects cost from the Fixed Asset
// Clearing Account (with a category), then is settled into existing final
// assets (a Planned one is capitalized, an Active one takes an addition).
// Also: balance and date checks, Settled status, register columns, the
// depreciation run, reversal order, approvals, and the GL-side guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  const acc = (code, name, type) => ({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true });
  Object.assign(f.coa, {
    'A-FACLR': acc('2300', 'Fixed Asset Clearing', 'Liability'),
    'A-VEH': acc('1600', 'Vehicles', 'Asset'),
    'A-VEHAD': acc('1690', 'Acc. Depreciation Vehicles', 'Asset'),
    'A-LAND': acc('1610', 'Land', 'Asset'),
    'A-CWIP': acc('1700', 'Capital Work in Progress', 'Asset'),
    'A-DEP': acc('6200', 'Depreciation Expense', 'Expense')
  });
  f.orgUnits.PC1 = { Type: 'ProfitCenter', Code: 'PC1', Name: 'Trading', Status: 'Active', CompanyID: 'C1' };
  f.currencies = { CUR1: { Code: 'AED', Name: 'Dirham', IsDefault: true, Status: 'Active' } };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async (p) => { const r = await p.catch(e => e); return r instanceof Error ? r.message : (r && r.error) || 'no error: ' + JSON.stringify(r); };
const doc = async (col, id) => { const d = await firestore.collection(col).doc(id).get(); return d.exists ? d.data() : null; };
const glLines = async (jvId) => (await doc('journalEntries', jvId)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort();

async function configure() {
  ok(await call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLR' }));
  const det = ok(await call('u-admin', 'saveFaAccountDetermination', {
    Code: 'VEH', Name: 'Vehicles', ByCompany: { SHARED: { AssetCostAccountID: 'A-VEH', AccumDepAccountID: 'A-VEHAD', DepExpenseAccountID: 'A-DEP' } }
  }));
  const land = ok(await call('u-admin', 'saveFaAccountDetermination', { Code: 'LAND', Name: 'Land', ByCompany: { SHARED: { AssetCostAccountID: 'A-LAND' } } }));
  const auc = ok(await call('u-admin', 'saveFaAccountDetermination', { Code: 'CWIP', Name: 'CWIP', ByCompany: { SHARED: { AuCAccountID: 'A-CWIP' } } }));
  const veh = ok(await call('u-admin', 'saveFaClass', { Code: 'VEH', Name: 'Vehicles', Kind: 'Tangible', DefaultMethod: 'SL', DefaultUsefulLifeMonths: 120, AccountDeterminationID: det.determinationId }));
  const lnd = ok(await call('u-admin', 'saveFaClass', { Code: 'LAND', Name: 'Land', Kind: 'Land', AccountDeterminationID: land.determinationId }));
  const cw = ok(await call('u-admin', 'saveFaClass', { Code: 'CWIP', Name: 'Building under construction', Kind: 'AuC', AccountDeterminationID: auc.determinationId }));
  return { vehClass: veh.classId, landClass: lnd.classId, cwipClass: cw.classId };
}
const newAsset = async (classId, extra) => ok(await call('u-admin', 'saveFaAsset', Object.assign({
  CompanyID: 'C1', ClassID: classId, Description: 'Delivery van', CostCenterID: 'CC1', ProfitCenterID: 'PC1'
}, extra || {})));
async function jvPurchase(amount, date, text) {
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: text || 'Site works', CompanyID: 'C1', Lines: [
    { AccountCode: '2300', Debit: amount, Description: text || 'Works' }, { AccountCode: '1100', Credit: amount, Description: 'Bank' }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  return s.jvId;
}
const items = async () => (await call('u-admin', 'getFaClearingItems', { companyId: 'C1', moduleId: 'FAAUC' })).items;
const pick = async (jvId, amount) => { const i = (await items()).find(x => x.JVID === jvId); return { JVID: jvId, LineNo: i.LineNo, Amount: amount }; };
async function postDoc(data, uid) {
  const s = ok(await call(uid || 'u-admin', 'saveFaPostingDraft', Object.assign({ CompanyID: 'C1', Description: 'CWIP' }, data)));
  return Object.assign(await call(uid || 'u-admin', 'postFaPosting', { postingId: s.postingId }), { postingId: s.postingId });
}
const cost = (cwipId, date, lines) => postDoc({ Type: 'AuCCost', Date: date, Lines: lines.map(l => Object.assign({ AssetID: cwipId }, l)) });
const settle = (cwipId, date, lines) => postDoc({ Type: 'AuCSettlement', Date: date, SourceAssetID: cwipId, Lines: lines });
const asset = (id) => doc('faAssets', id);
const book = async (id) => (await asset(id)).Areas.BOOK;
const reverse = (postingId, reason) => call('u-admin', 'reverseFaPosting', { postingId, reason: reason === undefined ? 'Test' : reason });

test('a CWIP is created in Fixed Asset Master and collects cost from clearing, with a category', async () => {
  await reset(fixture());
  const { vehClass, cwipClass } = await configure();
  // No cost center needed: a CWIP is never depreciated.
  const cw = await newAsset(cwipClass, { Description: 'Warehouse extension', CostCenterID: '', ProfitCenterID: '' });
  assert.equal((await asset(cw.assetId)).Status, 'Planned');
  assert.equal((await asset(cw.assetId)).ClassKind, 'AuC');
  const van = await newAsset(vehClass);
  const j1 = await jvPurchase(5000, '2026-01-05', 'Contractor bill');
  const j2 = await jvPurchase(3000, '2026-01-06', 'Steel');

  // Wrong sub-module, wrong asset, no category, more than open.
  const capErr = await err(postDoc({ Type: 'Capitalization', Date: '2026-01-10', Lines: [{ AssetID: cw.assetId, Items: [await pick(j1, 100)] }] }));
  assert.match(capErr, /Capital Work in Progress takes cost in Capital Work in Progress/);
  assert.match(await err(cost(van.assetId, '2026-01-10', [{ AssetID: van.assetId, Category: 'Materials', Items: [await pick(j1, 100)] }])), /is not a Capital Work in Progress/);
  assert.match(await err(cost(cw.assetId, '2026-01-10', [{ Items: [await pick(j1, 100)] }])), /select a cost category/);
  assert.match(await err(cost(cw.assetId, '2026-01-10', [{ Category: 'Contractors', Items: [await pick(j1, 6000)] }])), /only 5000.00 is still open/);

  const c = ok(await cost(cw.assetId, '2026-01-10', [{ Category: 'Contractors', Items: [await pick(j1, 5000), await pick(j2, 1000)] }]));
  const p = await doc('faPostings', c.postingId);
  assert.equal(p.JVNumber.split('-')[0], 'FAA');
  assert.deepEqual(await glLines(p.JVID), [['1700', 6000, 0], ['2300', 0, 5000], ['2300', 0, 1000]].sort());
  const a = await asset(cw.assetId);
  assert.deepEqual([a.Status, a.Areas.BOOK.Cost], ['UnderConstruction', 6000]);
  assert.deepEqual((await items()).map(i => [i.JVID, i.Open]), [[j2, 2000]], 'clearing amounts used up');
  const txn = await doc('faTransactions', c.postingId + '_' + cw.assetId);
  assert.deepEqual([txn.Type, txn.Category, txn.CostDelta], ['AuCCost', 'Contractors', 6000]);
  // JV can't reverse it; the AuC account is kept by the module.
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: p.JVID, reversalDate: '2026-01-11' })), /posted by FAAuCCost — reverse it from that module/);
  assert.match(await err(call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-01-11', Description: 'x', CompanyID: 'C1', Lines: [
    { AccountCode: '1700', Debit: 1, Description: 'a' }, { AccountCode: '1100', Credit: 1, Description: 'b' }] } })), /account 1700 is kept by the Fixed Assets module/);
});

test('settlement: into a Planned asset (capitalized) and an Active one (addition); Settled at zero; register; run', async () => {
  await reset(fixture());
  const { vehClass, landClass, cwipClass } = await configure();
  const cw = await newAsset(cwipClass, { Description: 'Warehouse extension' });
  const van = await newAsset(vehClass, { Description: 'Fit-out van' });
  const plot = await newAsset(landClass, { Description: 'Plot' });
  const jl = await jvPurchase(1000, '2026-01-02', 'Plot');
  ok(await postDoc({ Type: 'Capitalization', Date: '2026-01-03', Lines: [{ AssetID: plot.assetId, Items: [await pick(jl, 1000)] }] }));
  const j = await jvPurchase(8000, '2026-01-05');
  ok(await cost(cw.assetId, '2026-01-10', [{ Category: 'Materials', Items: [await pick(j, 8000)] }]));

  assert.match(await err(settle(cw.assetId, '2026-01-09', [{ AssetID: van.assetId, Amount: 100 }])), /before FA-01-\d+'s latest cost \(2026-01-10\)/);
  assert.match(await err(settle(cw.assetId, '2026-01-31', [{ AssetID: van.assetId, Amount: 9000 }])), /has 8000.00 to settle on 2026-01-31; this settles 9000.00/);
  assert.match(await err(settle(cw.assetId, '2026-01-31', [{ AssetID: cw.assetId, Amount: 100 }])), /can't be settled into itself/);

  const s1 = ok(await settle(cw.assetId, '2026-01-31', [{ AssetID: van.assetId, Amount: 6000 }]));
  const p1 = await doc('faPostings', s1.postingId);
  assert.equal(p1.JVNumber.split('-')[0], 'FAS');
  assert.deepEqual(await glLines(p1.JVID), [['1600', 6000, 0], ['1700', 0, 6000]]);
  let v = await asset(van.assetId);
  assert.deepEqual([v.Status, v.CapitalizationDate, v.Areas.BOOK.Cost, v.Areas.BOOK.DepStartDate], ['Active', '2026-01-31', 6000, '2026-01-31']);
  assert.deepEqual([(await asset(cw.assetId)).Status, (await book(cw.assetId)).Cost], ['UnderConstruction', 2000]);

  const s2 = ok(await settle(cw.assetId, '2026-02-01', [{ AssetID: plot.assetId, Amount: 2000 }]));
  assert.deepEqual([(await asset(cw.assetId)).Status, (await book(cw.assetId)).Cost], ['Settled', 0]);
  assert.equal((await book(plot.assetId)).Cost, 3000, 'addition to the Active plot');
  const j3 = await jvPurchase(50, '2026-02-02');
  assert.match(await err(cost(cw.assetId, '2026-02-03', [{ Category: 'Other', Items: [await pick(j3, 50)] }])), /Settled Capital Work in Progress takes no more cost/);
  assert.match(await err(settle(cw.assetId, '2026-02-03', [{ AssetID: van.assetId, Amount: 1 }])), /already been fully settled/);

  // Register as at dates: the CWIP's cost, then transferred out.
  const reg = async (d) => Object.fromEntries((await call('u-admin', 'getFaRegister', { companyId: 'C1', asOfDate: d })).rows.map(r => [r.AssetID, [r.OriginalCost, r.Additions, r.Transfers, r.Cost]]));
  let r = await reg('2026-01-15');
  assert.deepEqual(r[cw.assetId], [8000, 0, 0, 8000]);
  assert.equal(r[van.assetId], undefined, 'the van has no cost yet on that date');
  r = await reg('2026-02-28');
  assert.deepEqual(r[cw.assetId], [8000, 0, -8000, 0]);
  assert.deepEqual(r[van.assetId], [6000, 0, 0, 6000], 'first settlement is original cost');
  assert.deepEqual(r[plot.assetId], [1000, 2000, 0, 3000], 'later settlement is an addition');

  // The run depreciates the van, never the CWIP.
  const run = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' }));
  const runDoc = await doc('faRuns', run.runId);
  assert.deepEqual(runDoc.Lines.map(l => l.AssetID), [van.assetId]);
  // Reversing the first settlement is now refused (the van has a later run).
  assert.match(await err(reverse(s1.postingId)), /has a later transaction \(Depreciation 2026-01/);
  assert.ok(s2.postingId);
});

test('reversal order: settlements before cost; everything restored', async () => {
  await reset(fixture());
  const { vehClass, cwipClass } = await configure();
  const cw = await newAsset(cwipClass, { Description: 'Plant' });
  const van = await newAsset(vehClass);
  const j = await jvPurchase(4000, '2026-03-01');
  const c = ok(await cost(cw.assetId, '2026-03-02', [{ Category: 'Labour', Items: [await pick(j, 4000)] }]));
  const s = ok(await settle(cw.assetId, '2026-03-20', [{ AssetID: van.assetId, Amount: 4000 }]));
  assert.equal((await asset(cw.assetId)).Status, 'Settled');

  assert.match(await err(reverse(c.postingId)), /has a later transaction \(AuCSettlementOut/);
  assert.match(await err(reverse(s.postingId, '')), /A reason is required/);
  ok(await reverse(s.postingId, 'Wrong asset'));
  const v = await asset(van.assetId);
  assert.deepEqual([v.Status, v.CapitalizationDate, v.Areas.BOOK.Cost, v.Areas.BOOK.DepStartDate || ''], ['Planned', '', 0, '']);
  assert.deepEqual([(await asset(cw.assetId)).Status, (await book(cw.assetId)).Cost], ['UnderConstruction', 4000]);
  const sp = await doc('faPostings', s.postingId);
  assert.deepEqual(await glLines(sp.ReversalJVID), [['1600', 0, 4000], ['1700', 4000, 0]]);

  ok(await reverse(c.postingId, 'Wrong project'));
  assert.deepEqual([(await asset(cw.assetId)).Status, (await book(cw.assetId)).Cost], ['Planned', 0]);
  assert.deepEqual((await items()).map(i => [i.JVID, i.Open]), [[j, 4000]], 'clearing amount open again');
  // Register as at the settlement date shows nothing left once both are reversed.
  const rows = (await call('u-admin', 'getFaRegister', { companyId: 'C1', asOfDate: '2026-03-31' })).rows;
  assert.deepEqual(rows.filter(r => r.Cost || r.Transfers).map(r => r.AssetNumber), []);
});

test('approval gating on CWIP postings; Home task label', async () => {
  const f = fixture();
  f.approvalConfigurations = { FAAUC: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { FAAUC: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const { cwipClass } = await configure();
  const cw = await newAsset(cwipClass, { Description: 'Office fit-out' });
  const j = await jvPurchase(700, '2026-04-01');
  const r = ok(await cost(cw.assetId, '2026-04-02', [{ Category: 'Consultants', Items: [await pick(j, 700)] }]));
  assert.equal(r.status, 'PendingApproval');
  assert.equal((await asset(cw.assetId)).Status, 'Planned');
  const tasks = await call('u-approver', 'getPendingApprovalsForUser');
  assert.deepEqual(tasks.map(t => [t.ModuleID, t.ModuleLabel, t.DocumentID]), [['FAAUC', 'Capital Work in Progress', r.postingId]]);
  ok(await call('u-approver', 'decideFaPostingApproval', { postingId: r.postingId, levelNumber: 1, decision: 'Approved' }));
  assert.deepEqual([(await asset(cw.assetId)).Status, (await book(cw.assetId)).Cost], ['UnderConstruction', 700]);
  // A viewer can see, not post.
  assert.match(await err(call('u-viewer', 'saveFaPostingDraft', { Type: 'AuCCost', CompanyID: 'C1', Date: '2026-04-03', Lines: [] })), /permission/);
});
