---
fingerprint: 4e02c5c9a41ee920
reviewed: 2026-11-13
title: Audit Log
area: admin
order: 7.5
modules: [AUDITLOG]
sources: [functions/src/auditLog.js, functions/src/audit.js, functions/src/auditWrites.js, screens/AUDITLOG.html]
summary: See who changed what and when: saves, postings, approvals, changes to masters and settings, sign-ins, and refused attempts.
---
## What it is for

The **Audit Log** answers "who did this, and when?". Every change made in
the ERP is recorded as it happens. Nobody can change or delete an entry, not
even an Admin. Entries are kept for 7 years.

It records:

- **Actions on documents:** each save, submit, approval or rejection, post,
  reverse, cancel and delete, with the document's number. A document's
  creation and each change of its status (for example Draft → Posted) are
  recorded too, with its total.
- **Changes to masters and settings:** items, vendors, customers, the chart
  of accounts, companies, users, roles and rights, the menu, employees, the
  HR, payroll, tax and credit setups, and the other setups. Each entry lists
  the fields that changed, before and after.
- **Sign-ins and sign-outs:** to the ERP and to the Employee Portal,
  including a sign-out by the idle timeout.
- **Refusals:** an attempt to do something the user has no right to, or
  that goes over a limit, is recorded as *refused*, with the reason. A
  mistyped entry that the screen rejects is not.
- **Your provider's changes:** if your provider changes your modules or
  limits, or sets something up for you, it shows here as *The provider*.

Opening a screen or a report is not recorded.

## Before you start

- You need the Audit Log's access right. Only Admin has it unless you give
  it to another role in Roles & Permissions.
- The log starts on the day it was switched on. Changes made before then
  are not in it.

## Step by step

1. Open **Audit Log**. The newest entries are shown first.
2. Narrow the list by **User**, **Module**, **Action**, **Record** (a
   document number, such as JV-26-000123, or a record's ID) and the
   **From** and **To** dates, then select **Show**. Up to 500 entries are
   shown at a time. If there are more, narrow the dates or the filters.
3. Select **Open** on an entry to see its details and each changed field,
   before and after.
4. Select **Copy to Excel** to copy the entries shown, one row per changed
   field, and paste them into a spreadsheet.

## Sensitive fields

Salaries and pay, bank account numbers and IBANs, passwords and tokens show
only that they *changed*, never their values. The log never becomes a copy
of anyone's pay or bank details.

## What happens in the books

Nothing. The Audit Log only reads.

## Rights

**AUDITLOG access** opens the screen. It shows everything every user did,
so give it only to people who may see that. Every company has the Audit
Log; your provider cannot switch it off.

## Questions and mistakes

- **An entry says "System":** a scheduled task made the change, not a
  person.
- **An entry says "(n records)":** one action changed many records at
  once (an import, or a whole list set up in one go). The entry lists the
  first of them.
- **Something done long ago is missing:** entries older than 7 years are
  removed, and nothing before the log was switched on is in it.
- **The log is empty after a Data Reset:** Data Reset's *Audit Log*
  category clears it. The reset itself is then the log's first entry.

## Related pages

[Roles & Permissions](roles.html) · [User Management](user-management.html) · [Data Reset](data-reset.html) · [Approval Tracker](approval-tracker.html)
