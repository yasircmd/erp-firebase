// HR Payroll, step 4b: advances and loans (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, decision 7 and decisions 24-27).
//   - Loan types (Payroll Setup → Loans): an advance (recovered at once) or
//     a loan (in instalments), with its receivable account, the group's
//     with a company override.
//   - A loan or advance (module PAYROLLLOAN, "Loans & Advances"): entered as
//     a draft, approved through Approval Configuration ("Loan / advance",
//     decision 25), paid out from here (Dr the receivable / Cr a bank or
//     cash account, decision 24), recovered by each payroll run
//     (payrollRun.js; never past the net, decision 26) until repaid. HR may
//     skip a month, change the instalment from a month, or record an early
//     repayment (decision 27).
//   - The balance: the amount less the recoveries in posted runs and the
//     repayments. A reversed run gives its recovery back.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { approvalInstances } = require('./approvalStore');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'PAYROLLLOAN';
const VOUCHER_TYPE = 'PayrollLoan';
const TYPES = () => firestore.collection('payrollLoanTypes');
const LOANS = () => firestore.collection('payrollLoans');
const RUNS = () => firestore.collection('payrollRuns');
const SETTLEMENTS = () => firestore.collection('payrollSettlements');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const actorOf = user => user.profile.username || user.uid; // as My Drafts matches
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const docs = (snap, key) => snap.docs.map(d => Object.assign({ [key]: d.id }, d.data()));
const num = v => Number(String(v == null ? '' : v).replace(/,/g, ''));
const isCashOrBank = a => a && a.AccountType === 'Asset' && require('./coaScheme').isCashOrBank(a); // by the Cash / Bank mark (docs/modules/COA_NUMBERING.md)
const history = (l, event, user, extra) => (l.History || []).concat([Object.assign({ Event: event, By: actorName(user), At: new Date().toISOString() }, extra || {})]);

// ---------- loan types (Payroll Setup → Loans) ----------

const canSetup = (user, cap) => moduleHasCapability('PAYROLLSETUP', cap, user.profile.role);
const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function loanTypes() { return docs(await TYPES().get(), 'LoanTypeID').sort((a, b) => a.Name.localeCompare(b.Name)); }
// The receivable a loan of a type posts to for a company: its override, else the group's.
const accountFor = (t, co) => (t.GLByCompany || {})[co] || t.GLAccountID || '';

function checkAsset(coa, id, label, companyId) {
  const a = coa[id];
  if (!a) bad(label + ': account not found.');
  if (a.Status !== 'Active' || !a.IsPostable) bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' is not an active, postable account.');
  if (a.AccountType !== 'Asset') bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' must be an asset (a receivable).');
  if (companyId === null && a.CompanyID) bad(label + ': the group\'s account must be a shared one; set company accounts as overrides.');
  if (companyId && a.CompanyID && a.CompanyID !== companyId) bad(label + ': ' + a.AccountCode + ' belongs to another company.');
}

exports.getLoanTypes = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await canSetup(user, 'access')) && !(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to the loan types.');
  return { types: await loanTypes(), canWrite: await canSetup(user, 'write') };
});

exports.saveLoanType = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await canSetup(user, 'write'))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
  const d = (request.data || {}).loanType || {};
  const id = text(d.LoanTypeID, 80);
  const all = await loanTypes();
  const cur = id ? all.find(t => t.LoanTypeID === id) : null;
  if (id && !cur) throw new HttpsError('not-found', 'Loan type not found.');
  const out = { Name: text(d.Name, 60), Kind: text(d.Kind, 10), GLAccountID: text(d.GLAccountID, 80), Active: d.Active !== false };
  if (!out.Name) bad('Name the loan type.');
  if (!['Advance', 'Loan'].includes(out.Kind)) bad('A type is an advance (recovered at once) or a loan (in instalments).');
  if (all.some(t => t.LoanTypeID !== id && t.Name.toLowerCase() === out.Name.toLowerCase())) throw new HttpsError('already-exists', 'There is already a loan type "' + out.Name + '".');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  if (!out.GLAccountID) bad('Choose the receivable account.');
  checkAsset(coa, out.GLAccountID, out.Name, null);
  const by = Object.assign({}, (cur || {}).GLByCompany);
  for (const [co, acc] of Object.entries(d.GLByCompany || {})) {
    if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const a = text(acc, 80);
    if (!a) { delete by[co]; continue; }
    checkAsset(coa, a, out.Name + ' (' + co + ')', co);
    by[co] = a;
  }
  out.GLByCompany = by;
  // Limits on requests from the Employee Portal, all optional
  // (docs/modules/EMPLOYEE_PORTAL.md, decision 103).
  const opt = v => (v === '' || v == null ? null : num(v));
  out.MaxMonths = opt(d.MaxMonths);
  if (out.MaxMonths != null && !(out.MaxMonths > 0 && out.MaxMonths <= 60)) bad('The most an employee may ask for is 0.5 to 60 months of salary (or leave it empty).');
  if (out.MaxMonths != null) out.MaxMonths = round2(out.MaxMonths);
  out.MaxBasis = text(d.MaxBasis, 10) || 'Basic';
  if (!['Basic', 'Gross'].includes(out.MaxBasis)) bad('The months are of the basic or the gross salary.');
  out.MaxInstalments = out.Kind === 'Advance' ? null : opt(d.MaxInstalments);
  if (out.MaxInstalments != null && !(Number.isInteger(out.MaxInstalments) && out.MaxInstalments >= 1 && out.MaxInstalments <= 120)) bad('The most instalments is a whole number from 1 to 120 (or leave it empty).');
  out.AfterProbation = d.AfterProbation === true;
  out.OneOpen = d.OneOpen === true;
  const ref = cur ? TYPES().doc(cur.LoanTypeID) : TYPES().doc();
  await ref.set(out);
  return { success: true, loanTypeId: ref.id };
});

// ---------- balances ----------

// Each loan's recoveries in posted runs (by month) and its balance.
async function recoveriesOf(companyId) {
  const out = {};
  const runs = docs(await RUNS().where('CompanyID', '==', companyId).get(), 'RunID').filter(r => r.Status === 'Posted');
  for (const r of runs) {
    (await RUNS().doc(r.RunID).collection('slips').get()).docs.forEach(x => (x.data().Lines || []).filter(l => l.Source === 'Loan').forEach(l => {
      (out[l.LoanID] = out[l.LoanID] || []).push({ Month: r.Month, RunID: r.RunID, Amount: l.Amount });
    }));
  }
  return out;
}
const { loanBalance: balanceOf, loanDue: dueFor } = require('./payrollCalc');
// For the run (payrollRun.js): the company's loans due in the month, by
// employee, oldest first; the balance before the run.
async function loansDue(companyId, month, runId) {
  const loans = docs(await LOANS().where('CompanyID', '==', companyId).get(), 'LoanID').filter(l => l.Status === 'Active');
  if (!loans.length) return {};
  const recs = await recoveriesOf(companyId);
  const out = {};
  loans.sort((a, b) => String(a.LoanNumber).localeCompare(String(b.LoanNumber))).forEach(l => {
    const balance = balanceOf(l, recs[l.LoanID], runId);
    const due = dueFor(l, month, balance);
    if (due > 0) (out[l.EmployeeID] = out[l.EmployeeID] || []).push({ LoanID: l.LoanID, LoanNumber: l.LoanNumber, TypeName: l.TypeName, Due: due, Balance: balance });
  });
  return out;
}

// ---------- loans (module PAYROLLLOAN) ----------

async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Loans & Advances.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'pay' ? 'You do not have permission to pay out or receive loans.' : 'You do not have permission to enter loans.');
}
// An employee whose final settlement is past its draft (step 5b) has the
// loans recovered there: payouts and repayments wait for it.
async function requireNoSettlement(l) {
  const s = (await SETTLEMENTS().doc('fs_' + l.EmployeeID).get()).data();
  if (s && s.Status !== 'Draft') throw failed(l.EmployeeName + ' has a final settlement (' + s.Number + '): the loans are recovered there.');
}
async function loadLoan(user, id) {
  const snap = await LOANS().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Loan not found.');
  const l = Object.assign({ LoanID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, l.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return l;
}
function view(l, recs) {
  const balance = l.Status === 'Active' ? balanceOf(l, recs) : l.Amount;
  return Object.assign({}, l, { Balance: balance, Recoveries: recs || [], Shown: l.Status === 'Active' && balance <= 0 ? 'Repaid' : l.Status });
}

exports.getLoans = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const empId = text(d.employeeId, 80);
  // The employee record shows its loans to those who see the employee's pay.
  if (empId) {
    const ok = (await can(user, 'access')) || (await moduleHasCapability('EMPLOYEES', 'sensitive', user.profile.role));
    if (!ok) throw new HttpsError('permission-denied', 'You do not have access to Loans & Advances.');
  } else await requireCap(user);
  const loans = docs(await LOANS().get(), 'LoanID').filter(l => userCanAccessCompany(user.profile, l.CompanyID) && (!empId || l.EmployeeID === empId));
  const recs = {};
  for (const co of [...new Set(loans.filter(l => l.Status === 'Active').map(l => l.CompanyID))]) Object.assign(recs, await recoveriesOf(co));
  return { loans: loans.map(l => view(l, recs[l.LoanID])).sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt))),
    canDraft: await can(user, 'draft'), canPay: await can(user, 'pay') };
});

// The form: the employees of the user's companies, and the types.
exports.getLoanForm = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const emps = docs(await firestore.collection('employees').get(), 'EmployeeID').filter(e => userCanAccessCompany(user.profile, e.CompanyID) && e.Status !== 'Left')
    .map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo, FullName: e.FullName, CompanyID: e.CompanyID })).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const accounts = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && isCashOrBank(a))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName, CompanyID: a.CompanyID || '' })).sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  return { employees: emps, types: (await loanTypes()).filter(t => t.Active !== false), accounts };
});

exports.getLoan = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const l = await loadLoan(user, (request.data || {}).loanId);
  const recs = (await recoveriesOf(l.CompanyID))[l.LoanID] || [];
  let approval = null;
  if (l.ApprovalInstanceID) {
    const inst = await approvalInstances.get(l.ApprovalInstanceID);
    if (inst) {
      const decided = new Set((inst.Decisions || []).map(x => x.LevelNumber));
      approval = { Levels: (inst.RequiredLevels || []).map(x => ({ LevelNumber: x.LevelNumber })), Decisions: inst.Decisions || [],
        MyLevels: l.Status === 'PendingApproval' ? (inst.RequiredLevels || []).filter(x => x.ApproverUserID === user.uid && !decided.has(x.LevelNumber)).map(x => x.LevelNumber) : [] };
    }
  }
  return { loan: view(l, recs), approval, canDraft: await can(user, 'draft'), canPay: await can(user, 'pay') };
});

// A draft: created or changed (Payroll Loans "draft").
exports.saveLoan = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = (request.data || {}).loan || {};
  const id = text(d.LoanID, 80);
  const cur = id ? await loadLoan(user, id) : null;
  if (cur && cur.Status !== 'Draft') throw failed('Only a draft can be changed; once running, use the schedule.');
  const empSnap = await firestore.collection('employees').doc(text(d.EmployeeID, 80) || '-').get();
  if (!empSnap.exists) bad('Choose the employee.');
  const emp = empSnap.data();
  if (!userCanAccessCompany(user.profile, emp.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const type = (await loanTypes()).find(t => t.LoanTypeID === text(d.LoanTypeID, 80) && t.Active !== false);
  if (!type) bad('Choose the type.');
  const amount = round2(num(d.Amount));
  if (!(amount > 0)) bad('Enter the amount.');
  const instalment = type.Kind === 'Advance' ? amount : round2(num(d.Instalment));
  if (!(instalment > 0 && instalment <= amount)) bad('The instalment is more than 0 and at most the amount.');
  const start = text(d.StartMonth, 7);
  if (!isMonth(start)) bad('Choose the month recovery starts.');
  const now = new Date().toISOString();
  const out = { EmployeeID: empSnap.id, EmployeeNo: emp.EmployeeNo || '', EmployeeName: emp.FullName || '', CompanyID: emp.CompanyID, LoanTypeID: type.LoanTypeID, TypeName: type.Name,
    Kind: type.Kind, Amount: amount, Instalment: instalment, StartMonth: start, Note: text(d.Note, 300),
    Description: type.Name + ' — ' + (emp.FullName || ''), UpdatedAt: now, UpdatedBy: actorOf(user) };
  if (cur) { await LOANS().doc(cur.LoanID).update(out); return { success: true, loanId: cur.LoanID }; }
  const ref = await LOANS().add(Object.assign(out, { Status: 'Draft', LoanNumber: '', Skips: [], Changes: [], Repayments: [], CreatedAt: now, CreatedBy: actorOf(user), History: [] }));
  return { success: true, loanId: ref.id };
});

exports.deleteLoan = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const l = await loadLoan(user, (request.data || {}).loanId);
  if (l.Status !== 'Draft') throw failed('Only a draft can be deleted.');
  await LOANS().doc(l.LoanID).delete();
  return { success: true };
});

async function nextNumber() {
  // The format is the Numbering module's (docs/modules/NUMBERING.md).
  return require('./numbering').hrNumber('LN');
}

exports.submitLoan = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const l = await loadLoan(user, (request.data || {}).loanId);
  if (l.Status !== 'Draft') throw failed('Only a draft is submitted.');
  const number = l.LoanNumber || await nextNumber();
  const scope = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: l.CompanyID });
  const inst = await beginApprovalInstance(MODULE_ID, l.LoanID, number, scope, l.Amount, user.uid);
  const status = inst.required ? 'PendingApproval' : 'Approved';
  await LOANS().doc(l.LoanID).update({ LoanNumber: number, Status: status, ApprovalInstanceID: inst.required ? inst.instanceId : '', RejectedReason: '',
    UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user), History: history(l, 'Submitted', user).concat(inst.required ? [] : [{ Event: 'Approved (no approval set up)', By: actorName(user), At: new Date().toISOString() }]) });
  return { success: true, status, loanNumber: number };
});

exports.decideLoanApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const snap = await LOANS().doc(text(d.loanId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Loan not found.');
  const l = Object.assign({ LoanID: snap.id }, snap.data());
  if (l.Status !== 'PendingApproval' || !l.ApprovalInstanceID) throw failed('The loan is not waiting for approval.');
  let r;
  try { r = await recordApprovalDecision(user, l.ApprovalInstanceID, Number(d.levelNumber), text(d.decision, 20), text(d.reason, 500)); } catch (e) { throw failed(e.message); }
  const fields = r.status === 'Rejected' ? { Status: 'Draft', RejectedReason: text(d.reason, 500), History: history(l, 'Rejected', user, { Note: text(d.reason, 500) }) }
    : r.status === 'Approved' ? { Status: 'Approved', History: history(l, 'Approved', user) } : { History: history(l, text(d.decision, 20) + ' (level ' + Number(d.levelNumber) + ')', user) };
  await LOANS().doc(l.LoanID).update(fields);
  return { success: true, status: fields.Status || 'PendingApproval' };
});

// GL: the loan type's receivable for the company, and a cash or bank account.
async function glAccounts(l, accountId) {
  const [coa, type] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), TYPES().doc(l.LoanTypeID).get().then(s => s.data())]);
  const rec = coa[type ? accountFor(type, l.CompanyID) : ''];
  if (!rec) throw failed('Set the loan type\'s receivable account in Payroll Setup → Loans.');
  const cash = coa[text(accountId, 80)];
  if (!isCashOrBank(cash) || cash.Status !== 'Active' || !cash.IsPostable || (cash.CompanyID && cash.CompanyID !== l.CompanyID)) bad('Choose the cash or bank account (of the company).');
  return { rec, cash };
}
const post = (user, date, desc, ref, lines, l, extra) => withGlobalLock(user.uid, async () => {
  try { return await writeStockGlEntry(user, VOUCHER_TYPE, date, desc, ref, lines, { CompanyID: l.CompanyID }, Object.assign({ PayrollLoanID: l.LoanID, SourceTransactionID: l.LoanID, ReversalOfJV: '' }, extra || {})); } catch (e) { throw failed(e.message); }
});

// An approved loan in an interim payroll batch (step 5c) is paid out, and
// reversed, only through the batch.
const requireNotInBatch = l => { if (l.InterimID) throw failed(l.LoanNumber + ' is in interim payroll ' + (l.InterimNumber || '') + ': it is paid out there.'); };

// Paying it out (decision 24): Dr the receivable / Cr the cash or bank.
// batch: the interim payroll paying it (step 5c), for the journal's reference.
async function payOut(user, l, date, accountId, batch) {
  await requireNoSettlement(l);
  if (l.Status !== 'Approved') throw failed('Only an approved loan is paid out.');
  if (!isDate(date)) bad('Enter the date it is paid out.');
  const { rec, cash } = await glAccounts(l, accountId);
  const label = l.TypeName + ' ' + l.LoanNumber + ' — ' + l.EmployeeName;
  const gl = await post(user, date, 'Paid out: ' + label + (batch ? ' (' + batch.Number + ')' : ''), batch ? batch.Number : l.LoanNumber, [
    { AccountCode: rec.AccountCode, Debit: l.Amount, Credit: 0, Description: label }, { AccountCode: cash.AccountCode, Debit: 0, Credit: l.Amount, Description: label }], l,
    batch ? { PayrollInterimID: batch.InterimID } : {});
  await LOANS().doc(l.LoanID).update({ Status: 'Active', PayoutDate: date, PayoutJVID: gl.jvId, PayoutJVNumber: gl.jvNumber, PaidOutBy: actorName(user),
    UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user), History: history(l, 'Paid out', user, { JVNumber: gl.jvNumber, Note: batch ? batch.Number : '' }) });
  return gl;
}
exports.payOutLoan = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const l = await loadLoan(user, d.loanId);
  requireNotInBatch(l);
  const gl = await payOut(user, l, text(d.date, 10), d.accountId);
  return { success: true, jvNumber: gl.jvNumber };
});

// Undoing the payout, before anything is recovered or repaid.
async function reversePayout(user, l, reason) {
  await requireNoSettlement(l);
  if (l.Status !== 'Active' || !l.PayoutJVID) throw failed('The loan is not paid out.');
  const recs = (await recoveriesOf(l.CompanyID))[l.LoanID] || [];
  if (recs.length || (l.Repayments || []).some(x => !x.ReversedAt)) throw failed(l.LoanNumber + ': part of it is already recovered or repaid: it can no longer be reversed.');
  const ref = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(l.PayoutJVID);
  const e = (await ref.get()).data();
  const gl = await post(user, e.JVDate, 'Reversal of ' + e.JVNumber + ' — ' + reason, e.JVNumber,
    e.Lines.map(x => ({ AccountCode: x.AccountCode, Debit: x.Credit || 0, Credit: x.Debit || 0, Description: x.Description })), l, { ReversalOfJV: l.PayoutJVID });
  await ref.update({ ReversedByJV: gl.jvId, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) });
  await LOANS().doc(l.LoanID).update({ Status: 'Approved', PayoutDate: '', PayoutJVID: '', PayoutJVNumber: '', UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user),
    History: history(l, 'Payout reversed', user, { JVNumber: e.JVNumber, ReversalJVNumber: gl.jvNumber, Note: reason }) });
  return gl;
}
exports.reverseLoanPayout = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const reason = text(d.reason, 300);
  if (!reason) bad('Give the reason for reversing the payout.');
  const l = await loadLoan(user, d.loanId);
  requireNotInBatch(l);
  const gl = await reversePayout(user, l, reason);
  return { success: true, reversalNumber: gl.jvNumber };
});

// The schedule (decision 27): months skipped, and instalment changes from a
// month. A month a posted run already recovered can't change.
exports.saveLoanSchedule = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const l = await loadLoan(user, d.loanId);
  if (l.Kind !== 'Loan' && (d.changes || []).length) bad('An advance is recovered at once: it has no instalments to change.');
  if (!['Approved', 'Active'].includes(l.Status)) throw failed('The schedule changes once the loan is approved.');
  const done = new Set(((await recoveriesOf(l.CompanyID))[l.LoanID] || []).map(x => x.Month));
  const skips = [...new Set((d.skips || []).map(m => text(m, 7)))].sort();
  skips.forEach(m => { if (!isMonth(m)) bad('A month to skip is not valid.'); if (m < l.StartMonth) bad(m + ' is before recovery starts (' + l.StartMonth + ').'); });
  const changes = (d.changes || []).map(c => ({ FromMonth: text(c.FromMonth, 7), Instalment: round2(num(c.Instalment)) })).sort((a, b) => a.FromMonth.localeCompare(b.FromMonth));
  changes.forEach(c => {
    if (!isMonth(c.FromMonth)) bad('Choose the month a new instalment starts.');
    if (!(c.Instalment > 0 && c.Instalment <= l.Amount)) bad('The instalment is more than 0 and at most the amount.');
  });
  if (new Set(changes.map(c => c.FromMonth)).size !== changes.length) bad('One instalment change per month.');
  // What was already recovered stays as it was.
  const before = new Set((l.Skips || []).concat((l.Changes || []).map(c => c.FromMonth + ':' + c.Instalment)));
  const after = new Set(skips.concat(changes.map(c => c.FromMonth + ':' + c.Instalment)));
  [...before].filter(x => !after.has(x)).concat([...after].filter(x => !before.has(x))).forEach(x => {
    const m = x.slice(0, 7);
    if ([...done].some(r => r >= m)) bad('A posted run has already recovered ' + [...done].filter(r => r >= m).sort().pop() + ': change the schedule from a later month.');
  });
  await LOANS().doc(l.LoanID).update({ Skips: skips, Changes: changes, UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user),
    History: history(l, 'Schedule changed', user, { Note: [skips.length ? 'skip ' + skips.join(', ') : '', changes.map(c => c.Instalment.toFixed(2) + ' from ' + c.FromMonth).join(', ')].filter(Boolean).join('; ') }) });
  return { success: true };
});

// An early repayment received (decision 27): Dr the cash or bank / Cr the receivable.
exports.recordLoanRepayment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const l = await loadLoan(user, d.loanId);
  await requireNoSettlement(l);
  if (l.Status !== 'Active') throw failed('Only a running loan is repaid.');
  const date = text(d.date, 10);
  if (!isDate(date)) bad('Enter the date it was received.');
  const amount = round2(num(d.amount));
  const balance = balanceOf(l, (await recoveriesOf(l.CompanyID))[l.LoanID]);
  if (!(amount > 0 && amount <= balance)) bad('The repayment is more than 0 and at most the balance (' + balance.toFixed(2) + ').');
  const { rec, cash } = await glAccounts(l, d.accountId);
  const label = 'Repayment of ' + l.TypeName + ' ' + l.LoanNumber + ' — ' + l.EmployeeName;
  const gl = await post(user, date, label, l.LoanNumber, [
    { AccountCode: cash.AccountCode, Debit: amount, Credit: 0, Description: label }, { AccountCode: rec.AccountCode, Debit: 0, Credit: amount, Description: label }], l);
  await LOANS().doc(l.LoanID).update({ Repayments: (l.Repayments || []).concat([{ Date: date, Amount: amount, JVID: gl.jvId, JVNumber: gl.jvNumber, Note: text(d.note, 200), By: actorName(user) }]),
    UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user), History: history(l, 'Repayment received', user, { JVNumber: gl.jvNumber, Note: amount.toFixed(2) }) });
  return { success: true, jvNumber: gl.jvNumber, balance: round2(balance - amount) };
});

Object.assign(module.exports, { loansDue, recoveriesOf, balanceOf, dueFor, accountFor, loanTypes, payOut, reversePayout, LOANS });
