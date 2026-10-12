---
title: Employee Master
area: hr
order: 2
modules: [EMPLOYEES]
sources: [functions/src/hrEmployees.js]
summary: Maintain the employee record used for payroll, leave, portal access and the employee approval flow.
reviewed: 2026-10-12
fingerprint: cf518f76761edd4f
---
## What it is for

**Employee Master** stores the person record used by payroll, leave, employee requests and self-service access. It is the central record for the employee’s role, site, manager and payroll setup.

## Before you start

- The role and company assignment are known.
- The employee’s payroll and bank details are ready for entry.
- If the portal is enabled, the employee should have a linked ERP user.

## Step by step

1. Open **Employees** and select the company.
2. Add or update the employee’s identity, role, department and payroll details.
3. Add the employee’s line manager and portal access, if required.
4. Save the record and test its use in leave or payroll screens.

## What happens in the books

The employee master itself does not post to the general ledger. It supplies the assignment and data used in payroll, leave and employee controls.

## Rights

Usually limited to HR and admin users with employee-maintenance access.

## Questions and mistakes

- If the employee is absent from payroll or leave screens, check the active company and role status.
- If the portal is not working, verify that the ERP user and employee record are linked correctly.
