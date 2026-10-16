---
title: Employee Change / Update
area: hr
order: 3
modules: [EMPCHANGE]
sources: [functions/src/hrChanges.js, functions/src/hrPay.js]
summary: Record changes to an employee’s status, pay, roles or department while keeping the payroll and approvals aligned.
reviewed: 2026-10-16
fingerprint: d320bd2803e0f964
---
## What it is for

**Employee Change** is the controlled, effective-dated workflow for a promotion, increment, or transfer. It preserves the before-and-after values, change reason, approval decisions, and the date the new job or pay takes effect.

Use it for a real employment change, not to correct a typo. A one-off data-entry correction is made from Employee Master with **Correct** and a reason; that action is restricted to HR Setup writers and remains in the employee history.

## Before you start

- The employee exists and is not marked Left.
- The new grade, designation, organization assignment, schedule, and/or compensation are approved in principle.
- The effective date and written reason are known.
- HR has configured the grades, designation ranges, pay bands, work schedules, and pay elements in [HR Setup](hr-setup.html) and [Payroll Setup](payroll-setup.html).
- Approval Configuration for Employee Changes is ready if the company requires approvals.

## Step by step

1. Open Employee Changes from the employee record or the Employee Change module and choose the employee.
2. Select the document type:
	- **Promotion** changes grade or designation; pay may also change. A grade promotion must move to a higher level.
	- **Increment** changes pay while keeping job and organization unchanged.
	- **Transfer** changes company, division, branch, cost center, **cost split** or work schedule while keeping grade and designation unchanged.
	- **Cost split** (optional): share the employee's cost across cost centers by %, for example Workshop 60% and Office 40%. Add a share for each cost center; the shares add up to 100% and include the cost center above (the main one, the department). Once approved, every payroll expense line of the employee (salary, provisions, final settlement, interim payments) is shared the same way. Approvals and reports still use the main cost center.
3. Enter the effective date and reason. For compensation, enter the new fixed pay-element amounts and terms. A percentage raise can be applied to the basic; review the calculated monthly increase.
4. Review the validation warnings, including designation grade-range and company pay-band warnings. Check the “before” and “after” summary carefully, especially for a company transfer.
5. Save as a draft, then submit. The configured approvers act in order; a rejected change can be corrected and resubmitted.
6. After approval, verify the employee's current job and compensation history. A future-dated job/organization change is applied when its effective date arrives; a future schedule is recorded from that date so leave uses the right working days.

## What happens in the books

The change document does not post a journal. An approved pay change creates a new compensation version effective from its date; payroll uses the version in force for each month and can calculate arrears when a change is approved after its effective month was already posted. Approved job and organization changes update the employee record on the effective date. The Employee Change number and history remain available for audit.

## Rights

Employee Changes access is needed to view documents. Its **draft** right prepares and submits them; approvers are assigned through Approval Configuration. Pay details are visible to users with the Employees **sensitive** right and to the change's approvers. Company access still applies.

## Questions and mistakes

- **A second change cannot be opened:** only one Draft, Pending Approval, or Rejected change may be open for an employee. Finish, delete, or resolve it first.
- **Promotion refused:** it must change grade or designation; a grade change must move to a higher level.
- **Increment refused:** it must change compensation only. Use Promotion or Transfer for job/organization changes.
- **Transfer refused:** it must change company, division, branch, cost center, cost split, or schedule, without changing grade/designation.
- **Cost split refused:** the shares must add up to 100%, have at least two cost centers of the company, and include the main cost center.
- **Pay date refused:** a new pay version cannot begin on or before the latest pay version's start date.
- **Approved change not visible yet:** check its effective date. Future-dated job/organization changes do not take effect early.
- **Pay values are hidden:** grant the sensitive right only to people who need access; approvers can see the pay on the document they must decide.

## Related pages

[Employee Master](employees.html) · [HR Setup](hr-setup.html) · [Payroll Run](payroll-run.html) · [Approvals](approvals.html)
