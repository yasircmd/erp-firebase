---
title: Provisions
area: hr
order: 12
modules: [PROVISIONS]
sources: [functions/src/payrollProvisions.js, functions/src/payrollCalc.js, functions/src/payrollRun.js, functions/src/payrollPost.js, functions/src/payrollSettlement.js]
summary: Maintain leave, gratuity and other provisions so payroll and year-end reporting stay aligned.
reviewed: 2026-10-12
fingerprint: a587ac0f45857e69
---
## What it is for

Payroll provisions track employee liabilities that accrue over time, including end-of-service gratuity, unused leave salary, and company-defined accruals such as travel or education benefits. Rules are configured in Payroll Setup; monthly provision amounts are calculated with Payroll Run and posted when that run is posted.

## Before you start

- HR/Finance have agreed the policy for gratuity, leave salary, and each additional accrual.
- Payroll Setup → Provisions has the applicable formula, grade rules, employee exceptions, and active expense/liability accounts.
- Opening provision balances already in the GL have been imported with their as-of dates through Master Data Import; do not enter them again as a new GL posting.
- Employee grade, joining date, compensation, leave balances, and cost center are current.

## Step by step

### Configure the policy

1. In Payroll Setup → Provisions, select the company and configure gratuity: Basic or Gross base, day-rate rule, minimum service, cap, start point, service slabs, and expense/provision accounts.
2. Configure leave salary on Basic or Gross and set its expense/liability accounts. Its days come from the employee's available balance plus booked days for leave types that use balances.
3. Define other accrual types with a unique code and either a fixed annual amount or a percentage of Basic/Gross. Add non-overlapping grade-level rules, company-specific account overrides, and any employee-specific value or exclusion. Decide whether the balance is paid at leaving or lapses.
4. Verify account types and company ownership. The expense account must be an active postable Expense; the provision account an active postable Liability.

### Review balances and claims

1. Open Payroll's provision balances for the company and review employee balances by provision. Balances combine opening amounts, posted run accruals, salary payouts, claims, and settlements.
2. Record an accrual claim when the company pays an eligible benefit from an accrual, such as an approved education or travel cost. Select employee, accrual, date, amount, and cash/bank account; retain the supporting evidence.
3. Review the generated journal and updated balance. If a claim was entered incorrectly, reverse it with a reason rather than editing its posted record.
4. At termination, review the provision amounts in Final Settlement. The settlement pays configured balances at leaving or takes back balances that lapse.

## What happens in the books

Payroll Setup does not post. Each posted payroll run debits provision expense by employee cost center and credits the provision liability for the month's movement; a changed calculation can adjust an already provided balance. A claim debits the relevant provision liability and credits cash/bank. Final Settlement consumes the provision and posts any difference to expense; accruals configured to lapse are taken back. Opening balances imported from an existing GL are balance records only and are not posted again.

## Rights

Payroll Setup access/write controls provision configuration. PAYROLL access controls provision-balance review; PAYROLL **pay** controls accrual claims and reversals. Final Settlement permissions control the exit payout/clearance workflow. Company access applies.

## Questions and mistakes

- **No provision movement in the run:** verify the policy is enabled, the employee is included in the run, relevant grade/employee rules cover them, and both accounts are valid.
- **Accrual amount is zero or unexpected:** inspect the fixed annual amount/percentage, Basic/Gross selection, grade range, employee exception, service dates, and effective employee pay.
- **Leave salary differs from the leave report:** compare leave types that use a balance, employee entitlement overrides, approved/booked days, the as-of date, and the daily-rate method.
- **Provision account rejected:** expense must be an active postable Expense and provision must be an active postable Liability; company overrides must belong to that company.
- **Opening balance doubles the liability:** confirm the opening balance was imported as an as-of balance already represented in the GL, not posted as a new expense/liability journal.
- **Claim exceeds the expected balance:** review prior posted runs, opening balance date, earlier claims/payouts, and whether a final settlement has taken control of the employee's provisions.
- **Cannot make a claim or change a balance:** check the Payroll pay right, company access, and whether a final settlement is beyond Draft.
- **Final Settlement amount differs from monthly provision:** the settlement recalculates on the leaving date and clears the liability actually provided; the difference is posted to expense or taken back.

## Related pages

[Payroll Setup](payroll-setup.html) · [Payroll Run](payroll-run.html) · [Final Settlement](payroll-final-settlement.html) · [Master Data Import](master-import.html)
