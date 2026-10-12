---
title: Payroll Run
area: hr
order: 8
modules: [PAYROLL]
sources: [functions/src/payrollRun.js]
summary: Calculate and post the payroll for all employees in the selected pay cycle.
reviewed: 2026-10-12
fingerprint: 5e4e4f05e4c5a61a
---
## What it is for

**Payroll Run** performs the actual payroll calculation and creates the pay entries for the selected period. It reads the employee data, pay elements and company rules to build the pay result.

## Before you start

- Employee pay details, leave and deductions are up to date.
- Payroll Setup and Earning / Deductions are configured.
- The payroll period is open and approved for running.

## Step by step

1. Open **Payroll Run** and select the company and period.
2. Review the payroll draft for each employee.
3. Confirm any adjustments, deductions or provisions.
4. Calculate and post the payroll.
5. Review the resulting bank file and GL impact.

## What happens in the books

The payroll run creates the summary and accounting impact for salary expense, deductions, liabilities and payable entries.

## Rights

Payroll administrators and approved cash/payroll roles generally have the right to calculate and post a payroll run.

## Questions and mistakes

- If the run looks wrong, recheck salary inputs and prior changes to the employee record.
- If a deduction is missing, confirm the element and employee assignment are active.
