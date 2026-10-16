---
title: Employee Requests
area: hr
order: 13
modules: [EMPREQUESTS]
sources: [functions/src/employeeRequests.js, functions/src/essPortal.js, functions/src/reimbursements.js, functions/src/payrollLoans.js]
summary: Manage employee queries, claims and requests from the portal or the ERP’s request workflows.
reviewed: 2026-10-16
fingerprint: 20bb0e5cbe6a9ef1
---
## What it is for

**Employee Requests** is the ERP-side work queue for requests submitted through Employee Self-Service. It brings employee queries and cases to the relevant handler, while claims and other request types continue through their own approval and payroll/accounting workflows.

Requests may include a question or case, reimbursement claim, loan/advance request, payroll query, or a leave request that is initiated and tracked through the portal. This screen is for managing the request and its communication; it is not a substitute for the Payroll Loan, Leave, or payroll posting documents.

## Before you start

- The employee record is current, with company and line manager where the request type requires them.
- Employee portal access is enabled for the employee and the relevant roles have access to Employee Requests.
- The portal categories and policies are configured: reimbursement categories/pay elements, loan limits/types, and approval rules where used.
- The handler knows which actions belong in Employee Requests and which require the linked operational module.

## Step by step

1. Open Employee Requests and filter the list by company, request type, or status to find new and open work.
2. Open the request. Confirm the employee, category, submitted details, internal notes, and any supporting files before acting.
3. Add internal notes for the HR/payroll team. Keep notes factual and do not put sensitive payroll or identity details in a case that is visible to users who should not see them.
4. For a query, respond or route it to the appropriate handler and close it when resolved. The employee can also close their own query from the portal at any time while it is open: **Mark resolved** (with an optional note, shown as the outcome) or **Withdraw** (a reason is required). Either shows in the query's history; a query the employee marked resolved can still be reopened within 14 days. Loan, advance and claim requests are unchanged.
5. For a reimbursement, use the configured manager and approval flow. If approved, its category-specific earning is carried into the relevant month in Earnings and Deductions and paid with payroll; the claim itself is not a bank payment.
6. For a loan/advance request, check the configured loan type and limits, then follow the approval and payout workflow in [Loans and Advances](payroll-loan.html).
7. For leave, use the Leave Register and approval workflow for the authoritative dates, balance, and return handling.
8. Reopen or follow up requests that need more information; close only after the business action is complete and the employee has a clear resolution.

## What happens in the books

Employee Requests itself is a workflow record and does not post to the general ledger. An approved reimbursement can become an earning input for Payroll; a loan request can become a loan document; a leave request can become a Leave Register document. Those downstream modules perform their own approvals, postings, and payment records.

## Rights

Employee Requests access and handler rights are configured separately from portal access. The line manager, assigned handler, HR, and payroll staff should receive only the rights needed for their work. Access to employee-sensitive pay/bank information remains controlled by Employees sensitive rights and the respective payroll module permissions.

## Questions and mistakes

- **No requests appear:** check the employee's portal access, company access, request handler rights, and whether the correct status/type filter is selected.
- **Manager does not receive the task:** verify the manager link on Employee Master and the request type's approval configuration.
- **Reimbursement is approved but not paid:** check the assigned payroll month, its Earnings and Deductions entry, and whether that month's run has been calculated and posted.
- **Loan request is approved but not paid:** approval is not payout; prepare the loan payout or Interim Payroll payment using its own workflow.
- **Leave request and register disagree:** update or decide the leave in Leave Register; the case thread is not the authoritative leave record.
- **File or note is missing:** reopen the request and inspect its attachment list and history; do not recreate a duplicate request unless the employee must resubmit.

## Related pages

[Employee Master](employees.html) · [Payroll Setup](payroll-setup.html) · [Loans and Advances](payroll-loan.html) · [Leave](leave.html) · [Payroll Run](payroll-run.html)
