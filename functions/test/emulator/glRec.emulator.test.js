// GL account reconciliation, step R3 (docs/modules/RECONCILIATION.md,
// Q371-Q374), on the emulators: the company's list of accounts and their
// methods; a clearing account reconciled by matching its offsetting lines
// (what is left is the balance, carried to the next month); an accrual
// reconciled by a schedule that must add up to the balance; submit,
// approve, lock, months in order, reopen; the month's board (bank accounts
// too); Period Closing's check; the rights.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });
const err = p => p.then(r => (r && r.success === false ? r.error : 'no error'), e => e.message);
let n = 0;
const post = async (date, lines) => (await firestore.collection('journalEntries').add({ CompanyID: 'C1', JVDate: date, Status: 'Posted', VoucherType: 'JV',
  JVNumber: 'JV-' + (++n), Reference: '', Description: 'Entry ' + n, Lines: lines.map(([AccountID, Debit, Credit]) => ({ AccountID, Debit, Credit })) })).id;
const k = (id, i) => id + ':' + i;
const C = { companyId: 'C1' };
const get = (accountId, month, uid) => call(uid || 'u-admin', 'getGlRec', Object.assign({ accountId, month }, C));
const save = (accountId, month, data, uid) => call(uid || 'u-admin', 'saveGlRec', Object.assign({ accountId, month }, C, data));
const submit = (accountId, month) => call('u-admin', 'submitGlRec', Object.assign({ accountId, month }, C));

test('GL account reconciliation: the list; matching a clearing account; a schedule for an accrual; approve, lock, order, reopen; the board; Period Closing', async () => {
  const f = baseFixture();
  f.coa['A-ACCR'] = { AccountCode: '2300', AccountName: 'Accrued Expenses', AccountType: 'Liability', Status: 'Active', IsPostable: true };
  f.coa['A-EXP'] = { AccountCode: '6100', AccountName: 'Rent', AccountType: 'Expense', Status: 'Active', IsPostable: true };
  f.approvalConfigurations = { GLREC: { Enabled: true, ScopeType: 'Global' } };
  f.approvalLevels = { GLREC: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  await reset(f);
  const grn1 = await post('2026-10-03', [['A-INV', 500, 0], ['A-CLR', 0, 500]]);
  const inv1 = await post('2026-10-10', [['A-CLR', 500, 0], ['A-AP', 0, 500]]);
  const grn2 = await post('2026-10-20', [['A-INV', 300, 0], ['A-CLR', 0, 300]]);
  await post('2026-10-31', [['A-EXP', 1200, 0], ['A-ACCR', 0, 1200]]);
  await post('2026-10-12', [['A-BANK', 100, 0], ['A-EQ', 0, 100]]);

  // The list: balance-sheet accounts only, not bank accounts; who may set it.
  let s = await call('u-admin', 'getGlRecSetup', Object.assign({ month: '2026-10' }, C));
  assert.ok(s.candidates.some(a => a.AccountID === 'A-CLR') && !s.candidates.some(a => a.AccountID === 'A-BANK' || a.AccountID === 'A-EXP'));
  assert.match(await err(get('A-CLR', '2026-10')), /not on the company's list/);
  assert.match(await err(call('u-admin', 'saveGlRecList', Object.assign({ accounts: [{ AccountID: 'A-BANK', Method: 'Match' }] }, C))), /not bank accounts/);
  assert.match(await err(call('u-viewer', 'saveGlRecList', Object.assign({ accounts: [] }, C))), /permission to choose the accounts/);
  await call('u-admin', 'saveGlRecList', Object.assign({ accounts: [{ AccountID: 'A-CLR', Method: 'Match' }, { AccountID: 'A-ACCR', Method: 'Schedule' }] }, C));

  // The board and Period Closing before: nothing reconciled.
  s = await call('u-admin', 'getGlRecSetup', Object.assign({ month: '2026-10' }, C));
  assert.deepEqual(s.board.map(r => [r.Name, r.Kind, r.Status]), [['1100 Bank', 'Bank', 'Not started'], ['2100 GRN Clearing', 'GL', 'Not started'], ['2300 Accrued Expenses', 'GL', 'Not started']]);
  let pc = (await call('u-admin', 'getPeriodClosingChecklist', Object.assign({ month: '2026-10' }, C))).Items.find(i => i.Key === 'glRec');
  assert.deepEqual([pc.Result, pc.Findings.map(x => x.Number)], ['Warning', ['2100 GRN Clearing', '2300 Accrued Expenses']]);

  // GRN Clearing by matching: a GRN against its invoice; the GRN not yet invoiced is the balance.
  let r = await get('A-CLR', '2026-10');
  assert.deepEqual([r.method, r.report.Balance, r.report.OpenLines], ['Match', -300, 3]);
  assert.match(await err(save('A-CLR', '2026-10', { matches: [{ GL: [k(grn1, 1), k(grn2, 1)] }] })), /Match 1: its GL lines \(-800\.00\) do not net to nothing/);
  assert.match(await err(save('A-CLR', '2026-10', { matches: [{ GL: [k(grn1, 1)] }] })), /at least two lines/);
  r = await save('A-CLR', '2026-10', { matches: [{ GL: [k(grn1, 1), k(inv1, 0)] }], notes: 'GRN-2 waits for its bill' });
  assert.deepEqual([r.report.Balance, r.report.Explained, r.report.Difference, r.report.OpenLines], [-300, -300, 0, 1]);

  // The accrual by a schedule: it must add up to the balance.
  r = await save('A-ACCR', '2026-10', { items: [{ Description: 'October rent, landlord', Reference: 'LEASE-1', Amount: -1000 }] });
  assert.deepEqual([r.method, r.report.Balance, r.report.Explained, r.report.Difference], ['Schedule', -1200, -1000, -200]);
  assert.match(await err(submit('A-ACCR', '2026-10')), /difference is -200\.00/);
  assert.match(await err(save('A-ACCR', '2026-10', { items: [{ Description: '', Amount: 5 }] })), /Item 1: describe it/);
  r = await save('A-ACCR', '2026-10', { items: r.rec.Items.concat([{ Description: 'Service charge', Amount: '-200' }]) });
  assert.equal(r.report.Difference, 0);

  // Submitted, approved by the level, locked.
  assert.equal((await submit('A-ACCR', '2026-10')).status, 'PendingApproval');
  assert.match(await err(save('A-ACCR', '2026-10', { notes: 'x' })), /waiting for approval/);
  const p = await get('A-ACCR', '2026-10', 'u-approver');
  assert.equal(p.rec.MyLevel, 1);
  assert.equal((await call('u-approver', 'decideGlRecApproval', { recId: p.rec.RecID, levelNumber: 1, decision: 'Approved' })).status, 'Approved');
  assert.match(await err(save('A-ACCR', '2026-10', { notes: 'x' })), /reconciled and locked/);

  // November: the matched lines gone, the open GRN carried; not before October is approved.
  await save('A-CLR', '2026-11', { notes: '' });
  r = await get('A-CLR', '2026-11');
  assert.deepEqual(r.lines.map(l => [l.Key, l.Amount]), [[k(grn2, 1), -300]]);
  assert.match(await err(submit('A-CLR', '2026-11')), /2026-10 is not approved yet/);
  assert.equal((await submit('A-CLR', '2026-10')).status, 'PendingApproval');
  const q = await get('A-CLR', '2026-10', 'u-approver');
  await call('u-approver', 'decideGlRecApproval', { recId: q.rec.RecID, levelNumber: 1, decision: 'Approved' });
  pc = (await call('u-admin', 'getPeriodClosingChecklist', Object.assign({ month: '2026-10' }, C))).Items.find(i => i.Key === 'glRec');
  assert.equal(pc.Result, 'OK');
  s = await call('u-admin', 'getGlRecSetup', Object.assign({ month: '2026-10' }, C));
  assert.deepEqual(s.board.filter(x => x.Kind === 'GL').map(x => x.Status), ['Approved', 'Approved']);

  // Reopen: the latest locked month only, with a reason.
  assert.equal((await submit('A-CLR', '2026-11')).status, 'PendingApproval');
  assert.match(await err(call('u-admin', 'reopenGlRec', Object.assign({ accountId: 'A-CLR', month: '2026-10', reason: 'x' }, C))), /2026-11 is waiting for approval: reopen the latest month first/);
  assert.match(await err(call('u-viewer', 'reopenGlRec', Object.assign({ accountId: 'A-ACCR', month: '2026-10', reason: 'x' }, C))), /permission to reopen/);
  assert.equal((await call('u-admin', 'reopenGlRec', Object.assign({ accountId: 'A-ACCR', month: '2026-10', reason: 'Rent revised' }, C))).status, 'Draft');
  assert.match(await err(save('A-CLR', '2026-10', { notes: 'x' }, 'u-viewer')), /permission to prepare/);
});
