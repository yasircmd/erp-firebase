---
title: Payroll Loan / Advance
area: hr
order: 10
modules: [PAYROLLLOAN]
sources: [functions/src/payrollLoans.js]
summary: Manage loan and advance recovery and posting as part of the payroll cycle.
reviewed: 2026-10-12
fingerprint: 83aae107b2981c88
---
## What it is for

**Payroll Loan / Advance** handles employee loan or advance requests, their balances and the deductions applied through payroll.

## Before you start

- The loan type and payroll deduction rules are configured.
- The employee is active and has a valid account or deduction schedule.
- The amount and repayment schedule are agreed.

## Step by step

1. Open **Payroll Loan / Advance** and select the employee.
2. Add or review the loan or advance record.
3. Confirm the principal or recovery schedule.
4. Post or approve the record so the payroll run can deduct it.

## What happens in the books

The loan or advance creates the employee receivable and is later recovered through payroll. The deduction goes through the employee pay elements and the payroll posting.

## Rights

Payroll administrators and employee loan approvers usually have the rights to process the record.

## Questions and mistakes

- If a deduction is not showing, check the employee’s accrual, loan record and payroll element setup.
