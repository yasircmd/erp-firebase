// HR Payroll, step 4: payment files and payment (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, "Step 4 design", decisions 20-22).
//   - Payroll Setup → Payment Files: each company's bank file formats
//     (payrollFiles.js builds them), with a preview from a run.
//   - Paying a posted run (Payroll "pay"): the bank file for those paid by
//     bank, the bank list, then Mark paid: one journal for the whole run
//     (decision 21), Dr Salaries Payable / Cr the bank for those with an
//     IBAN, Cr a cash or cheque account for the others (decision 22), dated
//     the payment date. A paid run can't be reversed until its payment is.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, writeStockGlEntry, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const setup = require('./payrollSetup');
const calc = require('./payrollCalc');
const files = require('./payrollFiles');
const R = require('./payrollRun');

const onCallOptions = { region: 'us-central1' };
const FORMATS = () => firestore.collection('payrollPaymentFormats');
const VOUCHER_TYPE = 'PayrollPayment';
const round2 = n => Math.round(n * 100) / 100;
const failed = msg => new HttpsError('failed-precondition', msg);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
// The company's time (Asia/Dubai, UTC+4) for a file's creation date and time.
const companyNow = () => new Date(Date.now() + 4 * 3600000);
// Cash accounts' codes start 10, banks' 11 (as Cash & Bank Transactions).
const isCashOrBank = a => a && a.AccountType === 'Asset' && ['10', '11'].includes(String(a.AccountCode).slice(0, 2));
const history = (run, event, user, extra) => (run.History || []).concat([Object.assign({ Event: event, By: R.actorName(user), At: new Date().toISOString() }, extra || {})]);

// ---------- Payroll Setup → Payment Files ----------

const canSetup = (user, cap) => moduleHasCapability('PAYROLLSETUP', cap, user.profile.role);
async function requireSetup(user, cap) {
  if (!(await canSetup(user, 'access'))) throw new HttpsError('permission-denied', 'You do not have access to Payroll Setup.');
  if (cap && !(await canSetup(user, cap))) throw new HttpsError('permission-denied', 'You do not have permission to change Payroll Setup.');
}
const docs = snap => snap.docs.map(d => Object.assign({ FormatID: d.id }, d.data()));

exports.getPaymentFormats = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user);
  const formats = docs(await FORMATS().get()).filter(f => userCanAccessCompany(user.profile, f.CompanyID)).sort((a, b) => a.CompanyID.localeCompare(b.CompanyID) || a.Name.localeCompare(b.Name));
  // The runs a format can be previewed with: the user's companies', newest first.
  const runs = R.docs(await R.RUNS().get()).filter(r => userCanAccessCompany(user.profile, r.CompanyID)).map(r => ({ RunID: r._id, CompanyID: r.CompanyID, Month: r.Month, Status: r.Status }))
    .sort((a, b) => b.Month.localeCompare(a.Month));
  return { formats, runs, sources: Object.entries(files.SOURCES).map(([k, v]) => ({ Source: k, Label: v[0], Kind: v[1] })), records: files.RECORDS, starter: files.WPS_SIF, canWrite: await canSetup(user, 'write') };
});

function formatFrom(user, d) {
  const co = R.text(d.CompanyID, 80);
  if (!co || !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  return Object.assign(files.cleanFormat(d, R.bad), { CompanyID: co });
}

exports.savePaymentFormat = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user, 'write');
  const d = (request.data || {}).format || {};
  const out = formatFrom(user, d);
  const id = R.text(d.FormatID, 80);
  const all = docs(await FORMATS().get());
  if (id && !all.some(f => f.FormatID === id)) throw new HttpsError('not-found', 'Payment file format not found.');
  if (all.some(f => f.FormatID !== id && f.CompanyID === out.CompanyID && f.Name.toLowerCase() === out.Name.toLowerCase())) throw new HttpsError('already-exists', 'This company already has a format "' + out.Name + '".');
  const ref = id ? FORMATS().doc(id) : FORMATS().doc();
  await ref.set(Object.assign(out, { UpdatedAt: new Date().toISOString(), UpdatedBy: user.uid }));
  return { success: true, formatId: ref.id };
});

exports.deletePaymentFormat = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user, 'write');
  const snap = await FORMATS().doc(R.text((request.data || {}).formatId, 80) || '-').get();
  if (!snap.exists) throw new HttpsError('not-found', 'Payment file format not found.');
  if (!userCanAccessCompany(user.profile, snap.data().CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  await snap.ref.delete();
  return { success: true };
});

// ---------- the file's rows ----------

// Those paid by bank (an IBAN and something to pay) and the others.
async function payees(run) {
  const slips = R.docs(await R.SLIPS(run.RunID).get()).sort((a, b) => String(a.EmployeeNo).localeCompare(String(b.EmployeeNo)));
  const emps = Object.fromEntries((await Promise.all(slips.map(s => firestore.collection('employees').doc(s.EmployeeID).get()))).map(x => [x.id, x.data() || {}]));
  const days = calc.daysInMonth(run.Month);
  return slips.map(s => {
    const e = emps[s.EmployeeID];
    const v = files.employeeValues(s, e, days);
    return Object.assign(v, { EmployeeID: s.EmployeeID, ByBank: Boolean(e.IBAN), Missing: [e.IBAN ? '' : 'IBAN', e.WpsPersonID ? '' : 'WPS person ID', e.BankRoutingCode ? '' : 'bank routing code'].filter(Boolean) });
  }).filter(p => p.NET > 0);
}
function fileFor(run, format, rows, payDate) {
  return files.buildFile({ format, month: run.Month, payDate, created: companyNow(), rows: rows.filter(r => r.ByBank) });
}

// A format tried on a run, before it's saved.
exports.previewPaymentFile = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetup(user);
  const d = request.data || {};
  const format = formatFrom(user, d.format || {});
  const run = await R.loadRun(user, d.runId);
  if (run.CompanyID !== format.CompanyID) throw failed('Choose a run of the format\'s company.');
  const f = fileFor(run, format, await payees(run), R.text(d.paymentDate, 10) || calc.monthEnd(run.Month));
  return { fileName: f.fileName, lines: f.content.split(/\r?\n/).filter(Boolean).slice(0, 50), count: f.count, total: f.total };
});

// ---------- paying a run (Payroll "pay") ----------

async function requirePay(user) {
  await R.requireCap(user);
  if (!(await R.can(user, 'pay'))) throw new HttpsError('permission-denied', 'You do not have permission to pay payroll runs.');
}
const requirePosted = run => { if (run.Status !== 'Posted') throw failed('Only a posted run is paid.'); };

exports.getPayrollPayment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await R.requireCap(user);
  const run = await R.loadRun(user, (request.data || {}).runId);
  const coa = (await rtdb.ref('coa').get()).val() || {};
  const accounts = Object.entries(coa).filter(([, a]) => a.Status === 'Active' && a.IsPostable && isCashOrBank(a) && (!a.CompanyID || a.CompanyID === run.CompanyID))
    .map(([id, a]) => ({ AccountID: id, AccountCode: a.AccountCode, AccountName: a.AccountName, Bank: String(a.AccountCode).startsWith('11') }))
    .sort((a, b) => String(a.AccountCode).localeCompare(String(b.AccountCode)));
  const formats = docs(await FORMATS().where('CompanyID', '==', run.CompanyID).get()).filter(f => f.Active !== false).map(f => ({ FormatID: f.FormatID, Name: f.Name, Bank: f.Bank }));
  const rows = run.Status === 'Posted' ? await payees(run) : [];
  return {
    run: { RunID: run.RunID, Month: run.Month, Status: run.Status, PaidAt: run.PaidAt || '', PaymentDate: run.PaymentDate || '', PaymentJVNumber: run.PaymentJVNumber || '' },
    payees: rows.map(r => ({ EmployeeID: r.EmployeeID, EmployeeNo: r.EMP_NO, EmployeeName: r.EMP_NAME, BankName: r.BANK, IBAN: r.IBAN, Net: r.NET, ByBank: r.ByBank, Missing: r.Missing })),
    accounts, formats, canPay: await R.can(user, 'pay')
  };
});

exports.downloadPaymentFile = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePay(user);
  const d = request.data || {};
  const run = await R.loadRun(user, d.runId);
  requirePosted(run);
  const snap = await FORMATS().doc(R.text(d.formatId, 80) || '-').get();
  if (!snap.exists || snap.data().CompanyID !== run.CompanyID) throw new HttpsError('not-found', 'Choose one of the company\'s payment file formats.');
  const payDate = R.text(d.paymentDate, 10);
  if (!isDate(payDate)) R.bad('Enter the payment date.');
  const rows = await payees(run);
  if (!rows.some(r => r.ByBank)) throw failed('No one on the run is paid by bank.');
  const f = fileFor(run, snap.data(), rows, payDate);
  await R.RUNS().doc(run.RunID).update({ History: history(run, 'Payment file', user, { Note: f.fileName + ', ' + f.count + ' employees, ' + f.total.toFixed(2) }) });
  return { fileName: f.fileName, content: f.content, count: f.count, total: f.total };
});

exports.markPayrollPaid = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePay(user);
  const d = request.data || {};
  const run = await R.loadRun(user, d.runId);
  requirePosted(run);
  if (run.PaidAt) throw failed('The run is already paid.');
  const payDate = R.text(d.paymentDate, 10);
  if (!isDate(payDate)) R.bad('Enter the payment date.');
  if (payDate < run.Month + '-01') R.bad('The payment date is before the payroll month.');
  const [coa, settings, rows] = await Promise.all([rtdb.ref('coa').get().then(s => s.val() || {}), setup.companySettings(run.CompanyID), payees(run)]);
  const bankTotal = round2(rows.filter(r => r.ByBank).reduce((t, r) => t + r.NET, 0));
  const otherTotal = round2(rows.filter(r => !r.ByBank).reduce((t, r) => t + r.NET, 0));
  if (!(bankTotal + otherTotal > 0)) throw failed('There is nothing to pay on this run.');
  const account = (id, label) => {
    const a = coa[R.text(id, 80)];
    if (!isCashOrBank(a) || a.Status !== 'Active' || !a.IsPostable || (a.CompanyID && a.CompanyID !== run.CompanyID)) R.bad('Choose the ' + label + ' (a cash or bank account of the company).');
    return a;
  };
  const payable = coa[settings.PayableAccountID];
  if (!payable) throw failed('Set the company\'s Salaries Payable in Payroll Setup → Payroll.');
  const lines = [{ AccountCode: payable.AccountCode, Debit: round2(bankTotal + otherTotal), Credit: 0, Description: 'Salaries paid — payroll ' + run.Month }];
  if (bankTotal) lines.push({ AccountCode: account(d.bankAccountId, 'bank account').AccountCode, Debit: 0, Credit: bankTotal, Description: 'Salaries paid by bank — payroll ' + run.Month });
  if (otherTotal) lines.push({ AccountCode: account(d.cashAccountId, 'account for those without a bank account').AccountCode, Debit: 0, Credit: otherTotal, Description: 'Salaries paid by cash or cheque — payroll ' + run.Month });
  return withGlobalLock(user.uid, async () => {
    const fresh = (await R.RUNS().doc(run.RunID).get()).data();
    if (fresh.PaidAt || fresh.Status !== 'Posted') throw failed('The run changed: open it again.');
    let gl;
    try {
      gl = await writeStockGlEntry(user, VOUCHER_TYPE, payDate, 'Salaries paid — payroll ' + run.Month, run.RunNumber || '', lines, { CompanyID: run.CompanyID },
        { PayrollRunID: run.RunID, SourceTransactionID: run.RunID, ReversalOfJV: '' });
    } catch (e) { throw failed(e.message); }
    const now = new Date().toISOString();
    await R.RUNS().doc(run.RunID).update({ PaidAt: now, PaidBy: user.uid, PaidByName: R.actorName(user), PaymentDate: payDate, PaymentJVID: gl.jvId, PaymentJVNumber: gl.jvNumber,
      PaymentReference: R.text(d.reference, 100), PaidByBank: bankTotal, PaidOther: otherTotal, History: history(Object.assign({}, run, { History: fresh.History }), 'Paid', user, { JVNumber: gl.jvNumber }) });
    return { success: true, jvNumber: gl.jvNumber, bank: bankTotal, other: otherTotal };
  });
});

exports.reversePayrollPayment = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requirePay(user);
  const d = request.data || {};
  const reason = R.text(d.reason, 500);
  if (!reason) R.bad('Give the reason for reversing the payment.');
  const run = await R.loadRun(user, d.runId);
  if (!run.PaidAt || !run.PaymentJVID) throw failed('The run is not paid.');
  return withGlobalLock(user.uid, async () => {
    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(run.PaymentJVID);
    const entry = (await glRef.get()).data();
    if (!entry) throw failed('The payment\'s GL entry was not found.');
    if (entry.ReversedByJV) throw failed('That GL entry has already been reversed.');
    const description = 'Reversal of ' + entry.JVNumber + ' — ' + reason;
    const lines = (entry.Lines || []).map(l => ({ AccountCode: l.AccountCode, Debit: l.Credit || 0, Credit: l.Debit || 0, Description: l.Description || description, CostCenterID: l.CostCenterID || '' }));
    let gl;
    try {
      gl = await writeStockGlEntry(user, VOUCHER_TYPE, entry.JVDate, description, entry.JVNumber, lines, { CompanyID: run.CompanyID }, { PayrollRunID: run.RunID, SourceTransactionID: run.RunID, ReversalOfJV: run.PaymentJVID });
    } catch (e) { throw failed(e.message); }
    await glRef.update({ ReversedByJV: gl.jvId, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
    await R.RUNS().doc(run.RunID).update({ PaidAt: '', PaymentDate: '', PaymentJVID: '', PaymentJVNumber: '', PaidByBank: 0, PaidOther: 0,
      History: history(run, 'Payment reversed', user, { JVNumber: entry.JVNumber, ReversalJVNumber: gl.jvNumber, Note: reason }) });
    return { success: true, reversalNumber: gl.jvNumber };
  });
});
