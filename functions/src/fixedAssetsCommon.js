// Fixed Assets (Asset Accounting, FI-AA) — shared pieces of the
// sub-modules (docs/modules/FIXED_ASSETS.md). New development,
// hand-written.
//
// Storage is Firestore, so an asset transaction, its GL entry and the
// asset's cached balances are written in one atomic commit:
//   faSettings/{companyId}            clearing account, reserved lock date (configuration)
//   faRunState/{companyId}            last posted period, run in progress (transactional)
//   faClasses/{id}                    asset classes
//   faAccountDetermination/{id}       GL accounts per company ('' = shared row)
//   faAssets/{id}                     asset master + cached balances per area
//   faTransactions/{id}               the sub-ledger, append-only
//   faPostings/{id}                   capitalization / take-over / additional depreciation documents
//   faClearingUse/{jvId_lineNo}       what has been capitalized from each clearing line
//   faRuns/{id}, faPeriods/{company_area_period}   depreciation runs; the period record blocks duplicates
// The asset-number counter is in RTDB (fa/counters/asset/{companyRef}),
// taken under the global lock like the voucher counters.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { rtdb, firestore } = require('./firebaseAdmin');
const { moduleHasCapability } = require('./auth');
const { userCanAccessCompany, getCompanyRefCode } = require('./glWriting');

const AREA = 'BOOK';
// Key of an account determination's shared row (Firestore map keys can't be empty).
const SHARED = 'SHARED';
const COL = {
  settings: 'faSettings', classes: 'faClasses', determination: 'faAccountDetermination', assets: 'faAssets',
  txns: 'faTransactions', postings: 'faPostings', clearingUse: 'faClearingUse', runs: 'faRuns', periods: 'faPeriods',
  runState: 'faRunState'
};
const MODULES = {
  FACONFIG: 'Fixed Asset Configuration', FAASSET: 'Fixed Asset Master', FAACQ: 'Fixed Asset Capitalization',
  FADEPRUN: 'Depreciation Run', FAADDDEP: 'Additional Depreciation', FAREGISTER: 'Fixed Asset Register'
};
const CLASS_KINDS = ['Tangible', 'Land', 'Intangible', 'AuC'];
// Account determination: field, label, required account type(s).
const ACCOUNT_FIELDS = [
  { field: 'AssetCostAccountID', label: 'Asset Cost', types: ['Asset'] },
  { field: 'AccumDepAccountID', label: 'Accumulated Depreciation', types: ['Asset'] },
  { field: 'DepExpenseAccountID', label: 'Depreciation Expense', types: ['Expense'] },
  { field: 'AdditionalDepExpenseAccountID', label: 'Additional Depreciation Expense', types: ['Expense'] },
  { field: 'GainAccountID', label: 'Gain on Disposal', types: ['Revenue'] },
  { field: 'LossAccountID', label: 'Loss on Disposal', types: ['Expense'] },
  { field: 'AuCAccountID', label: 'Assets under Construction', types: ['Asset'] },
  { field: 'ClearingAccountID', label: 'Fixed Asset Clearing (override)', types: ['Asset', 'Liability'] }
];
// Accounts only the asset module may post to (JV/CBT refuse them).
const CONTROLLED_FIELDS = ['AssetCostAccountID', 'AccumDepAccountID', 'AuCAccountID'];
// Statuses that hold capitalized value on the books.
const ON_BOOKS = ['Active', 'FullyDepreciated'];

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const str = v => String(v == null ? '' : v).trim();
const actorOf = user => user.profile.username || user.uid;
const nowIso = () => new Date().toISOString();
const newId = prefix => prefix + '-' + require('crypto').randomUUID().split('-')[0].toUpperCase();

async function requireCap(moduleId, cap, role) {
  if (await moduleHasCapability(moduleId, cap, role)) return;
  const label = MODULES[moduleId] || moduleId;
  if (cap === 'access') throw new HttpsError('permission-denied', 'You do not have access to ' + label + '.');
  if (cap === 'draft') throw new Error('You do not have permission to create or edit entries in ' + label + '.');
  if (cap === 'write') throw new Error('You do not have permission to change ' + label + '.');
  if (cap === 'reverse') throw new Error('You do not have permission to reverse in ' + label + '.');
  throw new Error('You do not have permission to post or reverse entries in ' + label + '.');
}

function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Select a Company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}

// Every rights flag the Fixed Asset screens need, in one call.
async function rightsFor(role) {
  const out = {};
  for (const id of Object.keys(MODULES)) {
    out[id] = {};
    for (const cap of ['access', 'draft', 'post', 'write', 'reverse']) out[id][cap] = await moduleHasCapability(id, cap, role);
  }
  return out;
}

const docsOf = snap => snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
async function getDoc(col, id) {
  if (!id) return null;
  const d = await firestore.collection(col).doc(id).get();
  return d.exists ? Object.assign({ _id: d.id }, d.data()) : null;
}
async function listWhere(col, field, value) {
  return docsOf(await firestore.collection(col).where(field, '==', value).get());
}
async function coa() { return (await rtdb.ref('coa').get()).val() || {}; }

// A company's settings merged with its run state (read-only view).
async function getSettings(companyId) {
  const [settings, state] = await Promise.all([getDoc(COL.settings, companyId), getDoc(COL.runState, companyId)]);
  return Object.assign({ CompanyID: companyId, ClearingAccountID: '', LockedThroughDate: '' }, settings || {},
    { LastPostedPeriod: (state && state.LastPostedPeriod) || '', RunInProgress: (state && state.RunInProgress) || '' });
}

// The reserved posting guard (docs → Reserved for later): every asset
// post goes through it. Today: company access, and the reserved lock
// date if one is ever set. A period lock is added here later.
async function assertFaPostingOpen(user, companyId, date) {
  requireCompany(user, companyId);
  if (!isDate(date)) throw new HttpsError('invalid-argument', 'A valid date is required.');
  const s = await getSettings(companyId);
  if (s.LockedThroughDate && date <= s.LockedThroughDate) {
    throw new Error('Fixed asset postings are locked up to ' + s.LockedThroughDate + ' for this company.');
  }
  return s;
}

// The accounts a class uses for a company: the company's row of its
// account determination, else the shared row (SHARED); the clearing account
// falls back to the company setting.
async function accountsFor(cls, companyId, settings) {
  const det = await getDoc(COL.determination, cls.AccountDeterminationID);
  if (!det || det.Status !== 'Active') throw new Error('Class ' + cls.Code + ' has no active account determination.');
  const rows = det.ByCompany || {};
  const row = Object.assign({}, rows[SHARED] || {}, rows[companyId] || {});
  if (!row.ClearingAccountID) row.ClearingAccountID = (settings || await getSettings(companyId)).ClearingAccountID || '';
  return { det: det, accounts: row };
}

// One account of `accounts`, checked for use by this company. Refuses a
// missing one with a message naming the class and the account.
function requireAccount(accounts, field, cls, companyId, chart, fallbackField) {
  let id = accounts[field];
  if (!id && fallbackField) id = accounts[fallbackField];
  const spec = ACCOUNT_FIELDS.find(f => f.field === field);
  const label = spec ? spec.label : field;
  if (!id) throw new Error(cls.Name + ': no ' + label + ' account for this company — set it in Fixed Asset Configuration → Account Determination.');
  const a = chart[id];
  if (!a || a.Status !== 'Active' || a.IsPostable !== true) throw new Error(cls.Name + ': the ' + label + ' account is no longer an active, postable account.');
  if (a.CompanyID && a.CompanyID !== companyId) throw new Error(cls.Name + ': the ' + label + ' account belongs to a different company.');
  return Object.assign({ AccountID: id }, a);
}

// Every account id any account determination row uses for asset cost,
// accumulated depreciation or AuC: JV and CBT refuse lines on them.
async function controlledAccountIds() {
  const dets = docsOf(await firestore.collection(COL.determination).get());
  const ids = new Set();
  dets.forEach(d => Object.values(d.ByCompany || {}).forEach(row => CONTROLLED_FIELDS.forEach(f => { if (row[f]) ids.add(row[f]); })));
  return ids;
}

// For journal.js: refuses JV/CBT lines on asset-controlled accounts.
async function assertNoFaControlledAccounts(lines) {
  const ids = await controlledAccountIds();
  if (!ids.size) return;
  (lines || []).forEach((l, i) => {
    if (ids.has(l.AccountID)) {
      throw new Error('Line ' + (i + 1) + ': account ' + l.AccountCode + ' is kept by the Fixed Assets module (asset cost, accumulated depreciation or AuC). Post to the Fixed Asset Clearing Account and capitalize from there.');
    }
  });
}

// Every clearing account in use by this company: the setting plus any
// account-determination override.
async function clearingAccountIds(companyId) {
  const ids = new Set();
  const s = await getSettings(companyId);
  if (s.ClearingAccountID) ids.add(s.ClearingAccountID);
  docsOf(await firestore.collection(COL.determination).get()).forEach(d => {
    const rows = d.ByCompany || {};
    [rows[SHARED], rows[companyId]].forEach(r => { if (r && r.ClearingAccountID) ids.add(r.ClearingAccountID); });
  });
  return ids;
}

// Refuses reversing a GL entry (JV, CBT, Vendor Invoice) while some of
// its clearing lines have been capitalized to an asset.
async function assertEntryNotCapitalized(jvId) {
  if (!jvId) return;
  const uses = await listWhere(COL.clearingUse, 'JVID', jvId);
  const used = uses.filter(u => round2(u.Capitalized || 0) > 0);
  if (used.length) {
    const assets = [...new Set(used.flatMap(u => (u.Uses || []).filter(x => !x.Reversed).map(x => x.AssetNumber)))].join(', ');
    throw new Error('This entry has been capitalized to fixed assets (' + assets + '). Reverse the capitalization in Fixed Asset Capitalization first.');
  }
}

// The next asset number, FA-<company ref>-<6 digits>. Caller holds the
// global lock; the counter never goes back.
async function nextAssetNumber(companyId) {
  const ref = await getCompanyRefCode(companyId);
  const path = 'fa/counters/asset/' + ref;
  const current = (await rtdb.ref(path).get()).val() || 0;
  await rtdb.ref(path).set(current + 1);
  return 'FA-' + ref + '-' + String(current + 1).padStart(6, '0');
}

// All transactions of an asset for one area, oldest first.
async function assetTxns(assetId) {
  return (await listWhere(COL.txns, 'AssetID', assetId))
    .filter(t => (t.Area || AREA) === AREA)
    .sort((a, b) => (a.Date + a.CreatedAt).localeCompare(b.Date + b.CreatedAt));
}

// The engine's view of an asset (faDepreciation.computeScheduled).
function engineAsset(asset, txns) {
  const b = (asset.Areas || {})[AREA] || {};
  return {
    valuation: { Method: b.Method, UsefulLifeMonths: b.UsefulLifeMonths, WdvRate: b.WdvRate, ResidualValue: b.ResidualValue, DepStartDate: b.DepStartDate },
    txns: txns.filter(t => t.CostDelta || t.AccDepDelta),
    lastDepPeriod: b.LastDepPeriod || ''
  };
}

function assertBatchSize(n) {
  if (n > 490) throw new Error('Too many assets in one posting (' + n + ' writes); split it.');
}

module.exports = {
  AREA, SHARED, COL, MODULES, CLASS_KINDS, ACCOUNT_FIELDS, CONTROLLED_FIELDS, ON_BOOKS,
  round2, isDate, str, actorOf, nowIso, newId, docsOf, getDoc, listWhere, coa,
  requireCap, requireCompany, rightsFor, getSettings, assertFaPostingOpen, accountsFor, requireAccount,
  controlledAccountIds, assertNoFaControlledAccounts, clearingAccountIds, assertEntryNotCapitalized,
  nextAssetNumber, assetTxns, engineAsset, assertBatchSize
};
