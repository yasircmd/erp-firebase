// Which accounts need a cost center, profit center or project (owner,
// 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, decisions 219-224). New
// development, hand-written.
//
// Each account says, for each of the three dimensions, Required, Optional
// or NotUsed. The rule is set on a heading (a group or sub-group) and its
// accounts follow it; an account may set its own (decision 219). Where
// nothing up the chain sets one, today's rule applies: Expense, Revenue
// and COGS need a cost center, everything else is optional — so nothing
// changes until a rule is set.
//
//   coa/{id}.DimensionRules { CostCenter, ProfitCenter, Project }  ('' or absent: follow the heading)
'use strict';

const VALUES = ['Required', 'Optional', 'NotUsed'];
const DIMENSIONS = [
  { key: 'CostCenter', field: 'CostCenterID', label: 'Cost Center' },
  { key: 'ProfitCenter', field: 'ProfitCenterID', label: 'Profit Center' },
  { key: 'Project', field: 'ProjectID', label: 'Project' }
];
const COST_CENTER_DEFAULT_TYPES = ['Expense', 'Revenue', 'COGS'];

function defaultRule(account, key) {
  if (key === 'CostCenter' && COST_CENTER_DEFAULT_TYPES.includes(account && account.AccountType)) return 'Required';
  return 'Optional';
}

// coa: { id: account } (each account's id is its key, or its AccountID).
function byId(coa, id) {
  if (!id || !coa) return null;
  if (coa[id]) return coa[id];
  return Object.values(coa).find(a => a && a.AccountID === id) || null;
}

// The account's rule for one dimension, and where it comes from.
function ruleOf(account, coa, key) {
  let a = account, hops = 0;
  while (a && hops++ < 50) {
    const own = a.DimensionRules && a.DimensionRules[key];
    if (VALUES.includes(own)) return { rule: own, from: a === account ? 'account' : (a.AccountCode || '') };
    a = byId(coa, a.ParentAccountID);
  }
  return { rule: defaultRule(account, key), from: 'default' };
}

// All three rules of an account: { CostCenter, ProfitCenter, Project }.
function rulesOf(account, coa) {
  const out = {};
  DIMENSIONS.forEach(d => { out[d.key] = ruleOf(account, coa, d.key).rule; });
  return out;
}

// A line's dimensions checked against its account's rules: the missing
// required one throws Error (prefix, e.g. 'Line 2: '); a NotUsed one is
// dropped (its field is hidden on the screens, so it is never posted).
// Returns the line's { CostCenterID, ProfitCenterID, ProjectID }.
function applyRules(line, account, coa, prefix) {
  const rules = rulesOf(account, coa);
  const out = {};
  DIMENSIONS.forEach(d => {
    const value = String((line && line[d.field]) || '').trim();
    if (rules[d.key] === 'Required' && !value) {
      // The cost center message as before (callers and tests rely on it).
      throw new Error((prefix || '') + 'account ' + account.AccountCode + (d.key === 'CostCenter' ? ' (' + account.AccountType + ')' : '') + ' requires a ' + d.label + '.');
    }
    out[d.field] = rules[d.key] === 'NotUsed' ? '' : value;
  });
  return out;
}

// A heading's or an account's DimensionRules as sent by a screen: each
// value one of VALUES, or '' to follow the heading. Throws Error.
function cleanRules(raw) {
  const out = {};
  DIMENSIONS.forEach(d => {
    const v = String((raw && raw[d.key]) || '').trim();
    if (v && !VALUES.includes(v)) throw new Error(d.label + ' must be Required, Optional or Not used.');
    out[d.key] = v;
  });
  return out;
}

// Whether lines posting to these accounts need a cost center, for the
// screens' checks at save time (they name the account by a sales type, an
// item's cost of sales, or directly). One that can't be resolved counts as
// needing one, as before the rules. Reads RTDB.
async function needsCostCenter({ accountIds, salesTypeIds, itemIds } = {}) {
  const { rtdb } = require('./firebaseAdmin');
  const val = async p => (await rtdb.ref(p).get()).val() || {};
  const coa = await val('coa');
  const ids = (accountIds || []).slice();
  if ((salesTypeIds || []).length) { const st = await val('salesTypes'); salesTypeIds.forEach(id => ids.push((st[id] || {}).GLAccountID || '')); }
  if ((itemIds || []).length) { const items = await val('items'); itemIds.forEach(id => { const it = items[id] || {}; ids.push(it.SalesCogsAccountID || it.ConsumptionAccountID || ''); }); }
  return ids.some(id => !coa[id] || ruleOf(coa[id], coa, 'CostCenter').rule === 'Required');
}

module.exports = { VALUES, DIMENSIONS, defaultRule, ruleOf, rulesOf, applyRules, cleanRules, needsCostCenter };
