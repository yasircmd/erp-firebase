// HR Payroll, step 3: approval, posting, payslips, reversal (owner,
// 2026-10-04; docs/modules/HR_PAYROLL.md, "Step 3 design", decisions 9-11,
// 16-19).
//   - Submit (Payroll "draft"): through Approval Configuration ("Payroll";
//     the amount is the net pay). The final approval posts the run at once
//     (decision 16); with no approval set up, submitting does.
//   - Posting: one journal per run, voucher type Payroll, dated the month's
//     last day (decision 17), through the common path, so lines are clubbed:
//     Dr each earning's account by the employee's cost center, Cr each
//     deduction's account (by cost center where the account needs one),
//     Cr Salaries Payable the net; a net shortfall (decision 9) is Dr to
//     "Recoverable from employees" and brought forward in the next run.
//   - Reversal (Payroll "post"): the company's latest posted run, a mirror
//     journal on the same date; the run goes back to draft (decision 18).
//   - Payslips (decision 19): the month, each leave balance at its end and
//     the year to date from the posted runs.
'use strict';
const doc = require('./payslipDocument');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, getCompanyRefCode, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const { withGlobalLock } = require('./lock');
const { clubGlLines } = require('./lineClubbing');
const { loadSetup } = require('./hrSetup');
const { leaveTypes } = require('./hrLeaveSetup');
const lv = require('./hrLeave');
const setup = require('./payrollSetup');
const calc = require('./payrollCalc');
const R = require('./payrollRun');
const ED = require('./payrollInputs');
const loans = require('./payrollLoans');
const P = require('./payrollProvisions');
const costSplit = require('./costSplit');

const onCallOptions = { region: 'us-central1' };
const VOUCHER_TYPE = 'Payroll';
const CC_TYPES = ['Expense', 'Revenue', 'COGS']; // accounts that need a cost center (glWriting)
const round2 = n => Math.round(n * 100) / 100;
const history = (run, event, user, extra) => (run.History || []).concat([Object.assign({ Event: event, By: R.actorName(user), At: new Date().toISOString() }, extra || {})]);
const failed = msg => new HttpsError('failed-precondition', msg);

// The journal's lines: each payslip line to its element's account (the
// company's override, else the group's), the net to Salaries Payable, a
// shortfall to Recoverable from employees.
function glLinesFor(run, slips, elements, coa, settings, loanAccounts, provAccount) {
  const co = run.CompanyID, label = ' — payroll ' + run.Month;
  const missing = new Set(), noCostCenter = new Set(), lines = [];
  const add = (accountId, what, amount, debit, slip) => {
    const a = coa[accountId];
    if (!accountId || !a) { missing.add(what); return; }
    // The account's rule (PROJECTS_DIMENSIONS.md): required, or (optional on an expense) taken when the slip has one.
    const rule = require('./dimensionRules').ruleOf(a, coa, 'CostCenter').rule;
    const needsCc = rule === 'Required', useCc = needsCc || (rule === 'Optional' && CC_TYPES.includes(a.AccountType) && Boolean(slip.CostCenterID));
    if (needsCc && !slip.CostCenterID) noCostCenter.add(slip.EmployeeNo + ' ' + slip.EmployeeName);
    // An expense line shared across the slip's cost split, if any (PAYROLL_COST_SPLIT.md).
    (useCc ? costSplit.shares(amount, slip.CostCenterID, slip.CostSplit) : [{ CostCenterID: '', Amount: amount }]).forEach(p =>
      lines.push({ AccountCode: a.AccountCode, Debit: debit ? p.Amount : 0, Credit: debit ? 0 : p.Amount, Description: what + label, CostCenterID: p.CostCenterID }));
  };
  slips.forEach(s => {
    s.Lines.forEach(l => {
      if (!l.Amount) return;
      const debit = (l.Kind === 'Earning') === (l.Amount > 0);
      if (l.Source === 'CarryForward') return add(settings.ReceivableAccountID, 'Recoverable from employees', Math.abs(l.Amount), debit, s);
      if (l.Source === 'Hold' || l.Source === 'HoldRelease') return add(settings.HeldAccountID, 'Salary held', Math.abs(l.Amount), debit, s); // SALARY_HOLD.md
      if (l.Source === 'Loan') return add((loanAccounts || {})[l.LoanID] || '', l.Name.replace(/ LN-\d+$/, ''), Math.abs(l.Amount), debit, s); // to the loan type's receivable (step 4b)
      if (l.Source === 'AccrualPayout') return add(provAccount ? provAccount('Accrual', l.AccrualTypeID, 'Provision') : '', l.Name, Math.abs(l.Amount), debit, s); // from its provision (step 5a)
      // A leave deduction pro rata (step 6, decision 46): back off each earning it came from.
      if (settings.LeaveDeductionGL === 'ProRata' && (l.Split || []).length) {
        return l.Split.forEach(p => { const el = elements[p.ElementID]; if (p.Amount) add(el ? calc.accountFor(el, co) : '', (el ? el.Name : p.ElementID) + ' (' + l.Name.toLowerCase() + ')', Math.abs(p.Amount), (l.Kind === 'Earning') === (p.Amount > 0), s); });
      }
      const el = elements[l.ElementID];
      add(el ? calc.accountFor(el, co) : '', (el ? el.Name : l.Name) + (l.Source === 'Arrears' ? ' arrears' : ''), Math.abs(l.Amount), debit, s);
    });
    // The month's provisions (step 5a): Dr the expense by cost center / Cr the provision (a decrease the other way).
    (s.Provisions || []).forEach(p => {
      if (!p.Amount || !provAccount) return;
      const name = p.Kind === 'Gratuity' ? 'Gratuity' : p.Kind === 'LeaveSalary' ? 'Leave salary' : p.Name;
      add(provAccount(p.Kind, p.AccrualTypeID, 'Expense'), name + ' expense', Math.abs(p.Amount), p.Amount > 0, s);
      add(provAccount(p.Kind, p.AccrualTypeID, 'Provision'), name + ' provision', Math.abs(p.Amount), p.Amount < 0, s);
    });
    if (s.Net > 0) add(settings.PayableAccountID, 'Salaries Payable', s.Net, false, s);
    if (s.Net < 0) add(settings.ReceivableAccountID, 'Recoverable from employees', -s.Net, true, s);
  });
  if (missing.size) throw failed('Set the GL accounts in Payroll Setup first: ' + [...missing].join(', ') + '.');
  if (noCostCenter.size) throw failed('These employees have no cost center for their expense: ' + [...noCostCenter].join(', ') + '.');
  return lines;
}
async function postingContext(run) {
  const [slips, els, coaSnap, settings] = await Promise.all([R.docs(await R.SLIPS(run.RunID).get()), setup.payrollElements(), rtdb.ref('coa').get(), setup.companySettings(run.CompanyID)]);
  // Each recovered loan's receivable: its type's, for the company.
  const loanIds = [...new Set(slips.reduce((a, s) => a.concat(s.Lines.filter(l => l.Source === 'Loan').map(l => l.LoanID)), []))];
  const types = Object.fromEntries((await loans.loanTypes()).map(t => [t.LoanTypeID, t]));
  const loanAccounts = {};
  for (const id of loanIds) { const l = (await firestore.collection('payrollLoans').doc(id).get()).data(); if (l && types[l.LoanTypeID]) loanAccounts[id] = loans.accountFor(types[l.LoanTypeID], run.CompanyID); }
  // The provisions' accounts (step 5a): the company's gratuity and leave salary; each accrual's (its company override, else the group's).
  const [prov, accTypes] = await Promise.all([P.provisionSettings(run.CompanyID), P.accrualTypes()]);
  const byType = Object.fromEntries(accTypes.map(t => [t.AccrualTypeID, t]));
  const provAccount = (kind, typeId, side) => kind === 'Gratuity' ? prov.Gratuity[side + 'AccountID'] : kind === 'LeaveSalary' ? prov.LeaveSalary[side + 'AccountID']
    : byType[typeId] ? P.accrualAccount(byType[typeId], side, run.CompanyID) : '';
  return { slips, elements: Object.fromEntries(els.map(e => [e.ElementID, e])), coa: coaSnap.val() || {}, settings, loanAccounts, provAccount };
}

// The journal is posted as the approver; one without access to the
// company posts on behalf of the user who submitted the run.
async function posterFor(user, run) {
  if (userCanAccessCompany(user.profile, run.CompanyID)) return user;
  const profile = (await rtdb.ref('users/' + run.SubmittedBy).get()).val();
  if (!profile) throw failed('The user who submitted the run no longer exists.');
  return { uid: run.SubmittedBy, profile };
}

async function postRun(runId, user) {
  return withGlobalLock(user.uid, async () => {
    const snap = await R.RUNS().doc(runId).get();
    const run = Object.assign({ RunID: snap.id }, snap.data());
    if (run.Status !== 'Approved') throw failed('Only an approved run is posted.');
    const ctx = await postingContext(run);
    const lines = glLinesFor(run, ctx.slips, ctx.elements, ctx.coa, ctx.settings, ctx.loanAccounts, ctx.provAccount);
    const gl = await writeStockGlEntry(await posterFor(user, run), VOUCHER_TYPE, calc.monthEnd(run.Month), 'Payroll ' + run.Month, run.RunNumber || '', lines,
      // A run reversed into the first open month (its month closed) is redone there too
      // (docs/modules/PERIOD_CLOSING.md, step 1c, decision 136).
      { CompanyID: run.CompanyID }, { PayrollRunID: run.RunID, SourceTransactionID: run.RunID, ReversalOfJV: '', AdjustableRedo: Boolean(run.AdjustInOpenMonth) });
    const now = new Date().toISOString();
    const writes = [b => b.update(R.RUNS().doc(runId), { Status: 'Posted', JVID: gl.jvId, JVNumber: gl.jvNumber, PostedAt: now, PostedBy: user.uid, PostedByName: R.actorName(user),
      PostError: '', History: history(run, 'Posted', user, { JVNumber: gl.jvNumber, Note: gl.adjustedFrom ? 'Posted on ' + gl.jvDate + ': ' + run.Month + ' is closed' : '' }) })]
      .concat(ctx.slips.map(s => b => b.update(R.SLIPS(runId).doc(s._id), { Paid: Math.max(0, s.Net), CarryForward: round2(Math.max(0, -s.Net)) })));
    for (let i = 0; i < writes.length; i += 400) { const b = firestore.batch(); writes.slice(i, i + 400).forEach(w => w(b)); await b.commit(); }
    return gl;
  });
}
// Posting after the approval: a failure (an account removed since the
// submit, say) leaves the run approved, to post again from the screen.
async function postAndReport(runId, user) {
  try {
    const gl = await postRun(runId, user);
    return { success: true, status: 'Posted', jvNumber: gl.jvNumber };
  } catch (e) {
    await R.RUNS().doc(runId).update({ PostError: e.message });
    return { success: true, status: 'Approved', postError: e.message };
  }
}

exports.submitPayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user, 'draft');
  const run = await R.loadRun(user, (request.data || {}).runId);
  R.requireDraft(run);
  const rec = await R.leaveMonth(run.CompanyID, run.Month);
  if (!rec || rec.Status !== 'Locked' || (rec.LockedAt || '') !== (run.LeaveLockedAt || '')) throw failed('The month\'s leave changed since the run was calculated: recalculate it first.');
  // Step 7b: the month's Earnings & Deductions as the run used them.
  if ((await ED.runInputs(run.CompanyID, run.Month)).key !== (run.InputsKey || '')) throw failed('The month\'s earnings and deductions changed since the run was calculated: recalculate it first.');
  const ctx = await postingContext(run);
  // A final settlement submitted since (step 5c) pays some of them.
  const settled = await R.settledIn(run.CompanyID, run.Month);
  const paidBy = ctx.slips.filter(x => settled[x.EmployeeID]).map(x => x.EmployeeName + ' (' + settled[x.EmployeeID].Number + ')');
  if (paidBy.length) throw failed('Recalculate the run first: a final settlement pays ' + run.Month + ' for ' + paidBy.join(', ') + '.');
  if (!ctx.slips.length) throw failed('No employees are on the run.');
  glLinesFor(run, ctx.slips, ctx.elements, ctx.coa, ctx.settings, ctx.loanAccounts, ctx.provAccount); // the accounts are checked before approval starts
  const amount = round2(ctx.slips.reduce((t, s) => t + Math.max(0, s.Net), 0));
  const number = run.RunNumber || 'Payroll ' + (await getCompanyRefCode(run.CompanyID) || run.CompanyID) + ' ' + run.Month;
  const scope = await resolveApprovalScopeKeyForDocument('PAYROLL', { CompanyID: run.CompanyID });
  const inst = await beginApprovalInstance('PAYROLL', run.RunID, number, scope, amount, user.uid);
  const now = new Date().toISOString();
  const fields = { RunNumber: number, SubmittedAt: now, SubmittedBy: user.uid, SubmittedByName: R.actorName(user), RejectedReason: '', PostError: '', History: history(run, 'Submitted', user) };
  if (inst.required) {
    await R.RUNS().doc(run.RunID).update(Object.assign(fields, { Status: 'PendingApproval', ApprovalInstanceID: inst.instanceId }));
    return { success: true, status: 'PendingApproval' };
  }
  await R.RUNS().doc(run.RunID).update(Object.assign(fields, { Status: 'Approved', ApprovalInstanceID: '' }));
  return postAndReport(run.RunID, user);
});

exports.decidePayrollApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const snap = await R.RUNS().doc(R.text(d.runId, 120) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Payroll run not found.');
  const run = Object.assign({ RunID: snap.id }, snap.data());
  if (run.Status !== 'PendingApproval' || !run.ApprovalInstanceID) throw failed('The run is not waiting for approval.');
  let r;
  try { r = await recordApprovalDecision(user, run.ApprovalInstanceID, Number(d.levelNumber), R.text(d.decision, 20), R.text(d.reason, 500)); } catch (e) { throw failed(e.message); }
  const decision = R.text(d.decision, 20);
  if (r.status === 'Rejected') {
    await R.RUNS().doc(run.RunID).update({ Status: 'Draft', RejectedReason: R.text(d.reason, 500), History: history(run, 'Rejected', user, { Note: R.text(d.reason, 500) }) });
    return { success: true, status: 'Draft' };
  }
  if (r.status !== 'Approved') {
    await R.RUNS().doc(run.RunID).update({ History: history(run, decision + ' (level ' + Number(d.levelNumber) + ')', user) });
    return { success: true, status: 'PendingApproval' };
  }
  await R.RUNS().doc(run.RunID).update({ Status: 'Approved', History: history(run, 'Approved', user) });
  return postAndReport(run.RunID, user);
});

// Posting again after a failure at approval (the accounts fixed meanwhile).
exports.postPayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user, 'post');
  const run = await R.loadRun(user, (request.data || {}).runId);
  if (run.Status !== 'Approved') throw failed('Only an approved run waiting to post can be posted.');
  try { const gl = await postRun(run.RunID, user); return { success: true, status: 'Posted', jvNumber: gl.jvNumber }; } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw failed(e.message);
  }
});

exports.reversePayrollRun = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user, 'post');
  const d = request.data || {};
  const reason = R.text(d.reason, 500);
  if (!reason) R.bad('Give the reason for reversing the run.');
  const run = await R.loadRun(user, d.runId);
  if (run.Status !== 'Posted' || !run.JVID) throw failed('Only a posted run can be reversed.');
  if (run.PaidAt || (run.Payments || []).some(p => !p.ReversedAt)) throw failed('The run is paid' + (run.PaidAt ? '' : ' in part') + ': reverse its payments first.');
  const later = R.docs(await R.RUNS().where('CompanyID', '==', run.CompanyID).get()).filter(x => x.Status !== 'Draft' && x.Month > run.Month).map(x => x.Month).sort();
  if (later.length) throw failed('Reverse the later run first (' + later.join(', ') + '): it may have recovered amounts this one carried forward.');
  // A final settlement (step 5b) relies on the leaving month's run.
  const fs = R.docs(await firestore.collection('payrollSettlements').where('CompanyID', '==', run.CompanyID).get()).filter(x => x.Status !== 'Draft' && String(x.LeavingDate).slice(0, 7) >= run.Month);
  if (fs.length) throw failed('Reverse the final settlement first (' + fs.map(x => x.Number + ' ' + x.EmployeeName).join(', ') + '): it relies on this run.');
  return withGlobalLock(user.uid, async () => {
    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(run.JVID);
    const entry = (await glRef.get()).data();
    if (!entry) throw failed('The run\'s GL entry was not found.');
    if (entry.ReversedByJV) throw failed('That GL entry has already been reversed.');
    const description = 'Reversal of ' + entry.JVNumber + ' — ' + reason;
    const lines = (entry.Lines || []).map(l => ({ AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: l.Description || description, CostCenterID: l.CostCenterID || '' }));
    let gl;
    try {
      gl = await writeStockGlEntry(user, VOUCHER_TYPE, entry.JVDate, description, entry.JVNumber, lines, { CompanyID: run.CompanyID }, { PayrollRunID: run.RunID, SourceTransactionID: run.RunID, ReversalOfJV: run.JVID });
    } catch (e) { throw failed(e.message); }
    const now = new Date().toISOString();
    await glRef.update({ ReversedByJV: gl.jvId, UpdatedAt: now, UpdatedBy: user.profile.username || user.uid });
    const slips = await R.SLIPS(run.RunID).get();
    // Reversed into the first open month (decision 131): the redone run posts there too.
    const adjusted = gl.adjustedFrom ? { AdjustInOpenMonth: true } : {};
    const writes = [b => b.update(R.RUNS().doc(run.RunID), Object.assign({ Status: 'Draft', JVID: '', JVNumber: '', PostedAt: '', ApprovalInstanceID: '',
      History: history(run, 'Reversed', user, { JVNumber: entry.JVNumber, ReversalJVNumber: gl.jvNumber, Note: reason + (gl.adjustedFrom ? ' (posted on ' + gl.jvDate + ': ' + run.Month + ' is closed)' : '') }) }, adjusted))]
      .concat(slips.docs.map(x => b => b.update(x.ref, { Paid: FieldValue.delete(), CarryForward: FieldValue.delete() })));
    for (let i = 0; i < writes.length; i += 400) { const b = firestore.batch(); writes.slice(i, i + 400).forEach(w => w(b)); await b.commit(); }
    return { success: true, reversalNumber: gl.jvNumber };
  });
});

// ---------- payslips ----------

const maskIban = v => { const s = String(v || ''); return s.length > 8 ? s.slice(0, 4) + ' •••• ' + s.slice(-4) : s; };

// The run's GL impact (owner, 2026-10-10; docs/modules/GL_VIEWS.md, decision
// 86): once approved, what it will post (worked out and clubbed as the
// posting does); once posted, the posted journal. Each line with its
// account, cost center, description, debit and credit.
exports.getPayrollGlImpact = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user);
  const run = await R.loadRun(user, (request.data || {}).runId);
  if (run.Status !== 'Approved' && run.Status !== 'Posted') throw failed('The GL impact shows once the run is approved.');
  const [coaSnap, unitsSnap] = await Promise.all([rtdb.ref('coa').get(), rtdb.ref('orgUnits').get()]);
  const coa = coaSnap.val() || {}, units = unitsSnap.val() || {};
  let raw, posted = false, jvNumber = '';
  if (run.Status === 'Posted' && run.JVID) {
    const e = (await firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(run.JVID).get()).data();
    if (!e) throw failed('The GL entry of this run was not found.');
    raw = e.Lines || []; posted = true; jvNumber = e.JVNumber || run.JVNumber || '';
  } else {
    const ctx = await postingContext(run);
    raw = clubGlLines(glLinesFor(run, ctx.slips, ctx.elements, ctx.coa, ctx.settings, ctx.loanAccounts, ctx.provAccount));
  }
  const byCode = {};
  Object.values(coa).forEach(a => { byCode[a.AccountCode] = a; });
  const ccName = id => (id && units[id] ? [units[id].Code, units[id].Name].filter(Boolean).join(' — ') : '');
  const lines = raw.map(l => ({
    AccountCode: l.AccountCode, AccountName: (byCode[l.AccountCode] || {}).AccountName || '', CostCenterID: l.CostCenterID || '', CostCenter: ccName(l.CostCenterID),
    Description: l.Description || '', Debit: round2(Number(l.Debit) || 0), Credit: round2(Number(l.Credit) || 0)
  }));
  return {
    posted, jvNumber, date: calc.monthEnd(run.Month), lines,
    totals: { Debit: round2(lines.reduce((t, l) => t + l.Debit, 0)), Credit: round2(lines.reduce((t, l) => t + l.Credit, 0)) }
  };
});

exports.getPayrollPayslips = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user);
  const d = request.data || {};
  const run = await R.loadRun(user, d.runId);
  return payslipsOf(run, R.text(d.employeeId, 80));
});
// A run's payslips (all, or one employee's): also the Employee Portal's
// (docs/modules/EMPLOYEE_PORTAL.md).
async function payslipsOf(run, only) {
  const year = run.Month.slice(0, 4), end = calc.monthEnd(run.Month);
  const [slipDocs, hr, unitsSnap, coSnap, types, runs] = await Promise.all([R.SLIPS(run.RunID).get(), loadSetup(), rtdb.ref('orgUnits').get(), rtdb.ref('companies/' + run.CompanyID).get(),
    leaveTypes(), R.RUNS().where('CompanyID', '==', run.CompanyID).get()]);
  const units = unitsSnap.val() || {}, co = coSnap.val() || {};
  const slips = R.docs(slipDocs).filter(s => !only || s.EmployeeID === only).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  // The year to date: this run, and the year's earlier posted runs.
  const earlier = R.docs(runs).filter(r => r.Status === 'Posted' && r.Month.slice(0, 4) === year && r.Month < run.Month);
  const ytd = {};
  for (const r of earlier) R.docs(await R.SLIPS(r._id).get()).forEach(s => { const t = ytd[s.EmployeeID] = ytd[s.EmployeeID] || { Earnings: 0, Deductions: 0, Net: 0 }; t.Earnings += s.Earnings; t.Deductions += s.Deductions; t.Net += s.Net; });
  const balanceTypes = types.filter(t => t.Kind === 'Leave' && t.UsesBalance && t.Active !== false);
  // Each running loan's balance after this month (step 4b).
  const empLoans = R.docs(await firestore.collection('payrollLoans').where('CompanyID', '==', run.CompanyID).get()).filter(l => l.Status === 'Active');
  const recs = empLoans.length ? await loans.recoveriesOf(run.CompanyID) : {};
  const out = [];
  for (const s of slips) {
    const snap = await firestore.collection('employees').doc(s.EmployeeID).get();
    const e = Object.assign({ EmployeeID: s.EmployeeID }, snap.data() || {});
    const des = hr.designations.find(x => x.DesignationID === e.DesignationID);
    const cache = { leaves: await lv.leavesOf(e.EmployeeID), grade: await lv.gradeLevel(e) };
    const leave = [];
    for (const t of balanceTypes) { const b = await lv.balanceOf(e, t, end, null, cache); leave.push({ Code: t.Code, Name: t.Name, Balance: round2(b.Available + b.Booked) }); }
    const y = ytd[s.EmployeeID] || { Earnings: 0, Deductions: 0, Net: 0 };
    out.push(Object.assign({}, s, { Designation: des ? des.Title : '', CostCenterName: (units[s.CostCenterID] || {}).Name || '', // the slip's own (it posted there), not the employee's current one
      CostSplitText: costSplit.describe(s.CostSplit, units), JoinDate: e.JoinDate || '',
      BankName: e.BankName || '', IBAN: maskIban(e.IBAN), Leave: leave,
      Loans: empLoans.filter(l => l.EmployeeID === s.EmployeeID).map(l => {
        const here = run.Status === 'Posted' ? 0 : s.Lines.filter(x => x.Source === 'Loan' && x.LoanID === l._id).reduce((t, x) => t + x.Amount, 0);
        return { LoanNumber: l.LoanNumber, TypeName: l.TypeName, Balance: round2(loans.balanceOf(l, recs[l._id]) - here) };
      }),
      YTD: { Earnings: round2(y.Earnings + s.Earnings), Deductions: round2(y.Deductions + s.Deductions), Net: round2(y.Net + s.Net) } }));
  }
  const res = { company: { Name: co.LegalName || run.CompanyID, RefCode: co.CompanyRefCode || '', Address: co.Address || co.RegisteredAddress || '' },
    month: run.Month, monthEnd: end, status: run.Status, runNumber: run.RunNumber || '', jvNumber: run.JVNumber || '', slips: out };
  // The printed payslip, one layout for Payroll and the Employee Portal (payslipDocument.js).
  out.forEach(s => { s.Html = doc.payslipHtml(res, s); });
  res.css = doc.PAYSLIP_CSS;
  return res;
}

module.exports.glLinesFor = glLinesFor;
module.exports.payslipsOf = payslipsOf;
