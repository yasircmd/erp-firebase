---
title: Final Settlement
area: hr
order: 11
modules: [PAYROLLFS]
sources: [functions/src/payrollSettlement.js]
summary: Finalise the employee’s end-of-service or exit settlement with all remaining balances and payments.
reviewed: 2026-10-12
fingerprint: 237e5b31a24b8d9b
---
## What it is for

**Final Settlement** is used to settle the employee’s final dues when employment ends. It includes any remaining salary, leave balance instructions, deductions and end-of-service provisions.

## Before you start

- The employee record is complete and the exit date is known.
- The final settlement elements are configured in payroll setup.
- The employee’s final pay and deductions are approved.

## Step by step

1. Open **Final Settlement** and select the employee.
2. Review the employee’s final balance and settlement elements.
3. Add any special end-of-service adjustments.
4. Post the final settlement and verify the resulting payment and GL impact.

## What happens in the books

Final Settlement posts the final employee payable and clears the employee balance for the selected exit date. It often also creates the final leave or gratuity adjustments.

## Rights

This is restricted to payroll and HR managers with the proper approval rights.

## Questions and mistakes

- If the amount is not expected, verify the employee’s last payroll run, leave balance and final settlement rules.
