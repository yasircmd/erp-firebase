// The Chart of Accounts numbering and the Cash / Bank mark (docs/modules/COA_NUMBERING.md).
//   node --test functions/test/unit/coaScheme.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../../src/coaScheme');

const chart = () => ({
  C1: { AccountCode: '100000', AccountType: 'Asset', IsPostable: false },
  G1: { AccountCode: '110000', AccountType: 'Asset', IsPostable: false, ParentAccountID: 'C1', OwnCashBank: 'Cash', CashBank: 'Cash' },
  G2: { AccountCode: '120000', AccountType: 'Asset', IsPostable: false, ParentAccountID: 'C1', OwnCashBank: 'Bank', CashBank: 'Bank' },
  S1: { AccountCode: '121000', AccountType: 'Asset', IsPostable: false, ParentAccountID: 'G2', CashBank: 'Bank' },
  A1: { AccountCode: '110001', AccountType: 'Asset', IsPostable: true, ParentAccountID: 'G1', CashBank: 'Cash' },
  A2: { AccountCode: '110003', AccountType: 'Asset', IsPostable: true, ParentAccountID: 'G1', CashBank: 'Cash' },
  E1: { AccountCode: '600000', AccountType: 'Expense', IsPostable: false }
});

test('codes: a group under the class, an account and a sub-group under a group, an account under a sub-group', () => {
  const c = chart();
  assert.equal(s.generateCode('Asset', 'C1', c, false), '130000');
  assert.equal(s.generateCode('Asset', 'G1', c, true), '110002', 'the first free code');
  assert.equal(s.generateCode('Asset', 'G1', c, false), '111000');
  assert.equal(s.generateCode('Asset', 'G2', c, false), '122000');
  assert.equal(s.generateCode('Asset', 'S1', c, true), '121001');
  assert.equal(s.generateCode('Liability', null, c, false), '200000', 'a missing class');
});

test('codes refused: an account straight under the class or with no parent; a second class; a heading under a sub-group', () => {
  const c = chart();
  assert.throws(() => s.generateCode('Asset', 'C1', c, true), /can't sit straight under the class 100000/);
  assert.throws(() => s.generateCode('Asset', null, c, true), /sits under a group/);
  assert.throws(() => s.generateCode('Asset', null, c, false), /class 100000 already exists/);
  assert.throws(() => s.generateCode('Asset', 'S1', c, false), /sub-group can't have another heading/);
  assert.throws(() => s.generateCode('Asset', 'A1', c, true), /must be a heading/);
});

test('renumber: the free codes of its own heading only; headings and accounts outside a group are not', () => {
  const c = chart();
  const free = s.freeCodes('A1', c);
  assert.deepEqual([free[0], free[1], free.length, free.includes('110003'), free.includes('120001')], ['110002', '110004', 997, false, false]);
  assert.throws(() => s.freeCodes('G1', c), /Only an account that takes postings/);
  c.X = { AccountCode: '100001', AccountType: 'Asset', IsPostable: true, ParentAccountID: 'C1' };
  assert.throws(() => s.freeCodes('X', c), /not under a group/);
});

test('Cash / Bank: an account takes its nearest marked heading\'s mark; a heading\'s change reaches the accounts under it', () => {
  const c = chart();
  assert.equal(s.markFor({ IsPostable: true, ParentAccountID: 'S1' }, c), 'Bank', 'through the sub-group');
  assert.equal(s.markFor({ IsPostable: true, ParentAccountID: 'E1' }, c), '');
  assert.deepEqual([s.isCashOrBank(c.A1), s.isBank(c.A1), s.kindOf({ AccountCode: '110009' }), s.isCashOrBank(null)], [true, false, '', false], 'the mark, never the code');
  c.G1.OwnCashBank = 'Bank';
  assert.deepEqual(s.marksBelow('G1', c), { A1: 'Bank', A2: 'Bank' });
  c.G1.OwnCashBank = '';
  assert.deepEqual(s.marksBelow('G1', c), { A1: '', A2: '' });
});

test('accounts to fix: no group above, straight under the class, a heading\'s code; the default Retained Earnings', () => {
  const c = chart();
  c.X1 = { AccountCode: '100001', AccountName: 'Old cash', IsPostable: true, ParentAccountID: 'C1' };
  c.X2 = { AccountCode: '140000', AccountName: 'Stock', IsPostable: true, ParentAccountID: 'C1' };
  c.X3 = { AccountCode: '1000', AccountName: 'Loose', IsPostable: true };
  assert.deepEqual(s.accountsToFix(c).map(x => [x.AccountCode, x.Problem]), [['1000', 'has no group above it'], ['100001', 'sits straight under the class 100000'], ['140000', 'has a heading\'s code']]);
  const e = { EQ: { AccountCode: '300000', IsPostable: false }, RE: { AccountCode: '320000', IsPostable: false, ParentAccountID: 'EQ' },
    R2: { AccountCode: '320002', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'RE' },
    R1: { AccountCode: '320001', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'RE' },
    SC: { AccountCode: '310001', AccountType: 'Equity', Status: 'Active', IsPostable: true, ParentAccountID: 'EQ' } };
  assert.equal(s.defaultRetainedEarnings(e, 'C1'), 'R1');
});

test('the seed: a class per type, its groups under it, Cash and Bank marked', () => {
  const classes = s.SEED.filter(x => !x.parent).map(x => x.code);
  assert.deepEqual(classes, ['100000', '200000', '300000', '400000', '500000', '600000']);
  assert.ok(s.SEED.filter(x => x.parent).every(x => s.isGroup(x.code) && x.parent === x.code.charAt(0) + '00000'));
  assert.deepEqual(s.SEED.filter(x => x.cashBank).map(x => [x.code, x.cashBank]), [['110000', 'Cash'], ['120000', 'Bank']]);
});
