---
title: Employee Requests
area: hr
order: 13
modules: [EMPREQUESTS]
sources: [functions/src/employeeRequests.js, functions/src/requestTypes.js, functions/src/essPortal.js, functions/src/reimbursements.js, functions/src/payrollLoans.js]
summary: Manage employee queries, claims and requests from the portal or the ERP’s request workflows.
reviewed: 2026-10-26
fingerprint: 0828598efd9e5d4a
---
## What it is for

**Employee Requests** is the ERP-side work queue for requests submitted through Employee Self-Service. It brings employee queries and cases to the relevant handler, while claims and other request types continue through their own approval and payroll/accounting workflows.

Requests may include a question or case, reimbursement claim, loan/advance request, payroll query, or a leave request that is initiated and tracked through the portal. Besides these, HR can set up **request types** of its own (a salary certificate, IT support, a company car …), each with its own form; see [Request types](#request-types). This screen is for managing the request and its communication; it is not a substitute for the Payroll Loan, Leave, or payroll posting documents.

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

## Request types

The **Types** tab (it needs the setup right) lists the requests employees can raise from the portal's **Requests → Other**, besides payroll queries, loans and claims. For each type:

- **Name and description:** what the employee sees, e.g. *Salary certificate: for a bank or an embassy*. A name can't repeat a portal request of its own (Overtime, Loan …).
- **Fields:** the type's form, up to 20: short or long text, a number, a date, a choice (two options or more), yes/no, or files. Tick **Required** for the ones the employee must fill.
- **Goes to:** its **handler** directly, or the employee's **line manager first**, who approves or rejects it in the portal's Team; once approved, it goes on to the handler. An employee with no line manager goes straight to the handler. Each type is a category in the **Handlers** tab, by its name, so set who handles it there.
- **Answer within:** an optional number of days, counted from the day it reaches the handler. The request shows **Answer by** with the date, and after it **overdue**, in the list and on Home. It is a reminder, not a block.
- **The answer is a document:** for a certificate. The request can be resolved only once HR has attached the document under Supporting documents; the employee downloads it from the portal.
- **Companies:** none means every company; otherwise only the employees of the companies chosen see it.
- **Active:** untick to stop new requests of a type; the ones already raised carry on.

Requests of a type are numbered from one series, RQ-2026-0001 (see [Numbering](numbering.html)). They are handled like a query: reply, internal notes, files, **Resolve** with what was done, **Reject** with the reason, reassign. The employee can withdraw one, giving a reason, while it is open, and reopen it within 14 days of it being resolved.

### Example

HR sets up *Salary certificate*: fields *Addressed to* (required) and *Purpose* (a choice: Bank loan, Visa, Other), to the line manager first, answered within 3 days, the answer a document. An employee asks for one addressed to *Example Bank*; their manager approves it in Team; it reaches HR, due in 3 days. HR attaches the certificate and resolves it, and the employee downloads it from the request.

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
- **A type does not show in the portal:** check it is active and for the employee's company.
- **Resolve is refused for a certificate:** attach the document under Supporting documents first.
- **A request of a type is not on Home yet:** it is still with the line manager; it comes to the handler once approved.
- **File or note is missing:** reopen the request and inspect its attachment list and history; do not recreate a duplicate request unless the employee must resubmit.

## Related pages

[Employee Master](employees.html) · [Payroll Setup](payroll-setup.html) · [Loans and Advances](payroll-loan.html) · [Leave](leave.html) · [Payroll Run](payroll-run.html)
