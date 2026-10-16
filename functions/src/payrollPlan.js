// HR Payroll, step 6: the payment plan (owner, 2026-10-06;
// docs/modules/HR_PAYROLL.md, decision 47). Before a run or an interim
// batch is paid, each employee (or item) is given one way to be paid and
// the account it is paid from:
//   - BankFile: in the bank file, from a bank account (needs an IBAN);
//   - Cash: from a cash account;
//   - Cheque: a cheque or transfer, from a bank account.
// They are grouped by way and account; each group is paid, with its own
// date and journal, and reversed, on its own. Shared by payrollPayment.js
// (runs) and payrollInterim.js (batches).
'use strict';

const WAYS = { BankFile: 'Bank file', Cash: 'Cash', Cheque: 'Cheque / transfer' };
// Cash accounts' codes start 10, banks' 11 (as Cash & Bank Transactions).
const kindOf = a => require('./coaScheme').kindOf(a); // the Cash / Bank mark (docs/modules/COA_NUMBERING.md)
const usable = (a, co) => a && a.AccountType === 'Asset' && kindOf(a) && a.Status === 'Active' && a.IsPostable && (!a.CompanyID || a.CompanyID === co);

// The company's cash and bank accounts, for the plan.
function accountsOf(coa, co) {
  return Object.entries(coa).filter(([, a]) => usable(a, co))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName, Kind: kindOf(a), Bank: kindOf(a) === 'Bank' }))
    .sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
}
// The way each is paid unless HR chose: by bank file with an IBAN, else
// cash; from the company's first account of that kind.
function defaultWay(hasIban, accounts) {
  const first = kind => (accounts.find(a => a.Kind === kind) || {}).AccountID || '';
  return hasIban ? { Way: 'BankFile', AccountID: first('Bank') } : { Way: 'Cash', AccountID: first('Cash') };
}
// A way chosen: the account suits it; a bank file needs an IBAN. Returns a
// message, or '' when fine.
function wayProblem(way, accountId, coa, co, hasIban, name) {
  if (!WAYS[way]) return name + ': choose how they are paid.';
  const a = coa[accountId];
  if (!usable(a, co)) return name + ': choose the account it is paid from (a cash or bank account of the company).';
  if (way === 'Cash' && kindOf(a) !== 'Cash') return name + ': cash is paid from a cash account.';
  if (way !== 'Cash' && kindOf(a) !== 'Bank') return name + ': ' + WAYS[way].toLowerCase() + ' is paid from a bank account.';
  if (way === 'BankFile' && !hasIban) return name + ' has no IBAN: pay by cash or cheque.';
  return '';
}
const keyOf = (way, accountId) => way + ':' + accountId;
// The groups: rows ({ Way, AccountID, Amount, Paid }) by way and account,
// with what each holds and pays.
function groupsOf(rows, accounts) {
  const out = {};
  rows.forEach(r => {
    const k = keyOf(r.Way, r.AccountID);
    const a = accounts.find(x => x.AccountID === r.AccountID);
    const g = out[k] || (out[k] = { Key: k, Way: r.Way, WayName: WAYS[r.Way] || r.Way, AccountID: r.AccountID, Account: a ? a.AccountCode + ' — ' + a.AccountName : '(no account)', Count: 0, Total: 0, Unpaid: 0, UnpaidTotal: 0 });
    g.Count += 1; g.Total = Math.round((g.Total + r.Amount) * 100) / 100;
    if (!r.Paid) { g.Unpaid += 1; g.UnpaidTotal = Math.round((g.UnpaidTotal + r.Amount) * 100) / 100; }
  });
  return Object.values(out).sort((a, b) => a.Key.localeCompare(b.Key));
}

module.exports = { WAYS, kindOf, usable, accountsOf, defaultWay, wayProblem, keyOf, groupsOf };
