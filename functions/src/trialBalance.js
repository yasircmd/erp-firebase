// Trial Balance for a period: opening balance, the period's debits and
// credits, and closing balance per account (owner request 2026-09-27).
// Replaces the screen's use of the legacy as-of-date getTrialBalance,
// which showed the closing balance only; that callable stays deployed.
//
// Same data and rules as the legacy report: POSTED journal entries only,
// the same dimension filters and company access restriction (codegs.js
// helpers), and balances cumulative since inception (no year-end close,
// so income and expense accounts carry an opening balance too).
//   Opening = net of every line dated before FromDate
//   Period  = gross debits and gross credits dated FromDate..ToDate
//   Closing = Opening + Period debits − Period credits
// Opening and closing are shown net, on one side (Dr or Cr).
'use strict';
const { onCallWithMessages } = require('./callable');
const { run, requireUser_ } = require('./legacy/runtime');
const L = require('./legacy/codegs');
const { moduleHasCapability } = require('./auth');

const onCallOptions = { region: 'us-central1' };
const round2 = n => Math.round(n * 100) / 100;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const sides = net => ({ Debit: net > 0 ? net : 0, Credit: net < 0 ? -net : 0 });

async function trialBalancePeriod(idToken, params) {
  const p = params || {};
  const user = await requireUser_(idToken);
  if (!(await moduleHasCapability('TRIALBALANCE', 'access', user.profile.role))) {
    throw new Error('You do not have access to Trial Balance.');
  }
  const fromDate = String(p.FromDate || '').trim();
  const toDate = String(p.ToDate || '').trim();
  if (!isDate(fromDate) || !isDate(toDate)) throw new Error('Select both a From date and a To date.');
  if (fromDate > toDate) throw new Error('The From date is after the To date.');

  const filters = L.buildDimensionFilters_(p);
  const access = L.applyCompanyAccessRestriction_(user, filters.companyId);
  filters.companyId = access.companyId;
  filters.assignedCompanies = access.assignedCompanies;
  const coaData = await L.getCoaData_(idToken);
  const lines = (await L.getPostedGlLines_(idToken, filters)).filter(l => l.JVDate <= toDate);

  const byAccount = {};
  lines.forEach(l => {
    const a = byAccount[l.AccountID] || (byAccount[l.AccountID] = { opening: 0, debit: 0, credit: 0 });
    const debit = Number(l.Debit) || 0, credit = Number(l.Credit) || 0;
    if (l.JVDate < fromDate) a.opening += debit - credit;
    else { a.debit += debit; a.credit += credit; }
  });

  const totals = { OpeningDebit: 0, OpeningCredit: 0, PeriodDebit: 0, PeriodCredit: 0, ClosingDebit: 0, ClosingCredit: 0 };
  const rows = [];
  Object.keys(byAccount).forEach(accId => {
    const account = coaData[accId];
    if (!account) return;
    const a = byAccount[accId];
    const opening = round2(a.opening), debit = round2(a.debit), credit = round2(a.credit);
    const closing = round2(opening + debit - credit);
    // An account with nothing to show: no opening, no movement.
    if (Math.abs(opening) < 0.005 && debit < 0.005 && credit < 0.005) return;
    const o = sides(opening), c = sides(closing);
    const row = {
      AccountCode: account.AccountCode, AccountName: account.AccountName, AccountType: account.AccountType,
      OpeningDebit: o.Debit, OpeningCredit: o.Credit, PeriodDebit: debit, PeriodCredit: credit,
      ClosingDebit: c.Debit, ClosingCredit: c.Credit
    };
    Object.keys(totals).forEach(k => { totals[k] += row[k]; });
    rows.push(row);
  });
  rows.sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode), undefined, { numeric: true }));
  Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });

  return { fromDate, toDate, rows, totals };
}

const getTrialBalancePeriod = onCallWithMessages(onCallOptions, request =>
  run(request, ctx => trialBalancePeriod(ctx, (request.data || {}).params)));

module.exports = { getTrialBalancePeriod, trialBalancePeriod };
