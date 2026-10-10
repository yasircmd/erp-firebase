// GL views (owner, 2026-10-10; docs/modules/GL_VIEWS.md, decisions 84-87):
// GL Listing (picked accounts, a header bringing in everything beneath it,
// one list by date with account and cost center, no balances, totals, the
// GL Report's filters and access); GL Report's lines carry their cost
// center; an entry's GL impact with each line's cost center.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

const D1 = '2026-09-05', D2 = '2026-09-20';
function fixture() {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-EXPH': { AccountCode: '6000', AccountName: 'Operating Expenses', AccountType: 'Expense', Status: 'Active', IsPostable: false },
    'A-RENT': { AccountCode: '6001', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true, ParentAccountID: 'A-EXPH' },
    'A-POWER': { AccountCode: '6002', AccountName: 'Electricity', AccountType: 'Expense', Status: 'Active', IsPostable: true, ParentAccountID: 'A-EXPH' },
    'A-FUEL': { AccountCode: '6100', AccountName: 'Fuel', AccountType: 'Expense', Status: 'Active', IsPostable: true }
  });
  f.orgUnits.CC2 = { Type: 'CostCenter', Code: 'CC2', Name: 'Office', Status: 'Active', CompanyID: 'C1' };
  f.roles.Clerk = { Name: 'Clerk', Status: 'Active' };
  f.users['u-clerk'] = { status: 'Active', role: 'Clerk', username: 'clerk', fullName: 'Clerk', AssignedCompanies: ['C1'] };
  return f;
}
// A journal voucher, posted unless draft: Dr expense by cost center, Cr bank.
async function jv(date, code, cc, amount, draft) {
  const d = await call('u-admin', 'saveJournalDraft', { jvData: { JVDate: date, Description: 'JV ' + code, CompanyID: 'C1', Lines: [
    { AccountCode: code, Debit: amount, Description: 'Expense ' + code, CostCenterID: cc },
    { AccountCode: '1100', Credit: amount, Description: 'Bank' }] } });
  assert.equal(d.success, true, d.error);
  if (draft) return d;
  const p = await call('u-admin', 'postJournalEntry', { jvId: d.jvId });
  assert.equal(p.success, true, p.error);
  return Object.assign(d, p);
}
const listing = (params, uid) => call(uid || 'u-admin', 'getGlListing', { params: Object.assign({ FromDate: '2026-09-01', ToDate: '2026-09-30' }, params) });

test('GL Listing: picked accounts and a header\'s children, one list by date with account and cost center, no balances, totals; filters; drafts only when asked', async () => {
  await reset(fixture());
  await jv('2026-08-31', '6001', 'CC1', 999); // before the period: no opening is shown
  const a = await jv(D2, '6001', 'CC1', 100);
  await jv(D1, '6002', 'CC2', 40);
  await jv(D1, '6100', 'CC2', 7);
  await jv(D2, '6100', 'CC1', 5, true); // a draft
  const r = await listing({ AccountIDs: ['A-EXPH', 'A-FUEL'] });
  assert.deepEqual(r.rows.map(x => [x.JVDate, x.AccountCode, x.CostCenter, x.Debit, x.Credit]), [
    [D1, '6002', 'CC2 — Office', 40, 0], [D1, '6100', 'CC2 — Office', 7, 0], [D2, '6001', 'CC1 — Workshop', 100, 0]]);
  assert.deepEqual(r.totals, { Debit: 147, Credit: 0 });
  assert.equal(r.openingBalance, undefined);
  assert.equal(r.rows[0].Balance, undefined, 'no running balance');
  assert.deepEqual(r.accounts.map(x => [x.AccountCode, x.IsHeader]), [['6000', true], ['6100', false]]);
  const row = r.rows.find(x => x.AccountCode === '6001');
  assert.deepEqual([row.TransactionRef, row.JVNumber, row.SourceModule, row.AccountName], [a.transactionRef || row.TransactionRef, a.jvNumber, 'JV', 'Rent']);
  assert.match(row.TransactionRef, /^TXN-/);
  // The cost center filter; the bank side as a ledger too.
  assert.deepEqual((await listing({ AccountIDs: ['A-EXPH', 'A-FUEL'], CostCenterID: 'CC2' })).rows.map(x => x.AccountCode), ['6002', '6100']);
  assert.deepEqual((await listing({ AccountIDs: ['A-BANK'] })).totals, { Debit: 0, Credit: 147 });
  // Drafts only when asked.
  assert.equal((await listing({ AccountIDs: ['A-FUEL'], IncludeDraft: true })).rows.length, 2);
  // The checks.
  await assert.rejects(listing({ AccountIDs: [] }), /Pick at least one account/);
  await assert.rejects(listing({ AccountIDs: ['A-FUEL'], FromDate: '' }), /both a From date and a To date/);
  await assert.rejects(listing({ AccountIDs: ['A-FUEL'], FromDate: '2026-10-01' }), /From date is after the To date/);
  await assert.rejects(listing({ AccountIDs: ['NOPE'] }), /Account not found/);
  await assert.rejects(listing({ AccountIDs: ['A-FUEL'] }, 'u-clerk'), /do not have access to General Ledger Reports/);
});

test('GL Report lines carry their cost center; an entry\'s GL impact shows each line\'s cost center, its Txn Ref and source', async () => {
  await reset(fixture());
  const a = await jv(D1, '6001', 'CC2', 60);
  const g = await call('u-admin', 'getGlReport', { params: { AccountID: 'A-EXPH', FromDate: '2026-09-01', ToDate: '2026-09-30' } });
  assert.deepEqual(g.rows.map(x => [x.AccountCode, x.CostCenterID, x.Balance]), [['6001', 'CC2', 60]]);
  const e = await call('u-admin', 'getJournalEntryDetail', { jvId: a.jvId });
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.CostCenterID, l.CostCenter]), [['6001', 'CC2', 'CC2 — Office'], ['1100', '', '']]);
  assert.deepEqual([e.SourceModule, /^TXN-/.test(e.TransactionRef), e.Status], ['JV', true, 'Posted']);
});
