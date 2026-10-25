// HR Payroll, step 2: one employee's pay for a month (docs/modules/HR_PAYROLL.md,
// "Step 2 design" and decisions 12-15). Pure arithmetic, no emulator.
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../../src/payrollCalc');
const round2 = n => Math.round(n * 100) / 100;

const EL = {
  b: { ElementID: 'b', Code: 'BASIC', Name: 'Basic Salary', Kind: 'Earning', Nature: 'Fixed', IsBasic: true, Prorated: true, InGross: true },
  h: { ElementID: 'h', Code: 'HRA', Name: 'Housing', Kind: 'Earning', Nature: 'Fixed', Prorated: true, InGross: true },
  t: { ElementID: 't', Code: 'TRANS', Name: 'Transport', Kind: 'Earning', Nature: 'Fixed', Prorated: true, InGross: false },
  p: { ElementID: 'p', Code: 'PHONE', Name: 'Phone', Kind: 'Earning', Nature: 'Fixed', Prorated: false, InGross: false },
  pen: { ElementID: 'pen', Code: 'PENSION', Name: 'Pension', Kind: 'Deduction', Nature: 'Fixed', Prorated: true },
  ot: { ElementID: 'ot', Code: 'OT', Name: 'Overtime', Kind: 'Earning', Nature: 'Variable', Category: 'Overtime',
    Overtime: { Mode: 'Hours', Base: 'Basic', DaysMode: 'Company', HoursMode: 'Schedule', Weightage: 1.25 } },
  bonus: { ElementID: 'bonus', Code: 'BONUS', Name: 'Bonus', Kind: 'Earning', Nature: 'Variable' },
  fine: { ElementID: 'fine', Code: 'FINE', Name: 'Fine', Kind: 'Deduction', Nature: 'Variable' }
};
const v = (from, amounts, extra) => Object.assign({ Status: 'Active', EffectiveFrom: from, CreatedAt: from,
  Lines: Object.entries(amounts).map(([id, Amount]) => ({ ElementID: id, Code: EL[id].Code, Name: EL[id].Name, Kind: EL[id].Kind, Amount })) }, extra || {});
const run = over => calc.computeEmployee(Object.assign({ month: '2026-07', method: 'DIV30', emp: { JoinDate: '2025-01-01', LeavingDate: '' },
  versions: [v('2025-01-01', { b: 6000, h: 3000 })], elements: EL, leave: [], inputs: [], hoursPerDay: 8 }, over));
const amt = (r, code) => { const l = r.Lines.find(x => x.Code === code); return l ? l.Amount : undefined; };
const leave = (Date, Pay, extra) => Object.assign({ Date, Fraction: 1, Code: 'X', Pay, Percent: Pay === 'Unpaid' ? 0 : 100, Elements: [] }, extra || {});

test('a full month: the monthly amounts; net is earnings less deductions', () => {
  const r = run({ versions: [v('2025-01-01', { b: 6000, h: 3000, pen: 300 })] });
  assert.deepEqual([amt(r, 'BASIC'), amt(r, 'HRA'), amt(r, 'PENSION'), r.Earnings, r.Deductions, r.Net], [6000, 3000, 300, 9000, 300, 8700]);
  assert.deepEqual(r.Warnings, []);
});

test('part months (decision 12): the days not employed are deducted from the monthly amount', () => {
  // The owner's example: 6,000, ÷ 30, joins 15 July: 6,000 − 14 × 200 = 3,200.
  let r = run({ emp: { JoinDate: '2026-07-15' }, versions: [v('2026-07-15', { b: 6000, p: 100 })] });
  assert.equal(amt(r, 'BASIC'), 3200);
  assert.equal(r.Lines.find(l => l.Code === 'BASIC').Text, '6,000.00 a month − 14 days before joining × 200.00 = 3,200.00');
  assert.equal(amt(r, 'PHONE'), 100, 'not prorated');
  // By the month's days: 6,000 − 14 × 6,000/31.
  r = run({ method: 'MONTHDAYS', emp: { JoinDate: '2026-07-15' }, versions: [v('2026-07-15', { b: 6000 })] });
  assert.equal(amt(r, 'BASIC'), 3290.32);
  // Leaving on 10 July: 21 days after.
  r = run({ emp: { JoinDate: '2025-01-01', LeavingDate: '2026-07-10' } });
  assert.deepEqual([amt(r, 'BASIC'), amt(r, 'HRA')], [1800, 900]);
  // Someone in post all month always gets exactly the monthly amount, even in February.
  r = run({ month: '2026-02' });
  assert.equal(amt(r, 'BASIC'), 6000);
});

test('a pay change during the month: the days at the earlier amounts are adjusted from the new', () => {
  const r = run({ versions: [v('2025-01-01', { b: 5000, h: 3000 }), v('2026-07-16', { b: 6000, h: 3000, t: 600 })] });
  // 15 days at 5,000: 15 × (5,000 − 6,000) / 30 = −500; transport is new: 15 × (0 − 600) / 30 = −300.
  assert.deepEqual([amt(r, 'BASIC'), amt(r, 'HRA'), amt(r, 'TRANS')], [5500, 3000, 300]);
  assert.match(r.Lines.find(l => l.Code === 'BASIC').Text, /15 days at 5,000\.00: − 500\.00 = 5,500\.00$/);
});

test('leave (decision 13): unpaid, absent and reduced-pay days on their own deduction lines', () => {
  const versions = [v('2025-01-01', { b: 6000, h: 3000, t: 600, p: 100 })];
  // Unpaid: every prorated earning, (6,000 + 3,000 + 600) / 30 = 320 a day; the phone is not prorated.
  let r = run({ versions, leave: [leave('2026-07-06', 'Unpaid'), leave('2026-07-07', 'Unpaid')] });
  assert.deepEqual([amt(r, 'UNPAIDLV'), amt(r, 'BASIC'), r.Net], [640, 6000, 9700 - 640]);
  assert.equal(r.Lines.find(l => l.Code === 'UNPAIDLV').Text, '2 days × 320.00 = 640.00');
  assert.equal(r.UnpaidDays, 2, 'for the bank file (step 4)');
  // Absence, its own line.
  r = run({ versions, leave: [leave('2026-07-08', 'Unpaid', { Absence: true })] });
  assert.deepEqual([amt(r, 'ABSENCE'), amt(r, 'UNPAIDLV')], [320, undefined]);
  assert.equal(r.UnpaidDays, 1);
  // Full salary pays the "in gross" elements: transport (not in gross) is taken out.
  r = run({ versions, leave: [leave('2026-07-10', 'Full')] });
  assert.equal(amt(r, 'REDUCEDLV'), 20);
  // Basic only: housing and transport out, 120 a day; at 50% full: half of the gross out, 150 + 20.
  r = run({ versions, leave: [leave('2026-07-10', 'Basic'), leave('2026-07-11', 'Basic'), leave('2026-07-12', 'Full', { Percent: 50 })] });
  assert.equal(amt(r, 'REDUCEDLV'), 2 * 120 + 170);
  // Selected elements: basic and transport paid, housing out.
  r = run({ versions, leave: [leave('2026-07-10', 'Elements', { Elements: ['b', 't'] })] });
  assert.equal(amt(r, 'REDUCEDLV'), 100);
  // A half day, and duty days (paid as working).
  r = run({ versions, leave: [leave('2026-07-10', 'Unpaid', { Fraction: 0.5 }), leave('2026-07-11', 'Duty')] });
  assert.deepEqual([amt(r, 'UNPAIDLV'), r.Lines.length], [160, 5]);
});

test('adjustments from earlier months: at the day\'s own month and pay; a cancelled day is given back', () => {
  const versions = [v('2025-01-01', { b: 5000, h: 1000 }), v('2026-07-01', { b: 6000, h: 3000 })];
  const r = run({ method: 'MONTHDAYS', versions, leave: [
    leave('2026-06-29', 'Unpaid', { PayMonth: '2026-07' }), // entered late: June's pay, ÷ 30 (June's days)
    leave('2026-06-10', 'Unpaid', { Fraction: -1, Reversal: true, PayMonth: '2026-07' }) // an unpaid June day cancelled
  ] });
  assert.equal(amt(r, 'UNPAIDLV'), undefined, 'the two June days net to nothing: no line');
  const r2 = run({ method: 'MONTHDAYS', versions, leave: [leave('2026-06-29', 'Unpaid', { PayMonth: '2026-07' }), leave('2026-07-03', 'Unpaid')] });
  assert.equal(amt(r2, 'UNPAIDLV'), 200 + 290.32);
  assert.equal(r2.Lines.find(l => l.Code === 'UNPAIDLV').Text, '1 day in 2026-06 (adjustment) × 200.00 + 1 day × 290.32 = 490.32');
  const r3 = run({ versions, leave: [leave('2026-06-10', 'Unpaid', { Fraction: -1, Reversal: true, PayMonth: '2026-07' })] });
  assert.equal(amt(r3, 'UNPAIDLV'), -200);
  assert.match(r3.Lines.find(l => l.Code === 'UNPAIDLV').Text, /^-1 day in 2026-06 \(taken back\) × 200\.00/);
});

test('this month\'s leave never takes more than the month\'s pay', () => {
  const days = []; for (let d = 1; d <= 31; d++) days.push(leave('2026-07-' + String(d).padStart(2, '0'), 'Unpaid'));
  const r = run({ leave: days });
  assert.deepEqual([amt(r, 'UNPAIDLV'), r.Net], [9000, 0]);
  assert.match(r.Lines.find(l => l.Code === 'UNPAIDLV').Text, /limited to the month's pay/);
});

test('inputs: overtime hours at the element\'s rate; amounts for bonus and one-off deductions', () => {
  const r = run({ hoursPerDay: 8, inputs: [{ ElementID: 'ot', Hours: 10 }, { ElementID: 'bonus', Amount: 1500, Note: 'Q2' }, { ElementID: 'fine', Amount: 50 }] });
  // 6,000 ÷ 30 ÷ 8 × 1.25 = 31.25 an hour.
  assert.deepEqual([amt(r, 'OT'), amt(r, 'BONUS'), amt(r, 'FINE'), r.Net], [312.5, 1500, 50, 9000 + 312.5 + 1500 - 50]);
  assert.equal(r.Lines.find(l => l.Code === 'OT').Text, '10 hours × 31.25 (6,000.00 (basic) ÷ 30 days ÷ 8 hours × 1.25 = 31.25 an hour)');
  assert.equal(r.Lines.find(l => l.Code === 'BONUS').Text, '1,500.00 — Q2');
  // On the gross and the employee's 9-hour schedule.
  const els = Object.assign({}, EL, { ot: Object.assign({}, EL.ot, { Overtime: Object.assign({}, EL.ot.Overtime, { Base: 'Gross' }) }) });
  assert.equal(amt(run({ elements: els, hoursPerDay: 9, inputs: [{ ElementID: 'ot', Hours: 2 }] }), 'OT'), 83.34); // 9,000 / 30 / 9 × 1.25 = 41.67
});

test('warnings: no pay in force; a negative net', () => {
  let r = run({ versions: [] });
  assert.match(r.Warnings.join(' '), /No pay in force/);
  r = run({ inputs: [{ ElementID: 'fine', Amount: 10000 }] });
  assert.equal(r.Net, -1000);
  assert.match(r.Warnings.join(' '), /Negative net: the deductions are 1,000\.00 more/);
});

test('back pay (decision 10): a posted month worked out again, less what was paid for it, by element', () => {
  // June was paid at 5,000 basic with one unpaid day; a raise to 6,000 from 1 June is approved later.
  const june = { month: '2026-06', leave: [leave('2026-06-10', 'Unpaid')] };
  const paid = run(Object.assign({ versions: [v('2025-01-01', { b: 5000, h: 3000 })] }, june)).Lines;
  const now = run(Object.assign({ versions: [v('2025-01-01', { b: 5000, h: 3000 }), v('2026-06-01', { b: 6000, h: 3000 })] }, june));
  const a = calc.arrearsFor('2026-06', now, paid, EL);
  // Basic +1,000; the unpaid day is now (6,000 + 3,000) / 30 = 300 instead of 266.67: +33.33 more deducted.
  assert.deepEqual(a.map(l => [l.Code, l.Kind, l.Amount, l.Source, l.ForMonth]), [['BASIC', 'Earning', 1000, 'Arrears', '2026-06'], ['UNPAIDLV', 'Deduction', 33.33, 'Arrears', '2026-06']]);
  assert.equal(a[0].Text, '2026-06: paid 5,000.00, now 6,000.00');
  assert.equal(a[0].Name, 'Basic Salary arrears');
  // Once paid, nothing more is due; a later cut gives negative arrears.
  assert.deepEqual(calc.arrearsFor('2026-06', now, paid.concat(a), EL), []);
  const cut = run(Object.assign({ versions: [v('2025-01-01', { b: 5000, h: 3000 }), v('2026-06-01', { b: 5500, h: 3000 })] }, june));
  assert.deepEqual(calc.arrearsFor('2026-06', cut, paid.concat(a), EL).map(l => [l.Code, l.Amount]), [['BASIC', -500], ['UNPAIDLV', -16.67]]);
});

test('extra lines (arrears, a shortfall brought forward) count in the totals', () => {
  const r = run({ extra: [{ ElementID: 'b', Code: 'BASIC', Name: 'Basic Salary arrears', Kind: 'Earning', Source: 'Arrears', Amount: 1000, Text: '' },
    { ElementID: 'sys-bfwd', Code: 'BFWD', Name: 'Brought forward', Kind: 'Deduction', Source: 'CarryForward', Amount: 400, Text: '' }] });
  assert.deepEqual([r.Earnings, r.Deductions, r.Net], [10000, 400, 9600]);
});

test('loans (step 4b): the balance, what a month asks (start, skips, instalment changes, an advance at once), recovered never past the net', () => {
  const loan = { Status: 'Active', PayoutJVID: 'J1', Kind: 'Loan', Amount: 3000, Instalment: 500, StartMonth: '2026-07', Skips: ['2026-09'], Changes: [{ FromMonth: '2026-11', Instalment: 1000 }],
    Repayments: [{ Amount: 200 }, { Amount: 100, ReversedAt: 'x' }] };
  const recs = [{ RunID: 'R7', Month: '2026-07', Amount: 500 }, { RunID: 'R8', Month: '2026-08', Amount: 500 }];
  assert.equal(calc.loanBalance(loan, recs), 1800); // 3,000 − 1,000 recovered − 200 repaid (a reversed repayment doesn't count)
  assert.equal(calc.loanBalance(loan, recs, 'R8'), 2300, 'the run being worked out again');
  assert.deepEqual(['2026-06', '2026-08', '2026-09', '2026-10', '2026-11'].map(m => calc.loanDue(loan, m, 1800)), [0, 500, 0, 500, 1000]);
  assert.equal(calc.loanDue(loan, '2026-12', 700), 700, 'at most the balance');
  assert.equal(calc.loanDue(Object.assign({}, loan, { Kind: 'Advance' }), '2026-08', 1800), 1800);
  assert.equal(calc.loanDue(Object.assign({}, loan, { PayoutJVID: '' }), '2026-08', 1800), 0, 'not paid out yet');
  // In the run: oldest first, never past the net (decision 26).
  let r = run({ loans: [{ LoanID: 'L1', LoanNumber: 'LN-0001', TypeName: 'Personal loan', Due: 500, Balance: 1800 }] });
  assert.deepEqual([amt(r, 'LOAN'), r.Net, r.Lines.find(l => l.Code === 'LOAN').Text, r.Lines.find(l => l.Code === 'LOAN').Name], [500, 8500, '500.00; balance after 1,300.00', 'Loan recovery: Personal loan LN-0001']);
  r = run({ inputs: [{ ElementID: 'fine', Amount: 8600 }], loans: [{ LoanID: 'L1', LoanNumber: 'LN-0001', TypeName: 'Personal loan', Due: 500, Balance: 1800 }, { LoanID: 'L2', LoanNumber: 'LN-0002', TypeName: 'Advance', Due: 300, Balance: 300 }] });
  assert.deepEqual([amt(r, 'LOAN'), r.Net, r.Lines.filter(l => l.Source === 'Loan').length], [400, 0, 1]);
  assert.match(r.Warnings.join(' '), /LN-0001: 400\.00 of the 500\.00 instalment recovered[\s\S]*LN-0002: 0\.00 of the 300\.00/);
});

test('gratuity (step 5, owner point 1, decision 28): the UAE slabs, a day as basic × 12 ÷ 365, the 2-year cap; from day one or after the first year', () => {
  // 1,826 days (2021-01-01 to 2025-12-31, a leap year in it) = 5.0027 years: 5 × 21 + 0.0027 × 30 days.
  let g = calc.gratuityFor({}, { base: 10000, joinDate: '2021-01-01', asOf: '2025-12-31', provision: true });
  assert.deepEqual([g.serviceDays, g.amount], [1826, 34547.57]);
  assert.equal(g.text, '5.00 years: 5 × 21 + 0.003 × 30 = 105.08 days × 328.77 = 34,547.57');
  // Unpaid days don't count as service.
  assert.equal(calc.gratuityFor({}, { base: 10000, joinDate: '2021-01-01', asOf: '2025-12-31', unpaidDays: 1, provision: true }).serviceDays, 1825);
  // Under a year: none, unless the provision starts from day one (never in a settlement).
  const young = { base: 10000, joinDate: '2025-06-01', asOf: '2025-12-31' };
  assert.equal(calc.gratuityFor({}, Object.assign({ provision: true }, young)).amount, 0);
  assert.equal(calc.gratuityFor({ StartsFrom: 'DayOne' }, Object.assign({ provision: true }, young)).amount, round2(214 / 365 * 21 * 10000 * 12 / 365));
  assert.equal(calc.gratuityFor({ StartsFrom: 'DayOne' }, young).amount, 0, 'a settlement under a year');
  // Long service: capped at 2 years' basic.
  g = calc.gratuityFor({}, { base: 10000, joinDate: '1995-01-01', asOf: '2025-12-31', provision: true });
  assert.deepEqual([g.amount, /capped at 2 years' pay/.test(g.text)], [240000, true]);
  // The company's own: ÷ 30, no cap, different slabs.
  g = calc.gratuityFor({ DayRule: 'Company', CapYears: null, MinYears: 0, Slabs: [{ FromYear: 0, ToYear: null, Days: 30 }] }, { base: 9000, joinDate: '2024-01-01', asOf: '2024-12-30', method: 'DIV30', month: '2024-12', provision: true });
  assert.equal(g.amount, round2(365 / 365 * 30 * 300));
});

test('leave salary (owner point 2, decision 30) and accruals (owner point 3, decision 32)', () => {
  assert.deepEqual(calc.leaveSalaryFor({ days: 12.5, base: 6000, method: 'DIV30', month: '2026-07' }), { amount: 2500, text: '12.5 days × 200.00 = 2,500.00' });
  assert.equal(calc.leaveSalaryFor({ days: 10, base: 6200, method: 'MONTHDAYS', month: '2026-07' }).amount, 2000);
  const flight = { Basis: 'Fixed', Rules: [{ LevelFrom: 1, LevelTo: 5, Value: 2400 }, { LevelFrom: 6, LevelTo: 99, Value: 6000 }], Exceptions: { E9: { Excluded: true }, E8: { Value: 1200 } } };
  const x = { level: 3, basic: 6000, gross: 9000, employedDays: 31, monthDays: 31, employeeId: 'E1' };
  assert.deepEqual(calc.accrualShareFor(flight, x), { amount: 200, text: '2,400.00 a year ÷ 12 = 200.00' });
  assert.equal(calc.accrualShareFor(flight, Object.assign({}, x, { level: 7 })).amount, 500);
  assert.equal(calc.accrualShareFor(flight, Object.assign({}, x, { employedDays: 15 })).amount, round2(200 * 15 / 31));
  assert.equal(calc.accrualShareFor(flight, Object.assign({}, x, { employeeId: 'E9' })).amount, 0, 'excluded');
  assert.equal(calc.accrualShareFor(flight, Object.assign({}, x, { employeeId: 'E8' })).amount, 100, 'their own amount');
  assert.equal(calc.accrualShareFor(flight, Object.assign({}, x, { level: null })).amount, 0, 'no grade, no rule');
  const edu = { Basis: 'Percent', Of: 'Basic', Rules: [{ LevelFrom: 1, LevelTo: 99, Value: 5 }] };
  assert.deepEqual(calc.accrualShareFor(edu, x), { amount: 300, text: '3,600.00 a year (5% of the basic) ÷ 12 = 300.00' });
});

// Stop salary (docs/modules/SALARY_HOLD.md): a held month's payslip is normal
// with a Stop Salary deduction taking the net to zero, after the loans; a
// released hold pays what was held as a Salary released earning.
test('a held salary: Stop Salary equal to the net, after loan recovery; released, paid as an earning', () => {
  const loans = [{ LoanID: 'L1', LoanNumber: 'LN-1', TypeName: 'Advance', Due: 1000, Balance: 3000 }];
  let r = run({ versions: [v('2025-01-01', { b: 6000, h: 3000, pen: 300 })], loans, hold: { FromMonth: '2026-07', Reason: 'Absconding' } });
  assert.deepEqual([amt(r, 'LOAN'), amt(r, 'STOPSAL'), r.Earnings, r.Deductions, r.Net], [1000, 7700, 9000, 9000, 0]);
  assert.equal(r.Lines.find(l => l.Code === 'STOPSAL').Source, 'Hold');
  assert.equal(r.Lines.find(l => l.Code === 'STOPSAL').Text, 'salary held from 2026-07', 'no reason on the payslip');
  // A negative net is not held.
  r = run({ versions: [v('2025-01-01', { b: 100, pen: 300 })], hold: { FromMonth: '2026-07', Reason: 'x' } });
  assert.equal(amt(r, 'STOPSAL'), undefined);
  // Released: the months held, paid now, out of the loans' reach.
  r = run({ versions: [v('2025-01-01', { b: 6000 })], loans: [{ LoanID: 'L1', LoanNumber: 'LN-1', TypeName: 'Advance', Due: 9000, Balance: 9000 }], released: { amount: 7700, months: ['2026-05', '2026-06'] } });
  assert.deepEqual([amt(r, 'SALREL'), amt(r, 'LOAN'), r.Net], [7700, 6000, 7700]);
  assert.equal(r.Lines.find(l => l.Code === 'SALREL').Text, 'held 2026-05, 2026-06, released');
});
