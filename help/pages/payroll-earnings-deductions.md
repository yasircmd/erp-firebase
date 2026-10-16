---
title: Earnings and Deductions
area: hr
order: 7
modules: [PAYROLLED]
sources: [functions/src/payrollInputs.js, functions/src/payrollInterim.js]
summary: Define the earnings, deductions and allowances that payroll calculations apply each pay cycle.
reviewed: 2026-10-16
fingerprint: b2430284e735a7b4
---
## What it is for

**Earnings and Deductions** is the period input register for variable pay. Payroll staff enter employee-specific overtime hours or amount, bonus, commission, reimbursement, accrual payout, and one-off additions/deductions for a company and month. Fixed monthly compensation is maintained on the employee's dated compensation record, not here.

## Before you start

- [Payroll Setup](payroll-setup.html) has active pay elements and their accounting/overtime rules.
- Employees have active records and compensation effective for the month.
- The payroll month and company are confirmed, and payroll input totals are approved by their source records.
- If an item is to be paid separately, confirm it is eligible for Interim Payroll before entering it.

## Step by step

1. Open **Earnings and Deductions** and choose the company and payroll month.
2. Add a row for each employee/variable pay element. Use employee number or employee selection, the configured element, and either hours (for an hours-based overtime element) or an amount. Add a note to identify the source or reason; paste multiple rows from a spreadsheet when appropriate.
3. Choose **Run** for earnings/deductions paid through the monthly payroll, or **Interim** for eligible amount-based earnings such as a bonus or commission that will be paid separately. Hour-based overtime and accrual payouts are not paid by Interim Payroll.
4. Review the register's state: for the run, entries are included in its next calculation; interim items show whether they are awaiting a batch, in a batch, or paid.
5. Correct or remove an entry while it remains editable. Recalculate the payroll draft after changing run inputs; the run captures the input version used in its calculation.
6. For Interim items, create/select an Interim Payroll batch and include the entry. It becomes locked while reserved by a batch and is marked paid only after that payment is completed.

## What happens in the books

Entering an item does not post a journal. Run-paid inputs are included in the monthly calculation and post with that run using the element's GL account and employee cost center. Interim-paid earnings post when the Interim Payroll item is paid, using a payment journal and the configured element account.

## Rights

The PAYROLLED access right controls viewing; its **draft** right controls adding, editing, and deleting inputs. Company access applies. Changes to run-paid rows stop once the monthly run is no longer Draft; interim rows stop being editable once included in a batch.

## Questions and mistakes

- **Employee is not available:** check the employee's company and employment dates; the employee must be on payroll in that month.
- **Element is not listed:** only active variable elements and available provision accrual payouts are entered here. Fixed pay belongs in compensation.
- **Hours field is required:** the overtime element is configured as hours-based; enter hours, not a manually calculated amount.
- **Run total did not change:** recalculate the run after editing inputs. If the run left Draft, its run-paid entries can no longer be changed; follow the run's reject/reversal controls as applicable.
- **Entry says In the draft run/Pending approval/Posted with the run:** the run owns its editability. Reopen the run to review the matching calculation and status.
- **Interim option is rejected:** only an earning paid by amount is eligible; ordinary salary, hourly overtime, and accrual payouts remain with the monthly run or provision process.
- **Interim entry is locked:** remove it from its draft batch first; after approval/payment, use the batch's payment reversal workflow rather than deleting the source row.

## Related pages

[Payroll Setup](payroll-setup.html) · [Payroll Run](payroll-run.html) · [Interim Payroll](payroll-interim.html) · [Employee Requests](employee-requests.html)
