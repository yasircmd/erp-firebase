---
title: Interim Payroll
area: hr
order: 9
modules: [PAYROLLIP]
sources: [functions/src/payrollInterim.js]
summary: Run an ad hoc or partial payroll when a monthly payroll needs an interim adjustment.
reviewed: 2026-10-12
fingerprint: 486c382c9fee74c9
---
## What it is for

**Interim Payroll** is used for an extra or partial payroll outside the normal pay cycle. It is often used for a special payment or adjustment that must be processed separately from the standard payroll run.

## Before you start

- The company has approved the interim run and the employees are known.
- The amounts and pay elements are agreed.
- The relevant payroll period is valid for the run.

## Step by step

1. Open **Interim Payroll** and select the company and date.
2. Select the employees and the pay elements to be processed.
3. Review the amounts before calculating the run.
4. Post the interim run and review the resulting cash and GL effect.

## What happens in the books

Interim Payroll creates payroll postings outside the regular cycle, so it clears the agreed salary or payment element at the selected date.

## Rights

This function is normally available only to payroll and finance users with posting rights.

## Questions and mistakes

- If an employee is missing, check whether the record is active and included in the payroll company setup.
