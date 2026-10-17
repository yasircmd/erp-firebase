---
title: Final Settlement
area: hr
order: 11
modules: [PAYROLLFS]
sources: [functions/src/payrollSettlement.js, functions/src/eosStatement.js, functions/src/payrollCalc.js, functions/src/payrollRun.js, functions/src/payrollFiles.js, functions/src/payrollLoans.js, functions/src/payrollProvisions.js]
summary: Finalise the employee’s end-of-service or exit settlement with all remaining balances and payments.
reviewed: 2026-10-16
fingerprint: 723816c3e78e14b7
---
## What it is for

**Final Settlement** calculates and clears the amounts due when an employee leaves. It brings together salary months not yet paid, leave balance, gratuity, other accruals, notice pay, additional pay/deductions, and outstanding loans in one effective-dated exit document.

## Before you start

- Employee Master shows the employee as **On notice** or **Left**, with leaving date, reason, company, cost center, and final job/pay details updated.
- The leaving date has arrived; settlement cannot be submitted before that date.
- Payroll Setup has valid salary, provision, loan, and Salaries Payable/Recoverable accounts and any notice-pay elements.
- Leave up to the leaving date is decided. Any salary months allocated to Payroll Run have a posted run containing the employee; months allocated to the settlement cannot have a run past Draft.
- Approval Configuration for Final Settlement is ready if approval is required.

## Step by step

1. Open Final Settlements and choose an employee on notice or marked Left with a leaving date. Only one settlement exists per employee.
2. Review the salary months listed. The leaving month is paid through the settlement; earlier unpaid months can be assigned either to a payroll run or to the settlement, subject to the sequence shown.
3. Review calculated lines for salary, unpaid/paid leave, gratuity, leave salary, accruals, loan balance, and any arrears or monthly inputs. Confirm the chosen salary basis and rates against the employee's compensation and Payroll Setup.
4. Enter notice days and choose whether notice is paid in lieu or deducted for short notice. Add other earning/deduction elements only when supported by the relevant business decision.
5. If an automatically calculated gratuity, leave-salary, or accrual amount must be overridden, enter the agreed amount and a reason. Check all warnings and the final net: a positive amount is payable; a negative amount is due from the employee.
6. Save the draft and submit on or after the leaving date. The system recalculates, checks leave and salary-month dependencies, and routes through Approval Configuration. Rejection returns it to Draft.
7. Final approval posts the settlement journal dated on the leaving date. Review the journal and settlement status, then create a payment from the configured bank file or cash/bank account. If sent through Interim Payroll, pay it there instead; do not pay it twice.
8. If a posted settlement is wrong, reverse its payment first, then reverse the settlement with a reason. Reversal restores loan recoveries and returns the document to Draft for correction.

## The end-of-service statement

**Print statement** (at the top of a saved settlement) prints the End-of-Service Settlement Statement to give the employee. It prints without the ERP title bar, like other documents sent outside. It shows:

- the company and the employee: employee no., name as in passport, nationality, passport and Emirates ID numbers (from Employee Documents), designation, department, joining date, last working day, reason for leaving and length of service;
- the gratuity worked out: the basic, a day's pay and, for each slab, the years, the days a year and the amount; the cap if it applied; an amount HR changed, with its reason;
- the entitlements (salary to the last working day, leave salary, accruals, notice pay, other additions) and the deductions (loans, leave taken in advance, other deductions);
- the net, in figures and in words, in the system currency (the currency marked Default in Currency Configuration);
- signature lines for preparer, approver and the employee's acknowledgement.

Until the settlement is posted, the statement is marked **DRAFT**, so you can check it with the employee first. A draft shows the figures as they are worked out now, the same as the screen.

Once the settlement is paid, the employee can view and download the same statement in the Employee Portal (**My payslips**), while their portal access lasts. That access normally ends on the payment date, so extend it in Employee Master if they need longer.

## What happens in the books

Approval posts one settlement journal dated the leaving date. It clears the amounts used from gratuity, leave salary and other provisions, posts the difference to expense, takes back any lapsed accrual provision, reduces loan receivables, and posts net due to Salaries Payable or Recoverable from employees. Payment is separate and clears the payable through cash/bank. Once it is paid, the leaver's ERP and Employee Portal access ends on the payment date (or the last working day, if later); without a payment it ends 30 days after the last working day. Reversing the payment brings the 30 days back. A negative net is not paid out; it is recorded as an employee receivable.

## Rights

PAYROLLFS **access** controls viewing; **draft** prepares and submits; configured approvers decide; **post** controls reversal; **pay** controls payment and payment reversal. Payroll Setup write is required to correct setup accounts. Company access and employee-sensitive rights apply.

## Questions and mistakes

- **Employee is not available:** status must be On notice or Left, and the leaving date must be entered.
- **Cannot submit yet:** wait until the leaving date, decide/delete leave through that date, and resolve every salary month. A month left to its run must have a posted run with the employee; a month paid here cannot have a run beyond Draft.
- **Salary month appears in both workflows:** choose whether the run or settlement pays it. A submitted settlement later causes the payroll run to require recalculation and exclude that employee/month.
- **Leave or gratuity amount is unexpected:** check approved and pending leave through the exit date, unpaid-day treatment, current compensation, grade/leave rules, company daily-rate method, and provision setup.
- **Override is refused:** provide a non-negative amount and a reason. Keep supporting approval evidence with the settlement.
- **No GL account/cost center:** configure the relevant payroll/provision/loan account and employee cost center before submission.
- **Settlement is payable through Interim Payroll:** a posted positive-net settlement can be included in one Interim Payroll batch; do not also mark it paid directly.
- **Cannot reverse:** reverse the payment first and remove the settlement from any Interim Payroll batch. Reversal requires a reason.

## Related pages

[Employee Master](employees.html) · [Employee Change](employee-change.html) · [Payroll Setup](payroll-setup.html) · [Payroll Run](payroll-run.html) · [Interim Payroll](payroll-interim.html) · [Provisions](provisions.html)
