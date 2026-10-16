// The Chart of Accounts numbering and the Cash / Bank mark (owner,
// 2026-10-16; docs/modules/COA_NUMBERING.md, decisions 197-210). New
// development, hand-written; the legacy saveAccount uses it (patches
// coa-class-group-*).
//
// Six digits, a level each (decision 197):
//   X00000  class (one per type, a heading, seeded): 100000 Assets
//   XN0000  group (a heading under the class):        110000 Cash
//   XNM000  sub-group (optional, under a group):      121000 Bank: current accounts
//   XN0001-XN0999 / XNM001-XNM999  accounts (take postings), always under
//           a group or a sub-group, never straight under a class.
//
// Cash and bank (decision 210): a group (or sub-group) is marked Cash or
// Bank. Every account keeps the mark of its nearest marked heading in its
// own CashBank field, written by the account's save (and by a heading's
// save, for the accounts under it), so a check reads the account alone:
// Cash and Bank Transactions, PDCs, Fixed Assets, payroll payments and
// the final settlement. Nothing reads the code for it any more.
'use strict';

const TYPES = {
  Asset: { digit: '1', normalBalance: 'Debit' }, Liability: { digit: '2', normalBalance: 'Credit' }, Equity: { digit: '3', normalBalance: 'Credit' },
  Revenue: { digit: '4', normalBalance: 'Credit' }, COGS: { digit: '5', normalBalance: 'Debit' }, Expense: { digit: '6', normalBalance: 'Debit' }
};
const MARKS = ['Cash', 'Bank'];

// The seeded chart: a class per type and its groups.
const SEED = [
  { code: '100000', name: 'Assets', type: 'Asset', cashFlowCategory: '' },
  { code: '110000', name: 'Cash / Petty Cash', type: 'Asset', parent: '100000', cashFlowCategory: '', cashBank: 'Cash' },
  { code: '120000', name: 'Bank Accounts', type: 'Asset', parent: '100000', cashFlowCategory: '', cashBank: 'Bank' },
  { code: '130000', name: 'Accounts Receivable (Trade)', type: 'Asset', parent: '100000', cashFlowCategory: 'Operating' },
  { code: '140000', name: 'Inventory', type: 'Asset', parent: '100000', cashFlowCategory: 'Operating' },
  { code: '200000', name: 'Liabilities', type: 'Liability', cashFlowCategory: '' },
  { code: '210000', name: 'Accounts Payable (Trade)', type: 'Liability', parent: '200000', cashFlowCategory: 'Operating' },
  { code: '220000', name: 'Short-Term Loans Payable', type: 'Liability', parent: '200000', cashFlowCategory: 'Financing' },
  { code: '230000', name: 'Accrued Liabilities', type: 'Liability', parent: '200000', cashFlowCategory: 'Operating' },
  { code: '300000', name: 'Equity', type: 'Equity', cashFlowCategory: '' },
  { code: '310000', name: 'Share Capital', type: 'Equity', parent: '300000', cashFlowCategory: 'Financing' },
  { code: '320000', name: 'Retained Earnings', type: 'Equity', parent: '300000', cashFlowCategory: 'Operating' },
  { code: '400000', name: 'Revenue', type: 'Revenue', cashFlowCategory: '' },
  { code: '410000', name: 'Domestic Sales Revenues', type: 'Revenue', parent: '400000', cashFlowCategory: 'Operating' },
  { code: '420000', name: 'Sales Returns & Discounts', type: 'Revenue', parent: '400000', cashFlowCategory: 'Operating' },
  { code: '430000', name: 'Interest / Other Income', type: 'Revenue', parent: '400000', cashFlowCategory: 'Operating' },
  { code: '500000', name: 'Cost of Sales', type: 'COGS', cashFlowCategory: '' },
  { code: '510000', name: 'Cost of Goods Sold (COGS)', type: 'COGS', parent: '500000', cashFlowCategory: 'Operating' },
  { code: '520000', name: 'Direct Material Cost', type: 'COGS', parent: '500000', cashFlowCategory: 'Operating' },
  { code: '600000', name: 'Expenses', type: 'Expense', cashFlowCategory: '' },
  { code: '610000', name: 'Wages & Salaries Expense', type: 'Expense', parent: '600000', cashFlowCategory: 'Operating' },
  { code: '620000', name: 'Rent & Facility Expense', type: 'Expense', parent: '600000', cashFlowCategory: 'Operating' },
  { code: '630000', name: 'Depreciation Expense', type: 'Expense', parent: '600000', cashFlowCategory: 'Operating' }
];
// The default Retained Earnings group (Period Closing's default account is the first under it).
const RETAINED_EARNINGS_GROUP = '320000';

const isClass = code => /^[1-6]00000$/.test(String(code || ''));
const isGroup = code => /^[1-6][1-9]0000$/.test(String(code || ''));
const isSubGroup = code => /^[1-6][1-9][1-9]000$/.test(String(code || ''));
const levelOf = code => (isClass(code) ? 'class' : isGroup(code) ? 'group' : isSubGroup(code) ? 'subgroup' : 'account');

// ---------- the code ----------

function nextFree(prefix, width, from, to, used) {
  for (let n = from; n <= to; n++) {
    const code = prefix + String(n).padStart(width, '0');
    if (!used.has(code)) return code;
  }
  return '';
}
// The code a new account takes. existing: the whole chart { id: account }.
function generateCode(accountType, parentId, existing, isPostable) {
  const t = TYPES[accountType];
  if (!t) throw new Error('Unknown account type: ' + accountType);
  const all = Object.values(existing || {});
  const used = new Set(all.map(a => String(a.AccountCode || '')));
  if (!parentId) {
    if (isPostable) throw new Error('An account that takes postings sits under a group: choose its group as the parent (for example ' + t.digit + '10000), never no parent or the class.');
    const cls = t.digit + '00000';
    if (used.has(cls)) throw new Error('The ' + accountType + ' class ' + cls + ' already exists: a new heading goes under it as a group (choose ' + cls + ' as the parent).');
    return cls;
  }
  const parent = existing[parentId];
  if (!parent) throw new Error('Parent account not found.');
  if (parent.IsPostable === true) throw new Error('Parent account must be a heading (a class, group or sub-group), not an account that takes postings.');
  const pc = String(parent.AccountCode || '');
  if (isClass(pc)) {
    if (isPostable) throw new Error('An account can\'t sit straight under the class ' + pc + ': choose one of its groups (or add a group first).');
    // A group: XN0000, N 1-9.
    for (let n = 1; n <= 9; n++) { const code = pc.charAt(0) + n + '0000'; if (!used.has(code)) return code; }
    throw new Error('The class ' + pc + ' already has its 9 groups.');
  }
  if (isGroup(pc)) {
    const prefix = pc.substring(0, 2);
    if (!isPostable) {
      for (let m = 1; m <= 9; m++) { const code = prefix + m + '000'; if (!used.has(code)) return code; }
      throw new Error('The group ' + pc + ' already has its 9 sub-groups.');
    }
    const code = nextFree(prefix + '0', 3, 1, 999, used);
    if (!code) throw new Error('The group ' + pc + ' has its 999 accounts: add a sub-group for more.');
    return code;
  }
  if (isSubGroup(pc)) {
    if (!isPostable) throw new Error('A sub-group can\'t have another heading under it: only accounts.');
    const code = nextFree(pc.substring(0, 3), 3, 1, 999, used);
    if (!code) throw new Error('The sub-group ' + pc + ' has its 999 accounts.');
    return code;
  }
  throw new Error('New accounts go under a class, a group or a sub-group.');
}

// The codes an account may be renumbered to (decision 198): the free
// codes of its own heading, same range as a new account there would take.
function freeCodes(accountId, existing) {
  const a = existing[accountId];
  if (!a) throw new Error('Account not found.');
  if (a.IsPostable !== true || levelOf(a.AccountCode) !== 'account') throw new Error('Only an account that takes postings is renumbered (headings are not, for now).');
  const parent = existing[a.ParentAccountID];
  const pc = String((parent || {}).AccountCode || '');
  if (!parent || !(isGroup(pc) || isSubGroup(pc))) throw new Error('Account ' + a.AccountCode + ' is not under a group: give it its group first (it is listed under "Accounts to fix").');
  const used = new Set(Object.values(existing).map(x => String(x.AccountCode || '')));
  const prefix = isGroup(pc) ? pc.substring(0, 2) + '0' : pc.substring(0, 3);
  const out = [];
  for (let n = 1; n <= 999; n++) { const code = prefix + String(n).padStart(3, '0'); if (!used.has(code)) out.push(code); }
  return out;
}

// ---------- Cash / Bank ----------

const kindOf = a => (a && MARKS.includes(a.CashBank) ? a.CashBank : '');
const isCashOrBank = a => Boolean(kindOf(a));
const isBank = a => kindOf(a) === 'Bank';
const isCash = a => kindOf(a) === 'Cash';

// The mark an account takes: its own if it is a heading with one, else its
// nearest marked heading's (the chart as saved, with this account's own record).
function markFor(record, existing) {
  if (record.IsPostable !== true && MARKS.includes(record.OwnCashBank)) return record.OwnCashBank;
  let p = existing[record.ParentAccountID], guard = 0;
  while (p && guard++ < 10) {
    if (MARKS.includes(p.OwnCashBank)) return p.OwnCashBank;
    p = existing[p.ParentAccountID];
  }
  return '';
}
// After a heading is saved: every account under it, with the mark it now
// takes ({ id: mark } for those that change).
function marksBelow(rootId, existing) {
  const out = {};
  const walk = id => Object.keys(existing).filter(k => existing[k].ParentAccountID === id).forEach(k => {
    const m = markFor(existing[k], existing);
    if ((existing[k].CashBank || '') !== m) out[k] = m;
    walk(k);
  });
  walk(rootId);
  return out;
}

// ---------- the check (decision 201) ----------

// Accounts that take postings but are not under a group: no parent, the
// class itself as the parent, or a heading's code.
function accountsToFix(existing) {
  return Object.entries(existing || {}).filter(([, a]) => a.IsPostable === true && a.Status !== 'Inactive').map(([id, a]) => {
    const p = existing[a.ParentAccountID];
    const problem = levelOf(a.AccountCode) !== 'account' ? 'has a heading\'s code' : !a.ParentAccountID || !p ? 'has no group above it'
      : isClass(p.AccountCode) ? 'sits straight under the class ' + p.AccountCode : '';
    return problem ? { AccountID: id, AccountCode: a.AccountCode || '', AccountName: a.AccountName || '', Problem: problem } : null;
  }).filter(Boolean).sort((x, y) => x.AccountCode.localeCompare(y.AccountCode));
}

// The default Retained Earnings account: the first active one under the 320000 group.
function defaultRetainedEarnings(existing, companyId) {
  const under = (a, code) => { let p = existing[a.ParentAccountID], g = 0; while (p && g++ < 10) { if (String(p.AccountCode) === code) return true; p = existing[p.ParentAccountID]; } return false; };
  return Object.entries(existing || {}).filter(([, a]) => a.AccountType === 'Equity' && a.Status === 'Active' && a.IsPostable === true && (!a.CompanyID || a.CompanyID === companyId) && under(a, RETAINED_EARNINGS_GROUP))
    .sort((x, y) => String(x[1].AccountCode).localeCompare(String(y[1].AccountCode))).map(([id]) => id)[0] || '';
}

module.exports = { TYPES, MARKS, SEED, RETAINED_EARNINGS_GROUP, isClass, isGroup, isSubGroup, levelOf, generateCode, freeCodes, kindOf, isCashOrBank, isBank, isCash,
  markFor, marksBelow, accountsToFix, defaultRetainedEarnings };
