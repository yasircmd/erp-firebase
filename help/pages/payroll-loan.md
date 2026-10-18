---
title: Payroll Loan / Advance
area: hr
order: 10
modules: [PAYROLLLOAN]
sources: [functions/src/payrollLoans.js, functions/src/payrollCalc.js]
summary: Manage loan and advance recovery and posting as part of the payroll cycle.
reviewed: 2026-10-18
fingerprint: d396c4b3170ac826
---
## What it is for

**Loans & Advances** tracks employee borrowing from draft request through approval, payout, scheduled recovery, and repayment. Loan types are defined in Payroll Setup; an advance is recovered at once, while a loan is recovered in instalments through payroll.

## Before you start

- Payroll Setup contains the active loan type, asset receivable account, and intended recovery policy.
- The employee is active, belongs to the selected company, and the amount/start month/instalment are agreed.
- Approval Configuration for Loan / Advance is ready if approval is required.
- A valid cash/bank account is available for payout, and Payroll Setup's payment file is configured if the payout will be included in an interim bank file.

## Step by step

1. Open Loans & Advances, select the employee and active type, then enter principal, instalment (for a loan), recovery start month, and note.
2. Save the draft and submit it. The approval amount is the principal. A rejection returns it for correction; approval alone does not pay the employee.
3. Include the approved loan/advance in an Interim Payroll batch and pay it from cash/bank. The payout posts to the receivable account configured for that type.
4. Review the running balance and monthly recovery history. Payroll deducts the scheduled amount in each run, oldest due items first, but does not recover more than the employee's available net pay.
5. When necessary, use the loan schedule controls to skip a month, change an instalment from a specified month, or record an early repayment. Review the new balance and next due amount.
6. At leaving, review the balance with Final Settlement; the settlement deducts the remaining loan balance. Once a final settlement is beyond Draft, payout/repayment actions wait for that settlement.

## What happens in the books

Payout debits the loan type's employee receivable and credits cash/bank. Each posted Payroll Run recovery credits that receivable and reduces the loan balance; early repayments use their own payment journal. A reversed payroll run restores the recovery balance. Final Settlement clears the remaining receivable when the employee leaves.

## Rights

PAYROLLLOAN **access** controls viewing; **draft** prepares/submits loan records; configured approvers decide; **pay** controls payout and repayment. Payroll Setup write is required to maintain types and receivable accounts. Sensitive employee compensation remains subject to Employees sensitive access.

## Questions and mistakes

- **Loan type missing:** confirm it is active in Payroll Setup → Loans and the user can access the company.
- **Approval completed but no money received:** approved status is not payout; include the item in an Interim Payroll batch and mark it paid.
- **Loan not recovered in a run:** check status, recovery start month, skips/instalment changes, outstanding balance, and whether a settlement has taken control of the employee's balance.
- **Recovery is less than the scheduled instalment:** the run caps recovery at the employee's net amount; the remaining balance stays due.
- **Receivable account error:** the group account must be an active postable Asset account; a company override must belong to that company.
- **Loan is already in another batch:** remove it from the other Draft batch or finish/reverse that payment before reserving it again.
- **Employee has a final settlement:** changes and repayments are held while a settlement past Draft controls the remaining balance.

## Related pages

[Payroll Setup](payroll-setup.html) · [Payroll Run](payroll-run.html) · [Interim Payroll](payroll-interim.html) · [Final Settlement](payroll-final-settlement.html)
