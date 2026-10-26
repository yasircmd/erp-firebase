// Tax Configuration (UX round 2, item 32; owner, 2026-10-26; docs/modules/
// TAX_ENGINE.md, Q311-Q322). New development, hand-written. A company's tax
// regime (UAE VAT, India GST or its own), its components with their output
// and input accounts, its tax codes with their rates by date, how it rounds.
// The rules are taxEngine.js's; this keeps them, one document per company:
//   taxConfig/{companyId} (Firestore)
// access sees it, setup changes it (Q320). The documents read it from
// part 2 on (taxConfig.configFor).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const engine = require('./taxEngine');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'TAXCONFIG';
const DOC = companyId => firestore.collection('taxConfig').doc(companyId);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);

async function requireCompany(user, cap, companyId) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'setup' ? 'You do not have permission to change Tax Configuration.' : 'You do not have access to Tax Configuration.');
  }
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}

// A company's configuration, or null where none is set yet.
async function configFor(companyId) {
  const s = await DOC(text(companyId, 80) || '-').get();
  return s.exists ? s.data() : null;
}

// The accounts a component may post to: active, postable, the company's.
const accountsFor = (coa, co) => Object.keys(coa || {}).filter(id => coa[id].Status === 'Active' && coa[id].IsPostable === true && (!coa[id].CompanyID || coa[id].CompanyID === co))
  .map(id => ({ AccountID: id, AccountCode: String(coa[id].AccountCode), AccountName: coa[id].AccountName || '', AccountType: coa[id].AccountType || '' }))
  .sort((a, b) => a.AccountCode.localeCompare(b.AccountCode));

exports.getTaxConfig = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const co = text((request.data || {}).companyId, 80);
  await requireCompany(user, 'access', co);
  const [config, coa, company] = await Promise.all([configFor(co), rtdb.ref('coa').get().then(s => s.val()), rtdb.ref('companies/' + co).get().then(s => s.val())]);
  return {
    config, companyCountry: (company || {}).Country || '',
    presets: Object.keys(engine.PRESETS).map(k => ({ Regime: k, Name: engine.PRESETS[k].Name, config: engine.preset(k) })),
    categories: Object.keys(engine.CATEGORIES).map(k => ({ Category: k, Label: engine.CATEGORIES[k].label, Taxed: engine.CATEGORIES[k].taxed })),
    gstStates: engine.GST_STATES, emirates: engine.EMIRATES, registrationTypes: engine.REGISTRATION_TYPES.filter(Boolean),
    accounts: accountsFor(coa, co), canWrite: await moduleHasCapability(MODULE_ID, 'setup', user.profile.role)
  };
});

exports.saveTaxConfig = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = text(d.companyId, 80);
  await requireCompany(user, 'setup', co);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const coaOk = id => {
    const a = coa[id];
    if (!a) return 'not found.';
    if (a.Status !== 'Active' || a.IsPostable !== true) return a.AccountCode + ' must be an active, postable account.';
    if (a.CompanyID && a.CompanyID !== co) return a.AccountCode + ' belongs to another company.';
    return '';
  };
  let cfg;
  try { cfg = engine.validateConfig(d.config, coaOk); } catch (e) { throw new HttpsError('invalid-argument', e.message); }
  // A code once used stays (part 2 on, documents name it): it can be made inactive, not removed.
  const before = await configFor(co);
  if (before && before.Regime !== cfg.Regime && (await usedCodes(co)).length) {
    throw new HttpsError('failed-precondition', 'This company\'s documents already use its tax codes: its regime can no longer change.');
  }
  if (before) {
    const gone = (await usedCodes(co)).filter(c => !cfg.Codes.some(x => x.Code === c));
    if (gone.length) throw new HttpsError('failed-precondition', 'Tax code ' + gone.join(', ') + ' is used by documents: make it inactive instead of removing it.');
  }
  const now = new Date().toISOString();
  await DOC(co).set(Object.assign(cfg, { CompanyID: co, UpdatedAt: now, UpdatedBy: user.profile.username || user.uid }));
  return { success: true };
});

// The codes documents have used (from part 2 on, taxCodeUse/{company}).
async function usedCodes(companyId) {
  const s = await firestore.collection('taxCodeUse').doc(companyId).get();
  return s.exists ? Object.keys(s.data() || {}).filter(k => k !== 'UpdatedAt') : [];
}

module.exports = Object.assign(exports, { configFor, usedCodes, MODULE_ID });
