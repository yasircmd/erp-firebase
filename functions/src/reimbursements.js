// Reimbursements, the Employee Portal's step 3 (owner, 2026-10-10;
// docs/modules/EMPLOYEE_PORTAL.md, decisions 93, 94, 106-109):
//   - categories (Payroll Setup → Reimbursements): the expense account (the
//     group's, with company overrides), an optional monthly limit, receipt
//     required, how old a bill may be (60 days by default). Each category
//     keeps its own earning pay element ("Reimbursement — Travel":
//     variable, outside gross, not prorated, posting to its account), so an
//     Earnings & Deductions entry pays it with the salary;
//   - claims (Type "Claim" in employeeRequests): bills with their files;
//     the line manager, then Approval Configuration "Reimbursement" by the
//     total; approvers may approve part; over a monthly limit is flagged,
//     not refused (decision 106); on the final approval one E&D entry per
//     category for the payroll month (decision 108); "Paid" once that
//     month's run is posted.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { approvalInstances } = require('./approvalStore');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');

const onCallOptions = { region: 'us-central1' };
const CATEGORIES = () => firestore.collection('reimbursementCategories');
const ELEMENTS = () => firestore.collection('hrPayElements');
const REQUESTS = () => firestore.collection('employeeRequests');
const ENTRIES = () => firestore.collection('payrollInputs');
const RUNS = () => firestore.collection('payrollRuns');
const MODULE_ID = 'EMPREQUESTS';
const CONFIG_KEY = 'REIMBURSEMENT'; // Approval Configuration entry (decision 94)
const MAX_BILLS = 30;
const FILES_PER_BILL = 3;
const DEFAULT_AGE = 60; // decision 107

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const num = v => Number(String(v == null ? '' : v).replace(/,/g, ''));
const today = () => todayIn('Asia/Dubai');
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const nextMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = m => MON[Number(m.slice(5, 7)) - 1] + '-' + m.slice(0, 4);
const money = n => Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const entry = (event, by, note) => ({ Event: event, By: by, At: new Date().toISOString(), Note: note || '' });

// ---------- categories (Payroll Setup → Reimbursements) ----------

async function categories() {
  return CATEGORIES().get().then(s => s.docs.map(d => Object.assign({ CategoryID: d.id }, d.data())).sort((a, b) => a.Name.localeCompare(b.Name)));
}
function checkExpense(coa, id, label, companyId) {
  const a = coa[id];
  if (!a) bad(label + ': account not found.');
  if (a.Status !== 'Active' || !a.IsPostable) bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' is not an active, postable account.');
  if (a.AccountType !== 'Expense') bad(label + ': ' + a.AccountCode + ' ' + a.AccountName + ' must be an expense account.');
  if (companyId === null && a.CompanyID) bad(label + ': the group\'s account must be a shared one; set company accounts as overrides.');
  if (companyId && a.CompanyID && a.CompanyID !== companyId) bad(label + ': ' + a.AccountCode + ' belongs to another company.');
}
// The category's earning element, made or kept in step with it.
async function syncElement(cat, ref) {
  const els = (await ELEMENTS().get()).docs.map(d => Object.assign({ ElementID: d.id }, d.data()));
  let code = cat.ElementCode;
  if (!code) { let n = 1; while (els.some(e => e.Code === 'RB' + String(n).padStart(2, '0'))) n++; code = 'RB' + String(n).padStart(2, '0'); }
  const elRef = cat.ElementID ? ELEMENTS().doc(cat.ElementID) : ELEMENTS().doc();
  const sort = cat.ElementID ? undefined : els.length + 1;
  await elRef.set(Object.assign({ Code: code, Name: 'Reimbursement — ' + cat.Name, Kind: 'Earning', Nature: 'Variable', IsBasic: false, Active: cat.Active !== false,
    GLAccountID: cat.GLAccountID, GLByCompany: cat.GLByCompany || {}, Prorated: false, InGross: false, Category: 'Normal', Reimbursement: ref.id }, sort ? { Sort: sort } : {}), { merge: true });
  return { ElementID: elRef.id, ElementCode: code };
}

exports.reimbursementSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const canRead = await moduleHasCapability('PAYROLLSETUP', 'access', user.profile.role);
  const canWrite = await moduleHasCapability('PAYROLLSETUP', 'write', user.profile.role);
  if (!canRead) throw new HttpsError('permission-denied', 'You do not have access to Payroll Setup.');
  if (d.action === 'list') return { categories: await categories(), canWrite };
  if (d.action !== 'save') bad('Unknown request.');
  if (!canWrite) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
  const c = d.category || {};
  const id = text(c.CategoryID, 80);
  const all = await categories();
  const cur = id ? all.find(x => x.CategoryID === id) : null;
  if (id && !cur) throw new HttpsError('not-found', 'Category not found.');
  const out = { Name: text(c.Name, 40), GLAccountID: text(c.GLAccountID, 80), ReceiptRequired: c.ReceiptRequired !== false, Active: c.Active !== false };
  if (!out.Name) bad('Name the category.');
  if (all.some(x => x.CategoryID !== id && x.Name.toLowerCase() === out.Name.toLowerCase())) throw new HttpsError('already-exists', 'There is already a category "' + out.Name + '".');
  out.MonthlyLimit = c.MonthlyLimit === '' || c.MonthlyLimit == null ? null : round2(num(c.MonthlyLimit));
  if (out.MonthlyLimit != null && !(out.MonthlyLimit > 0)) bad('The monthly limit is more than 0 (or leave it empty).');
  out.MaxAgeDays = c.MaxAgeDays === '' || c.MaxAgeDays == null ? DEFAULT_AGE : Math.round(num(c.MaxAgeDays));
  if (!(out.MaxAgeDays >= 1 && out.MaxAgeDays <= 366)) bad('A bill may be 1 to 366 days old.');
  const coa = (await rtdb.ref('coa').get()).val() || {};
  if (!out.GLAccountID) bad('Choose the expense account.');
  checkExpense(coa, out.GLAccountID, out.Name, null);
  const by = Object.assign({}, (cur || {}).GLByCompany);
  for (const [co, acc] of Object.entries(c.GLByCompany || {})) {
    if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    const a = text(acc, 80);
    if (!a) { delete by[co]; continue; }
    checkExpense(coa, a, out.Name + ' (' + co + ')', co);
    by[co] = a;
  }
  out.GLByCompany = by;
  const ref = cur ? CATEGORIES().doc(cur.CategoryID) : CATEGORIES().doc();
  Object.assign(out, await syncElement(Object.assign({}, cur || {}, out), ref));
  await ref.set(out);
  return { success: true, categoryId: ref.id };
});

// ---------- claims ----------

// A claim's bills, checked: the category (in use), the date (not ahead, not
// older than the category allows), the amount, the description.
function checkBills(list, cats) {
  if (!Array.isArray(list) || !list.length) bad('Add at least one bill.');
  if (list.length > MAX_BILLS) bad('At most ' + MAX_BILLS + ' bills on one claim.');
  return list.map((b, i) => {
    const n = 'Bill ' + (i + 1) + ': ';
    const cat = cats.find(c => c.CategoryID === text(b.categoryId, 80) && c.Active !== false);
    if (!cat) bad(n + 'choose what it is for.');
    const date = text(b.date, 10);
    if (!isDate(date)) bad(n + 'enter the date on the bill.');
    if (date > today()) bad(n + 'the date is ahead of today.');
    const age = cat.MaxAgeDays || DEFAULT_AGE;
    if (daysBetween(date, today()) > age) bad(n + cat.Name + ' bills are claimed within ' + age + ' days: this one is from ' + date + '.');
    const amount = round2(num(b.amount));
    if (!(amount > 0)) bad(n + 'enter the amount.');
    const description = text(b.description, 200);
    if (!description) bad(n + 'say what it was.');
    return { CategoryID: cat.CategoryID, CategoryName: cat.Name, Date: date, Amount: amount, Approved: amount, Description: description, Files: [], Note: '' };
  });
}
const totalOf = bills => round2(bills.reduce((s, b) => s + b.Amount, 0));
const approvedOf = bills => round2(bills.reduce((s, b) => s + (b.Approved == null ? b.Amount : b.Approved), 0));

// Over a category's monthly limit (decision 106): flagged to the approvers.
// Counts the employee's other claims not rejected or withdrawn, by the
// bill's month.
async function limitFlags(r, cats) {
  const others = (await REQUESTS().where('EmployeeID', '==', r.EmployeeID).get()).docs.map(d => Object.assign({ RequestID: d.id }, d.data()))
    .filter(x => x.Type === 'Claim' && x.RequestID !== r.RequestID && !['Rejected', 'Withdrawn', 'Draft'].includes(x.Status));
  const sums = {};
  const add = (b, amt) => { const k = b.CategoryID + '|' + b.Date.slice(0, 7); sums[k] = round2((sums[k] || 0) + amt); };
  others.forEach(x => (x.Bills || []).forEach(b => add(b, b.Approved == null ? b.Amount : b.Approved)));
  const mine = {};
  (r.Bills || []).forEach(b => { const k = b.CategoryID + '|' + b.Date.slice(0, 7); mine[k] = round2((mine[k] || 0) + (b.Approved == null ? b.Amount : b.Approved)); });
  const out = [];
  for (const k of Object.keys(mine)) {
    const [catId, month] = k.split('|');
    const cat = cats.find(c => c.CategoryID === catId);
    if (!cat || cat.MonthlyLimit == null) continue;
    const used = round2((sums[k] || 0) + mine[k]);
    if (used > cat.MonthlyLimit) out.push(cat.Name + ': over the monthly limit (' + money(cat.MonthlyLimit) + ') by ' + money(used - cat.MonthlyLimit) + ' for ' + monthText(month) + '.');
  }
  return out;
}

// The claim's stage for the lists.
async function stage(r) {
  if (r.Status === 'Draft') return { Stage: 'Draft', StatusText: 'Not sent yet' };
  if (r.Status === 'WithManager') return { Stage: 'WithManager', StatusText: 'With manager' };
  if (r.Status === 'InApproval') return { Stage: 'InApproval', StatusText: 'With approvers' };
  if (r.Status === 'Approved') {
    const run = (await RUNS().doc(r.CompanyID + '_' + r.PayMonth).get()).data();
    return run && run.Status === 'Posted' ? { Stage: 'Paid', StatusText: 'Paid with the ' + monthText(r.PayMonth) + ' payroll' }
      : { Stage: 'Approved', StatusText: 'Approved — paid with the ' + monthText(r.PayMonth) + ' payroll' };
  }
  return { Stage: r.Status, StatusText: r.Status };
}

async function claimForm(me) {
  const cats = (await categories()).filter(c => c.Active !== false);
  return { categories: cats.map(c => ({ CategoryID: c.CategoryID, Name: c.Name, MonthlyLimit: c.MonthlyLimit, ReceiptRequired: c.ReceiptRequired !== false, MaxAgeDays: c.MaxAgeDays || DEFAULT_AGE })),
    today: today(), filesPerBill: FILES_PER_BILL };
}

// Made as a draft: the portal adds each bill's files, then sends it.
async function raiseClaim(me, d, base, nextNumber) {
  const cats = await categories();
  const bills = checkBills(d.bills, cats);
  const r = Object.assign(base, { Number: await nextNumber('RC'), Status: 'Draft', Bills: bills, Total: totalOf(bills), ApprovedTotal: totalOf(bills),
    Description: text(d.description, 500), History: [entry('Claim made', me.emp.FullName)] });
  const ref = await REQUESTS().add(r);
  return { success: true, requestId: ref.id, number: r.Number };
}
// A bill's file (the portal's upload names the bill).
async function addBillFile(r, billIndex, file) {
  const i = Number(billIndex);
  if (!Number.isInteger(i) || !r.Bills[i]) bad('Choose the bill.');
  if ((r.Bills[i].Files || []).length >= FILES_PER_BILL) throw failed('At most ' + FILES_PER_BILL + ' files on one bill.');
  const bills = r.Bills.slice();
  bills[i] = Object.assign({}, bills[i], { Files: (bills[i].Files || []).concat([file.AttachmentID]) });
  await REQUESTS().doc(r.RequestID).update({ Bills: bills, UpdatedAt: new Date().toISOString() });
}

// Sent: the receipts checked; to the line manager, else to the approvers.
async function submitClaim(me, r, manager) {
  if (r.Status !== 'Draft') throw failed('This claim has already been sent.');
  const cats = await categories();
  const missing = r.Bills.map((b, i) => [b, i]).filter(([b]) => { const c = cats.find(x => x.CategoryID === b.CategoryID); return c && c.ReceiptRequired !== false && !(b.Files || []).length; });
  if (missing.length) throw failed('Add the receipt for ' + missing.map(([b, i]) => 'bill ' + (i + 1) + ' (' + b.CategoryName + ')').join(', ') + '.');
  const now = new Date().toISOString();
  if (manager) {
    await REQUESTS().doc(r.RequestID).update({ Status: 'WithManager', ManagerID: manager.EmployeeID, ManagerName: manager.FullName, SubmittedAt: now, UpdatedAt: now, LastAt: now,
      History: (r.History || []).concat([entry('Sent', me.emp.FullName)]) });
    return { success: true, status: 'WithManager' };
  }
  return toApprovers(Object.assign({}, r, { History: (r.History || []).concat([entry('Sent', me.emp.FullName)]), SubmittedAt: now }), r.CreatedByUid);
}
// Approval Configuration "Reimbursement" by the total, else approved at once.
async function toApprovers(r, createdBy) {
  const emp = (await firestore.collection('employees').doc(r.EmployeeID).get()).data() || {};
  const scope = await resolveApprovalScopeKeyForDocument(CONFIG_KEY, { CompanyID: r.CompanyID, DivisionID: emp.DivisionID, BranchID: emp.BranchID, CostCenterID: emp.CostCenterID });
  const inst = await beginApprovalInstance(MODULE_ID, r.RequestID, r.Number, scope, approvedOf(r.Bills), createdBy, CONFIG_KEY);
  const now = new Date().toISOString();
  if (inst.required) {
    await REQUESTS().doc(r.RequestID).update({ Status: 'InApproval', ApprovalInstanceID: inst.instanceId, UpdatedAt: now, SubmittedAt: r.SubmittedAt || now,
      History: (r.History || []).concat([entry('Sent for approval', 'System')]) });
    return { success: true, status: 'InApproval' };
  }
  return finalize(Object.assign({}, r, { History: (r.History || []).concat([entry('Approved (no approval set up)', 'System')]) }));
}

// The payroll month (decision 108): this month if before the company's
// cut-off day and its run is still a draft (or not made); else the next
// month whose run is open.
async function payMonthFor(co) {
  const t = today();
  const cut = Number(((await firestore.collection('payrollSettings').doc(co).get()).data() || {}).CutOffDay) || 0;
  let m = t.slice(0, 7);
  if (cut && Number(t.slice(8, 10)) >= cut) m = nextMonth(m);
  for (let i = 0; i < 24; i++, m = nextMonth(m)) {
    const run = (await RUNS().doc(co + '_' + m).get()).data();
    if (!run || run.Status === 'Draft') return m;
  }
  throw failed('No payroll month is open for ' + co + '.');
}
// Approved: one Earnings & Deductions entry per category, for the payroll.
async function finalize(r) {
  const cats = await categories();
  const month = await payMonthFor(r.CompanyID);
  const byCat = {};
  r.Bills.forEach(b => { const a = b.Approved == null ? b.Amount : b.Approved; if (a > 0) byCat[b.CategoryID] = round2((byCat[b.CategoryID] || 0) + a); });
  const now = new Date().toISOString();
  const ids = [];
  for (const [catId, amount] of Object.entries(byCat)) {
    const c = cats.find(x => x.CategoryID === catId);
    if (!c || !c.ElementID) throw failed('The category ' + (c ? c.Name : catId) + ' has no pay element: save it again in Payroll Setup → Reimbursements.');
    const ref = await ENTRIES().add({ EmployeeID: r.EmployeeID, EmployeeNo: r.EmployeeNo, EmployeeName: r.EmployeeName, ElementID: c.ElementID, Code: c.ElementCode, ElementName: 'Reimbursement — ' + c.Name,
      Kind: 'Earning', Hours: null, Amount: amount, Note: r.Number, PayBy: 'Run', CompanyID: r.CompanyID, Month: month, ClaimID: r.RequestID,
      CreatedAt: now, CreatedBy: 'portal', CreatedByName: 'Reimbursement ' + r.Number, UpdatedAt: now });
    ids.push(ref.id);
  }
  await REQUESTS().doc(r.RequestID).update({ Status: 'Approved', PayMonth: month, EntryIDs: ids, ApprovedTotal: approvedOf(r.Bills), Bills: r.Bills, ApprovedAt: now, UpdatedAt: now, LastAt: now,
    History: (r.History || []).concat([entry('Approved: paid with the ' + monthText(month) + ' payroll', 'System')]) });
  return { success: true, status: 'Approved', payMonth: month };
}

// The line manager (decision 94).
async function decideByManager(me, r, d) {
  if (r.Status !== 'WithManager') throw failed('This claim is no longer waiting for you.');
  const now = new Date().toISOString();
  if (d.decision === 'Rejected') {
    const reason = text(d.reason, 500);
    if (!reason) bad('Give the reason for rejecting.');
    await REQUESTS().doc(r.RequestID).update({ Status: 'Rejected', RejectionReason: reason, RejectedAt: now, UpdatedAt: now, ManagerDecision: 'Rejected', ManagerDecidedAt: now,
      History: (r.History || []).concat([entry('Rejected by the line manager', me.emp.FullName, reason)]) });
    return { success: true, status: 'Rejected' };
  }
  if (d.decision !== 'Approved') bad('Approve or reject.');
  await REQUESTS().doc(r.RequestID).update({ ManagerDecision: 'Approved', ManagerDecidedAt: now });
  return toApprovers(Object.assign({}, r, { History: (r.History || []).concat([entry('Approved by the line manager', me.emp.FullName)]) }), r.CreatedByUid);
}

// An approver (Approval Configuration), who may approve part: a bill's
// approved amount lowered (to 0 at least) with a note.
async function decideByApprover(user, r, d) {
  if (r.Status !== 'InApproval' || !r.ApprovalInstanceID) throw failed('This claim is not waiting for approval.');
  let bills = r.Bills;
  if (d.decision === 'Approved' && Array.isArray(d.adjust) && d.adjust.length) {
    bills = r.Bills.map(b => Object.assign({}, b));
    for (const a of d.adjust) {
      const b = bills[Number(a.index)];
      if (!b) bad('Bill not found.');
      const amt = round2(num(a.amount));
      if (!(amt >= 0 && amt <= b.Amount)) bad('An approved amount is 0 to the amount claimed (' + money(b.Amount) + ').');
      const note = text(a.note, 200);
      if (amt < b.Amount && !note) bad('Say why bill ' + (Number(a.index) + 1) + ' is approved in part (the employee sees it).');
      b.Approved = amt; b.Note = amt < b.Amount ? note : '';
    }
  }
  const result = await recordApprovalDecision(user, r.ApprovalInstanceID, Number(d.levelNumber), d.decision, d.reason);
  const by = user.profile.fullName || user.profile.username || user.uid, now = new Date().toISOString();
  const changed = bills !== r.Bills ? [entry('Approved in part: ' + money(approvedOf(bills)) + ' of ' + money(totalOf(bills)), by)] : [];
  if (result.status === 'Rejected') {
    await REQUESTS().doc(r.RequestID).update({ Status: 'Rejected', RejectionReason: text(d.reason, 500), RejectedAt: now, UpdatedAt: now, LastAt: now,
      History: (r.History || []).concat([entry('Rejected', by, text(d.reason, 500))]) });
  } else if (result.status === 'Approved') {
    await finalize(Object.assign({}, r, { Bills: bills, History: (r.History || []).concat(changed, [entry('Approved', by)]) }));
  } else {
    await REQUESTS().doc(r.RequestID).update({ Bills: bills, ApprovedTotal: approvedOf(bills), UpdatedAt: now, History: (r.History || []).concat(changed, [entry('Approved level ' + d.levelNumber, by)]) });
  }
  return { success: true, status: result.status };
}
// The approval as the screen shows it, and the levels this user decides.
async function approvalOf(r, uid) {
  if (!r.ApprovalInstanceID) return null;
  const inst = await approvalInstances.get(r.ApprovalInstanceID);
  if (!inst) return null;
  const decided = new Set((inst.Decisions || []).map(x => x.LevelNumber));
  return { Status: inst.Status, Levels: (inst.RequiredLevels || []).map(x => ({ LevelNumber: x.LevelNumber })), Decisions: inst.Decisions || [],
    MyLevels: inst.Status === 'Pending' && r.Status === 'InApproval' ? (inst.RequiredLevels || []).filter(x => x.ApproverUserID === uid && !decided.has(x.LevelNumber)).map(x => x.LevelNumber) : [] };
}
// Withdrawn or rejected before the end: its approval is withdrawn too.
async function closeApproval(r) {
  if (r.ApprovalInstanceID) await approvalInstances.update(r.ApprovalInstanceID, { Status: 'Withdrawn', UpdatedAt: new Date().toISOString() });
}

// The line manager's claims waiting (Team).
async function teamClaims(reportIds) {
  if (!reportIds.size) return [];
  const list = (await REQUESTS().where('Status', '==', 'WithManager').get()).docs.map(d => Object.assign({ RequestID: d.id }, d.data()))
    .filter(r => r.Type === 'Claim' && reportIds.has(r.EmployeeID));
  const cats = await categories();
  const out = [];
  for (const r of list.sort((a, b) => String(a.SubmittedAt).localeCompare(String(b.SubmittedAt)))) {
    out.push({ RequestID: r.RequestID, Number: r.Number, EmployeeNo: r.EmployeeNo, EmployeeName: r.EmployeeName, Total: r.Total, Description: r.Description || '',
      Bills: r.Bills.map(b => ({ CategoryName: b.CategoryName, Date: b.Date, Amount: b.Amount, Description: b.Description, Files: (b.Files || []).length })), Flags: await limitFlags(r, cats) });
  }
  return out;
}

// What a claim shows (portal and ERP).
async function claimView(r) {
  const cats = await categories();
  return { Bills: (r.Bills || []).map(b => ({ CategoryName: b.CategoryName, Date: b.Date, Amount: b.Amount, Approved: b.Approved == null ? b.Amount : b.Approved, Description: b.Description,
    Note: b.Note || '', Files: b.Files || [] })), Total: r.Total || 0, ApprovedTotal: approvedOf(r.Bills || []), PayMonth: r.PayMonth || '', Flags: r.Status === 'Draft' ? [] : await limitFlags(r, cats),
    Description: r.Description || '' };
}

Object.assign(module.exports, {
  categories, claimForm, raiseClaim, addBillFile, submitClaim, decideByManager, decideByApprover, approvalOf, closeApproval, teamClaims, claimView, stage, limitFlags,
  totalOf, approvedOf, FILES_PER_BILL, CONFIG_KEY, payMonthFor
});
