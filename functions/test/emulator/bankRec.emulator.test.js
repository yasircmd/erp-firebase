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

// Step R2 (Q369, Q370, Q374): an entry posted for a statement line and
// matched; submitted only at nothing; approved through the levels, locked;
// months in order; reopened, the latest only, with a reason; Period
// Closing's check.
test('R2: an entry from a statement line; submit, approve, lock; months in order; reopen; Period Closing', async () => {
  const f = baseFixture();
  f.coa['A-CHG'] = { AccountCode: '6900', AccountName: 'Bank Charges', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.approvalConfigurations = { BANKREC: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { BANKREC: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  await post('2026-09-30', [['A-BANK', 1000, 0], ['A-EQ', 0, 1000]], { VoucherType: 'JV' });

  // Period Closing: September's bank account not reconciled.
  const before = (await call('u-admin', 'getPeriodClosingChecklist', { companyId: 'C1', month: '2026-09' })).Items.find(i => i.Key === 'bankRec');
  assert.deepEqual([before.Result, before.Findings.map(x => [x.Number, x.Status])], ['Warning', [['1100 Bank', 'Not started']]]);

  // September: a bank charge on the statement, posted from it and matched.
  let r = await save('2026-09', { statementClosing: 985, pasteText: '30/09/2026\tCapital\t\t\t1000\n30/09/2026\tBank charges\t\t15\t' });
  const [cap, chg] = r.rec.StatementLines;
  r = await save('2026-09', { matches: [{ GL: [r.glLines[0].Key], ST: [cap.LineID] }] });
  assert.equal(r.report.Difference, -15, 'the charge is the difference');
  assert.match(await err(call('u-admin', 'submitBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09' })), /difference is -15\.00/);
  assert.match(await err(call('u-admin', 'postBankRecEntry', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09', lineId: chg.LineID, accountCode: '' })), /Choose the account/);
  r = await call('u-admin', 'postBankRecEntry', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09', lineId: chg.LineID, accountCode: '6900', costCenterCode: 'CC1' });
  assert.deepEqual([r.status, r.matched, r.report.Difference, r.unmatchedStatement.length], ['Posted', true, 0, 0]);
  const posted = (await firestore.collection('journalEntries').where('CompanyID', '==', 'C1').where('VoucherType', '==', 'Bank Payment').get()).docs.map(d => d.data());
  assert.deepEqual(posted.map(e => [e.JVDate, e.Status, e.Lines.map(l => [l.AccountID, l.Debit, l.Credit, l.CostCenterID || '']).sort()]), [['2026-09-30', 'Posted', [['A-BANK', 0, 15, 'CC1'], ['A-CHG', 15, 0, 'CC1']]]]);
  assert.match(await err(call('u-admin', 'postBankRecEntry', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09', lineId: chg.LineID, accountCode: '6900' })), /matched already/);

  // October: not before September is approved.
  await save('2026-10', { statementClosing: 985 });
  assert.match(await err(call('u-admin', 'submitBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10' })), /2026-09 is not approved yet/);

  // September submitted: waiting; locked against changes; the approver decides.
  assert.equal((await call('u-admin', 'submitBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09' })).status, 'PendingApproval');
  assert.match(await err(save('2026-09', { statementClosing: 1 })), /waiting for approval/);
  const pending = await call('u-approver', 'getBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09' });
  assert.equal(pending.rec.MyLevel, 1);
  assert.equal((await call('u-approver', 'decideBankRecApproval', { recId: pending.rec.RecID, levelNumber: 1, decision: 'Approved' })).status, 'Approved');
  assert.match(await err(save('2026-09', { statementClosing: 1 })), /reconciled and locked: reopen it/);
  const after = (await call('u-admin', 'getPeriodClosingChecklist', { companyId: 'C1', month: '2026-09' })).Items.find(i => i.Key === 'bankRec');
  assert.equal(after.Result, 'OK');

  // October approved too; reopening September refused (October rests on it), October reopened with a reason.
  assert.equal((await call('u-admin', 'submitBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10' })).status, 'PendingApproval');
  const oct = await call('u-approver', 'getBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10' });
  await call('u-approver', 'decideBankRecApproval', { recId: oct.rec.RecID, levelNumber: 1, decision: 'Approved' });
  assert.match(await err(call('u-admin', 'reopenBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-09', reason: 'x' })), /2026-10 is locked: reopen the latest month first/);
  assert.match(await err(call('u-admin', 'reopenBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10', reason: '' })), /reason/);
  assert.match(await err(call('u-viewer', 'reopenBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10', reason: 'x' })), /permission to reopen/);
  assert.equal((await call('u-admin', 'reopenBankRec', { companyId: 'C1', accountId: 'A-BANK', month: '2026-10', reason: 'Statement corrected' })).status, 'Draft');
  const hist = (await firestore.collection('bankRecs').doc('C1__A-BANK__2026-10').get()).data().History.map(h => h.What + (h.Note ? ': ' + h.Note : ''));
  assert.deepEqual(hist.slice(-3), ['Submitted for approval', 'Approved', 'Reopened: Statement corrected']);
});
