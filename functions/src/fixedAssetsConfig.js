// Fixed Asset Configuration (FACONFIG): asset classes, account
// determination and per-company settings (docs/modules/FIXED_ASSETS.md
// → Master data). Also getFaRights, the one rights call every Fixed
// Asset screen makes.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const { validateValuation } = require('./faDepreciation');
const C = require('./fixedAssetsCommon');
const { COL, str, round2 } = C;

const onCallOptions = { region: 'us-central1' };
const isCashOrBank = a => ['10', '11'].includes(String(a.AccountCode || '').substring(0, 2));

exports.getFaRights = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  return C.rightsFor(user.profile.role);
});

// Everything the configuration screen shows, limited to the user's companies.
exports.getFaConfig = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FACONFIG', 'access', user.profile.role);
  const [classes, dets, settings, chart] = await Promise.all([
    firestore.collection(COL.classes).get(), firestore.collection(COL.determination).get(),
    firestore.collection(COL.settings).get(), C.coa()
  ]);
  const mine = id => !id || userCanAccessCompany(user.profile, id);
  return {
    classes: C.docsOf(classes).filter(c => mine(c.CompanyID)).map(c => Object.assign({ ClassID: c._id }, c))
      .sort((a, b) => a.Code.localeCompare(b.Code)),
    determinations: C.docsOf(dets).map(d => {
      const rows = {};
      Object.keys(d.ByCompany || {}).forEach(k => { if (mine(k)) rows[k] = d.ByCompany[k]; });
      return Object.assign({}, d, { DeterminationID: d._id, ByCompany: rows });
    }).sort((a, b) => a.Code.localeCompare(b.Code)),
    settings: C.docsOf(settings).filter(s => mine(s.CompanyID)),
    accounts: Object.keys(chart)
      .filter(id => chart[id].Status === 'Active' && chart[id].IsPostable === true && mine(chart[id].CompanyID))
      .map(id => ({ AccountID: id, AccountCode: String(chart[id].AccountCode), AccountName: chart[id].AccountName || '', AccountType: chart[id].AccountType, CompanyID: chart[id].CompanyID || '' }))
      .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true })),
    fields: C.ACCOUNT_FIELDS, kinds: C.CLASS_KINDS
  };
});

async function partyControlAccounts() {
  const [v, c] = await Promise.all([rtdb.ref('vendors').get(), rtdb.ref('customers').get()]);
  return new Set([...Object.values(v.val() || {}).map(x => x.TradePayablesAccountID), ...Object.values(c.val() || {}).map(x => x.TradeReceivablesAccountID)].filter(Boolean));
}

// A clearing account: postable, Asset or Liability, not cash/bank, not a
// party's control account, not an account the asset module controls.
async function checkClearing(id, companyId, chart, label) {
  const a = chart[id];
  if (!a || a.Status !== 'Active' || a.IsPostable !== true) throw new Error(label + ' must be an active, postable account.');
  if (!['Asset', 'Liability'].includes(a.AccountType)) throw new Error(label + ' must be an Asset or Liability account.');
  if (isCashOrBank(a)) throw new Error(label + ' must not be a cash or bank account.');
  if (a.CompanyID && a.CompanyID !== companyId) throw new Error(label + ' belongs to a different company.');
  if ((await partyControlAccounts()).has(id)) throw new Error(label + ' must not be a vendor or customer account.');
  if ((await C.controlledAccountIds()).has(id)) throw new Error(label + ' is used as an asset cost, accumulated depreciation or AuC account.');
}

exports.saveFaSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FACONFIG', 'write', user.profile.role);
  const d = request.data || {};
  const companyId = str(d.CompanyID);
  C.requireCompany(user, companyId);
  const clearingId = str(d.ClearingAccountID);
  if (!clearingId) throw new HttpsError('invalid-argument', 'Select the Fixed Asset Clearing Account.');
  await checkClearing(clearingId, companyId, await C.coa(), 'The Fixed Asset Clearing Account');
  await firestore.collection(COL.settings).doc(companyId).set({
    CompanyID: companyId, ClearingAccountID: clearingId, UpdatedAt: C.nowIso(), UpdatedBy: C.actorOf(user)
  }, { merge: true });
  return { success: true };
});

// One company row (or the shared row, key '') of an account determination.
async function checkRow(key, row, chart) {
  const out = {};
  const seen = {};
  for (const spec of C.ACCOUNT_FIELDS) {
    const id = str(row[spec.field]);
    out[spec.field] = id;
    if (!id) continue;
    const a = chart[id];
    const where = (key ? 'Company row' : 'Shared row') + ', ' + spec.label + ': ';
    if (!a || a.Status !== 'Active' || a.IsPostable !== true) throw new Error(where + 'must be an active, postable account.');
    if (!spec.types.includes(a.AccountType)) throw new Error(where + 'must be an account of type ' + spec.types.join(' or ') + '.');
    if (a.CompanyID && a.CompanyID !== key) throw new Error(where + 'account ' + a.AccountCode + ' is restricted to ' + (key ? 'another company' : 'one company, so it can\'t be in the shared row') + '.');
    if (C.CONTROLLED_FIELDS.includes(spec.field) && isCashOrBank(a)) throw new Error(where + 'must not be a cash or bank account.');
    if (C.CONTROLLED_FIELDS.includes(spec.field)) {
      if (seen[id]) throw new Error(where + 'is already used as ' + seen[id] + ' in this row.');
      seen[id] = spec.label;
    }
  }
  if (out.ClearingAccountID) {
    if (C.CONTROLLED_FIELDS.some(f => out[f] === out.ClearingAccountID)) throw new Error('The clearing override must not be one of the row\'s asset accounts.');
    await checkClearing(out.ClearingAccountID, key, chart, (key ? 'Company row' : 'Shared row') + ', Fixed Asset Clearing (override)');
  }
  return out;
}

exports.saveFaAccountDetermination = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FACONFIG', 'write', user.profile.role);
  const d = request.data || {};
  const id = str(d.DeterminationID);
  const code = str(d.Code).toUpperCase();
  const name = str(d.Name);
  if (!code || !name) throw new HttpsError('invalid-argument', 'Code and name are required.');
  const status = str(d.Status) || 'Active';
  if (!['Active', 'Inactive'].includes(status)) throw new HttpsError('invalid-argument', 'Status must be Active or Inactive.');

  return withGlobalLock(user.uid, async () => {
    const all = C.docsOf(await firestore.collection(COL.determination).get());
    if (all.some(x => x._id !== id && String(x.Code).toUpperCase() === code)) throw new Error('Code "' + code + '" is already in use.');
    const existing = id ? all.find(x => x._id === id) : null;
    if (id && !existing) throw new HttpsError('not-found', 'Account determination not found.');
    const chart = await C.coa();
    // Rows of companies the user can't see are kept as they are.
    const rows = Object.assign({}, existing ? existing.ByCompany || {} : {});
    const sent = d.ByCompany || {};
    for (const key of Object.keys(sent)) {
      if (key && !userCanAccessCompany(user.profile, key)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
      const row = await checkRow(key, sent[key] || {}, chart);
      if (Object.values(row).some(Boolean)) rows[key] = row; else delete rows[key];
    }
    // Clearing accounts in company settings must not become controlled.
    const controlled = new Set(Object.values(rows).flatMap(r => C.CONTROLLED_FIELDS.map(f => r[f]).filter(Boolean)));
    const settings = C.docsOf(await firestore.collection(COL.settings).get());
    const clash = settings.find(s => s.ClearingAccountID && controlled.has(s.ClearingAccountID));
    if (clash) throw new Error('Account ' + (chart[clash.ClearingAccountID] || {}).AccountCode + ' is a company\'s Fixed Asset Clearing Account; it can\'t also be an asset account.');

    const now = C.nowIso();
    const fields = { Code: code, Name: name, Status: status, ByCompany: rows, UpdatedAt: now, UpdatedBy: C.actorOf(user) };
    const docId = id || C.newId('FAAD');
    await firestore.collection(COL.determination).doc(docId).set(existing ? fields : Object.assign(fields, { CreatedAt: now, CreatedBy: C.actorOf(user) }), { merge: true });
    return { success: true, determinationId: docId };
  });
});

exports.saveFaClass = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await C.requireCap('FACONFIG', 'write', user.profile.role);
  const d = request.data || {};
  const id = str(d.ClassID);
  const code = str(d.Code).toUpperCase();
  const name = str(d.Name);
  if (!code || !name) throw new HttpsError('invalid-argument', 'Code and name are required.');
  const kind = str(d.Kind);
  if (!C.CLASS_KINDS.includes(kind)) throw new HttpsError('invalid-argument', 'Select the kind of class.');
  const companyId = str(d.CompanyID);
  if (companyId) C.requireCompany(user, companyId);
  const status = str(d.Status) || 'Active';
  if (!['Active', 'Inactive'].includes(status)) throw new HttpsError('invalid-argument', 'Status must be Active or Inactive.');
  const depreciates = kind === 'Tangible' || kind === 'Intangible';
  const method = depreciates ? str(d.DefaultMethod) : 'None';
  const life = depreciates ? Number(d.DefaultUsefulLifeMonths) : 0;
  const rate = method === 'WDV' ? Number(d.DefaultWdvRate) : 0;
  const err = validateValuation({ Method: method, UsefulLifeMonths: life, WdvRate: rate, ResidualValue: 0 }, kind);
  if (err) throw new HttpsError('invalid-argument', 'Default: ' + err);
  const residualPct = Number(d.DefaultResidualPercent) || 0;
  if (residualPct < 0 || residualPct >= 100) throw new HttpsError('invalid-argument', 'Default residual value must be from 0% to less than 100%.');
  const detId = str(d.AccountDeterminationID);
  if (!detId) throw new HttpsError('invalid-argument', 'Select the account determination.');

  return withGlobalLock(user.uid, async () => {
    const det = await C.getDoc(COL.determination, detId);
    if (!det) throw new HttpsError('not-found', 'Account determination not found.');
    const all = C.docsOf(await firestore.collection(COL.classes).get());
    if (all.some(x => x._id !== id && String(x.Code).toUpperCase() === code)) throw new Error('Class code "' + code + '" is already in use.');
    const existing = id ? all.find(x => x._id === id) : null;
    if (id && !existing) throw new HttpsError('not-found', 'Class not found.');
    if (existing) {
      if (existing.CompanyID && !userCanAccessCompany(user.profile, existing.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that class.');
      const used = (await firestore.collection(COL.assets).where('ClassID', '==', id).limit(1).get()).size > 0;
      if (used && existing.Kind !== kind) throw new Error('This class has assets: its kind can\'t change.');
      if (used && (existing.CompanyID || '') !== companyId) throw new Error('This class has assets: its company can\'t change.');
    }
    const now = C.nowIso();
    const fields = {
      Code: code, Name: name, Kind: kind, CompanyID: companyId, Status: status,
      DefaultMethod: method, DefaultUsefulLifeMonths: life, DefaultWdvRate: rate, DefaultResidualPercent: round2(residualPct),
      AccountDeterminationID: detId, UpdatedAt: now, UpdatedBy: C.actorOf(user)
    };
    const docId = id || C.newId('FACL');
    await firestore.collection(COL.classes).doc(docId).set(existing ? fields : Object.assign(fields, { CreatedAt: now, CreatedBy: C.actorOf(user) }), { merge: true });
    return { success: true, classId: docId };
  });
});
