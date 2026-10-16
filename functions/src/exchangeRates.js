// Exchange rates by effective date (owner, 2026-10-16; docs/modules/
// MULTI_CURRENCY.md, decisions 211-218). New development, hand-written.
//
// One base currency for every company: the currency marked Default in
// Currency Configuration. A rate says 1 unit of the foreign currency = Rate
// units of the base, from EffectiveDate until a later rate takes effect
// (decision: rates typed, never fetched, 213). Rates are only added: a
// correction is a new rate (the same date again replaces it from then on,
// the later entry winning), so a document keeps the rate it was made with.
//
//   exchangeRates/{CODE}/{pushId} { EffectiveDate, Rate, Note, By, ByName, At }
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');

const onCallOptions = { region: 'us-central1' };
const PATH = 'exchangeRates';
const MODULE_ID = 'CURRENCYCONFIG';
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const val = async p => (await rtdb.ref(p).get()).val();

// The base currency: { CurrencyID, Code, Name, Symbol }, or Code '' if none is set.
async function baseCurrency() {
  const data = (await val('currencies')) || {};
  const id = Object.keys(data).find(k => data[k].IsDefault && data[k].Status === 'Active');
  return id ? { CurrencyID: id, Code: data[id].Code || '', Name: data[id].Name || '', Symbol: data[id].Symbol || '' } : { CurrencyID: '', Code: '', Name: '', Symbol: '' };
}

// A currency's rates, newest effective first (the later entry first on the same date).
function sorted(rates) {
  return Object.keys(rates || {}).map(id => Object.assign({ RateID: id }, rates[id]))
    .sort((a, b) => String(b.EffectiveDate).localeCompare(String(a.EffectiveDate)) || String(b.At).localeCompare(String(a.At)));
}
// The rate of `code` on `date` (yyyy-mm-dd): 1 for the base currency;
// { Rate, EffectiveDate, RateID } of the latest rate effective on or
// before the date. Throws Error when there is none.
async function rateOn(code, date, base) {
  const b = base || await baseCurrency();
  const c = text(code, 3).toUpperCase();
  if (!c || c === b.Code) return { Rate: 1, EffectiveDate: '', RateID: '' };
  const hit = sorted(await val(PATH + '/' + c)).find(r => String(r.EffectiveDate) <= date);
  if (!hit) throw new Error('No exchange rate for ' + c + ' on or before ' + date + ': enter one in Currency Configuration → Rates.');
  return { Rate: Number(hit.Rate), EffectiveDate: hit.EffectiveDate, RateID: hit.RateID };
}

async function requireAccess(user) {
  if (!(await moduleHasCapability(MODULE_ID, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Currency Configuration.');
}

// Currency Configuration → Rates: every currency's rates.
exports.getExchangeRates = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const [base, all, currencies] = await Promise.all([baseCurrency(), val(PATH), val('currencies')]);
  const out = {};
  Object.values(currencies || {}).forEach(c => { if (c.Code && c.Code !== base.Code) out[c.Code] = sorted((all || {})[c.Code]); });
  return { base, rates: out, canEnter: await moduleHasCapability(MODULE_ID, 'rates', user.profile.role) };
});

// A new rate (the right "rates", decision 212).
exports.saveExchangeRate = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability(MODULE_ID, 'rates', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to enter exchange rates.');
  const d = request.data || {};
  const code = text(d.code, 3).toUpperCase();
  const date = text(d.effectiveDate, 10);
  const rate = Number(String(d.rate == null ? '' : d.rate).replace(/,/g, ''));
  const base = await baseCurrency();
  if (!base.Code) bad('Set the default (base) currency in Currency Configuration first.');
  const cur = Object.values((await val('currencies')) || {}).find(c => c.Code === code);
  if (!cur) bad('Choose a currency of Currency Configuration.');
  if (cur.Status !== 'Active') bad(code + ' is inactive.');
  if (code === base.Code) bad(code + ' is the base currency: its rate is always 1.');
  if (!isDate(date)) bad('Enter the date the rate takes effect.');
  if (!(rate > 0) || !isFinite(rate)) bad('Enter the rate: how many ' + base.Code + ' one ' + code + ' is (more than 0).');
  if (Math.round(rate * 1e6) / 1e6 !== rate) bad('A rate has at most 6 decimals.');
  const ref = rtdb.ref(PATH + '/' + code).push();
  await ref.set({ EffectiveDate: date, Rate: rate, Note: text(d.note, 200), By: user.profile.username || user.uid, ByName: user.profile.fullName || user.profile.username || user.uid, At: new Date().toISOString() });
  return { success: true, rateId: ref.key };
});

// The rate on a date, for a document's screen (any signed-in user).
exports.getExchangeRateOn = onCallWithMessages(onCallOptions, async (request) => {
  await requireUser(request);
  const d = request.data || {};
  const date = text(d.date, 10);
  if (!isDate(date)) bad('Enter the document date first.');
  const base = await baseCurrency();
  try { return Object.assign({ base: base.Code, code: text(d.code, 3).toUpperCase() }, await rateOn(d.code, date, base)); } catch (e) { bad(e.message); }
});

// Each company's Exchange Gain / Loss account (and the cost centre its
// lines take when the settling line has none): fxSettings/{companyId}.
exports.getFxSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireAccess(user);
  const { userCanAccessCompany } = require('./glWriting');
  const [companies, settings, coa, units] = await Promise.all([val('companies'), val('fxSettings'), val('coa'), val('orgUnits')]);
  const mine = (r, id) => !r.CompanyID || r.CompanyID === id;
  return { canWrite: await moduleHasCapability(MODULE_ID, 'write', user.profile.role),
    companies: Object.keys(companies || {}).filter(id => userCanAccessCompany(user.profile, id)).map(id => Object.assign({ CompanyID: id, LegalName: companies[id].LegalName || id,
      Accounts: Object.keys(coa || {}).filter(k => coa[k].Status === 'Active' && coa[k].IsPostable === true && ['Revenue', 'Expense'].includes(coa[k].AccountType) && mine(coa[k], id))
        .map(k => ({ AccountID: k, AccountCode: coa[k].AccountCode, AccountName: coa[k].AccountName })).sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode))),
      CostCenters: Object.keys(units || {}).filter(k => units[k].Type === 'CostCenter' && units[k].Status !== 'Inactive' && mine(units[k], id))
        .map(k => ({ UnitID: k, Code: units[k].Code, Name: units[k].Name }))
    }, (settings || {})[id] || {})) };
});
exports.saveFxSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability(MODULE_ID, 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change Currency Configuration.');
  const { userCanAccessCompany } = require('./glWriting');
  const d = request.data || {};
  const co = text(d.companyId, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const [coa, units] = await Promise.all([val('coa'), val('orgUnits')]);
  const acc = (coa || {})[text(d.gainLossAccountId, 80)];
  if (!acc || acc.Status !== 'Active' || acc.IsPostable !== true || (acc.CompanyID && acc.CompanyID !== co)) bad('Choose an active account of the company that takes postings.');
  if (!['Revenue', 'Expense'].includes(acc.AccountType)) bad('The Exchange Gain / Loss account is a Revenue or Expense account.');
  const cc = text(d.costCenterId, 80);
  if (cc) { const u = (units || {})[cc]; if (!u || u.Type !== 'CostCenter' || (u.CompanyID && u.CompanyID !== co)) bad('Choose a cost center of the company.'); }
  await rtdb.ref('fxSettings/' + co).set({ GainLossAccountID: text(d.gainLossAccountId, 80), CostCenterID: cc, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

module.exports = Object.assign(exports, { baseCurrency, rateOn, sorted });
