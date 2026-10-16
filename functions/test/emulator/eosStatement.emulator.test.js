// The end-of-service statement (owner, 2026-10-16; docs/modules/
// EOS_STATEMENT.md, decisions 179-184): a final settlement printed in the
// UAE standard layout: the employee (ID documents on file, service), the
// gratuity worked out by slab, entitlements, deductions, the net in figures
// and in words in the system currency, signatures; a draft marked DRAFT; in
// the Employee Portal once paid, the same statement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, rtdb, firestore, call, reset, baseFixture } = require('./_helpers');
const { todayIn } = require('../../src/recurringSchedule');

test.after(async () => { await app.delete(); });
const T = todayIn('Asia/Dubai');
const text = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const statement = (id, uid) => call(uid || 'u-admin', 'getSettlementStatement', { settlementId: id });
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
let ALI, FS;

test.before(async () => {
  const f = baseFixture();
  Object.assign(f.coa, {
    'A-SAL': { AccountCode: '6000', AccountName: 'Salaries', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-SALPAY': { AccountCode: '2300', AccountName: 'Salaries Payable', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-REC': { AccountCode: '1250', AccountName: 'Recoverable from employees', AccountType: 'Asset', Status: 'Active', IsPostable: true },
    'A-GEXP': { AccountCode: '6100', AccountName: 'Gratuity Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-GPRO': { AccountCode: '2400', AccountName: 'Gratuity Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-LEXP': { AccountCode: '6110', AccountName: 'Leave Salary Expense', AccountType: 'Expense', Status: 'Active', IsPostable: true },
    'A-LPRO': { AccountCode: '2410', AccountName: 'Leave Salary Provision', AccountType: 'Liability', Status: 'Active', IsPostable: true },
    'A-OTH': { AccountCode: '4900', AccountName: 'Other Income', AccountType: 'Revenue', Status: 'Active', IsPostable: true }
  });
  // The system currency: whichever is Default in Currency Configuration (decision 184), not AED fixed.
  f.currencies = { CUR1: { Code: 'AED', Name: 'UAE Dirham', IsDefault: false, Status: 'Active' }, CUR2: { Code: 'QAR', Name: 'Qatari Riyal', IsDefault: true, Status: 'Active' } };
  await reset(f);
  const g3 = (await call('u-admin', 'saveHrGrade', { grade: { Code: 'G3', Level: 3 } })).gradeId;
  const des = (await call('u-admin', 'saveHrDesignation', { designation: { Title: 'Storekeeper' } })).designationId;
  ALI = (await call('u-admin', 'saveEmployee', { employee: { FullName: 'Ali Hassan', PassportName: 'ALI HASSAN AHMED', Nationality: 'Jordanian', CompanyID: 'C1', DesignationID: des, GradeID: g3, Gender: 'Male',
    CostCenterID: 'CC1', JoinDate: '2021-01-01', Status: 'Left', LeavingDate: T, LeavingReason: 'Relocation', UserUID: 'u-viewer', IBAN: 'AE070331234567890123456' } })).employeeId;
  const docs = firestore.collection('employeeDocuments');
  await docs.add({ EmployeeID: ALI, CompanyID: 'C1', DocTypeName: 'Passport', DocNumber: 'P0000001', IssueDate: '2015-01-01', Status: 'Superseded' });
  await docs.add({ EmployeeID: ALI, CompanyID: 'C1', DocTypeName: 'Passport', DocNumber: 'P7654321', IssueDate: '2025-01-01', Status: 'Active' });
  await docs.add({ EmployeeID: ALI, CompanyID: 'C1', DocTypeName: 'Emirates ID', DocNumber: '784-1990-0000000-1', IssueDate: '2024-01-01', Status: 'Active' });
  const els = Object.fromEntries((await call('u-admin', 'getPayElements', {})).elements.map(e => [e.Code, e.ElementID]));
  const damage = (await call('u-admin', 'savePayElement', { element: { Code: 'DAMAGE', Name: 'Damaged equipment', Kind: 'Deduction', Nature: 'Variable' } })).elementId;
  await call('u-admin', 'saveCompensation', { employeeId: ALI, compensation: { Lines: [{ ElementID: els.BASIC, Amount: 3650 }, { ElementID: els.HRA, Amount: 1000 }] } });
  for (const id of [els.BASIC, els.HRA]) await call('u-admin', 'savePayElementPayroll', { elementId: id, glAccountId: 'A-SAL', prorated: true, inGross: true });
  await call('u-admin', 'savePayElementPayroll', { elementId: damage, glAccountId: 'A-OTH' });
  await call('u-admin', 'savePayrollCompany', { companyId: 'C1', dailyRateMethod: 'DIV30', payableAccountId: 'A-SALPAY', receivableAccountId: 'A-REC' });
  const s = (await call('u-admin', 'getProvisionSetup', {})).settings[0];
  await call('u-admin', 'saveProvisionSettings', { companyId: 'C1', gratuity: Object.assign({}, s.Gratuity, { Enabled: true, ExpenseAccountID: 'A-GEXP', ProvisionAccountID: 'A-GPRO' }),
    leaveSalary: Object.assign({}, s.LeaveSalary, { Enabled: true, ExpenseAccountID: 'A-LEXP', ProvisionAccountID: 'A-LPRO' }) });
  FS = (await call('u-admin', 'saveSettlement', { employeeId: ALI, others: [{ ElementID: damage, Amount: 250, Note: 'Handheld scanner' }] })).settlementId;
});

test('a draft prints marked DRAFT: the employee and service, the gratuity by slab, entitlements and deductions, the net in words in the system currency', async () => {
  const s = (await call('u-admin', 'getSettlement', { settlementId: FS })).settlement;
  const p = await statement(FS);
  assert.equal(p.draft, true);
  assert.match(p.css, /\.eos-doc/);
  const t = text(p.html);
  assert.match(t, /DRAFT: not final/);
  assert.match(t, /End-of-Service Settlement Statement/);
  for (const v of ['Ali Hassan', 'ALI HASSAN AHMED', 'Jordanian', 'P7654321', '784-1990-0000000-1', 'Storekeeper', 'Workshop', '2021-01-01', T, 'Relocation']) assert.ok(t.includes(v), v + ' in: ' + t.slice(0, 600));
  assert.doesNotMatch(t, /P0000001/, 'the renewed passport, not the old one');
  // Service: whole years, months and days to the last working day.
  assert.match(t, /Length of service \d+ years(, \d+ months?)?(, \d+ days?)? /);
  // The gratuity: 21 days a year for the first 5 years, then 30; a day is 3,650 × 12 ÷ 365 = 120.00.
  const g = s.Lines.find(l => l.Key === 'Gratuity');
  assert.deepEqual([g.Working.Daily, g.Working.Slabs.map(x => x.DaysPerYear)], [120, [21, 30]]);
  assert.match(t, /A day's pay 120\.00/);
  assert.match(t, /Year 0 to 5 5 21 105 12,600\.00/);
  // The slabs add up to the gratuity worked out (the last takes the rounding).
  assert.equal(Math.round(g.Working.Slabs.reduce((t, x) => t + x.Amount, 0) * 100) / 100, g.Worked);
  assert.match(t, new RegExp('Gratuity worked out ' + g.Amount.toLocaleString('en-US', { minimumFractionDigits: 2 }).replace('.', '\\.')));
  assert.match(t, /Damaged equipment Handheld scanner 250\.00/);
  assert.match(t, /Salary for \d{4}-\d{2} \(to the last working day\)/);
  const net = s.Net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.ok(t.includes('Net payable to the employee (QAR) ' + net), net);
  assert.match(t, /Amount in words: QAR [A-Z][A-Za-z-]+ Thousand .* only/);
  assert.match(t, /received the amount above in full and final settlement/);
  // Rights: Final Settlements access and the company.
  await assert.rejects(statement(FS, 'u-other'), /access to that company/);
  await assert.rejects(statement('fs_nobody'), /not found: save it first/);
});

test('an amount HR changed shows with its reason; posted, it prints plainly with who approved it', async () => {
  await call('u-admin', 'saveSettlement', { employeeId: ALI, overrides: { Gratuity: { Amount: 20000, Reason: 'Agreed with the employee' } },
    others: (await call('u-admin', 'getSettlement', { settlementId: FS })).settlement.Others });
  let t = text((await statement(FS)).html);
  assert.match(t, /Changed by HR: Agreed with the employee 20,000\.00/);
  const sub = await call('u-admin', 'submitSettlement', { settlementId: FS });
  assert.equal(sub.status, 'Posted', JSON.stringify(sub));
  const p = await statement(FS);
  t = text(p.html);
  assert.equal(p.draft, false);
  assert.doesNotMatch(t, /DRAFT/);
  assert.match(t, /No\. FS-0001/);
  assert.match(t, /Prepared by: Admin User/);
  assert.match(t, /Approved by: Admin User/);
});

test('the Employee Portal: nothing before it is paid; once paid, the same statement to view and download', async () => {
  let pay = await ess('u-viewer', 'payslips');
  assert.equal(pay.statement, null);
  await assert.rejects(ess('u-viewer', 'statement'), /once your final settlement is paid/);
  await call('u-admin', 'markSettlementPaid', { settlementId: FS, paymentDate: T, accountId: 'A-BANK' });
  pay = await ess('u-viewer', 'payslips');
  assert.deepEqual([pay.statement.Number, pay.statement.PaymentDate], ['FS-0001', T]);
  const p = await ess('u-viewer', 'statement');
  const hr = await statement(FS);
  assert.equal(p.html, hr.html, 'one layout for both');
  assert.match(text(p.html), new RegExp('Paid on ' + T));
  assert.equal(p.employeeNo, 'EMP-0001');
});
