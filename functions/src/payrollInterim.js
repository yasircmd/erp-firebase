// HR Payroll, step 5c: interim payroll (owner, 2026-10-06;
// docs/modules/HR_PAYROLL.md, "Step 5c design", decisions 40-43).
//   - A batch (module PAYROLLIP, "Interim Payroll") pays, between monthly
//     runs, what doesn't wait for them: posted final settlements (with
//     something to pay) and approved loans and advances not yet paid out.
//     One company, a payment date, its items; an item is in one batch at a
//     time, and is then paid (or its payment reversed) only through it.
//   - Submitted through Approval Configuration ("Interim payroll"; the
//     amount is the batch total, decision 43); with none set up it is
//     approved at once. A rejection returns it to a draft.
//   - Approved: one bank file for the batch (Payroll Setup's formats), then
//     Mark paid from a cash or bank account: each item's own journal, as
//     its own Pay / Pay out writes (PAYP for a settlement, PLN for a loan),
//     with the batch number as the reference. A journal that fails puts
//     back those written before it.
//   - Reversing the payment reverses every item's journal and returns the
//     batch to a draft.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const calc = require('./payrollCalc');
const files = require('./payrollFiles');
const loans = require('./payrollLoans');
const FS = require('./payrollSettlement');
const R = require('./payrollRun');
const plan = require('./payrollPlan');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'PAYROLLIP';
const BATCHES = () => firestore.collection('payrollInterim');
const FORMATS = () => firestore.collection('payrollPaymentFormats');
const EMPLOYEES = () => firestore.collection('employees');
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round(n * 100) / 100;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const actorOf = user => user.profile.username || user.uid; // as My Drafts matches
const actorName = user => user.profile.fullName || user.profile.username || user.uid;
const docs = (snap, key) => snap.docs.map(d => Object.assign({ [key]: d.id }, d.data()));
const history = (b, event, user, extra) => (b.History || []).concat([Object.assign({ Event: event, By: actorName(user), At: new Date().toISOString() }, extra || {})]);
const companyNow = () => new Date(Date.now() + 4 * 3600000); // Asia/Dubai, for the bank file
const KINDS = { Settlement: 'Final settlement', Loan: 'Loan / advance' };

const can = (user, cap) => moduleHasCapability(MODULE_ID, cap, user.profile.role);
async function requireCap(user, cap) {
  if (!(await can(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Interim Payroll.');
  if (cap && !(await can(user, cap))) throw new HttpsError('permission-denied', cap === 'pay' ? 'You do not have permission to pay interim payroll.' : 'You do not have permission to prepare interim payroll.');
}
async function companyFor(user, id) {
  const co = text(id, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('not-found', 'Company not found.');
  return co;
}
async function loadBatch(user, id) {
  const snap = await BATCHES().doc(text(id, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Interim payroll not found.');
  const b = Object.assign({ InterimID: snap.id }, snap.data());
  if (!userCanAccessCompany(user.profile, b.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return b;
}

// ---------- what can be paid ----------

const settlementRef = id => FS.SETTLEMENTS().doc(id);
const loanRef = id => loans.LOANS().doc(id);
const refOf = it => (it.Kind === 'Settlement' ? settlementRef(it.ID) : loanRef(it.ID));
// An item as the batch shows it, from its settlement or loan.
const itemOfSettlement = s => ({ Kind: 'Settlement', ID: s.SettlementID, Number: s.Number, EmployeeID: s.EmployeeID, EmployeeNo: s.EmployeeNo || '', EmployeeName: s.EmployeeName,
  What: 'Final settlement (left ' + s.LeavingDate + ')', Amount: round2(s.Net), LeavingDate: s.LeavingDate });
const itemOfLoan = l => ({ Kind: 'Loan', ID: l.LoanID, Number: l.LoanNumber, EmployeeID: l.EmployeeID, EmployeeNo: l.EmployeeNo || '', EmployeeName: l.EmployeeName,
  What: l.TypeName, Amount: round2(l.Amount) });
// Waiting to be paid: posted settlements with a net to pay, approved loans;
// not in another batch.
const payableSettlement = (s, id) => s.Status === 'Posted' && !s.PaidAt && s.Net > 0 && (!s.InterimID || s.InterimID === id);
const payableLoan = (l, id) => l.Status === 'Approved' && !l.PayoutJVID && (!l.InterimID || l.InterimID === id);

async function candidates(co, batchId) {
  const [fs, ln] = await Promise.all([FS.SETTLEMENTS().where('CompanyID', '==', co).get(), loans.LOANS().where('CompanyID', '==', co).get()]);
  return docs(fs, 'SettlementID').filter(s => payableSettlement(s, batchId)).map(itemOfSettlement)
    .concat(docs(ln, 'LoanID').filter(l => payableLoan(l, batchId)).map(itemOfLoan))
    .sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)) || a.Kind.localeCompare(b.Kind));
}
// The items asked for, each still waiting to be paid, of the company.
async function currentItems(co, asked, batchId) {
  const out = [], seen = new Set();
  for (const a of asked) {
    const kind = a.Kind === 'Loan' ? 'Loan' : 'Settlement', id = text(a.ID, 80);
    if (!id || seen.has(kind + id)) continue;
    seen.add(kind + id);
    const snap = await (kind === 'Settlement' ? settlementRef(id) : loanRef(id)).get();
    const x = snap.exists ? Object.assign(kind === 'Settlement' ? { SettlementID: id } : { LoanID: id }, snap.data()) : null;
    const name = (x && (x.Number || x.LoanNumber)) || id;
    if (!x || x.CompanyID !== co) throw failed(name + ' is not one of the company\'s ' + (kind === 'Settlement' ? 'final settlements' : 'loans') + '.');
    if (kind === 'Settlement' && !payableSettlement(x, batchId)) throw failed(name + ' is ' + (x.InterimID && x.InterimID !== batchId ? 'in interim payroll ' + x.InterimNumber : x.PaidAt ? 'already paid' : !(x.Net > 0) ? 'owed by the employee: nothing to pay' : 'not posted') + '.');
    if (kind === 'Loan' && !payableLoan(x, batchId)) throw failed(name + ' is ' + (x.InterimID && x.InterimID !== batchId ? 'in interim payroll ' + x.InterimNumber : x.PayoutJVID ? 'already paid out' : 'not approved') + '.');
    out.push(kind === 'Settlement' ? itemOfSettlement(x) : itemOfLoan(x));
  }
  return out;
}

// ---------- the list and a batch ----------

exports.getInterimBatches = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const companies = Object.entries((await rtdb.ref('companies').get()).val() || {}).filter(([id, c]) => c.Status === 'Active' && userCanAccessCompany(user.profile, id))
    .map(([id, c]) => ({ CompanyID: id, Name: c.LegalName || id, RefCode: c.CompanyRefCode || '' }));
  const batches = docs(await BATCHES().get(), 'InterimID').filter(b => userCanAccessCompany(user.profile, b.CompanyID))
    .map(b => ({ InterimID: b.InterimID, Number: b.Number, CompanyID: b.CompanyID, PaymentDate: b.PaymentDate, Status: b.Status, Count: (b.Items || []).length, Total: b.Total || 0, Note: b.Note || '' }))
    .sort((a, b) => String(b.Number).localeCompare(String(a.Number)));
  return { batches, companies, canDraft: await can(user, 'draft'), canPay: await can(user, 'pay') };
});

// A batch, or (companyId) what a new one could pay.
exports.getInterimBatch = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user);
  const d = request.data || {};
  const b = d.interimId ? await loadBatch(user, d.interimId) : { InterimID: '', Status: 'New', CompanyID: await companyFor(user, d.companyId), Items: [] };
  const co = b.CompanyID;
  const coa = await coaOf();
  const formats = docs(await FORMATS().where('CompanyID', '==', co).get(), 'FormatID').filter(f => f.Active !== false).map(f => ({ FormatID: f.FormatID, Name: f.Name, Bank: f.Bank }));
  const { accounts, rows } = await planned(b, coa);
  return { batch: b, candidates: b.Status === 'New' || b.Status === 'Draft' ? await candidates(co, b.InterimID) : [],
    payees: rows.map(r => ({ Kind: r.Kind, ID: r.ID, Key: r.Key, EmployeeName: r.EMP_NAME, IBAN: r.IBAN, Net: r.NET, ByBank: r.ByBank, Missing: r.Missing, Way: r.Way, AccountID: r.AccountID, Paid: r.Paid })),
    groups: plan.groupsOf(rows, accounts), payments: b.Payments || [], ways: plan.WAYS,
    accounts, formats, approval: await R.approvalOf(b, user), canDraft: await can(user, 'draft'), canPay: await can(user, 'pay') };
});

async function nextNumber() {
  const res = await rtdb.ref('hrCounters/IP').transaction(cur => (Number(cur) || 0) + 1);
  return 'IP-' + String(res.snapshot.val()).padStart(4, '0');
}
// Marks the items as in the batch (and frees those taken out).
async function reserve(batch, items, before) {
  const keep = new Set(items.map(i => i.Kind + i.ID));
  const writes = items.map(i => x => x.update(refOf(i), { InterimID: batch.InterimID, InterimNumber: batch.Number }))
    .concat((before || []).filter(i => !keep.has(i.Kind + i.ID)).map(i => x => x.update(refOf(i), { InterimID: '', InterimNumber: '' })));
  for (let i = 0; i < writes.length; i += 400) { const x = firestore.batch(); writes.slice(i, i + 400).forEach(w => w(x)); await x.commit(); }
}

exports.saveInterimBatch = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const d = request.data || {};
  const cur = d.interimId ? await loadBatch(user, d.interimId) : null;
  if (cur && cur.Status !== 'Draft') throw failed('Only a draft is changed.');
  const co = cur ? cur.CompanyID : await companyFor(user, d.companyId);
  const payDate = text(d.paymentDate, 10);
  if (!isDate(payDate)) bad('Enter the payment date.');
  const asked = Array.isArray(d.items) ? d.items.slice(0, 500) : [];
  const items = await currentItems(co, asked, cur ? cur.InterimID : '');
  const early = items.find(i => i.LeavingDate && payDate < i.LeavingDate);
  if (early) bad('The payment date is before ' + early.EmployeeName + '\'s leaving date (' + early.LeavingDate + ').');
  const now = new Date().toISOString();
  const fields = { PaymentDate: payDate, Note: text(d.note, 300), Items: items, Total: round2(items.reduce((t, i) => t + i.Amount, 0)), UpdatedAt: now, UpdatedBy: actorOf(user) };
  let b;
  if (cur) {
    b = Object.assign({}, cur, fields);
    await BATCHES().doc(cur.InterimID).update(fields);
  } else {
    const ref = BATCHES().doc();
    b = Object.assign({ InterimID: ref.id, CompanyID: co, Number: await nextNumber(), Status: 'Draft', Description: 'Interim payroll', CreatedAt: now, CreatedBy: actorOf(user),
      CreatedByName: actorName(user), History: history({}, 'Drafted', user) }, fields);
    const { InterimID, ...stored } = b;
    await ref.set(stored);
  }
  b.Description = 'Interim payroll ' + b.Number;
  await BATCHES().doc(b.InterimID).update({ Description: b.Description });
  await reserve(b, items, cur ? cur.Items : []);
  return { success: true, interimId: b.InterimID, number: b.Number, total: b.Total };
});

exports.deleteInterimBatch = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const b = await loadBatch(user, (request.data || {}).interimId);
  if (b.Status !== 'Draft') throw failed('Only a draft is deleted.');
  await reserve(b, [], b.Items);
  await BATCHES().doc(b.InterimID).delete();
  return { success: true };
});

// ---------- submit and approval (decision 43) ----------

exports.submitInterimBatch = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'draft');
  const b = await loadBatch(user, (request.data || {}).interimId);
  if (b.Status !== 'Draft') throw failed('Only a draft is submitted.');
  const items = await currentItems(b.CompanyID, b.Items || [], b.InterimID); // as they are now
  if (!items.length) throw failed('Add what the batch pays first.');
  const total = round2(items.reduce((t, i) => t + i.Amount, 0));
  const scope = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: b.CompanyID });
  const inst = await beginApprovalInstance(MODULE_ID, b.InterimID, b.Number, scope, total, user.uid);
  const now = new Date().toISOString();
  const status = inst.required ? 'PendingApproval' : 'Approved';
  await BATCHES().doc(b.InterimID).update({ Items: items, Total: total, Status: status, ApprovalInstanceID: inst.required ? inst.instanceId : '', SubmittedAt: now, SubmittedBy: user.uid,
    SubmittedByName: actorName(user), RejectedReason: '', UpdatedAt: now, UpdatedBy: actorOf(user),
    History: history(b, 'Submitted', user).concat(inst.required ? [] : [{ Event: 'Approved (no approval set up)', By: actorName(user), At: now }]) });
  return { success: true, status, total };
});

exports.decideInterimApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const snap = await BATCHES().doc(text(d.interimId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Interim payroll not found.');
  const b = Object.assign({ InterimID: snap.id }, snap.data());
  if (b.Status !== 'PendingApproval' || !b.ApprovalInstanceID) throw failed('The batch is not waiting for approval.');
  let r;
  try { r = await recordApprovalDecision(user, b.ApprovalInstanceID, Number(d.levelNumber), text(d.decision, 20), text(d.reason, 500)); } catch (e) { throw failed(e.message); }
  const fields = r.status === 'Rejected' ? { Status: 'Draft', RejectedReason: text(d.reason, 500), History: history(b, 'Rejected', user, { Note: text(d.reason, 500) }) }
    : r.status === 'Approved' ? { Status: 'Approved', History: history(b, 'Approved', user) } : { History: history(b, text(d.decision, 20) + ' (level ' + Number(d.levelNumber) + ')', user) };
  await snap.ref.update(fields);
  return { success: true, status: fields.Status || 'PendingApproval' };
});

// ---------- the payment plan, the bank file and the payment ----------
// Step 6 (decision 47): each item is paid one way from one account
// (payrollPlan.js); the groups are paid, each item its own journal, and
// reversed, on their own. The batch is paid once every item is; with no
// payment left after a reversal it goes back to a draft.

const itemKey = it => it.Kind + ':' + it.ID;
const liveOf = b => (b.Payments || []).filter(p => !p.ReversedAt);
async function employeesOf(b) {
  const emps = {};
  for (const id of [...new Set((b.Items || []).map(i => i.EmployeeID))]) emps[id] = (await EMPLOYEES().doc(id).get()).data() || {};
  return emps;
}
// Each item with its bank details, the way it is paid (the plan, else the default) and whether it is paid.
async function planned(b, coa) {
  const accounts = plan.accountsOf(coa, b.CompanyID), emps = await employeesOf(b), chosen = b.PaymentPlan || {};
  const days = calc.daysInMonth(String(b.PaymentDate || new Date().toISOString()).slice(0, 7));
  const rows = (b.Items || []).map(i => {
    const e = emps[i.EmployeeID];
    const slip = { EmployeeNo: i.EmployeeNo, EmployeeName: i.EmployeeName, Net: i.Amount, UnpaidDays: 0, Lines: [{ Kind: 'Earning', Source: 'Input', Amount: i.Amount }] };
    return Object.assign(files.employeeValues(slip, e, days), { Kind: i.Kind, ID: i.ID, Key: itemKey(i), ByBank: Boolean(e.IBAN), Amount: i.Amount, Paid: i.JVID ? i.PaymentID || 'P' : '',
      Missing: [e.IBAN ? '' : 'IBAN', e.WpsPersonID ? '' : 'WPS person ID', e.BankRoutingCode ? '' : 'bank routing code'].filter(Boolean) },
    chosen[itemKey(i)] || plan.defaultWay(Boolean(e.IBAN), accounts));
  });
  return { accounts, rows };
}
const coaOf = async () => (await rtdb.ref('coa').get()).val() || {};

// The plan: rows [{ Kind, ID, Way, AccountID }] for items not paid yet.
exports.saveInterimPlan = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const b = await loadBatch(user, d.interimId);
  if (!['Draft', 'PendingApproval', 'Approved'].includes(b.Status)) throw failed('The batch is ' + b.Status.toLowerCase() + ': its plan can no longer change.');
  const coa = await coaOf();
  const { rows } = await planned(b, coa);
  const byKey = Object.fromEntries(rows.map(r => [r.Key, r]));
  const out = Object.assign({}, b.PaymentPlan || {});
  (Array.isArray(d.rows) ? d.rows : []).slice(0, 500).forEach(x => {
    const r = byKey[text(x.Kind, 20) + ':' + text(x.ID, 80)];
    if (!r) bad('An item in the plan is not in this batch.');
    const way = text(x.Way, 20), acc = text(x.AccountID, 80);
    if (r.Paid) { if (way !== r.Way || acc !== r.AccountID) bad(r.EMP_NAME + ' is already paid: reverse that payment first.'); return; }
    const problem = plan.wayProblem(way, acc, coa, b.CompanyID, r.ByBank, r.EMP_NAME);
    if (problem) bad(problem);
    out[r.Key] = { Way: way, AccountID: acc };
  });
  await BATCHES().doc(b.InterimID).update({ PaymentPlan: out });
  return { success: true };
});

exports.downloadInterimFile = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const b = await loadBatch(user, d.interimId);
  if (b.Status !== 'Approved' && b.Status !== 'Paid') throw failed('The bank file is made once the batch is approved.');
  const snap = await FORMATS().doc(text(d.formatId, 80) || '-').get();
  if (!snap.exists || snap.data().CompanyID !== b.CompanyID) throw new HttpsError('not-found', 'Choose one of the company\'s payment file formats.');
  const payDate = text(d.paymentDate, 10) || b.PaymentDate;
  if (!isDate(payDate)) bad('Enter the payment date.');
  const accountId = text(d.accountId, 80);
  const rows = (await planned(b, await coaOf())).rows.filter(r => r.Way === 'BankFile' && r.AccountID === accountId);
  if (!rows.length) throw failed('No one in the batch is paid by bank file from that account.');
  const f = files.buildFile({ format: snap.data(), month: payDate.slice(0, 7), payDate, created: companyNow(), rows });
  await BATCHES().doc(b.InterimID).update({ History: history(b, 'Payment file', user, { Note: f.fileName + ', ' + f.count + ' payments, ' + f.total.toFixed(2) }) });
  return { fileName: f.fileName, content: f.content, count: f.count, total: f.total };
});

// Undoes one item's payment (a failed group, or a payment's reversal).
async function undo(user, it, reason) {
  const snap = await refOf(it).get();
  if (it.Kind === 'Settlement') return FS.unpay(user, Object.assign({ SettlementID: it.ID }, snap.data()), reason);
  return loans.reversePayout(user, Object.assign({ LoanID: it.ID }, snap.data()), reason);
}

// A group paid: its items not paid yet, each its own journal; all or nothing.
exports.markInterimPaid = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const b0 = await loadBatch(user, d.interimId);
  const way = text(d.way, 20), accountId = text(d.accountId, 80);
  const payDate = text(d.paymentDate, 10) || b0.PaymentDate;
  if (!isDate(payDate)) bad('Enter the payment date.');
  // Claimed for paying, so two people can't pay it at once.
  await firestore.runTransaction(async t => {
    const cur = (await t.get(BATCHES().doc(b0.InterimID))).data();
    if (cur.Status !== 'Approved') throw failed(cur.Status === 'Paid' ? 'The batch is already paid.' : cur.Status === 'Paying' ? 'The batch is being paid.' : 'Only an approved batch is paid.');
    t.update(BATCHES().doc(b0.InterimID), { Status: 'Paying' });
  });
  const b = await loadBatch(user, b0.InterimID);
  const free = () => BATCHES().doc(b.InterimID).update({ Status: 'Approved' });
  let due;
  try {
    const coa = await coaOf();
    due = (await planned(b, coa)).rows.filter(r => r.Way === way && r.AccountID === accountId && !r.Paid);
    if (!due.length) throw failed('No one in that group is waiting to be paid.');
    const problem = due.map(r => plan.wayProblem(way, accountId, coa, b.CompanyID, r.ByBank, r.EMP_NAME)).find(Boolean);
    if (problem) bad(problem);
  } catch (e) { await free(); throw e; }
  const paymentId = 'P' + ((b.Payments || []).length + 1);
  const done = {};
  try {
    for (const r of due) {
      const snap = await refOf(r).get();
      const gl = r.Kind === 'Settlement'
        ? await FS.pay(user, Object.assign({ SettlementID: r.ID }, snap.data()), payDate, accountId, text(d.reference, 100), b)
        : await loans.payOut(user, Object.assign({ LoanID: r.ID }, snap.data()), payDate, accountId, b);
      done[r.Key] = { JVID: gl.jvId, JVNumber: gl.jvNumber, PaymentID: paymentId };
    }
  } catch (e) {
    // Put back what this group paid before the failure; nothing of it is paid.
    for (const k of Object.keys(done).reverse()) { const it = b.Items.find(i => itemKey(i) === k); try { await undo(user, it, 'Interim payroll ' + b.Number + ' not paid: ' + e.message); } catch (x) { /* reported below */ } }
    await free();
    throw failed('Nothing was paid: ' + e.message);
  }
  const now = new Date().toISOString();
  const items = b.Items.map(i => Object.assign({}, i, done[itemKey(i)] || {}));
  const all = items.every(i => i.JVID);
  const total = round2(due.reduce((t, r) => t + r.Amount, 0));
  await BATCHES().doc(b.InterimID).update(Object.assign({ Status: all ? 'Paid' : 'Approved', Items: items,
    Payments: (b.Payments || []).concat([{ PaymentID: paymentId, Way: way, AccountID: accountId, Keys: Object.keys(done), Amount: total, PaymentDate: payDate, Reference: text(d.reference, 100), PaidAt: now, PaidByName: actorName(user) }]),
    History: history(b, 'Paid ' + due.length + ' (' + plan.WAYS[way].toLowerCase() + ')', user, { Note: Object.values(done).map(x => x.JVNumber).join(', ') }) },
  all ? { PaidAt: now, PaidByName: actorName(user) } : {}));
  return { success: true, journals: Object.values(done).map(x => x.JVNumber), total, paid: all };
});

// One payment reversed: each of its items' journals. With none left the batch is a draft again.
exports.reverseInterimPayment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'pay');
  const d = request.data || {};
  const reason = text(d.reason, 300);
  if (!reason) bad('Give the reason for reversing the payment.');
  const b = await loadBatch(user, d.interimId);
  const live = liveOf(b);
  const p = live.find(x => x.PaymentID === (text(d.paymentId, 20) || (live.length === 1 ? live[0].PaymentID : '')));
  if (!p) throw failed(live.length ? 'Choose the payment to reverse.' : 'The batch is not paid.');
  const its = b.Items.filter(i => p.Keys.includes(itemKey(i)));
  // A loan already recovered from can't be undone: checked for all first.
  const recovered = [];
  for (const it of its.filter(i => i.Kind === 'Loan')) {
    const l = (await loanRef(it.ID).get()).data();
    const recs = (await loans.recoveriesOf(l.CompanyID))[it.ID] || [];
    if (recs.length || (l.Repayments || []).some(x => !x.ReversedAt)) recovered.push(it.Number);
  }
  if (recovered.length) throw failed('Part of ' + recovered.join(', ') + ' is already recovered or repaid: the payment can no longer be reversed.');
  const out = [];
  for (const it of its) out.push((await undo(user, it, reason + ' (' + b.Number + ')')).jvNumber);
  const now = new Date().toISOString();
  const left = live.length - 1;
  await BATCHES().doc(b.InterimID).update(Object.assign({ Status: left ? 'Approved' : 'Draft', PaidAt: '', PaidByName: '',
    Items: b.Items.map(i => { if (!p.Keys.includes(itemKey(i))) return i; const x = Object.assign({}, i); delete x.JVID; delete x.JVNumber; delete x.PaymentID; return x; }),
    Payments: (b.Payments || []).map(x => (x.PaymentID === p.PaymentID ? Object.assign({}, x, { ReversedAt: now, ReversalReason: reason }) : x)),
    History: history(b, 'Payment reversed', user, { Note: reason + ' — ' + out.join(', ') }) }, left ? {} : { ApprovalInstanceID: '' }));
  return { success: true, reversals: out };
});
