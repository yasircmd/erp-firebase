// GL views (owner, 2026-10-10; docs/modules/GL_VIEWS.md, decisions 84-87).
// New development, hand-written.
//
// GL Listing: the lines of several ledgers, one list by date with the
// account and cost center of each, and no opening, running or closing
// balance (decisions 84-85). Picked accounts; a header brings in every
// account beneath it. GL Report's access right (decision 87), and its data
// and rules: the same line reader, dimension filters and company access
// restriction (codegs.js helpers), drafts only when asked.
'use strict';
const { onCallWithMessages } = require('./callable');
const { run, requireUser_ } = require('./legacy/runtime');
const L = require('./legacy/codegs');
const { moduleHasCapability } = require('./auth');
const { rtdb } = require('./firebaseAdmin');
const { userCanAccessCompany } = require('./glWriting');
const { moduleIdForEntry } = require('./masterData');

const onCallOptions = { region: 'us-central1' };
const round2 = n => Math.round(n * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const MAX_LINES = 20000;

// Cost centers by id, "code — name" (blank for none).
async function costCenterNames() {
  const units = (await rtdb.ref('orgUnits').get()).val() || {};
  const out = {};
  Object.entries(units).forEach(([id, u]) => { if (u.Type === 'CostCenter') out[id] = [u.Code, u.Name].filter(Boolean).join(' — '); });
  return out;
}

async function glListing(idToken, params) {
  const p = params || {};
  const user = await requireUser_(idToken);
  if (!(await moduleHasCapability('GLREPORT', 'access', user.profile.role))) {
    throw new Error('You do not have access to General Ledger Reports.');
  }
  const picked = [...new Set((Array.isArray(p.AccountIDs) ? p.AccountIDs : []).map(x => String(x || '').trim()).filter(Boolean))];
  if (!picked.length) throw new Error('Pick at least one account.');
  const fromDate = String(p.FromDate || '').trim();
  const toDate = String(p.ToDate || '').trim();
  if (!isDate(fromDate) || !isDate(toDate)) throw new Error('Select both a From date and a To date.');
  if (fromDate > toDate) throw new Error('The From date is after the To date.');

  const coaData = await L.getCoaData_(idToken);
  // A header brings in every account beneath it.
  const under = id => { let q = coaData[id] && coaData[id].ParentAccountID, hops = 0; while (q && hops++ < 50) { if (picked.includes(q)) return true; q = coaData[q] && coaData[q].ParentAccountID; } return false; };
  for (const id of picked) {
    const a = coaData[id];
    if (!a) throw new Error('Account not found.');
    if (!userCanAccessCompany(user.profile, a.CompanyID)) throw new Error('You do not have access to that company.');
  }
  const target = new Set(Object.keys(coaData).filter(id => picked.includes(id) || under(id)));

  const filters = L.buildDimensionFilters_(p);
  const access = L.applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  filters.includeDraft = p.IncludeDraft === true || p.IncludeDraft === 'true';
  const lines = (await L.getPostedGlLines_(idToken, filters))
    .filter(l => target.has(l.AccountID) && l.JVDate >= fromDate && l.JVDate <= toDate)
    .sort((a, b) => a.JVDate.localeCompare(b.JVDate) || String(a.TransactionRef || '').localeCompare(String(b.TransactionRef || '')) ||
      String(a.AccountCode).localeCompare(String(b.AccountCode), undefined, { numeric: true }));
  if (lines.length > MAX_LINES) throw new Error('That is ' + lines.length + ' lines, more than ' + MAX_LINES + ' at once: narrow the dates or the accounts.');

  const cc = await costCenterNames();
  let debit = 0, credit = 0;
  const rows = lines.map(l => {
    debit += l.Debit; credit += l.Credit;
    return {
      JVID: l.JVID, JVDate: l.JVDate, JVNumber: l.JVNumber, TransactionRef: l.TransactionRef, Status: l.Status,
      SourceModule: moduleIdForEntry({ VoucherType: l.VoucherType }),
      AccountCode: l.AccountCode, AccountName: l.AccountName, CostCenterID: l.CostCenterID || '', CostCenter: cc[l.CostCenterID] || '',
      Description: l.Description || l.EntryDescription, Debit: l.Debit, Credit: l.Credit
    };
  });
  return {
    fromDate, toDate, rows,
    accounts: Object.keys(coaData).filter(id => picked.includes(id)).map(id => ({ AccountCode: coaData[id].AccountCode, AccountName: coaData[id].AccountName, IsHeader: coaData[id].IsPostable !== true }))
      .sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode), undefined, { numeric: true })),
    totals: { Debit: round2(debit), Credit: round2(credit) }
  };
}

const getGlListing = onCallWithMessages(onCallOptions, request =>
  run(request, ctx => glListing(ctx, (request.data || {}).params)));

module.exports = { getGlListing, glListing, costCenterNames };
