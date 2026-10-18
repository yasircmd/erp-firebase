---
title: Leave Reports
area: hr
order: 5
modules: [LEAVEREPORTS]
sources: [functions/src/hrLeaveReports.js, functions/src/hrLeave.js, functions/src/hrLeaveSetup.js, functions/src/workCalendar.js]
summary: Review leave balances, absences and managerial follow-up across the company or department.
reviewed: 2026-10-18
fingerprint: bb5e6c6699ba4f13
---
## What it is for

**Leave Reports** provides four different views for operational follow-up: leave balances as of a date, the approved leave register for a period, absence-only records, and a monthly calendar showing who is away.

The screen tabs are **Balances**, **Leave register**, **Absences**, and **Who is away**.

## Before you start

- Leave Types, employee grades, work schedules, and company calendars are configured.
- The user has Leave Reports access and company access to the data required.
- Choose the appropriate report view and its date/month before running it.

## Step by step

### Balance report

1. Choose an as-of date and run the balance report.
2. Review each employee and balance-bearing leave type. The columns separate opening balance, accrued, adjusted, taken, booked, and available days.
3. Compare the grade and service rules in HR Setup with the employee's history before requesting an adjustment.

### Leave register and absences

1. Select the register view and enter the period from/to dates; optionally filter by leave type.
2. Review the dates, days falling inside the selected period, unpaid days, absent days, return date, and supporting-document status.
3. Use the absences view to focus on unauthorized absence and late-return absence. It is a report view; correct the source record in Leave if details need changing.

### Who is away

Choose one company and a month. The calendar marks leave by type, distinguishes pending entries from approved leave, and shades weekends/holidays. Use the away-only option to reduce the list to employees with entries in that month, or show everyone for coverage planning. Copy the report where available for spreadsheet follow-up.

## What happens in the books

These are report views and do not post to the ledger or change leave records. Balances are calculated from opening balances, accruals, adjustments, and approved/booked leave. The register report includes approved records; the calendar also identifies pending leave.

## Rights

The Leave Reports **access** right is separate from Leave Register access, so a reports-only role can view reports without being allowed to enter, approve, or close leave. Company access still restricts the report population.

## Questions and mistakes

- **No balance row:** check that the employee was employed on the as-of date, the leave type uses a balance, and the selected company is within the user's access.
- **Balance is unexpected:** compare the as-of date, opening balance date, grade/service entitlement, adjustments, booked leave, and approved leave. A pending request reduces available balance as a booking.
- **Register differs from all leave records:** the period report includes approved leave with counted lines in that period; drafts and pending requests are not approved register entries.
- **Calendar is unavailable for multiple companies:** the calendar is run for one company at a time; select the company first.
- **A late return appears as absence:** verify the return date in the Leave Register; that screen owns the source entry.

## Related pages

[Leave](leave.html) · [HR Setup](hr-setup.html) · [Payroll Run](payroll-run.html)
