// HR Payroll, step 4: payment files and payment (owner, 2026-10-04;
// docs/modules/HR_PAYROLL.md, "Step 4 design", decisions 20-22): the
// employee's WPS fields; each company's file formats (saved, checked,
// previewed on a run); paying a posted run: the file for those paid by bank,
// Mark paid in one journal (bank, and cash for those without an IBAN), on the
// payment date; a paid run can't be reversed until its payment is.
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

test('paying: the payees (bank or not, what the file lacks); the file; Mark paid in one journal on the payment date', async () => {
  const p = await call('u-admin', 'getPayrollPayment', { runId: RUN });
  assert.deepEqual(p.payees.map(x => [x.EmployeeName, x.Net, x.ByBank, x.Missing]), [
    ['Ali Hassan', 6000, true, []], ['Ben Okafor', 2000, false, ['IBAN', 'WPS person ID', 'bank routing code']], ['Chris Lee', 3000, true, ['WPS person ID', 'bank routing code']]]);
  assert.deepEqual([p.formats.map(f => f.Name), p.accounts.map(a => [a.AccountCode, a.Bank]), p.canPay], [['UAE WPS SIF'], [['1000', false], ['1100', true]], true]);
  await assert.rejects(call('u-viewer', 'downloadPaymentFile', { runId: RUN, formatId: FMT, paymentDate: '2026-08-03' }), /permission to pay payroll runs/);
  const f = await call('u-admin', 'downloadPaymentFile', { runId: RUN, formatId: FMT, paymentDate: '2026-08-03' });
  assert.deepEqual([f.count, f.total], [2, 9000]);
  assert.match(f.content, /^EDR,10012345678901,/);
  assert.equal((await runOf()).History.slice(-1)[0].Event, 'Payment file');
  const paid = d => call('u-admin', 'markPayrollPaid', Object.assign({ runId: RUN, paymentDate: '2026-08-03', bankAccountId: 'A-BANK', cashAccountId: 'A-CASH' }, d));
  await assert.rejects(paid({ paymentDate: '' }), /Enter the payment date/);
  await assert.rejects(paid({ paymentDate: '2026-06-30' }), /before the payroll month/);
  await assert.rejects(paid({ cashAccountId: '' }), /account for those without a bank account/);
  await assert.rejects(paid({ bankAccountId: 'A-SAL' }), /Choose the bank account/);
  const out = await paid({ reference: 'TRF-0803' });
  assert.deepEqual([out.bank, out.other], [9000, 2000]);
  const run = await runOf();
  assert.deepEqual([run.PaymentDate, run.PaymentJVNumber, run.PaymentReference, Boolean(run.PaidAt)], ['2026-08-03', out.jvNumber, 'TRF-0803', true]);
  const e = await jv(run.PaymentJVID);
  assert.deepEqual([e.VoucherType, e.JVDate, e.TotalDebit, e.TotalCredit], ['PayrollPayment', '2026-08-03', 11000, 11000]);
  assert.deepEqual(e.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort(), [['1000', 0, 2000], ['1100', 0, 9000], ['2300', 11000, 0]]);
  assert.match(out.jvNumber, /^PAYP-/);
  await assert.rejects(paid({}), /already paid/);
  await assert.rejects(call('u-admin', 'reversePayrollRun', { runId: RUN, reason: 'x' }), /The run is paid: reverse the payment first/);
});

test('reversing the payment: a reason, a mirror journal, unpaid again; then the run itself can be reversed', async () => {
  await assert.rejects(call('u-admin', 'reversePayrollPayment', { runId: RUN }), /reason for reversing the payment/);
  await assert.rejects(call('u-viewer', 'reversePayrollPayment', { runId: RUN, reason: 'x' }), /permission to pay/);
  const before = await runOf();
  const out = await call('u-admin', 'reversePayrollPayment', { runId: RUN, reason: 'Bank rejected the file' });
  const orig = await jv(before.PaymentJVID);
  const rev = await jv(orig.ReversedByJV);
  assert.deepEqual([rev.JVNumber, rev.JVDate, rev.ReversalOfJV], [out.reversalNumber, '2026-08-03', before.PaymentJVID]);
  assert.deepEqual(rev.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]).sort(), [['1000', 2000, 0], ['1100', 9000, 0], ['2300', 0, 11000]]);
  const run = await runOf();
  assert.deepEqual([run.PaidAt, run.PaymentJVID, run.History.slice(-1)[0].Event], ['', '', 'Payment reversed']);
  await assert.rejects(call('u-admin', 'reversePayrollPayment', { runId: RUN, reason: 'x' }), /The run is not paid/);
  await call('u-admin', 'reversePayrollRun', { runId: RUN, reason: 'Redo' });
  await assert.rejects(call('u-admin', 'markPayrollPaid', { runId: RUN, paymentDate: '2026-08-03', bankAccountId: 'A-BANK', cashAccountId: 'A-CASH' }), /Only a posted run is paid/);
});

test('deleting a format', async () => {
  await assert.rejects(call('u-viewer', 'deletePaymentFormat', { formatId: FMT }), /permission to change Payroll Setup/);
  await call('u-admin', 'deletePaymentFormat', { formatId: FMT });
  assert.deepEqual((await call('u-admin', 'getPaymentFormats', {})).formats, []);
});
