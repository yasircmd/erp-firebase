---
title: Payroll Setup
area: hr
order: 6
modules: [PAYROLLSETUP]
sources: [functions/src/hrPay.js, functions/src/payrollSetup.js, functions/src/payrollPayment.js, functions/src/payrollFiles.js, functions/src/payrollLoans.js, functions/src/payrollProvisions.js, functions/src/reimbursements.js, functions/src/leavingReasons.js]
summary: Set the company payroll account, pay elements and defaults used by each payroll run.
reviewed: 2026-10-18
fingerprint: aad913bacd8b7024
---
## What it is for

**Payroll Setup** is the configuration workspace for pay elements, payroll accounting, bank/payment file layouts, loan types, provisions, and reimbursement categories. The six tabs feed the employee compensation record, payroll calculation and posting, employee loan/claim workflows, and payroll payments.

It does not calculate an employee's monthly salary by itself. It defines the elements, formulas, accounts and policies that the operational modules use.

## Tabs at a glance

The seven Payroll Setup tabs are **Pay Elements**, **Payroll Accounting**, **Payment Files**, **Loans**, **Provisions**, **Reimbursements**, and **Leaving Reasons**. Use the matching section below for the setup maintained in each tab.

## Before you start

- HR and Finance have agreed the pay policies and the payroll accounting treatment.
- Companies and active, postable accounts are set up in the Chart of Accounts.
- Grades, bands, employee work schedules, leave pay rules, and company calendars are aligned in [HR Setup](hr-setup.html).
- The bank's file specification is available if a WPS SIF or other payment file is needed.
- The company has assigned Payroll Setup access/write rights and Payroll/Loans/Interim/Settlement rights to the appropriate roles.

## Step by step

### Pay Elements

Create each element with a unique code/name and classify it as **Earning** or **Deduction**, **Fixed** (monthly amount on compensation) or **Variable** (entered for a payroll period), and mark the one fixed earning that is Basic. Set inactive elements out of use rather than reusing their code. Fixed elements form the employee's recurring compensation; variable elements such as bonus, commission, overtime, or one-offs are entered for a period.

### Payroll Accounting

For each company, choose the daily-rate method: monthly amount divided by 30, by the actual days in that month, or monthly amount × 12 ÷ 365/366. Set **Salaries Payable** (liability) and **Recoverable from employees** (asset), and choose how leave deductions appear in the GL: pro-rata against the original earnings accounts or through the element's ledger mapping. Set the optional cut-off day (1–28) if the leave month is to lock before month end; blank means after month end.

For each pay element, select its shared/group GL account and any company-specific override. Earnings require an expense account; deductions may post to a liability or receivable. Decide whether the fixed amount is prorated for joiners, leavers and unpaid days, and whether an earning counts in gross for leave pay/overtime calculations.

For variable earning elements that represent overtime, enable the overtime formula. It can be a fixed amount per run or hours × rate. For hours-based OT, choose Basic or Gross, company daily-rate method or fixed divisor days, employee schedule hours or fixed hours, and a weightage. Review the displayed example against the approved company formula.

### Payment Files

Create a format for the company and bank, either from the UAE WPS SIF starter or as a blank layout. Configure file type (delimited or fixed width), delimiter/extension/line ending, filename pattern, employer and bank codes, currency/reference, and the ordered header, employee-record, and trailer fields required by the bank. Enter employee WPS person ID, bank routing code and IBAN in the sensitive employee fields. Preview a posted run with an appropriate payment date, then have the bank validate the output before first live use.

### Loans

Create each loan/advance type and select its receivable account (group account with optional company override). An advance is recovered at once; a loan is recovered in instalments. Optional Employee Portal limits can cap amount in months of Basic or Gross salary and number of instalments, require completion of probation, or allow only one open request of that type.

### Provisions

For each company, configure gratuity (salary base, day-rate rule, minimum service, cap, start point, service slabs, expense and liability accounts) and leave salary (Basic or Gross base, expense and liability accounts). Add other accruals such as flight or education: fixed annual amount or a percentage of Basic/Gross, by grade level, with company account overrides and employee exceptions. Decide whether an unused accrual is paid at leaving or lapses. Opening balances already recorded in the GL are brought in through Master Data Import, not posted again here.

### Reimbursements

Create each employee claim category with its expense account, optional company override, monthly per-employee limit, receipt requirement, and maximum age of bills. Each category has its own reimbursement pay element. Approved claims are added to the relevant month's Earnings and Deductions and paid through payroll; an over-limit flag is visible to approvers, who decide whether to approve it.

### Leaving Reasons

The reasons an employee leaves, each a **Resignation**, **Termination** or **Other**. The list starts with common ones (for example Better opportunity, Relocation, Performance, Redundancy, End of contract, Retirement); add your own with **New reason**. In [Employee Master](employees.html), an employee on notice or who has left must have one of these, with an optional note for any detail. Untick **In use** to retire a reason: employees who already have it keep it.

### Finish and test

Save each tab and check the selected company, group account, company override, and active status. Rehearse with representative employees and a draft run; verify the calculated lines and GL impact before approving or posting production payroll.

## What happens in the books

Payroll Setup itself makes no journal entries. Payroll Run posts earnings, deductions, net payable or recoverable amounts, and configured provisions. Loan payout/recovery, interim payments, final settlement, and provision claims create their own entries in their respective workflows. Payment file formats only produce bank files; marking payment is the action that posts the payment accounting.

## Rights

Payroll Setup access controls viewing; its **write** right controls all setup tabs. Payroll, Payroll Loan, Interim Payroll, Final Settlement, and Employee Requests have separate operational rights. Keep setup changes limited to trusted payroll and finance maintainers; they can affect all future runs.

## Questions and mistakes

- **Posting account rejected:** it must be active and postable, be the required account type, and belong to the group or selected company as appropriate.
- **Pay element has no account:** set its group account or company override in Payroll Accounting before posting.
- **Leave pay or overtime gross is wrong:** review the element's In gross flag, the leave pay rule, and the overtime base and divisors.
- **Joiner/leaver or unpaid days are not prorated as expected:** inspect the element's Prorated setting and company daily-rate method.
- **Payroll cannot lock leave when expected:** check the company's cut-off day and settle leave dated up to the cutoff first.
- **Bank rejects the file:** compare the exact field order, codes, filename, delimiters/line endings, employee WPS data, and payment date with the bank's current specification; a successful preview does not guarantee bank acceptance.
- **Loan or reimbursement request is blocked:** check the type/category is active, its account is valid, and optional limits and probation rules are intentional.
- **Provision is missing from a run:** confirm the company provision is enabled, its accounts are valid, and accrual rows cover the employee's grade level.

## Related pages

[HR Setup](hr-setup.html) · [Earnings and Deductions](payroll-earnings-deductions.html) · [Payroll Run](payroll-run.html) · [Loans and Advances](payroll-loan.html) · [Provisions](provisions.html)
