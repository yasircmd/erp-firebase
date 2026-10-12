---
title: HR Setup
area: hr
order: 1
modules: [HRSETUP]
sources: [functions/src/hrSetup.js, functions/src/hrLeaveSetup.js, functions/src/workCalendar.js]
summary: Set the company HR defaults that drive employee configuration, leave rules and payroll controls.
reviewed: 2026-10-12
fingerprint: c3bc37996153efea
---
## What it is for

**HR Setup** contains the employee structure and leave rules used by Employee Master, Employee Changes, Leave, and Payroll. It is a collection of setup registers, not a general policy text box: each tab has its own records and feeds particular parts of the workflow.

## Tabs at a glance

HR Setup has seven tabs: **Grades**, **Designations**, **Employee Fields**, **Document Types**, **Leave Types**, **Working Calendar**, and **Work Schedules**. Each tab maintains a separate setup register; the sections below explain what belongs in each one.

### Grades

Create one ordered grade ladder for the group. Each grade has a unique code, name, seniority level, and may have a minimum, midpoint, and maximum monthly basic salary for each company. The midpoint is a reference; payroll checks the employee's basic against the applicable minimum and maximum and reports a warning when it is outside the band.

### Designations

Add job titles and, where useful, the grade range normally associated with each title. The range is a guide: an employee can be outside it, but the system warns HR rather than treating the range as a hard prohibition.

### Employee Fields

Use Employee Fields for company-specific information not already on the standard form. Each field is Date, Text, or Amount; can be compulsory or optional; belongs to Personal, Employment, or Other; and can be marked sensitive. If a custom field has values on employee records, its type cannot be changed; create a replacement field instead.

### Document Types

Document Types control whether an employee document needs a document number or expiry date. Common types are provided to start; HR can add company-specific types and retire types no longer used.

### Work Schedules

Create named schedules with their weekend days and hours per working day. Schedules support different patterns, such as a Friday-only weekend. An employee's schedule is assigned on the employee record and can be changed through an approved Employee Change from an effective date. Do not change the weekend on a schedule already used by employees; create a new schedule and transfer employees to it so leave day calculations retain their history.

### Leave Types

Leave Types define whether a type is Leave or Duty, whether it uses a balance, whether dates count as working or calendar days, and rules such as half days, gender, probation, annual or per-instance limits, supporting-document thresholds, and HR-confirmed returns.

For balance-bearing leave, configure entitlement rows by grade level and completed years of service, the carry-forward cap, and pay-rule rows by grade level and day number. Pay may be full salary, basic only, selected fixed earnings, a percentage, or unpaid. Cover every applicable grade and day/service range: the setup displays gaps, and the Leave Register refuses a request when no applicable rule exists.

### Working Calendar

The Working Calendar is separate for each company. It contains weekend days and public-holiday date ranges. The employee's work schedule determines their weekend; company holidays still apply to them.

## Before you start

- The company, legal entity and departments are already set up.
- HR and Finance have agreed the grade ladder, salary bands, leave entitlement, leave pay, and working patterns.
- Pay elements exist before leave pay rules use selected elements.
- Company calendars and any different employee work schedules are known.

Treat changes as policy changes: validate the rules against representative employee cases before making them active for operational use.

## Step by step

1. Build the grade ladder first; set pay bands for every relevant company.
2. Add designations and their normal grade ranges.
3. Define employee fields and document types before entering employees, especially any compulsory or sensitive fields.
4. Create work schedules and confirm the company weekend and hours per day.
5. Configure Leave Types. Save a new type first, then add its pay rules and, if it uses a balance, entitlements and carry-forward cap.
6. Review the warning panel for uncovered grade levels or day/service ranges and close every gap.
7. Set each company's Working Calendar, including weekend and holiday ranges. Copying a previous year's holidays is a starting point; verify the new year's dates.
8. Test using employees at different grades and service lengths, including a leave request that crosses a pay-rule band and a working-calendar holiday.

## What happens in the books

HR Setup does not post to the general ledger. Grades, designations, custom fields, document types, work schedules, leave rules, and calendars supply data and rules used by employee records, leave calculations, reporting, and payroll.

## Rights

Users with HR Setup access can view setup; the HR Setup **write** right is needed to change it. Employees access can also permit reading setup data needed by the employee screen. Keep write access with the HR owners of these policies.

## Questions and mistakes

- **Grade or designation unavailable:** check that the setup record is active and that the employee's company can use it.
- **Pay band warning:** compare basic salary with that company's band; the warning is a review prompt, not an automatic salary change.
- **No leave entitlement or pay rule:** inspect the displayed grade/service/day gaps and add a non-overlapping row that covers the employee.
- **Leave days differ from expectation:** check the leave type's Working or Calendar setting, the employee's schedule, company holidays, and half-day settings.
- **A used schedule's weekend needs changing:** add another schedule and use Employee Change with an effective date; editing the used weekend would change day-count behavior.
- **A custom field type needs correction:** if any employee already has a value, the field type is locked. Add a new field and migrate the data deliberately.

## Related pages

[Employee Master](employees.html) · [Employee Change](employee-change.html) · [Leave](leave.html) · [Payroll Setup](payroll-setup.html)
