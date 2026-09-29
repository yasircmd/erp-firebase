// Fixed Assets phase 1 (docs/modules/FIXED_ASSETS.md): configuration,
// asset master, capitalization from the Fixed Asset Clearing Account
// (fed by real JV, CBT and Vendor Invoice postings), take-over, the
// depreciation run (order, duplicates, catch-up, reversal), additional
// depreciation, reversals and their guards, the registers, approvals,
// company access, and the GL-side guards (JV/CBT refuse asset accounts
// and won't reverse an FA entry or a capitalized purchase).
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

function fixture() {
  const f = baseFixture();
  const acc = (code, name, type, extra) => Object.assign({ AccountCode: code, AccountName: name, AccountType: type, Status: 'Active', IsPostable: true }, extra || {});
  Object.assign(f.coa, {
    'A-FACLR': acc('2300', 'Fixed Asset Clearing', 'Liability'),
    'A-FACLRA': acc('1590', 'Asset Clearing (asset side)', 'Asset'),
    'A-VEH': acc('1600', 'Vehicles', 'Asset'),
    'A-VEHAD': acc('1690', 'Acc. Depreciation Vehicles', 'Asset'),
    'A-LAND': acc('1610', 'Land', 'Asset'),
    'A-DEP': acc('6200', 'Depreciation Expense', 'Expense'),
    'A-ADEP': acc('6210', 'Additional Depreciation', 'Expense'),
    'A-GAIN': acc('4200', 'Gain on Disposal', 'Revenue'),
    'A-LOSS': acc('6300', 'Loss on Disposal', 'Expense'),
    'A-FRT': acc('6100', 'Freight', 'Expense'),
    'A-C2ONLY': acc('1620', 'C2 Asset', 'Asset', { CompanyID: 'C2' })
  });
  f.orgUnits.PC1 = { Type: 'ProfitCenter', Code: 'PC1', Name: 'Trading', Status: 'Active', CompanyID: 'C1' };
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.currencies = { CUR1: { Code: 'AED', Name: 'Dirham', IsDefault: true, Status: 'Active' } };
  return f;
}
test.after(async () => { await app.delete(); });

const ok = (r) => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async (p) => { const r = await p.catch(e => e); return r instanceof Error ? r.message : (r && r.error) || 'no error: ' + JSON.stringify(r); };
const doc = async (col, id) => { const d = await firestore.collection(col).doc(id).get(); return d.exists ? d.data() : null; };
const glLines = async (jvId) => (await doc('journalEntries', jvId)).Lines.map(l => [l.AccountCode, l.Debit, l.Credit, l.CostCenterID || '']);
async function balance(accountId) {
  const snap = await firestore.collection('journalEntries').where('Status', '==', 'Posted').get();
  let b = 0;
  snap.docs.forEach(d => (d.data().Lines || []).forEach(l => { if (l.AccountID === accountId) b += (l.Debit || 0) - (l.Credit || 0); }));
  return Math.round(b * 100) / 100;
}

// Configuration: settings, account determination, classes.
async function configure() {
  ok(await call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLR' }));
  const det = ok(await call('u-admin', 'saveFaAccountDetermination', {
    Code: 'VEH', Name: 'Vehicles', ByCompany: { SHARED: {
      AssetCostAccountID: 'A-VEH', AccumDepAccountID: 'A-VEHAD', DepExpenseAccountID: 'A-DEP', AdditionalDepExpenseAccountID: 'A-ADEP',
      GainAccountID: 'A-GAIN', LossAccountID: 'A-LOSS'
    } }
  }));
  const land = ok(await call('u-admin', 'saveFaAccountDetermination', { Code: 'LAND', Name: 'Land', ByCompany: { SHARED: { AssetCostAccountID: 'A-LAND' } } }));
  const veh = ok(await call('u-admin', 'saveFaClass', {
    Code: 'veh', Name: 'Vehicles', Kind: 'Tangible', DefaultMethod: 'SL', DefaultUsefulLifeMonths: 120, AccountDeterminationID: det.determinationId
  }));
  const lnd = ok(await call('u-admin', 'saveFaClass', { Code: 'LAND', Name: 'Land', Kind: 'Land', AccountDeterminationID: land.determinationId }));
  return { vehClass: veh.classId, landClass: lnd.classId, vehDet: det.determinationId };
}
const newAsset = async (classId, extra) => ok(await call('u-admin', 'saveFaAsset', Object.assign({
  CompanyID: 'C1', ClassID: classId, Description: 'Delivery van', CostCenterID: 'CC1', ProfitCenterID: 'PC1'
}, extra || {})));
// A purchase posted to the clearing account by JV (Dr clearing · Cr bank).
async function jvPurchase(amount, date, text) {
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: text || 'Van purchase', CompanyID: 'C1', Lines: [
    { AccountCode: '2300', Debit: amount, Description: text || 'Van' }, { AccountCode: '1100', Credit: amount, Description: 'Bank' }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: s.jvId }));
  return s.jvId;
}
const items = async () => (await call('u-admin', 'getFaClearingItems', { companyId: 'C1' })).items;
async function capitalize(assetId, picks, date, uid) {
  const s = ok(await call(uid || 'u-admin', 'saveFaPostingDraft', { Type: 'Capitalization', CompanyID: 'C1', Date: date, Description: 'Capitalize',
    Lines: [{ AssetID: assetId, Items: picks }] }));
  return Object.assign(await call(uid || 'u-admin', 'postFaPosting', { postingId: s.postingId }), { postingId: s.postingId });
}
const asset = (id) => doc('faAssets', id);
const book = async (id) => (await asset(id)).Areas.BOOK;

test('configuration: clearing account, account determination and class checks', async () => {
  await reset(fixture());
  const rights = await call('u-viewer', 'getFaRights');
  assert.deepEqual([rights.FACONFIG.access, rights.FACONFIG.write, rights.FADEPRUN.reverse], [true, false, false]);
  assert.match(await err(call('u-viewer', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLR' })), /permission to change Fixed Asset Configuration/);
  assert.match(await err(call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-BANK' })), /must not be a cash or bank account/);
  assert.match(await err(call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-AP' })), /must not be a vendor or customer account/);
  assert.match(await err(call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-DEP' })), /Asset or Liability/);
  assert.match(await err(call('u-admin', 'saveFaSettings', { CompanyID: 'C2', ClearingAccountID: 'A-FACLR' })), /do not have access to that company/);

  assert.match(await err(call('u-admin', 'saveFaAccountDetermination', { Code: 'X', Name: 'X', ByCompany: { SHARED: { DepExpenseAccountID: 'A-VEH' } } })), /Depreciation Expense: must be an account of type Expense/);
  assert.match(await err(call('u-admin', 'saveFaAccountDetermination', { Code: 'X', Name: 'X', ByCompany: { SHARED: { AssetCostAccountID: 'A-C2ONLY' } } })), /can't be in the shared row/);
  assert.match(await err(call('u-admin', 'saveFaAccountDetermination', { Code: 'X', Name: 'X', ByCompany: { SHARED: { AssetCostAccountID: 'A-VEH', AccumDepAccountID: 'A-VEH' } } })), /already used as Asset Cost/);
  const { vehClass, vehDet } = await configure();
  // The clearing account can't become an asset account, nor the reverse.
  ok(await call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLRA' }));
  assert.match(await err(call('u-admin', 'saveFaAccountDetermination', { DeterminationID: vehDet, Code: 'VEH', Name: 'Vehicles', ByCompany: { C1: { AssetCostAccountID: 'A-FACLRA' } } })), /Fixed Asset Clearing Account; it can't also be an asset account/);
  ok(await call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-FACLR' }));
  assert.match(await err(call('u-admin', 'saveFaSettings', { CompanyID: 'C1', ClearingAccountID: 'A-VEH' })), /asset cost, accumulated depreciation or AuC account/);

  assert.match(await err(call('u-admin', 'saveFaClass', { Code: 'VEH', Name: 'Dup', Kind: 'Tangible', DefaultMethod: 'SL', DefaultUsefulLifeMonths: 12, AccountDeterminationID: vehDet })), /already in use/);
  assert.match(await err(call('u-admin', 'saveFaClass', { Code: 'M', Name: 'M', Kind: 'Tangible', DefaultMethod: 'SL', AccountDeterminationID: vehDet })), /Useful life is required/);
  assert.match(await err(call('u-admin', 'saveFaClass', { Code: 'W', Name: 'W', Kind: 'Tangible', DefaultMethod: 'WDV', DefaultUsefulLifeMonths: 60, AccountDeterminationID: vehDet })), /WDV rate is required/);
  const cfg = await call('u-admin', 'getFaConfig');
  assert.deepEqual(cfg.classes.map(c => [c.Code, c.DefaultMethod, c.DefaultUsefulLifeMonths]), [['LAND', 'None', 0], ['VEH', 'SL', 120]]);
  assert.equal(cfg.settings[0].ClearingAccountID, 'A-FACLR');
  assert.ok(vehClass);
});

test('asset master: numbering, mandatory fields, rights, company access, delete', async () => {
  await reset(fixture());
  const { vehClass, landClass } = await configure();
  assert.match(await err(call('u-admin', 'saveFaAsset', { CompanyID: 'C1', Description: 'x', CostCenterID: 'CC1' })), /Select an asset class/);
  assert.match(await err(call('u-admin', 'saveFaAsset', { CompanyID: 'C1', ClassID: vehClass, Description: 'x' })), /Select a Cost Center/);
  assert.match(await err(call('u-admin', 'saveFaAsset', { CompanyID: 'C1', ClassID: vehClass, Description: 'x', CostCenterID: 'CC1', Method: 'WDV' })), /WDV rate is required/);
  assert.match(await err(call('u-viewer', 'saveFaAsset', { CompanyID: 'C1', ClassID: vehClass, Description: 'x', CostCenterID: 'CC1' })), /permission to create or edit entries in Fixed Asset Master/);
  const a = await newAsset(vehClass);
  const b = await newAsset(landClass, { Description: 'Plot 7', CostCenterID: '' });
  assert.deepEqual([a.assetNumber, b.assetNumber], ['FA-01-000001', 'FA-01-000002']);
  const rec = await asset(a.assetId);
  assert.deepEqual([rec.Status, rec.ClassCode, rec.CurrencyCode, rec.Areas.BOOK.Method, rec.Areas.BOOK.UsefulLifeMonths, rec.DepartmentID, rec.LocationID],
    ['Planned', 'VEH', 'AED', 'SL', 120, '', '']);
  assert.equal((await asset(b.assetId)).Areas.BOOK.Method, 'None');
  assert.equal((await call('u-other', 'getFaAssets', {})).length, 0, 'C2 user sees no C1 asset');
  assert.match(await err(call('u-other', 'getFaAsset', { assetId: a.assetId })), /do not have access to that company/);
  ok(await call('u-admin', 'deleteFaAsset', { assetId: b.assetId }));
  assert.equal(await asset(b.assetId), null);
  // The number is never reused.
  assert.equal((await newAsset(vehClass)).assetNumber, 'FA-01-000003');
});

test('capitalization from clearing: JV + CBT + Vendor Invoice, one atomic entry, no double use, guards on the source entries', async () => {
  await reset(fixture());
  const { vehClass } = await configure();
  const a = await newAsset(vehClass);
  const jv = await jvPurchase(100000, '2026-01-05');
  const cbt = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: '2026-01-06', Description: 'Registration',
    CompanyID: 'C1', OppositeLines: [{ AccountCode: '2300', Amount: '5000', Description: 'Registration fee' }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: cbt.jvId }));
  const vi = ok(await call('u-admin', 'saveVendorInvoiceDraft', { invoiceData: { InvoiceDate: '2026-01-07', Description: 'Van body', VendorRefNumber: 'B-1',
    CompanyID: 'C1', VendorID: 'V1', SourceGRNs: [], DirectLines: [{ AccountCode: '2300', Amount: 15000, Description: 'Body work' }, { AccountCode: '6100', Amount: 100, Description: 'Freight', CostCenterID: 'CC1' }] } }));
  ok(await call('u-admin', 'postVendorInvoice', { invoiceId: vi.invoiceId }));
  const viJv = (await (await require('./_helpers').rtdb.ref('vendorInvoices/' + vi.invoiceId).get()).val()).LinkedJVID;

  const open = await call('u-admin', 'getFaClearingItems', { companyId: 'C1' });
  assert.deepEqual(open.items.map(i => [i.VoucherType, i.Open]), [['JV', 100000], ['Bank Payment', 5000], ['VendorInvoice', 15000]]);
  assert.equal(open.openTotal, 120000);
  assert.equal(open.items[2].VendorName, 'Acme Metals');
  const pick = (i, amount) => ({ JVID: open.items[i].JVID, LineNo: open.items[i].LineNo, Amount: amount });

  // Not before the purchase; not more than is open.
  assert.match(await err(call('u-admin', 'saveFaPostingDraft', { Type: 'Capitalization', CompanyID: 'C1', Date: '2026-01-04', Lines: [{ AssetID: a.assetId, Items: [pick(0, 100000)] }] })), /before JV-/);
  assert.match(await err(call('u-admin', 'saveFaPostingDraft', { Type: 'Capitalization', CompanyID: 'C1', Date: '2026-01-10', Lines: [{ AssetID: a.assetId, Items: [pick(0, 100001)] }] })), /only 100000.00 is still open/);

  const r = ok(await capitalize(a.assetId, [pick(0, 100000), pick(1, 5000), pick(2, 15000)], '2026-01-01'.replace('01-01', '01-10')));
  assert.match(r.postingNumber, /^FAA-26-01-\d{6}$/);
  const p = await doc('faPostings', r.postingId);
  assert.equal(p.Status, 'Posted');
  assert.deepEqual(await glLines(p.JVID), [['1600', 120000, 0, 'CC1'], ['2300', 0, 100000, 'CC1'], ['2300', 0, 5000, 'CC1'], ['2300', 0, 15000, 'CC1']]);
  assert.equal((await doc('journalEntries', p.JVID)).VoucherType, 'FACapitalization');
  assert.equal(await balance('A-FACLR'), 0);
  assert.equal(await balance('A-VEH'), 120000);
  const rec = await asset(a.assetId);
  assert.deepEqual([rec.Status, rec.CapitalizationDate, rec.Areas.BOOK.Cost, rec.Areas.BOOK.DepStartDate], ['Active', '2026-01-10', 120000, '2026-01-10']);
  // Blank origin fields come from the items: the Vendor Invoice's vendor and number, the earliest purchase date.
  assert.deepEqual([rec.SupplierID, rec.SupplierName, rec.PurchaseDate], ['V1', 'Acme Metals', '2026-01-05']);
  assert.match(rec.PurchaseInvoiceRef, /^B-1 \/ VINV-26-01-\d{6}$/);
  const txn = await doc('faTransactions', r.postingId + '_' + a.assetId);
  assert.deepEqual([txn.Type, txn.CostDelta, txn.ClearingItems.length], ['Capitalization', 120000, 3]);
  assert.equal((await items()).length, 0, 'nothing left open');

  // The same clearing line can't be capitalized twice.
  const b = await newAsset(vehClass, { Description: 'Second van' });
  assert.match(await err(call('u-admin', 'saveFaPostingDraft', { Type: 'Capitalization', CompanyID: 'C1', Date: '2026-01-10', Lines: [{ AssetID: b.assetId, Items: [pick(0, 1)] }] })), /only 0.00 is still open/);

  // The purchases can't be reversed while capitalized; the FA entry can't be reversed from JV.
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: jv, reversalDate: '2026-01-11' })), /capitalized to fixed assets \(FA-01-000001\)/);
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: cbt.jvId, reversalDate: '2026-01-11' })), /capitalized to fixed assets/);
  assert.match(await err(call('u-admin', 'requestReverseVendorInvoice', { invoiceId: vi.invoiceId, reversalDate: '2026-01-11' })), /capitalized to fixed assets/);
  assert.match(await err(call('u-admin', 'reverseJournalEntry', { jvId: p.JVID, reversalDate: '2026-01-11' })), /posted by FACapitalization — reverse it from that module/);
  assert.ok(viJv);

  // JV and CBT can't post to the asset's own accounts; the clearing account stays open to them.
  assert.match(await err(call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-01-12', Description: 'x', CompanyID: 'C1', Lines: [
    { AccountCode: '1600', Debit: 1, Description: 'a' }, { AccountCode: '1100', Credit: 1, Description: 'b' }] } })), /Line 1: account 1600 is kept by the Fixed Assets module/);
  assert.match(await err(call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Payment', SelectedAccountCode: '1100', JVDate: '2026-01-12', Description: 'x',
    CompanyID: 'C1', OppositeLines: [{ AccountCode: '1690', Amount: '1', Description: 'x' }] } })), /account 1690 is kept by the Fixed Assets module/);

  // Reversal of the capitalization: GL mirrored, asset back to Planned, clearing open again, then the purchase can be reversed.
  assert.match(await err(call('u-admin', 'reverseFaPosting', { postingId: r.postingId, reason: '' })), /A reason is required/);
  ok(await call('u-admin', 'reverseFaPosting', { postingId: r.postingId, reason: 'Wrong asset' }));
  const rp = await doc('faPostings', r.postingId);
  assert.equal(rp.Status, 'Reversed');
  assert.deepEqual(await glLines(rp.ReversalJVID), [['1600', 0, 120000, 'CC1'], ['2300', 100000, 0, 'CC1'], ['2300', 5000, 0, 'CC1'], ['2300', 15000, 0, 'CC1']]);
  assert.equal((await doc('journalEntries', p.JVID)).ReversedByJV, rp.ReversalJVID);
  assert.equal(await balance('A-VEH'), 0);
  const back = await asset(a.assetId);
  assert.deepEqual([back.Status, back.CapitalizationDate, back.Areas.BOOK.Cost, back.Areas.BOOK.DepStartDate], ['Planned', '', 0, '']);
  assert.equal((await items()).length, 3);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: jv, reversalDate: '2026-01-11' }));
  assert.equal((await items()).length, 2, 'a reversed purchase is no longer an open item');
});

test('depreciation run: preview, post, duplicates, order, catch-up, reversal of the latest period only', async () => {
  await reset(fixture());
  const { vehClass } = await configure();
  const a = await newAsset(vehClass, { DepStartDate: '2026-01-01' });
  const b = await newAsset(vehClass, { Description: 'Pick-up', CostCenterID: 'CC2' });
  const j1 = await jvPurchase(120000, '2026-01-01');
  const j2 = await jvPurchase(60000, '2026-01-01', 'Pick-up');
  const it = await items();
  const pickOf = (jvId) => { const i = it.find(x => x.JVID === jvId); return [{ JVID: i.JVID, LineNo: i.LineNo, Amount: i.Open }]; };
  ok(await capitalize(a.assetId, pickOf(j1), '2026-01-01'));

  const pv = await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-01' });
  assert.deepEqual(pv.lines.map(l => [l.AssetNumber, l.Current, l.CatchUp, l.OpeningNBV, l.ClosingNBV]), [['FA-01-000001', 1000, 0, 120000, 119000]]);
  assert.deepEqual([pv.totals.total, pv.blockers.length], [1000, 0]);
  assert.match(await err(call('u-viewer', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' })), /permission to post or reverse entries in Depreciation Run/);
  const r1 = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' }));
  assert.match(r1.jvNumber, /^FAD-26-01-\d{6}$/);
  const run1 = await doc('faRuns', r1.runId);
  assert.deepEqual(await glLines(run1.JVID), [['6200', 1000, 0, 'CC1'], ['1690', 0, 1000, '']]);
  assert.equal((await doc('journalEntries', run1.JVID)).JVDate, '2026-01-31');
  assert.deepEqual([(await book(a.assetId)).AccDep, (await book(a.assetId)).LastDepPeriod], [1000, '2026-01']);
  assert.match(await err(call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' })), /already been posted/);
  assert.match(await err(call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-03' })), /next one is 2026-02/);
  assert.deepEqual((await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-03' })).blockers, ['The next period to post is 2026-02.']);
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-02' }));

  // A back-dated capitalization is caught up in the next run.
  ok(await capitalize(b.assetId, pickOf(j2), '2026-01-01'));
  const pv3 = await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-03' });
  assert.deepEqual(pv3.lines.map(l => [l.AssetNumber, l.Current, l.CatchUp, l.CatchUpFrom]), [['FA-01-000001', 1000, 0, ''], ['FA-01-000002', 500, 1000, '2026-01']]);
  const r3 = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-03' }));
  assert.deepEqual(await glLines((await doc('faRuns', r3.runId)).JVID), [['6200', 1000, 0, 'CC1'], ['6200', 1500, 0, 'CC2'], ['1690', 0, 2500, '']]);
  assert.equal(await balance('A-VEHAD'), -4500);

  // Only the latest period, with the reverse right and a reason.
  assert.match(await err(call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-02', reason: 'x' })), /Only the latest posted period \(2026-03\)/);
  assert.match(await err(call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-03', reason: '' })), /A reason is required/);
  assert.match(await err(call('u-viewer', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-03', reason: 'x' })), /permission to reverse in Depreciation Run/);
  const rv = ok(await call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-03', reason: 'Wrong cost center' }));
  assert.match(rv.reversalNumber, /^FAD-26-01-/);
  assert.equal(await balance('A-VEHAD'), -2000);
  assert.deepEqual([(await book(b.assetId)).AccDep, (await book(b.assetId)).LastDepPeriod], [0, '']);
  assert.equal((await doc('faRuns', r3.runId)).Status, 'Reversed');
  // Posted again after the reversal: same result.
  const again = ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-03' }));
  assert.equal(again.total, 2500);
  assert.equal(await balance('A-VEHAD'), -4500);

  // A capitalization with depreciation after it can't be reversed.
  const capA = (await call('u-admin', 'getFaPostings', { moduleId: 'FAACQ' })).find(x => x.AssetIDs.includes(a.assetId));
  assert.match(await err(call('u-admin', 'reverseFaPosting', { postingId: capA.PostingID, reason: 'x' })), /has a later transaction \(Depreciation 2026-03/);

  // Depreciation register over the quarter.
  const reg = await call('u-admin', 'getFaDepreciationRegister', { companyId: 'C1', fromPeriod: '2026-01', toPeriod: '2026-03' });
  assert.deepEqual(reg.rows.map(r => [r.AssetNumber, r.OpeningNBV, r.Scheduled, r.Additional, r.AccDep, r.ClosingNBV]),
    [['FA-01-000001', 0, 3000, 0, 3000, 117000], ['FA-01-000002', 0, 1500, 0, 1500, 58500]]);
});

test('additional depreciation in the month of the posted run (owner, 2026-09-29): capped after the run, run reversed last', async () => {
  await reset(fixture());
  const { vehClass } = await configure();
  const a = await newAsset(vehClass, { DepStartDate: '2026-01-01' });
  const j = await jvPurchase(120000, '2026-01-01');
  const i = (await items())[0];
  ok(await capitalize(a.assetId, [{ JVID: j, LineNo: i.LineNo, Amount: 120000 }], '2026-01-01'));
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' }));

  // Dated in January, after January's run (1,000, dated 31 Jan): the cap counts that run.
  const draft = (o) => call('u-admin', 'saveFaPostingDraft', Object.assign({ Type: 'AdditionalDepreciation', CompanyID: 'C1', Date: '2026-01-20', Reason: 'Accident damage',
    Lines: [{ AssetID: a.assetId, Amount: 11900 }] }, o));
  assert.match(await err(draft({ Lines: [{ AssetID: a.assetId, Amount: 119000.01 }] })), /at most 119000.00 can be charged/);
  const s = ok(await draft());
  ok(await call('u-admin', 'postFaPosting', { postingId: s.postingId }));
  assert.deepEqual([(await book(a.assetId)).AccDep, (await book(a.assetId)).AccDepAdditional], [12900, 11900]);
  // February spreads the lower remainder: 107,100 over 119 months.
  assert.equal((await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-02' })).lines[0].Current, 900);

  // January's run can't be reversed from under it: newest first.
  const pn = (await doc('faPostings', s.postingId)).PostingNumber;
  assert.match(await err(call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-01', reason: 'redo' })),
    new RegExp('Posted after this run on its assets: ' + pn + '\\. Reverse that first'));
  ok(await call('u-admin', 'reverseFaPosting', { postingId: s.postingId, reason: 'Entered in error' }));
  ok(await call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-01', reason: 'redo' }));
  assert.deepEqual([(await book(a.assetId)).AccDep, (await book(a.assetId)).AccDepAdditional], [0, 0]);
});

test('additional depreciation: limits, entry, lower schedule afterwards, reversal order', async () => {
  await reset(fixture());
  const { vehClass } = await configure();
  const a = await newAsset(vehClass, { DepStartDate: '2026-01-01' });
  const j = await jvPurchase(120000, '2026-01-01');
  const i = (await items())[0];
  ok(await capitalize(a.assetId, [{ JVID: j, LineNo: i.LineNo, Amount: 120000 }], '2026-01-01'));
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' }));

  const draft = (o) => call('u-admin', 'saveFaPostingDraft', Object.assign({ Type: 'AdditionalDepreciation', CompanyID: 'C1', Date: '2026-02-10', Reason: 'Accident damage',
    Lines: [{ AssetID: a.assetId, Amount: 11900 }] }, o));
  assert.match(await err(draft({ Reason: '' })), /A reason is required/);
  assert.match(await err(draft({ Date: '2025-12-20' })), /in or after the last posted depreciation period \(2026-01\)/);
  assert.match(await err(draft({ Lines: [{ AssetID: a.assetId, Amount: 119000.01 }] })), /at most 119000.00 can be charged/);
  const s = ok(await draft());
  const p = ok(await call('u-admin', 'postFaPosting', { postingId: s.postingId }));
  assert.match(p.postingNumber, /^FAU-26-01-/);
  const pd = await doc('faPostings', s.postingId);
  assert.deepEqual(await glLines(pd.JVID), [['6210', 11900, 0, 'CC1'], ['1690', 0, 11900, 'CC1']]);
  assert.deepEqual([(await book(a.assetId)).AccDep, (await book(a.assetId)).AccDepAdditional], [12900, 11900]);

  // 107,100 left over the remaining 119 months.
  const pv = await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-02' });
  assert.equal(pv.lines[0].Current, 900);
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-02' }));
  // Its reversal waits for the later run to be reversed first.
  assert.match(await err(call('u-admin', 'reverseFaPosting', { postingId: s.postingId, reason: 'x' })), /later transaction \(Depreciation 2026-02/);
  ok(await call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-02', reason: 'redo' }));
  ok(await call('u-admin', 'reverseFaPosting', { postingId: s.postingId, reason: 'Damage was repaired' }));
  assert.deepEqual([(await book(a.assetId)).AccDep, (await book(a.assetId)).AccDepAdditional], [1000, 0]);
  assert.equal((await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-02' })).lines[0].Current, 1000);

  // Additional depreciation to the end makes the asset fully depreciated; nothing more runs for it.
  const all = ok(await draft({ Lines: [{ AssetID: a.assetId, Amount: 119000 }] }));
  ok(await call('u-admin', 'postFaPosting', { postingId: all.postingId }));
  assert.equal((await asset(a.assetId)).Status, 'FullyDepreciated');
  assert.equal((await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-02' })).lines.length, 0);
});

test('take-over: no GL entry, continues depreciation from the given period; the register', async () => {
  await reset(fixture());
  const { vehClass, landClass } = await configure();
  const a = await newAsset(vehClass, { Description: 'Old truck' });
  const l = await newAsset(landClass, { Description: 'Plot 7', CostCenterID: '' });
  const bad = (o) => call('u-admin', 'saveFaPostingDraft', Object.assign({ Type: 'TakeOver', CompanyID: 'C1', Date: '2026-03-31',
    Lines: [Object.assign({ AssetID: a.assetId, Cost: 120000, AccDep: 60000, CapitalizationDate: '2021-04-01', LastDepPeriod: '2026-03' }, o)] }));
  assert.match(await err(bad({ AccDep: 120000.01 })), /more than cost less residual/);
  assert.match(await err(bad({ LastDepPeriod: '' })), /last period depreciation was charged/);
  assert.match(await err(bad({ CapitalizationDate: '2026-04-01' })), /on or before the take-over date/);
  const s = ok(await call('u-admin', 'saveFaPostingDraft', { Type: 'TakeOver', CompanyID: 'C1', Date: '2026-03-31', Lines: [
    { AssetID: a.assetId, Cost: 120000, AccDep: 60000, CapitalizationDate: '2021-04-01', LastDepPeriod: '2026-03' },
    { AssetID: l.assetId, Cost: 500000, AccDep: 0, CapitalizationDate: '2019-01-01', LastDepPeriod: '' }] }));
  const p = ok(await call('u-admin', 'postFaPosting', { postingId: s.postingId }));
  assert.match(p.postingNumber, /^FAO-26-01-/);
  assert.equal((await doc('faPostings', s.postingId)).JVID, '');
  assert.equal((await firestore.collection('journalEntries').get()).size, 0, 'no GL entry');
  const t = await asset(a.assetId);
  assert.deepEqual([t.Status, t.CapitalizationDate, t.Areas.BOOK.AccDep, t.Areas.BOOK.LastDepPeriod, t.Areas.BOOK.DepStartDate], ['Active', '2021-04-01', 60000, '2026-03', '2021-04-01']);

  // The first run continues from April: 60,000 left over the 60 months to March 2031.
  const pv = await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-04' });
  assert.deepEqual(pv.lines.map(x => [x.AssetNumber, x.Current, x.CatchUp]), [['FA-01-000001', 1000, 0]]);
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-04' }));

  const reg = await call('u-admin', 'getFaRegister', { companyId: 'C1', asOfDate: '2026-04-30' });
  assert.deepEqual(reg.rows.map(r => [r.AssetNumber, r.OriginalCost, r.Additions, r.AccDep, r.CurrentPeriodDep, r.NBV, r.Status]),
    [['FA-01-000001', 120000, 0, 61000, 1000, 59000, 'Active'], ['FA-01-000002', 500000, 0, 0, 0, 500000, 'Active']]);
  const before = await call('u-admin', 'getFaRegister', { companyId: 'C1', asOfDate: '2026-03-30' });
  assert.equal(before.rows.filter(r => r.Cost).length, 0, 'nothing on the books before the take-over date');

  // History: the take-over, the run, then a change of estimate recorded as a master change.
  ok(await call('u-admin', 'saveFaAsset', Object.assign({}, t, { AssetID: a.assetId, UsefulLifeMonths: 180, Method: 'SL', ResidualValue: 0, ChangeReason: 'Refurbished' })));
  assert.match(await err(call('u-admin', 'saveFaAsset', Object.assign({}, t, { AssetID: a.assetId, CostCenterID: 'CC2' }))), /change its cost center with an Asset Transfer/);
  const h = await call('u-admin', 'getFaAsset', { assetId: a.assetId });
  assert.deepEqual(h.history.map(x => x.Type), ['TakeOver', 'Depreciation', 'MasterChange']);
  assert.deepEqual(h.history[2].Changes, [{ Field: 'UsefulLifeMonths', From: 120, To: 180 }]);
  // Take-over reversal is refused while depreciation follows it.
  assert.match(await err(call('u-admin', 'reverseFaPosting', { postingId: s.postingId, reason: 'x' })), /later transaction/);
});

test('approval gating on capitalization; other company refused', async () => {
  const f = fixture();
  f.approvalConfigurations = { FAACQ: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { FAACQ: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const { vehClass } = await configure();
  const a = await newAsset(vehClass);
  const j = await jvPurchase(1000, '2026-01-01');
  const i = (await items())[0];
  const r = ok(await capitalize(a.assetId, [{ JVID: j, LineNo: i.LineNo, Amount: 1000 }], '2026-01-02'));
  assert.equal(r.status, 'PendingApproval');
  assert.equal((await asset(a.assetId)).Status, 'Planned');
  const tasks = await call('u-approver', 'getPendingApprovalsForUser');
  assert.deepEqual(tasks.map(t => [t.ModuleID, t.ModuleLabel, t.DocumentID]), [['FAACQ', 'Fixed Asset Capitalization', r.postingId]]);
  const d = ok(await call('u-approver', 'decideFaPostingApproval', { postingId: r.postingId, levelNumber: 1, decision: 'Approved' }));
  assert.equal(d.status, 'Approved');
  assert.equal((await asset(a.assetId)).Status, 'Active');
  assert.match(await err(call('u-other', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' })), /do not have access to that company/);
  assert.match(await err(call('u-other', 'getFaClearingItems', { companyId: 'C1' })), /do not have access to that company/);
});

test('a JV drafted to an asset account before it was configured can\'t be approved afterwards', async () => {
  const f = fixture();
  f.approvalConfigurations = { JV: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { JV: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const s = ok(await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: '2026-01-05', Description: 'Old habit', CompanyID: 'C1', Lines: [
    { AccountCode: '1600', Debit: 10, Description: 'a' }, { AccountCode: '1100', Credit: 10, Description: 'b' }] } }));
  assert.equal((await call('u-admin', 'postJournalEntry', { jvId: s.jvId })).status, 'PendingApproval');
  await configure();
  assert.match(await err(call('u-approver', 'decideJournalEntryApproval', { jvId: s.jvId, levelNumber: 1, decision: 'Approved' })), /account 1600 is kept by the Fixed Assets module/);
  assert.equal((await doc('journalEntries', s.jvId)).Status, 'PendingApproval');
});

// ---------- phase 2: retirement (sale, scrap) ----------

function retireFixture() {
  const f = fixture();
  f.companies.C1.OutputTaxAccountID = 'A-VATOUT';
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', TradeReceivablesAccountID: 'A-AR' } };
  return f;
}
const retire = (o) => call('u-admin', 'saveFaPostingDraft', Object.assign({ Type: 'Retirement', CompanyID: 'C1', Reason: 'Replaced' }, o));
async function retired(o) {
  const s = ok(await retire(o));
  const p = ok(await call('u-admin', 'postFaPosting', { postingId: s.postingId }));
  return Object.assign(p, { postingId: s.postingId });
}
// Two capitalized vans, depreciated for January and February.
async function twoVans() {
  const { vehClass } = await configure();
  const a = await newAsset(vehClass, { DepStartDate: '2026-01-01' });
  const b = await newAsset(vehClass, { Description: 'Pick-up', DepStartDate: '2026-01-01' });
  const ja = await jvPurchase(120000, '2026-01-01');
  const jb = await jvPurchase(60000, '2026-01-01', 'Pick-up');
  const it = await items();
  const pick = jv => { const i = it.find(x => x.JVID === jv); return [{ JVID: i.JVID, LineNo: i.LineNo, Amount: i.Open }]; };
  ok(await capitalize(a.assetId, pick(ja), '2026-01-01'));
  ok(await capitalize(b.assetId, pick(jb), '2026-01-01'));
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-01' }));
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-02' }));
  return { vehClass, a: a.assetId, b: b.assetId };
}

test('retirement by sale to a bank with VAT: depreciation to the date, loss, one GL entry, asset disposed', async () => {
  await reset(retireFixture());
  const { a, b } = await twoVans();
  const line = (o) => [Object.assign({ AssetID: a, Proceeds: 100000 }, o)];
  // Guards.
  assert.match(await err(retire({ RetirementType: 'Sale', Date: '2026-02-20', ProceedsTo: 'Bank', BankAccountID: 'A-BANK', Lines: line() })), /after the last posted depreciation month \(2026-02\)/);
  assert.match(await err(retire({ RetirementType: 'Sale', Date: '2026-03-16', ProceedsTo: 'Bank', BankAccountID: 'A-BANK', Lines: line({ Proceeds: 0 }) })), /enter the sale proceeds/);
  assert.match(await err(retire({ RetirementType: 'Scrap', Date: '2026-03-16', Lines: line({ Proceeds: 5 }) })), /a scrapped asset has no proceeds/);
  assert.match(await err(retire({ RetirementType: 'Sale', Date: '2026-03-16', ProceedsTo: 'Bank', BankAccountID: 'A-AR', Lines: line() })), /cash or bank account/);
  assert.match(await err(retire({ RetirementType: 'Sale', Date: '2026-03-16', Reason: '', ProceedsTo: 'Bank', BankAccountID: 'A-BANK', Lines: line() })), /A reason is required/);

  const preview = await call('u-admin', 'previewFaRetirement', { RetirementType: 'Sale', CompanyID: 'C1', Date: '2026-03-16', Reason: 'Sold', ProceedsTo: 'Bank', BankAccountID: 'A-BANK', VatPercent: 5, Lines: line() });
  assert.deepEqual([preview.Lines[0].DepToDate, preview.Lines[0].AccDepTotal, preview.Lines[0].NBV, preview.Lines[0].GainLoss, preview.VatAmount, preview.ReceiptTotal],
    [483.87, 2483.87, 117516.13, -17516.13, 5000, 105000]);

  const r = await retired({ RetirementType: 'Sale', Date: '2026-03-16', ProceedsTo: 'Bank', BankAccountID: 'A-BANK', VatPercent: 5, Lines: line() });
  assert.match(r.postingNumber, /^FAR-26-01-\d{6}$/);
  const p = await doc('faPostings', r.postingId);
  assert.deepEqual(await glLines(p.JVID), [
    ['6200', 483.87, 0, 'CC1'], ['1690', 0, 483.87, 'CC1'], ['1690', 2483.87, 0, 'CC1'], ['1600', 0, 120000, 'CC1'],
    ['6300', 17516.13, 0, 'CC1'], ['1100', 105000, 0, ''], ['2200', 0, 5000, '']]);
  assert.equal((await doc('journalEntries', p.JVID)).VoucherType, 'FARetirement');
  const rec = await asset(a);
  assert.deepEqual([rec.Status, rec.DisposedAt, rec.DisposalType, rec.Areas.BOOK.Cost, rec.Areas.BOOK.AccDep], ['Disposed', '2026-03-16', 'Sale', 0, 0]);
  assert.equal(await balance('A-VEH'), 60000, 'only the pick-up is left');

  // Nothing more on a disposed asset: not in the run, no additional depreciation, no second retirement, no edits.
  const pv = await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-03' });
  assert.deepEqual(pv.lines.map(l => l.AssetNumber), ['FA-01-000002']);
  assert.match(await err(call('u-admin', 'saveFaPostingDraft', { Type: 'AdditionalDepreciation', CompanyID: 'C1', Date: '2026-03-20', Reason: 'x', Lines: [{ AssetID: a, Amount: 1 }] })), /only an Active asset/);
  assert.match(await err(retire({ RetirementType: 'Scrap', Date: '2026-03-20', Lines: [{ AssetID: a }] })), /a Disposed asset can't be retired/);
  assert.match(await err(call('u-admin', 'saveFaAsset', Object.assign({}, rec, { AssetID: a, Description: 'x' }))), /disposed asset can't be changed/);

  // Register: off the books after the date, with the sale's value and loss; on the books before it.
  const after = (await call('u-admin', 'getFaRegister', { companyId: 'C1', asOfDate: '2026-03-31' })).rows.find(x => x.AssetID === a);
  assert.deepEqual([after.OriginalCost, after.Retirements, after.Cost, after.AccDep, after.NBV, after.DisposalValue, after.GainLoss, after.CurrentPeriodDep],
    [120000, -120000, 0, 0, 0, 100000, -17516.13, 483.87]);
  const before = (await call('u-admin', 'getFaRegister', { companyId: 'C1', asOfDate: '2026-03-15' })).rows.find(x => x.AssetID === a);
  assert.deepEqual([before.Cost, before.NBV, before.DisposalValue], [120000, 118000, 0]);
  const h = await call('u-admin', 'getFaAsset', { assetId: a });
  assert.deepEqual(h.history.map(x => x.Type).slice(-2), ['Depreciation', 'Disposal']);

  // Reversal waits for later depreciation months to be reversed.
  ok(await call('u-admin', 'postFaDepreciation', { companyId: 'C1', period: '2026-03' }));
  assert.match(await err(call('u-admin', 'reverseFaPosting', { postingId: r.postingId, reason: 'Sale cancelled' })), /Depreciation up to 2026-03 has been posted since/);
  ok(await call('u-admin', 'reverseFaDepreciation', { companyId: 'C1', period: '2026-03', reason: 'redo' }));
  ok(await call('u-admin', 'reverseFaPosting', { postingId: r.postingId, reason: 'Sale cancelled' }));
  const back = await asset(a);
  assert.deepEqual([back.Status, back.DisposedAt, back.Areas.BOOK.Cost, back.Areas.BOOK.AccDep, back.Areas.BOOK.LastDepPeriod], ['Active', '', 120000, 2000, '2026-02']);
  assert.equal(await balance('A-VEH'), 180000);
  assert.equal(await balance('A-VATOUT'), 0);
  assert.equal((await call('u-admin', 'previewFaDepreciation', { companyId: 'C1', period: '2026-03' })).lines.length, 2, 'depreciated again');
  assert.ok(b);
});

test('the brief\'s example on account and a scrap: gain/loss from NBV, customer open item, reversal guarded by the receipt', async () => {
  await reset(retireFixture());
  const { vehClass } = await configure();
  const take = async (desc) => (await newAsset(vehClass, { Description: desc })).assetId;
  const x = await take('Laptop pool'); const y = await take('Old forklift');
  const to = ok(await call('u-admin', 'saveFaPostingDraft', { Type: 'TakeOver', CompanyID: 'C1', Date: '2026-02-28', Lines: [
    { AssetID: x, Cost: 6000, AccDep: 4000, CapitalizationDate: '2023-03-01', LastDepPeriod: '2026-02' },
    { AssetID: y, Cost: 9000, AccDep: 8000, CapitalizationDate: '2020-01-01', LastDepPeriod: '2026-02' }] }));
  ok(await call('u-admin', 'postFaPosting', { postingId: to.postingId }));

  // Cost 6,000, accumulated 4,000, NBV 2,000, sold for 1,000 on account: loss 1,000.
  const s = await retired({ RetirementType: 'Sale', Date: '2026-03-01', ProceedsTo: 'Customer', CustomerID: 'CU1', Lines: [{ AssetID: x, Proceeds: 1000 }] });
  const sp = await doc('faPostings', s.postingId);
  assert.deepEqual(await glLines(sp.JVID), [['1690', 4000, 0, 'CC1'], ['1600', 0, 6000, 'CC1'], ['6300', 1000, 0, 'CC1'], ['1200', 1000, 0, '']]);
  const arLine = (await doc('journalEntries', sp.JVID)).Lines.find(l => l.AccountCode === '1200');
  assert.deepEqual([arLine.PartyType, arLine.PartyID, arLine.Allocations[0].RefType], ['Customer', 'CU1', 'New']);
  const open = await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' });
  assert.deepEqual(open.map(i => [i.Outstanding, i.Side]), [[1000, 'Dr']]);

  // Scrapped: no proceeds, the NBV of 1,000 is the loss.
  const sc = await retired({ RetirementType: 'Scrap', Date: '2026-03-01', Reason: 'Beyond repair', Lines: [{ AssetID: y }] });
  assert.deepEqual(await glLines((await doc('faPostings', sc.postingId)).JVID), [['1690', 8000, 0, 'CC1'], ['1600', 0, 9000, 'CC1'], ['6300', 1000, 0, 'CC1']]);
  // A take-over posts nothing (the GL already held these assets before
  // go-live); this fixture's GL didn't, so the two retirements leave −15,000.
  assert.equal(await balance('A-VEH'), -15000);
  assert.equal(await balance('A-LOSS'), 2000);

  // The customer pays, allocated to the sale: the sale can't be reversed until that receipt is.
  const rc = ok(await call('u-admin', 'saveCbtDraft', { cbtData: { VoucherType: 'Bank Receipt', SelectedAccountCode: '1100', JVDate: '2026-03-10', Description: 'Receipt',
    CompanyID: 'C1', CostCenterID: 'CC1', OppositeLines: [{ AccountCode: '1200', Amount: 1000, Description: 'Laptops', PartyType: 'Customer', PartyID: 'CU1',
      Allocations: [{ RefType: 'Against', RefID: open[0].RefID, Amount: 1000 }] }] } }));
  ok(await call('u-admin', 'postJournalEntry', { jvId: rc.jvId }));
  assert.match(await err(call('u-admin', 'reverseFaPosting', { postingId: s.postingId, reason: 'x' })), /allocat|settled/i);
  ok(await call('u-admin', 'reverseJournalEntry', { jvId: rc.jvId, reversalDate: '2026-03-10' }));
  ok(await call('u-admin', 'reverseFaPosting', { postingId: s.postingId, reason: 'Wrong buyer' }));
  assert.equal((await call('u-admin', 'getPartyOpenItems', { partyType: 'Customer', partyId: 'CU1', companyId: 'C1' })).length, 0);
  assert.equal((await asset(x)).Status, 'Active');
});
