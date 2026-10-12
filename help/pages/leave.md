---
title: Leave
area: hr
order: 4
modules: [LEAVE]
sources: [functions/src/hrLeave.js, functions/src/hrLeaveSetup.js, functions/src/hrLeaveClose.js, functions/src/workCalendar.js]
summary: Register and approve leave so balances, attendance and payroll deductions remain accurate.
reviewed: 2026-10-12
fingerprint: 3bcb4789cb2977a5
---
## What it is for

**Leave** is the employee leave register. It calculates the days, applicable pay treatment, balance effect, document requirement, and expected return for each entry; after approval, these day-level records feed the monthly leave close and payroll.

## Before you start

- Employee, grade, work schedule, and company assignment are current.
- HR Setup has complete Leave Type, entitlement, pay-rule, and Working Calendar configuration.
- Approval Configuration is set up if approval is required. Portal requests also need employee/manager links and portal access.
- The dates, reason, and any required supporting document are available.

## Step by step

### Enter and review leave

1. Open Leave, or start from the employee's leave card. Select the employee and leave type.
2. Enter the first and last dates, and mark a half day at either end if the type allows it. Enter the reason and attach any supporting file.
3. Review the live preview before saving. It shows counted days, pay treatment by day band, balance before/after, and any portion beyond an available balance that will be unpaid.
4. Save the document. Submit it for approval; if no approval is configured, submission approves it immediately. A portal leave request first goes to the line manager and then follows the configured approval flow.
5. The approver checks the dates, balance, pay breakdown, reason, and any document flag, then approves or rejects with a reason.

### Record the return or adjustment

For a leave type that requires HR to confirm return, record the actual return date when the employee comes back. An early return removes the unused future days from the leave and restores the balance. If the employee returns late, record the return; the extra working days are recorded as unpaid absence.

Use the employee leave card to make a balance adjustment only for a documented correction, such as a verified opening balance or earned entitlement correction. Include the reason; an adjustment is not a substitute for entering the leave itself.

### Month and year close

At month end, review the leave summary and resolve Draft or pending leave dated up to the close date. Lock months in order. The lock records the summary and monthly accruals used by payroll. Reopen only the latest locked month, with a reason, and only while its payroll run is still Draft. At year end, review the preview of balances, carry-forward caps, and lapses before confirming the leave-year close.

## What happens in the books

Leave entry, approval, return, and balance adjustment do not directly post a GL journal. The approved day lines affect available balances and monthly payroll: paid leave may reduce selected pay elements or apply a percentage; unpaid leave, absence, and partial leave affect salary deductions. Monthly leave close locks the rows payroll will use. If a closed month's leave is entered later, its pay effect is assigned to a later open month as an adjustment.

## Rights

The Leave module's access right controls visibility; **draft** allows entry; **post** allows submit/cancel/close actions; **lock** controls month and year close; **reopen** controls reopening a locked month. Approval decisions are limited to the configured approvers. Employees and line managers use their portal workflow where enabled. Company access is enforced.

## Questions and mistakes

- **Working-day leave starts or ends on a day off:** use the employee's schedule and company holiday calendar; working-day leave must start and finish on counted working days.
- **No leave pay rule:** add a non-overlapping HR Setup rule covering the employee's grade and the leave-day band.
- **Leave exceeds the available balance:** the excess is split off as unpaid; verify the opening balance, accrued days, adjustments, previous approved/pending bookings, and carry-forward.
- **Supporting document expected:** attach it or let the approver explicitly accept the leave without it. A missing document is recorded for reporting.
- **Leave is blocked by overlap:** review the employee's existing draft, pending, or approved leave across the date range.
- **Month cannot be locked:** settle or delete leave still in Draft or pending for dates up to the applicable close date, and lock months in sequence.
- **Month cannot be reopened:** only the latest locked month can be reopened, and not after its payroll has left Draft or December's leave year has closed.

## Related pages

[HR Setup](hr-setup.html) · [Leave Reports](leave-reports.html) · [Payroll Run](payroll-run.html) · [Employee Requests](employee-requests.html)
