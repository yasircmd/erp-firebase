---
title: Earnings and Deductions
area: hr
order: 7
modules: [PAYROLLED]
sources: [functions/src/payrollInputs.js]
summary: Define the earnings, deductions and allowances that payroll calculations apply each pay cycle.
reviewed: 2026-10-12
fingerprint: 0e8c0663097a7a25
---
## What it is for

**Earnings and Deductions** is the register of each pay element used in payroll. It lists the company-defined earnings, deductions, loan deductions and reimbursement items used in each payroll run.

## Before you start

- Payroll Setup is complete for the company.
- The business knows which elements are paid each month.
- Accounts for each pay element are set up in the GL.

## Step by step

1. Open **Earnings and Deductions** and select the company.
2. Review the existing pay elements and their assignment to earnings or deductions.
3. Add or update any item with its account and calculation rule.
4. Save and test the element in a payroll run.

## What happens in the books

The pay element definitions are used when payroll is calculated and posted. They do not create a ledger entry until a payroll run is generated.

## Rights

Payroll administration and finance setup rights normally maintain this screen.

## Questions and mistakes

- If the payroll run shows unexpected amounts, recheck the element configuration and account mapping.
