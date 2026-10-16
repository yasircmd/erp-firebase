// Project report (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md,
// "Reports"): each project's income, costs and result for a period, by
// account, from the posted GL lines tagged with it. Lines with no project
// show under "No project" (decision 223). New development, hand-written.
//
// Income = Revenue accounts (credit − debit); Costs = Expense and COGS
// accounts (debit − credit); Result = Income − Costs. Other accounts (a
// project's receivable, say) are left out: the report is the project's P&L.
'use strict';
const { onCallWithMessages } = require('./callable');
const { run, requireUser_ } = require('./legacy/runtime');
const L = require('./legacy/codegs');
const { moduleHasCapability } = require('./auth');
const { rtdb } = require('./firebaseAdmin');

const onCallOptions = { region: 'us-central1' };
const round2 = n => Math.round(n * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const KIND = { Revenue: 'Income', Expense: 'Costs', COGS: 'Costs' };

async function projectReport(idToken, params) {
  const p = params || {};
  const user = await requireUser_(idToken);
  if (!(await moduleHasCapability('PROJECTREPORT', 'access', user.profile.role))) throw new Error('You do not have access to the Project Report.');
  const fromDate = String(p.FromDate || '').trim(), toDate = String(p.ToDate || '').trim();
  if (!isDate(fromDate) || !isDate(toDate)) throw new Error('Select both a From date and a To date.');
  if (fromDate > toDate) throw new Error('The From date is after the To date.');
  if (!String(p.CompanyID || '').trim()) throw new Error('Select a Company.');

  const filters = L.buildDimensionFilters_({ CompanyID: p.CompanyID, ProjectID: p.ProjectID });
  const access = L.applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  const [coaData, units] = await Promise.all([L.getCoaData_(idToken), rtdb.ref('orgUnits').get().then(s => s.val() || {})]);
  const lines = (await L.getPostedGlLines_(idToken, filters)).filter(l => l.JVDate >= fromDate && l.JVDate <= toDate);

  const byProject = new Map();
  lines.forEach(l => {
    const account = coaData[l.AccountID];
    const kind = account && KIND[account.AccountType];
    if (!kind) return;
    const id = l.ProjectID || '';
    if (!byProject.has(id)) {
      const u = units[id] || {};
      byProject.set(id, { ProjectID: id, Code: id ? u.Code || id : '', Name: id ? u.Name || '' : 'No project', Status: u.Status || '', CustomerID: u.CustomerID || '',
        StartDate: u.StartDate || '', EndDate: u.EndDate || '', Income: 0, Costs: 0, Accounts: new Map() });
    }
    const pr = byProject.get(id);
    const amount = kind === 'Income' ? (Number(l.Credit) || 0) - (Number(l.Debit) || 0) : (Number(l.Debit) || 0) - (Number(l.Credit) || 0);
    pr[kind] += amount;
    const a = pr.Accounts.get(l.AccountID) || { AccountCode: account.AccountCode, AccountName: account.AccountName, Kind: kind, Amount: 0 };
    a.Amount += amount;
    pr.Accounts.set(l.AccountID, a);
  });

  const projects = [...byProject.values()].map(pr => ({
    ProjectID: pr.ProjectID, Code: pr.Code, Name: pr.Name, Status: pr.Status, CustomerID: pr.CustomerID, StartDate: pr.StartDate, EndDate: pr.EndDate,
    Income: round2(pr.Income), Costs: round2(pr.Costs), Result: round2(pr.Income - pr.Costs),
    Accounts: [...pr.Accounts.values()].map(a => Object.assign(a, { Amount: round2(a.Amount) }))
      .sort((x, y) => (x.Kind === y.Kind ? String(x.AccountCode).localeCompare(String(y.AccountCode)) : (x.Kind === 'Income' ? -1 : 1)))
  })).sort((a, b) => (!a.ProjectID ? 1 : !b.ProjectID ? -1 : String(a.Code).localeCompare(String(b.Code), undefined, { numeric: true })));
  const totals = projects.reduce((t, x) => ({ Income: round2(t.Income + x.Income), Costs: round2(t.Costs + x.Costs), Result: round2(t.Result + x.Result) }), { Income: 0, Costs: 0, Result: 0 });
  return { fromDate, toDate, projects, totals };
}

const getProjectReport = onCallWithMessages(onCallOptions, request =>
  run(request, ctx => projectReport(ctx, (request.data || {}).params)));

module.exports = { getProjectReport, projectReport };
