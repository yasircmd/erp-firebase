---
title: Employee Master
area: hr
order: 2
modules: [EMPLOYEES]
sources: [functions/src/hrEmployees.js, functions/src/hrDocuments.js, functions/src/hrPay.js]
summary: Maintain the employee record used for payroll, leave, portal access and the employee approval flow.
reviewed: 2026-10-12
fingerprint: 6c5def8e16622b12
---
## What it is for

**Employee Master** is the employee's central record for identity, employment, organization, job, manager, payroll details, documents, compensation, and history. Payroll and Leave use this record to decide which employees and terms apply in a given period.

The employee number is generated using the system's employee numbering format. An ERP login and an employee record are separate records; link them only when the employee needs access to the portal or another employee-linked workflow.

## What the record contains

- Personal details, contact information, emergency contact, and configured HR custom fields.
- Employment details: company, joining and probation dates, employment type, status, and leaving date/reason.
- Organization and job: division, branch, cost center (the department for payroll costing), work location, grade, designation, manager, and work schedule.
- Bank details, IBAN, and WPS person/routing details where applicable.
- Employee documents, with document type, number or expiry where configured, files, renewal history, and removal reason.
- Compensation versions with effective dates, fixed pay elements, and agreed variable-pay terms.
- A history of creation and subsequent corrections or approved changes.

## Before you start

- The company has active grades, designations, organization units, custom fields, document types, and work schedules in [HR Setup](hr-setup.html).
- The new employee's company, joining date, job, cost center, manager, and employment details are confirmed.
- Pay elements and the grade's company pay band are configured before compensation is entered.
- Bank and WPS data are checked against the bank's requirements. Access to pay, bank details, and sensitive fields is restricted separately.

## Step by step

### Create an employee

1. Open **Employees**, choose **New**, and complete required identity, employment, job, and organization fields.
2. Choose an active grade and designation. If the designation has a usual grade range, an out-of-range choice is shown as a warning.
3. Assign the cost center and, if applicable, a line manager, work schedule, ERP user, and required custom fields.
4. Enter bank and sensitive information only with the appropriate **sensitive** right. Users without that right do not see protected values and cannot erase them by saving other fields.
5. Save and review the generated employee number and history entry.

### Maintain the record

After creation, ordinary personal and contact details can be maintained under employee write access. Company, grade, designation, division, branch, cost center, and work schedule are job/organization changes: process them through [Employee Change](employee-change.html) so the change has an effective date, approval, and history. HR Setup users may use **Correct** for a data-entry mistake, with a reason recorded in history; it is not the normal route for a promotion or transfer.

Use **Replace manager** to move all of a departing or reassigned manager's direct reports to another manager in one operation. Review the employee's direct reports before changing a manager's status to Left.

### Compensation and documents

Compensation is a dated version, not a single amount overwritten in place. Enter fixed monthly pay elements and agreed bonus or commission terms. Use a new effective-dated version for an initial entry or correction; later job/pay changes should follow the Employee Change workflow. The basic salary is checked against the company pay band.

Add documents under the employee's Documents section. Select a configured document type, enter its number/expiry when required, attach the file, and use renewal rather than replacing the old record when a document is renewed. Removal is recorded with a reason; it is not an untracked deletion.

## What happens in the books

Creating or updating an employee does not post to the general ledger. Employee cost center, compensation versions, bank details, work schedule, and employment dates are inputs used by payroll, leave calculations, approvals, and payment files.

## Rights

Employees access/write rights control ordinary records. The separate Employees **sensitive** right controls compensation, bank and WPS details, and sensitive custom fields. HR Setup write permits reasoned corrections to locked job/organization fields. Document access is controlled through employee access and the supporting-document workflow. Company access limits which employees a user can see.

## Questions and mistakes

- **Employee missing from a period:** check company, joining/leaving dates, and status for the period. Payroll includes an employee only for months overlapping employment.
- **Cannot change company, grade, or cost center:** create an Employee Change, or use Correct with a reason only when fixing a genuine entry error.
- **Pay band warning:** confirm the basic amount and the selected grade/company band; the system flags the exception for review.
- **Employee is missing from portal or approval routing:** confirm the ERP user is linked, the manager is assigned where needed, and portal access/role settings are enabled.
- **Manager cannot be changed to Left:** reassign direct reports first with Replace manager.
- **Sensitive field appears blank:** check the user's sensitive right; a user without it cannot see the saved value.
- **Document expiry is wrong:** check the document type's expiry setting and update the document record through renewal rather than overwriting its history.

## Related pages

[HR Setup](hr-setup.html) · [Employee Change](employee-change.html) · [Employee Requests](employee-requests.html) · [Payroll Run](payroll-run.html)
