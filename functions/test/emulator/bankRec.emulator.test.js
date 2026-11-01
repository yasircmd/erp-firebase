// Bank reconciliation, step R1 (docs/modules/RECONCILIATION.md, Q366-Q368),
// on the emulators: the company's bank accounts; a month's statement pasted
// and its suggested matches; matches by hand (one to many, an entry against
// its reversal) and ticks; the report reaching a difference of nothing; the
// next month starting from what is still uncleared; lines no other month
// can take; the rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
let n = 0;
const post = async (date, lines, extra) => (await firestore.collection('journalEntries').add(Object.assign({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: 'Bank Payment',
  JVNumber: 'CBT-' + (++n), Reference: '', Description: 'Entry ' + n, Lines: lines.map(([AccountID, Debit, Credit]) => ({ AccountID, Debit, Credit })) }, extra || {}))).id;
const rec = (month, uid) => call(uid || 'u-admin', 'getBankRec', { companyId: 'C1', accountId: 'A-BANK', month });
const save = (month, data, uid) => call(uid || 'u-admin', 'saveBankRec', Object.assign({ companyId: 'C1', accountId: 'A-BANK', month }, data));

test('bank reconciliation: a statement pasted, matches suggested and confirmed, by hand, ticks; the report to nothing; the next month', async () => {
  const f = baseFixture();
  f.coa['A-EXP'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  await reset(f);
  const open = await post('2026-09-30', [['A-BANK', 10000, 0], ['A-EQ', 0, 10000]], { VoucherType: 'JV' });
  const chq = await post('2026-10-02', [['A-EXP', 1250, 0], ['A-BANK', 0, 1250]], { Reference: '100045' });
  const two = await post('2026-10-08', [['A-EXP', 400, 0], ['A-BANK', 0, 400]]);
  const three = await post('2026-10-08', [['A-EXP', 600, 0], ['A-BANK', 0, 600]]);
  const wrong = await post('2026-10-12', [['A-EXP', 90, 0], ['A-BANK', 0, 90]]);
  const back = await post('2026-10-12', [['A-EXP', 0, 90], ['A-BANK', 90, 0]], { VoucherType: 'JV' }); // its reversal
  const late = await post('2026-10-30', [['A-EXP', 700, 0], ['A-BANK', 0, 700]]); // not yet presented
  await post('2026-10-31', [['A-BANK', 900, 0], ['A-EQ', 0, 900]], { VoucherType: 'Bank Receipt' }); // not yet credited

  const setup = await call('u-admin', 'getBankRecSetup', { companyId: 'C1' });
  assert.deepEqual(setup.accounts.map(a => a.AccountID), ['A-BANK'], 'the bank accounts only (not cash)');

  // September: the opening deposit ticked by hand, the statement balance typed.
  let r = await save('2026-09', { ticked: [open + ':0'], statementClosing: '10,000' });
  assert.deepEqual([r.report.GLBalance, r.report.Difference], [10000, 0]);

  // October: pasted; the cheque suggested by its number.
  r = await save('2026-10', { statementOpening: 10000, statementClosing: 7750, pasteText: [
    'Date\tDescription\tReference\tDebit\tCredit',
    '04/10/2026\tCHQ 100045\t\t1,250.00\t',
    '09/10/2026\tTwo payments\t\t1000\t',
    'oops'
  ].join('\n') });
  assert.deepEqual(r.badRows, [4]);
  assert.equal(r.glLines.some(g => g.Key === open + ':0'), false, 'September\'s cleared line is gone from October');
  assert.equal(r.rec.StatementLines.length, 2);
  const [s1, s2] = r.rec.StatementLines.map(s => s.LineID);
  assert.deepEqual(r.suggestions.map(m => [m.GL[0], m.ST[0], m.ByReference]), [[chq + ':1', s1, true]]);
  assert.deepEqual(r.unmatchedStatement.sort(), [s1, s2].sort());

  // Refused: an unbalanced match; a line in two matches; a line cleared by another month.
  assert.match(await err(save('2026-10', { matches: [{ GL: [two + ':1'], ST: [s2] }] })), /Match 1: its GL lines \(-400\.00\) and statement lines \(-1000\.00\) differ/);
  assert.match(await err(save('2026-10', { matches: [{ GL: [chq + ':1'], ST: [s1] }, { GL: [chq + ':1', two + ':1'], ST: [] }] })), /Match 2/);
  assert.match(await err(save('2026-10', { ticked: [open + ':0'] })), /not one of this account's open GL lines/);
  assert.match(await err(save('2026-10', { pasteText: '15/11/2026\tNext month\t\t5\t' })), /dated outside 2026-10/);

  // The suggestion accepted, two payments against one bank line, an entry against its reversal.
  r = await save('2026-10', { matches: [{ GL: [chq + ':1'], ST: [s1] }, { GL: [two + ':1', three + ':1'], ST: [s2] }, { GL: [wrong + ':1', back + ':1'], ST: [] }] });
  assert.deepEqual([r.report.GLBalance, r.report.PaymentsNotPresented, r.report.DepositsNotCredited, r.report.PerBank, r.report.StatementClosing, r.report.Difference],
    [7950, 700, 900, 7750, 7750, 0]);
  assert.deepEqual(r.report.Uncleared.sort(), [late + ':1'].concat(r.report.Uncleared.filter(k => k !== late + ':1')).sort());
  assert.equal(r.unmatchedStatement.length, 0);

  // November starts from what is still uncleared; October's statement balance shown as the opening.
  r = await rec('2026-11');
  assert.deepEqual(r.glLines.map(g => g.Amount).sort((a, b) => a - b), [-700, 900]);
  assert.equal(r.previousClosing, 7750);
  assert.equal(r.rec.Status, 'New');

  // The rights: a viewer reads, prepares nothing.
  assert.equal((await rec('2026-10', 'u-viewer')).report.Difference, 0);
  assert.match(await err(save('2026-10', { ticked: [] }, 'u-viewer')), /permission to prepare bank reconciliations/);
  assert.match(await err(call('u-other', 'getBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10' })), /access to that company/);
  assert.match(await err(call('u-admin', 'getBankRec', { companyId: 'C1', accountId: 'A-CASH', month: '2026-10' })), /one of the company's bank accounts/);
});
