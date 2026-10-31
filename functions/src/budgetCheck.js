// The budget's spending check, step B3 (owner, 2026-10-31; docs/modules/
// BUDGET.md, Q342, Q348-Q352). New development, hand-written.
//
// A Purchase Order on submit and a Vendor Invoice's direct lines on post
// (Q352: requisitions have no prices) are checked against the company's
// Current budget for the document's year (none: no check, Q351), each line
// against the budget line it counts against (none: budget zero, Q349), over
// the period Budget Setup says (Q350), counting the actuals and, when the
// company does, open Purchase Orders (Q348). A PO's goods count at the GRN
// (actuals) and its open quantity as committed; an invoice's GRN part is
// already in the actuals, so only its direct lines are new.
//
// With life-of-project budgets (Budget Setup's ProjectBudgets, step B5, Q359), a line
// carrying a project is also checked against that project's life budget.
//
// Budget Setup's SpendingCheck (Q342):
//   Off    no check;
//   Warn   over budget, the document is refused with WARN until the user
//          continues (the request's budgetConsent.go), then goes ahead with
//          the overrun recorded on it (BudgetCheck), for the approvers;
//   Block  refused; a user with Budget's "override" right may go ahead with a
//          reason (budgetConsent.go and .reason), recorded on the document.
// The screens look for the markers below (keep in step with them). The
// consent rides with the request, as the period lock's does (callable.js).
'use strict';
const { rtdb } = require('./firebaseAdmin');
const { moduleHasCapability } = require('./auth');
const { purchaseOrders } = require('./purchaseStore');
const B = require('./budget');
const C = require('./budgetCalc');

const WARN = 'Over budget (warning)';
const BLOCK_OVERRIDE = 'Over budget (blocked; you may override with a reason)';
const BLOCK = 'Over budget (blocked)';

const { runWithBudgetConsent, consent } = require('./budgetConsent');
const fmt = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The base currency's code and a document currency's rate to it on a date.
async function baseCode() {
  const data = (await rtdb.ref('currencies').get()).val() || {};
  const id = Object.keys(data).find(k => data[k].IsDefault && data[k].Status === 'Active');
  return id ? data[id].Code || '' : '';
}
async function rateOf(code, date, base) {
  // No base currency set (no Currency Configuration): the document's amounts are the base.
  if (!code || !base || code === base) return 1;
  return (await require('./exchangeRates').rateOn(code, date, base)).Rate;
}

// A Purchase Order's lines as debits in the base currency: a category line
// to its GL account, an item line to its inventory account; the PO's cost
// centre (a PO line has none). Open: the quantity not yet received.
async function poLines(po, refs, base, open) {
  const rate = await rateOf(po.Currency || '', po.PODate, base);
  return (po.Lines || []).map(l => {
    const qty = open ? Math.max(0, (Number(l.Quantity) || 0) - (Number(l.ReceivedQuantity) || 0)) : Number(l.Quantity) || 0;
    const account = l.CategoryID ? (refs.categories[l.CategoryID] || {}).GLAccountID : (refs.itemsByCode[l.ItemCode] || {}).InventoryAccountID;
    return { AccountID: account || '', CostCenterID: po.CostCenterID || '', ProjectID: '', Amount: C.round2(qty * (Number(l.UnitPrice) || 0) * rate) };
  }).filter(l => l.AccountID && l.Amount);
}
// A Vendor Invoice's direct lines (its GRN part is already in the actuals).
function viLines(vi, refs) {
  const rate = Number(vi.ExchangeRate) > 0 ? Number(vi.ExchangeRate) : 1;
  return (vi.DirectLines || []).map(l => ({ AccountID: refs.byCode[String(l.AccountCode || '')] || '', CostCenterID: l.CostCenterID || vi.CostCenterID || '',
    ProjectID: vi.ProjectID || '', Amount: C.round2((Number(l.Amount) || 0) * rate) })).filter(l => l.AccountID && l.Amount);
}

// The check: null when nothing is over (or there is nothing to check), else
// the record to keep on the document; throws when the user must decide.
async function checkDocument(user, moduleId, doc) {
  const companyId = doc.CompanyID, date = String(moduleId === 'PURCHASEORDER' ? doc.PODate : doc.InvoiceDate || '');
  if (!companyId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const setup = await B.setupOf(companyId);
  if (setup.SpendingCheck === 'Off') return null;
  const yearStart = require('./periodClosing').yearStartOf(date.slice(0, 7), await B.fiscalStartOf(companyId));
  const all = await B.budgetsOf(companyId);
  const budget = all.find(b => b.YearStart === yearStart && b.Status === 'Approved' && b.Current) || null;
  // A project's life budget too, where the company keeps them (step B5, Q359).
  const lifeBudgets = setup.ProjectBudgets === 'LifeOfProject' ? all.filter(b => b.Kind === 'Project' && b.Status === 'Approved' && b.Current) : [];
  if (!budget && !lifeBudgets.length) return null; // Q351
  const months = C.monthsOf(yearStart), month = months.indexOf(date.slice(0, 7));
  const [coa, categories, items, base] = await Promise.all([
    rtdb.ref('coa').get().then(s => s.val() || {}), rtdb.ref('requisitionCategories').get().then(s => s.val() || {}),
    moduleId === 'PURCHASEORDER' || setup.Committed === 'ActualsAndPOs' ? rtdb.ref('items').get().then(s => s.val() || {}) : {}, baseCode()]);
  const refs = { categories, itemsByCode: {}, byCode: {} };
  Object.values(items).forEach(i => { if (i && i.ItemCode) refs.itemsByCode[i.ItemCode] = i; });
  Object.keys(coa).forEach(id => { refs.byCode[String(coa[id].AccountCode)] = id; });
  const accounts = {};
  Object.keys(coa).forEach(id => { accounts[id] = { AccountType: coa[id].AccountType }; });
  const docLines = moduleId === 'PURCHASEORDER' ? await poLines(doc, refs, base, false) : viLines(doc, refs);
  if (!docLines.length) return null;

  // The year's budget (Q348, Q350).
  let findings = [];
  if (budget) {
    const to = setup.CheckPeriod === 'Year' ? 11 : month;
    const entries = await B.postedEntries(companyId, C.lastDay(months[to]), months[0] + '-01');
    const committed = [];
    if (setup.Committed === 'ActualsAndPOs') {
      const open = await purchaseOrders.query({ CompanyID: companyId, Status: 'Approved' });
      for (const [id, po] of Object.entries(open)) {
        const m = months.indexOf(String(po.PODate || '').slice(0, 7));
        if (m < 0 || id === doc.POID || id === doc._id) continue;
        (await poLines(po, refs, base, true)).forEach(l => committed.push(Object.assign(l, { Month: m })));
      }
    }
    findings = C.overruns(budget, accounts, entries, docLines, committed, month, setup.CheckPeriod);
  }
  // The life budget of each project the document's lines carry: all its actuals to date.
  const projects = [...new Set(docLines.map(l => l.ProjectID).filter(Boolean))];
  const lives = [];
  for (const pid of projects) {
    const pb = lifeBudgets.find(b => b.ProjectID === pid);
    if (!pb) continue;
    const found = C.projectOverruns(pb, accounts, await B.postedEntries(companyId, date), docLines);
    if (found.length) lives.push({ budget: pb, findings: found });
  }
  if (!findings.length && !lives.length) return null;

  const units = (await rtdb.ref('orgUnits').get()).val() || {};
  const name = f => Object.assign(f, { AccountCode: String((coa[f.AccountID] || {}).AccountCode || ''), AccountName: (coa[f.AccountID] || {}).AccountName || '',
    CostCenter: units[f.CostCenterID] ? units[f.CostCenterID].Code : '', Project: units[f.ProjectID] ? units[f.ProjectID].Code : '' });
  const line = f => f.AccountCode + ' ' + f.AccountName + (f.CostCenter ? ' / ' + f.CostCenter : '') + (f.Project && !f.Life ? ' / ' + f.Project : '') + ': ' +
    (f.Budgeted ? 'budget ' + fmt(f.Budget) : 'no budget line') + ', spent ' + fmt(f.Spent) + (f.Committed ? ', on open orders ' + fmt(f.Committed) : '') +
    ', this document ' + fmt(f.Document) + ', over by ' + fmt(f.Over);
  const parts = [];
  if (findings.length) {
    const period = setup.CheckPeriod === 'Month' ? 'in ' + months[month] : setup.CheckPeriod === 'Year' ? 'for ' + budget.YearLabel : 'to the end of ' + months[month];
    parts.push(period + ' (' + budget.Number + '): ' + findings.map(name).map(line).join('; '));
  }
  lives.forEach(l => parts.push('for the life of project ' + (l.budget.ProjectLabel || l.budget.ProjectID) + ' (' + l.budget.Number + '): ' + l.findings.map(name).map(line).join('; ')));
  const text = parts.join('; and ');
  const named = findings.concat(...lives.map(l => l.findings));
  const record = { Mode: setup.SpendingCheck, Period: setup.CheckPeriod, BudgetID: budget ? budget.BudgetID : '', BudgetNumber: budget ? budget.Number : '',
    ProjectBudgets: lives.map(l => l.budget.Number), Findings: named, Text: text, By: user.profile.username || user.uid, At: new Date().toISOString() };
  const c = consent();
  if (setup.SpendingCheck === 'Warn') {
    if (c.go) return Object.assign(record, { Accepted: true });
    throw new Error(WARN + ' ' + text + '. Continue anyway? The approvers will see it.');
  }
  const may = await moduleHasCapability('BUDGET', 'override', user.profile.role);
  if (may && c.go && c.reason) return Object.assign(record, { Overridden: true, Reason: c.reason });
  if (may) throw new Error(BLOCK_OVERRIDE + ' ' + text + '.');
  throw new Error(BLOCK + ' ' + text + '. Someone with the right to override the budget can go ahead, or the budget can be revised.');
}

module.exports = { checkDocument, runWithBudgetConsent, consent, WARN, BLOCK_OVERRIDE, BLOCK };
