// Budget and forecast, step B1 (owner, 2026-10-30; docs/modules/BUDGET.md,
// Q338-Q345). New development, hand-written.
//
// A budget is one company's financial year: an amount per account per
// month, a line optionally for a cost centre and / or project (a line
// without one is the company's, Q339), for the P&L and the balance sheet
// (Q338). Balance-sheet lines are monthly movements or month-end closing
// balances, as the company's Budget Setup says when the budget is made; the
// budget keeps that method (Q344). Amounts in the base currency, each in
// its account's natural sign (budgetCalc.js).
//
// Versions (Q340): the first approved budget of a year is the Original;
// a change later is a Revision, approved again. Every approved version is
// kept; the latest is Current, what the year is held to. One version at a
// time is open (Draft, Rejected or PendingApproval) per company and year.
//
//   Firestore budgets/{BudgetID} { CompanyID, YearStart (yyyy-mm), YearLabel,
//     Version (0 Original, n Revision n), Number, Status, Current, BalanceSheetMethod,
//     Lines [{ AccountID, AccountCode, AccountName, AccountType, CostCenterID, ProjectID, Amounts[12] }],
//     Total (the year's budgeted costs: the approval amount), Notes,
//     ApprovalInstanceID, RejectionReason, History, Created/Updated/Submitted/Approved At, By }
//   Firestore budgetSetup/{CompanyID} { BalanceSheet: 'Movements' | 'Closing', UpdatedAt, UpdatedBy }
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { approvalInstances } = require('./approvalStore');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { rulesOf } = require('./dimensionRules');
const C = require('./budgetCalc');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'BUDGET';
const LABEL = 'Budget';
const MAX_LINES = 5000;
const OPEN = ['Draft', 'Rejected', 'PendingApproval'];
const EDITABLE = ['Draft', 'Rejected'];
const SETUP_DEFAULTS = { BalanceSheet: 'Movements' };
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const actorOf = user => user.profile.username || user.uid;
const budgets = () => firestore.collection('budgets');
const setupDoc = companyId => firestore.collection('budgetSetup').doc(companyId);

async function requireCap(user, cap) {
  if (await moduleHasCapability(MODULE_ID, cap, user.profile.role)) return;
  if (cap === 'access') throw new HttpsError('permission-denied', 'You do not have access to ' + LABEL + '.');
  if (cap === 'setup') throw new HttpsError('permission-denied', 'You do not have permission to change Budget Setup.');
  throw new HttpsError('permission-denied', 'You do not have permission to prepare budgets.');
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
async function load(id) {
  const snap = await budgets().doc(text(id, 60)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Budget not found.');
  return Object.assign({ BudgetID: snap.id }, snap.data());
}
async function setupOf(companyId) {
  const snap = await setupDoc(companyId).get();
  return Object.assign({}, SETUP_DEFAULTS, snap.exists ? snap.data() : {});
}
// The company's financial year start: 'Jan' or 'Apr' (Period Closing → Setup).
async function fiscalStartOf(companyId) {
  const s = (await rtdb.ref('periodClosing/' + companyId + '/Settings/FiscalYearStart').get()).val();
  return s === 'Apr' ? 'Apr' : 'Jan';
}
async function yearsOf(companyId) {
  return (await budgets().where('CompanyID', '==', companyId).get()).docs.map(d => Object.assign({ BudgetID: d.id }, d.data()));
}
const historyWith = (b, event, user, note) => (b.History || []).concat([Object.assign({ Event: event, At: new Date().toISOString(), By: actorOf(user) }, note ? { Note: note } : {})]);

// The accounts a company can budget: active, postable, its own or shared.
function accountsFor(coa, companyId) {
  return Object.keys(coa).filter(id => coa[id] && coa[id].Status === 'Active' && coa[id].IsPostable === true && (!coa[id].CompanyID || coa[id].CompanyID === companyId));
}
function unitsFor(units, companyId, type) {
  return Object.keys(units).filter(id => units[id] && units[id].Type === type && units[id].Status !== 'Inactive' && (!units[id].CompanyID || units[id].CompanyID === companyId))
    .map(id => ({ ID: id, Code: units[id].Code || '', Name: units[id].Name || '' }))
    .sort((a, b) => String(a.Code).localeCompare(String(b.Code), undefined, { numeric: true }));
}

// The lines as saved: known accounts and units of the company, a dimension
// the account doesn't use refused, each account / cost centre / project once.
function cleanLines(raw, coa, units, companyId) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_LINES) throw new Error('A budget can have up to ' + MAX_LINES + ' lines.');
  const allowed = new Set(accountsFor(coa, companyId));
  const unitOk = (id, type) => units[id] && units[id].Type === type && (!units[id].CompanyID || units[id].CompanyID === companyId);
  const seen = new Set();
  return list.map((l, i) => {
    const at = 'Line ' + (i + 1) + ': ';
    const id = text(l.AccountID, 60), a = coa[id];
    if (!allowed.has(id)) throw new Error(at + 'choose an active, postable account of this company.');
    const cc = text(l.CostCenterID, 60), pj = text(l.ProjectID, 60);
    if (cc && !unitOk(cc, 'CostCenter')) throw new Error(at + 'that cost centre is not one of this company\'s.');
    if (pj && !unitOk(pj, 'Project')) throw new Error(at + 'that project is not one of this company\'s.');
    const rules = rulesOf(a, coa);
    if (cc && rules.CostCenter === 'NotUsed') throw new Error(at + a.AccountCode + ' does not use cost centres.');
    if (pj && rules.Project === 'NotUsed') throw new Error(at + a.AccountCode + ' does not use projects.');
    const line = { AccountID: id, AccountCode: String(a.AccountCode || ''), AccountName: a.AccountName || '', AccountType: a.AccountType || '', CostCenterID: cc, ProjectID: pj, Amounts: C.amountsOf(l.Amounts) };
    const k = C.keyOf(line);
    if (seen.has(k)) throw new Error(at + a.AccountCode + (cc ? ' / ' + units[cc].Code : '') + (pj ? ' / ' + units[pj].Code : '') + ' is on the budget twice.');
    seen.add(k);
    return line;
  });
}

// The company's posted GL entries up to `end` (from `from` when given): one
// query on company and date (firestore.indexes.json), never the whole corporate.
async function postedEntries(companyId, end, from) {
  let q = firestore.collection('journalEntries').where('CompanyID', '==', companyId).where('JVDate', '<=', end);
  if (from) q = q.where('JVDate', '>=', from);
  return (await q.get()).docs.map(d => d.data()).filter(e => e.Status === 'Posted');
}

// ---------- Reading ----------

// Everything the screen needs for a company: its year start, setup, rights,
// the accounts (with their headings, to total by), cost centres, projects
// and its budgets (without their lines).
exports.getBudgetSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const rights = { canWrite: await moduleHasCapability(MODULE_ID, 'write', user.profile.role), canSetup: await moduleHasCapability(MODULE_ID, 'setup', user.profile.role) };
  const companyId = text(request.data && request.data.companyId, 80);
  if (!companyId) return { rights };
  requireCompany(user, companyId);
  const [coa, units, setup, fy, list] = await Promise.all([
    rtdb.ref('coa').get().then(s => s.val() || {}), rtdb.ref('orgUnits').get().then(s => s.val() || {}),
    setupOf(companyId), fiscalStartOf(companyId), yearsOf(companyId)
  ]);
  const heading = id => (coa[id] ? { ID: id, Code: String(coa[id].AccountCode || ''), Name: coa[id].AccountName || '', Parent: coa[id].ParentAccountID || '' } : null);
  const headings = {};
  const accounts = accountsFor(coa, companyId).map(id => {
    const a = coa[id], rules = rulesOf(a, coa);
    for (let p = a.ParentAccountID, hops = 0; p && coa[p] && !headings[p] && hops < 20; p = coa[p].ParentAccountID, hops++) headings[p] = heading(p);
    return { AccountID: id, AccountCode: String(a.AccountCode || ''), AccountName: a.AccountName || '', AccountType: a.AccountType || '', Parent: a.ParentAccountID || '',
      UsesCostCenter: rules.CostCenter !== 'NotUsed', UsesProject: rules.Project !== 'NotUsed' };
  }).sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true }));
  return {
    rights, setup: { BalanceSheet: setup.BalanceSheet }, fiscalYearStart: fy, accounts, headings,
    costCenters: unitsFor(units, companyId, 'CostCenter'), projects: unitsFor(units, companyId, 'Project'),
    budgets: list.map(b => { const o = Object.assign({}, b); delete o.Lines; delete o.History; o.LineCount = (b.Lines || []).length; return o; })
      .sort((a, b) => b.YearStart.localeCompare(a.YearStart) || b.Version - a.Version)
  };
});

exports.getBudget = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const b = await load(request.data && request.data.budgetId);
  requireCompany(user, b.CompanyID);
  return b;
});

// ---------- Budget Setup ----------

exports.saveBudgetSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'setup');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const bs = d.BalanceSheet === 'Closing' ? 'Closing' : d.BalanceSheet === 'Movements' ? 'Movements' : null;
  if (!bs) throw new HttpsError('invalid-argument', 'Choose how balance-sheet lines are budgeted.');
  // A budget keeps the method it was made with: a change applies to the next one.
  await setupDoc(companyId).set({ BalanceSheet: bs, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) }, { merge: true });
  return { success: true };
});

// ---------- Preparing ----------

// A new version for a company's year: the Original while none is approved,
// else a Revision starting from the Current one. Refused while another
// version of that year is open.
exports.createBudget = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const yearStart = text(d.yearStart, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearStart)) throw new HttpsError('invalid-argument', 'Choose the financial year.');
  const fy = await fiscalStartOf(companyId);
  if (yearStart.slice(5) !== (fy === 'Apr' ? '04' : '01')) throw new HttpsError('invalid-argument', 'This company\'s financial year starts in ' + (fy === 'Apr' ? 'April' : 'January') + '.');
  return withGlobalLock(user.uid, async () => {
    const year = (await yearsOf(companyId)).filter(b => b.YearStart === yearStart);
    const open = year.find(b => OPEN.includes(b.Status));
    if (open) throw new HttpsError('failed-precondition', open.Number + ' is still ' + (open.Status === 'PendingApproval' ? 'waiting for approval' : 'being prepared') + ': finish it first.');
    const current = year.find(b => b.Status === 'Approved' && b.Current);
    const version = current ? Math.max(...year.filter(b => b.Status === 'Approved').map(b => b.Version)) + 1 : 0;
    const setup = await setupOf(companyId);
    const now = new Date().toISOString();
    const id = 'BUD-' + randomUUID().split('-')[0].toUpperCase();
    const label = C.yearLabel(yearStart);
    const b = {
      CompanyID: companyId, YearStart: yearStart, YearLabel: label, Version: version,
      Number: 'Budget ' + label + ' ' + C.versionLabel(version), Status: 'Draft', Current: false,
      // A revision keeps its Original's method, so the versions compare like for like.
      BalanceSheetMethod: current ? current.BalanceSheetMethod : setup.BalanceSheet,
      Lines: current ? current.Lines : [], Total: current ? current.Total : 0, Notes: '',
      CreatedAt: now, CreatedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user),
      History: [{ Event: current ? 'Revision started from ' + current.Number : 'Created', At: now, By: actorOf(user) }]
    };
    await budgets().doc(id).set(b);
    return { success: true, budgetId: id, number: b.Number };
  });
});

exports.saveBudgetDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  const d = request.data || {};
  return withGlobalLock(user.uid, async () => {
    const b = await load(d.budgetId);
    requireCompany(user, b.CompanyID);
    if (!EDITABLE.includes(b.Status)) throw new HttpsError('failed-precondition', 'Only a draft or rejected budget can be changed.');
    const [coa, units] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), rtdb.ref('orgUnits').get().then(s => s.val() || {})]);
    const lines = cleanLines(d.lines, coa, units, b.CompanyID);
    const now = new Date().toISOString();
    await budgets().doc(b.BudgetID).update({ Lines: lines, Total: C.approvalAmount(lines), Notes: text(d.notes, 1000), UpdatedAt: now, UpdatedBy: actorOf(user) });
    return { success: true, lines: lines.length, total: C.approvalAmount(lines) };
  });
});

// A draft never approved is deleted outright; a rejected one too (its
// approval record keeps the history of the decision).
exports.deleteBudgetDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  return withGlobalLock(user.uid, async () => {
    const b = await load(request.data && request.data.budgetId);
    requireCompany(user, b.CompanyID);
    if (!EDITABLE.includes(b.Status)) throw new HttpsError('failed-precondition', 'Only a draft or rejected budget can be deleted.');
    await budgets().doc(b.BudgetID).delete();
    return { success: true };
  });
});

// Approved: this version becomes Current, the one before it stays, approved, for comparison.
async function commitApproval(user, b, event) {
  const now = new Date().toISOString();
  const others = (await yearsOf(b.CompanyID)).filter(x => x.YearStart === b.YearStart && x.BudgetID !== b.BudgetID && x.Current);
  const batch = firestore.batch();
  others.forEach(x => batch.update(budgets().doc(x.BudgetID), { Current: false, UpdatedAt: now }));
  batch.update(budgets().doc(b.BudgetID), { Status: 'Approved', Current: true, RejectionReason: '', ApprovedAt: now, ApprovedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user),
    History: historyWith(b, event, user) });
  await batch.commit();
}

exports.submitBudget = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  return withGlobalLock(user.uid, async () => {
    const b = await load(request.data && request.data.budgetId);
    requireCompany(user, b.CompanyID);
    if (!EDITABLE.includes(b.Status)) throw new HttpsError('failed-precondition', 'Only a draft or rejected budget can be submitted.');
    if (!(b.Lines || []).length) throw new Error('The budget has no lines.');
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: b.CompanyID });
    const approval = await beginApprovalInstance(MODULE_ID, b.BudgetID, b.Number, scopeKey, b.Total, user.uid);
    const now = new Date().toISOString();
    if (approval.required) {
      await budgets().doc(b.BudgetID).update({ Status: 'PendingApproval', ApprovalInstanceID: approval.instanceId, RejectionReason: '',
        SubmittedAt: now, SubmittedBy: actorOf(user), UpdatedAt: now, UpdatedBy: actorOf(user), History: historyWith(b, 'Submitted for approval', user) });
      return { success: true, status: 'PendingApproval' };
    }
    await commitApproval(user, Object.assign(b, { SubmittedAt: now }), 'Approved (no approval required)');
    return { success: true, status: 'Approved' };
  });
});

// The approver's decision (Approval Configuration's levels; the approval card on a phone too).
exports.decideBudgetApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  return withGlobalLock(user.uid, async () => {
    const b = await load(d.budgetId);
    requireCompany(user, b.CompanyID);
    if (b.Status !== 'PendingApproval' || !b.ApprovalInstanceID) throw new HttpsError('failed-precondition', 'This budget is not waiting for approval.');
    const result = await recordApprovalDecision(user, b.ApprovalInstanceID, d.levelNumber, d.decision, d.reason);
    if (result.status === 'Approved') await commitApproval(user, b, 'Approved');
    if (result.status === 'Rejected') {
      const reason = text(d.reason, 500);
      await budgets().doc(b.BudgetID).update({ Status: 'Rejected', RejectionReason: reason, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user),
        History: historyWith(b, 'Rejected', user, reason) });
    }
    return { success: true, status: result.status, selfApproved: result.selfApproved };
  });
});

// A start for a budget from the year before: its actuals or its current
// budget, changed by a %; or last year's months per line (to spread by).
exports.getBudgetSeed = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const yearStart = text(d.yearStart, 7);
  if (!/^\d{4}-\d{2}$/.test(yearStart)) throw new HttpsError('invalid-argument', 'Choose the financial year.');
  const prev = C.addMonths(yearStart, -12);
  if (d.source === 'budget') {
    const last = (await yearsOf(companyId)).find(b => b.YearStart === prev && b.Status === 'Approved' && b.Current);
    if (!last) throw new Error('There is no approved budget for ' + C.yearLabel(prev) + '.');
    return { lines: C.seedFromBudget(last.Lines, d.pct), from: last.Number };
  }
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const months = C.monthsOf(prev);
  const entries = await postedEntries(companyId, C.lastDay(months[11]), months[0] + '-01');
  return { lines: C.seedFromActuals(prev, coa, entries, d.pct, d.byDimension !== false), from: 'Actual ' + C.yearLabel(prev) };
});

// ---------- Budget vs Actual ----------

// A version against the company's posted actuals, per budget line, and the
// actuals no line takes ("not budgeted"). through: the month the year to
// date runs to (yyyy-mm, in the year; default the current month, or the
// year's last when it is over).
exports.getBudgetVsActual = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const b = await load(d.budgetId);
  requireCompany(user, b.CompanyID);
  const months = C.monthsOf(b.YearStart);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const through = months.includes(d.through) ? d.through : thisMonth < months[0] ? months[0] : thisMonth > months[11] ? months[11] : thisMonth;
  const [coa, units, entries] = await Promise.all([
    rtdb.ref('coa').get().then(s => s.val() || {}), rtdb.ref('orgUnits').get().then(s => s.val() || {}),
    // The balance sheet needs every year before (its opening); the P&L only this year's.
    postedEntries(b.CompanyID, C.lastDay(months[11]), (b.Lines || []).every(l => C.isPL(l.AccountType)) ? months[0] + '-01' : '')
  ]);
  const accounts = {};
  Object.keys(coa).forEach(id => { accounts[id] = { AccountType: coa[id].AccountType }; });
  const i = months.indexOf(through);
  const name = id => (id && units[id] ? units[id].Code + ' ' + (units[id].Name || '') : '');
  const rows = C.compare(b, accounts, entries).map(r => Object.assign(r, C.totals(r, i), {
    AccountCode: String((coa[r.AccountID] || {}).AccountCode || ''), AccountName: (coa[r.AccountID] || {}).AccountName || '', Parent: (coa[r.AccountID] || {}).ParentAccountID || '',
    CostCenter: name(r.CostCenterID), Project: name(r.ProjectID)
  })).map(r => Object.assign(r, { Favour: C.favour(r.AccountType, r.YtdBudget, r.YtdActual) }))
    .sort((a, b2) => a.AccountCode.localeCompare(b2.AccountCode, undefined, { numeric: true }) || a.CostCenter.localeCompare(b2.CostCenter) || a.Project.localeCompare(b2.Project));
  const versions = (await yearsOf(b.CompanyID)).filter(x => x.YearStart === b.YearStart && x.Status === 'Approved')
    .map(x => ({ BudgetID: x.BudgetID, Number: x.Number, Version: x.Version, Current: Boolean(x.Current) })).sort((a, c) => a.Version - c.Version);
  return { budget: { BudgetID: b.BudgetID, Number: b.Number, YearLabel: b.YearLabel, Status: b.Status, BalanceSheetMethod: b.BalanceSheetMethod, CompanyID: b.CompanyID },
    months, through, rows, versions };
});
