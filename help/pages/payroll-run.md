---
title: Payroll Run
area: hr
order: 8
modules: [PAYROLL]
sources: [functions/src/payrollRun.js, functions/src/payrollCalc.js, functions/src/payrollInputs.js, functions/src/payrollLoans.js, functions/src/payrollProvisions.js, functions/src/payrollPost.js, functions/src/payrollPayment.js]
summary: Calculate and post the payroll for all employees in the selected pay cycle.
reviewed: 2026-10-12
fingerprint: d87a0983e1a5880d
---
## What it is for

**Payroll Run** calculates, reviews, approves, posts, and pays one company's payroll for a month. It combines the employee compensation version in force, payroll setup, locked leave, monthly variable inputs, loan recoveries, provisions, and any arrears or carried-forward net shortfall.

## Before you start

- Employees, effective-dated compensation, bank details, grades, and cost centers are current.
- Payroll Setup has valid element/account mappings, company daily-rate settings, payable/receivable accounts, and relevant provision rules.
- Leave for the month is reviewed and locked in [Leave](leave.html). The run cannot be calculated without the locked leave month.
- Variable items are entered in [Earnings and Deductions](payroll-earnings-deductions.html); loans due are active and settlements have been checked.
- Approval Configuration for Payroll is ready if approval is required. Confirm the month is not blocked by the accounting period lock.

## Step by step

### Calculate and review

1. Open Payroll and create/open the run for the company and month. A company has one run for a given month.
2. Calculate the run. Eligible employees are those whose employment overlaps the month. Fixed elements come from the compensation version effective for each date and use the company's daily-rate method for proration.
3. Review the register totals and each employee's slip. The calculation considers paid leave rules, unpaid and absent days, duty, late leave adjustments, variable inputs, loan instalments, accrual payouts, and provision movements.
4. Investigate warnings before submission: missing compensation or IBAN, basic outside the grade band, negative net, or other employee-specific exceptions. Correct source data and recalculate.
5. Recalculate whenever variable inputs or the locked leave data changes. The run records the versions it used and prevents submission if its leave lock or input set is stale.

### Approve and post

1. Submit the reviewed draft. If Approval Configuration requires approvals, the run becomes Pending Approval; otherwise it is approved and posts immediately.
2. Approvers review the net-pay amount and employee slips, then approve or reject. Final approval posts the run.
3. Review the approved GL impact before posting where available, then verify the posted journal and run status. Posting is one payroll journal dated at the month's end, with lines clubbed by account/cost center as appropriate.

### Pay and issue payslips

After posting, review and print employee payslips. Build/preview the configured bank file or payment list, then mark payment from the selected cash/bank account. A run can be paid in parts; track unpaid balances from its payment status. Reverse payments before reversing a paid run.

### Correct a posted run

A posted run can be reversed only when its payments are reversed and later dependent payroll runs/settlements are dealt with first. Supply a reason, correct the source data, recalculate, and submit the run again. A closed accounting period may require the adjustment/repost to be dated in the first open month.

## What happens in the books

Posting debits earning expense accounts by employee cost center, credits deduction accounts, and credits Salaries Payable for positive net amounts. A negative net is debited to Recoverable from employees and carried forward into a later run. Configured gratuity, leave salary, and other accrual provisions post their expense/liability movements. Loan recoveries reduce the corresponding employee loan receivable; accrual payouts reduce the provision. Payment is a separate journal that debits Salaries Payable and credits the cash/bank account.

## Rights

PAYROLL **access** allows viewing runs and amounts; **draft** allows creating, recalculating, changing and submitting a run; configured approvers decide approval; **post** is used for reversal; payment rights control marking payment. Payroll amounts are sensitive: access is granted by the Payroll module and the approval workflow, while employee bank details and pay records have their own sensitive controls.

## Questions and mistakes

- **Cannot calculate:** lock leave for this company/month first, then inspect missing compensation, inactive elements, missing pay rules, and employee grade/schedule.
- **Submission says recalculate:** the leave month was reopened/changed or Earnings and Deductions changed after calculation. Recalculate and review the new totals.
- **Employee absent from run:** check company, joining date, leaving date, and any final settlement that is paying that month.
- **Net differs from expectation:** inspect the detailed slip by element, unpaid/paid leave, overtime formula, variable inputs, loan schedule, carry-forward, arrears, and provision entries.
- **Missing GL account or cost center:** fix Payroll Setup or Employee Master, then retry posting. Expense accounts requiring cost centers need an employee cost center.
- **Approved but not posted:** inspect the posting error; a missing/inactive account can leave an approved run waiting to post.
- **Run cannot be reversed:** reverse its payments first; reverse later runs or dependent final settlements before this run.
- **Bank file is wrong:** the payment file is generated from Payroll Setup and employee WPS/bank fields. Preview and validate it against the bank format before marking payment.

## Related pages

[Payroll Setup](payroll-setup.html) · [Earnings and Deductions](payroll-earnings-deductions.html) · [Leave](leave.html) · [Interim Payroll](payroll-interim.html) · [Final Settlement](payroll-final-settlement.html) · [Provisions](provisions.html)
