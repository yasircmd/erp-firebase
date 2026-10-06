// HR Payroll, step 4: payment files and payment (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, "Step 4 design", decisions 20-22): the
// employee's WPS fields; each company's file formats (saved, checked,
// previewed on a run); paying a posted run (step 6, decision 47): the plan,
// each employee one way from one account, the bank file per bank account,
// each group paid and reversed on its own; a run paid in whole or part can't
// be reversed until its payments are.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');

test.after(async () => { await app.delete(); });

let ALI, BEN, CHRIS, RUN, FMT, STARTER;
const jv = async id => (await firestore.collection('journalEntries').doc(id).get()).data();
const runOf = async () => (await call('u-admin', 'getPayrollRun', { runId: RUN })).run;

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true }
  });
  await reset(f);
  const g = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Accountant' } })).designationId;
  const emp = (name, extra) => call('u-admin', 'saveEmployee', { employee: Object.assign({ FullName: name, CompanyID: 'C1', DesignationID: des, GradeID: g, Gender: 'Male', JoinDate: '2024-01-01', CostCenterID: 'CC1' }, extra) }).then(r => r.employeeId);
  await assert.rejects(emp('Bad Id', { WpsPersonID: '1001-234' }), /WPS person ID has letters and digits only/);
  ALI = await emp('Ali Hassan', { BankName: 'ENBD', IBAN: 'AE070331234567890123456', WpsPersonID: '10012345678901', BankRoutingCode: '803320101' });
  BEN = await emp('Ben Okafor', {});
  CHRIS = await emp('Chris Lee', { BankName: 'ADCB', IBAN: 'AE070331234567890123457' });
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  const pay = (id, amt) => call('u-admin', 'saveCompensation', { employeeId: id, compensation: { Lines: [{ ElementID: els.BASIC, Amount: amt }] } });
  await pay(ALI, 6000); await pay(BEN, 2000); await pay(CHRIS, 3000);
  await call('u-admin', 'savePayElementPayroll', { elementId: els.BASIC, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY' });
  await call('u-admin', 'lockLeaveMonth', { companyId: 'C1', month: '2026-07' });
  RUN = (await call('u-admin', 'createPayrollRun', { companyId: 'C1', month: '2026-07' })).runId;
  assert.equal((await call('u-admin', 'submitPayrollRun', { runId: RUN })).status, 'Posted');
});

test('formats: the WPS SIF starter; saved per company, checked, one name per company; previewed on a run', async () => {
  const g = await call('u-admin', 'getPaymentFormats', {});
  STARTER = g.starter;
  assert.deepEqual([g.starter.Name, g.formats, g.canWrite, g.runs.map(r => r.Month)], ['UAE WPS SIF', [], true, ['2026-07']]);
  assert.ok(g.sources.some(s => s.Source === 'WPS_ID'));
  const fmt = Object.assign({}, STARTER, { CompanyID: 'C1', Bank: 'ENBD', Values: { EmployerID: '0000123456789', BankCode: '803320101', Currency: 'AED', Reference: '' } });
  await assert.rejects(call('u-viewer', 'savePaymentFormat', { format: fmt }), /permission to change Payroll Setup/);
  await assert.rejects(call('u-admin', 'savePaymentFormat', { format: Object.assign({}, fmt, { CompanyID: 'C2' }) }), /access to that company/);
  await assert.rejects(call('u-admin', 'savePaymentFormat', { format: Object.assign({}, fmt, { Type: 'Fixed' }) }), /needs its width/);
  FMT = (await call('u-admin', 'savePaymentFormat', { format: fmt })).formatId;
  await assert.rejects(call('u-admin', 'savePaymentFormat', { format: fmt }), /already has a format "UAE WPS SIF"/);
  const p = await call('u-viewer', 'previewPaymentFile', { format: fmt, runId: RUN, paymentDate: '2026-08-03' });
  // Ben has no IBAN: not in the bank file.
  assert.deepEqual(p.lines, [
    'EDR,10012345678901,803320101,AE070331234567890123456,2026-07-01,2026-07-31,31,6000.00,0.00,0',
    'EDR,,,AE070331234567890123457,2026-07-01,2026-07-31,31,3000.00,0.00,0',
    p.lines[2]]);
  assert.match(p.lines[2], /^SCR,0000123456789,803320101,\d{4}-\d{2}-\d{2},\d{4},072026,2,9000\.00,AED,$/);
  assert.match(p.fileName, /^0000123456789\d{12}\.SIF$/);
});

test('paying (step 6, decision 47): the plan, each employee one way from one account; the bank file per bank account; each group paid on its own', async () => {
  const p = await call('u-admin', 'getPayrollPayment', { runId: RUN });
  // By bank file with an IBAN, else cash: from the company's first bank and cash accounts.
  assert.deepEqual(p.payees.map(x => [x.EmployeeName, x.Net, x.ByBank, x.Missing, x.Way, x.AccountID, x.Paid]), [
    ['Ali Hassan', 6000, true, [], 'BankFile', 'A-BANK', ''], ['Ben Okafor', 2000, false, ['IBAN', 'WPS person ID', 'bank routing code'], 'Cash', 'A-CASH', ''],
    ['Chris Lee', 3000, true, ['WPS person ID', 'bank routing code'], 'BankFile', 'A-BANK', '']]);
  assert.deepEqual([p.formats.map(f => f.Name), p.accounts.map(a => [a.AccountCode, a.Kind]), p.canPay], [['UAE WPS SIF'], [['1000', 'Cash'], ['1100', 'Bank']], true]);
  assert.deepEqual(p.groups.map(g => [g.Key, g.Count, g.Total]), [['BankFile:A-BANK', 2, 9000], ['Cash:A-CASH', 1, 2000]]);
  const plan = rows => call('u-admin', 'savePaymentPlan', { runId: RUN, rows });
  await assert.rejects(call('u-viewer', 'savePaymentPlan', { runId: RUN, rows: [] }), /permission to pay payroll runs/);
  await assert.rejects(plan([{ EmployeeID: BEN, Way: 'BankFile', AccountID: 'A-BANK' }]), /Ben Okafor has no IBAN: pay by cash or cheque/);
  await assert.rejects(plan([{ EmployeeID: ALI, Way: 'Cash', AccountID: 'A-BANK' }]), /Ali Hassan: cash is paid from a cash account/);
  await assert.rejects(plan([{ EmployeeID: ALI, Way: 'Cheque', AccountID: 'A-SAL' }]), /Ali Hassan: choose the account it is paid from/);
  // Chris by cheque this month.
  await plan([{ EmployeeID: CHRIS, Way: 'Cheque', AccountID: 'A-BANK' }]);
  const g = (await call('u-admin', 'getPayrollPayment', { runId: RUN })).groups;
  assert.deepEqual(g.map(x => [x.Key, x.Count, x.Total]), [['BankFile:A-BANK', 1, 6000], ['Cash:A-CASH', 1, 2000], ['Cheque:A-BANK', 1, 3000]]);
  await assert.rejects(call('u-viewer', 'downloadPaymentFile', { runId: RUN, formatId: FMT, paymentDate: '2026-08-03', accountId: 'A-BANK' }), /permission to pay payroll runs/);
  await assert.rejects(call('u-admin', 'downloadPaymentFile', { runId: RUN, formatId: FMT, paymentDate: '2026-08-03', accountId: 'A-CASH' }), /No one on the run is paid by bank file from that account/);
  const f = await call('u-admin', 'downloadPaymentFile', { runId: RUN, formatId: FMT, paymentDate: '2026-08-03', accountId: 'A-BANK' });
  assert.deepEqual([f.count, f.total], [1, 6000]);
  assert.match(f.content, /^EDR,10012345678901,/);
  assert.equal((await runOf()).History.slice(-1)[0].Event, 'Payment file');
  const paid = d => call('u-admin', 'markPayrollPaid', Object.assign({ runId: RUN, paymentDate: '2026-08-03', way: 'BankFile', accountId: 'A-BANK' }, d));
  await assert.rejects(paid({ paymentDate: '' }), /Enter the payment date/);
  await assert.rejects(paid({ paymentDate: '2026-06-30' }), /before the payroll month/);
  await assert.rejects(paid({ way: 'Cash', accountId: 'A-BANK' }), /No one in that group is waiting to be paid/);
  const out = await paid({ reference: 'TRF-0803' });
  assert.deepEqual([out.total, out.count, out.paid], [6000, 1, false]);
  assert.match(out.jvNumber, /^PAYP-/);
  const e = await jv((await runOf()).Payments[0].JVID);
  assert.deepEqual([e.VoucherType, e.JVDate, e.TransactionRef.slice(0, 4)], ['PayrollPayment', '2026-08-03', 'PRL-']);
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort(), [['1100', 0, 6000], ['2300', 6000, 0]]);
  await assert.rejects(paid({}), /No one in that group is waiting to be paid/);
  await assert.rejects(call('u-admin', 'savePaymentPlan', { runId: RUN, rows: [{ EmployeeID: ALI, Way: 'Cheque', AccountID: 'A-BANK' }] }), /Ali Hassan is already paid: reverse that payment first/);
  await assert.rejects(call('u-admin', 'reversePayrollRun', { runId: RUN, reason: 'x' }), /The run is paid in part: reverse its payments first/);
  // The cash a day later, the cheque the day after: the run is then paid.
  assert.equal((await paid({ way: 'Cash', accountId: 'A-CASH', paymentDate: '2026-08-04' })).paid, false);
  assert.equal((await paid({ way: 'Cheque', accountId: 'A-BANK', paymentDate: '2026-08-05', reference: 'CHQ 1001' })).paid, true);
  const run = await runOf();
  assert.deepEqual([Boolean(run.PaidAt), run.PaymentDate, run.Payments.map(x => [x.Way, x.Amount, x.PaymentDate])],
    [true, '2026-08-05', [['BankFile', 6000, '2026-08-03'], ['Cash', 2000, '2026-08-04'], ['Cheque', 3000, '2026-08-05']]]);
  assert.deepEqual((await call('u-admin', 'getPayrollPayment', { runId: RUN })).payees.map(x => x.Paid), ['P1', 'P2', 'P3']);
  await assert.rejects(call('u-admin', 'reversePayrollRun', { runId: RUN, reason: 'x' }), /The run is paid: reverse its payments first/);
});

test('reversing a payment: the one chosen, a mirror journal, those employees unpaid again; then the run itself can be reversed', async () => {
  await assert.rejects(call('u-admin', 'reversePayrollPayment', { runId: RUN, paymentId: 'P3' }), /reason for reversing the payment/);
  await assert.rejects(call('u-viewer', 'reversePayrollPayment', { runId: RUN, paymentId: 'P3', reason: 'x' }), /permission to pay/);
  await assert.rejects(call('u-admin', 'reversePayrollPayment', { runId: RUN, reason: 'x' }), /Choose the payment to reverse/);
  const before = await runOf();
  const out = await call('u-admin', 'reversePayrollPayment', { runId: RUN, paymentId: 'P3', reason: 'Cheque bounced' });
  const orig = await jv(before.Payments[2].JVID);
  const rev = await jv(orig.ReversedByJV);
  assert.deepEqual([rev.JVNumber, rev.JVDate, rev.ReversalOfJV], [out.reversalNumber, '2026-08-05', before.Payments[2].JVID]);
  assert.deepEqual(rev.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort(), [['1100', 3000, 0], ['2300', 0, 3000]]);
  const run = await runOf();
  assert.deepEqual([run.PaidAt, run.History.slice(-1)[0].Event], ['', 'Payment reversed']);
  assert.deepEqual((await call('u-admin', 'getPayrollPayment', { runId: RUN })).payees.map(x => x.Paid), ['P1', 'P2', '']);
  // Chris by bank file now, then the rest reversed too.
  await call('u-admin', 'savePaymentPlan', { runId: RUN, rows: [{ EmployeeID: CHRIS, Way: 'BankFile', AccountID: 'A-BANK' }] });
  assert.equal((await call('u-admin', 'markPayrollPaid', { runId: RUN, paymentDate: '2026-08-06', way: 'BankFile', accountId: 'A-BANK' })).total, 3000);
  for (const id of ['P1', 'P2', 'P4']) await call('u-admin', 'reversePayrollPayment', { runId: RUN, paymentId: id, reason: 'Redo' });
  await assert.rejects(call('u-admin', 'reversePayrollPayment', { runId: RUN, reason: 'x' }), /The run is not paid/);
  await call('u-admin', 'reversePayrollRun', { runId: RUN, reason: 'Redo' });
  await assert.rejects(call('u-admin', 'markPayrollPaid', { runId: RUN, paymentDate: '2026-08-03', way: 'BankFile', accountId: 'A-BANK' }), /Only a posted run is paid/);
});

test('deleting a format', async () => {
  await assert.rejects(call('u-viewer', 'deletePaymentFormat', { formatId: FMT }), /permission to change Payroll Setup/);
  await call('u-admin', 'deletePaymentFormat', { formatId: FMT });
  assert.deepEqual((await call('u-admin', 'getPaymentFormats', {})).formats, []);
});
