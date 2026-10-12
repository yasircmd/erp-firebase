---
title: Payroll Setup
area: hr
order: 6
modules: [PAYROLLSETUP]
sources: [functions/src/payrollSetup.js]
summary: Set the company payroll account, pay elements and defaults used by each payroll run.
reviewed: 2026-10-12
fingerprint: 37ed0dd108529f58
---
## What it is for

**Payroll Setup** defines the company’s payroll structure, including pay and deduction elements and the account mapping for payroll transactions.

## Before you start

- The company and its GL account structure are ready.
- The employee pay rules are agreed with HR and finance.
- The payroll calendar and relevant pay cycle are known.

## Step by step

1. Open **Payroll Setup** and select the company.
2. Review the payroll elements and their GL account links.
3. Confirm the defaults for deductions, allowances and payroll posting.
4. Save the setup and test it with a pilot payroll entry.

## What happens in the books

Payroll Setup does not post a run by itself. It determines how the payroll calculations and posting entries are later created.

## Rights

Usually restricted to payroll admins and finance support roles.

## Questions and mistakes

- If payroll runs fail, check the company pay definitions and linked accounts.
- Missing pay elements or bank details are common blockers for payroll processing.
