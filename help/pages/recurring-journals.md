---
title: Recurring Journal Entries
area: finance
order: 7
modules: [RECURRINGJV]
sources: [functions/src/recurringJournal.js, functions/src/recurringSchedule.js]
summary: Entries that repeat on a schedule — rent, depreciation-like accruals, prepaid expenses spread over months.
reviewed: 2026-10-16
fingerprint: e352c918d51c18bc
---
## What it is for

A recurring entry is a template that posts the same journal on a schedule:
monthly rent accrual, a prepaid insurance spread over twelve months, a
monthly provision. Each run becomes a normal journal entry dated on its
run date.

## Before you start

The accounts exist, as for a [Journal Entry](journal-entries.html).

## Step by step

1. Open **Recurring Journal Entries** and select **New Recurring Entry**.
2. Fill the header and lines as on a JV. The description may include
   `{MONTH}`, `{DATE}` or `{YEAR}` (for example "Rent {MONTH}" posts "Rent
   Oct-2026").
3. Choose the **Amounts**:
   - **Fixed**: the lines' amounts on every run;
   - **Spread a total**: a total shared equally over the runs;
   - **Spread by service period**: a total over a service period (from,
     to), each month charged for its days; for example 12,000 for 16 Sep
     – 15 Sep gives 500, then 1,000 a month, then 500.
4. Choose the **Schedule**: monthly on a day (a day past the month's end
   runs on its last day), monthly at month end, weekly on a weekday, or
   monthly on the first … last weekday; **every** 1, 2, 3… months or
   weeks (3 = quarterly, 12 = yearly).
5. Choose when it **Ends**: on an end date, or after a number of runs.
6. Check the preview: every run date with its amount.
7. **Save**, then activate it (with approval, where set up).

### Posting the runs

Runs are posted by a person, not automatically. When a run's date comes,
**Recurring Journal Entries Due to Post** appears in Home tasks. Select
**Post Due Runs** (on the list for all, or on one entry). Missed past
dates are posted each with its own date.

### Run by run

On an entry's run list:
- **Skip** a date (no posting that month);
- **Reverse** a posted run (a mirror entry; then **Post again** or
  **Skip**);
- a run that failed (an account made inactive, a closed month…) shows the
  reason; fix it and post again.

### Changing an active entry

**Pause**, edit, then resume (it goes through approval again where set
up). **End** stops it for good.

## What happens in the books

Each run posts a journal entry (numbered RJV-…) dated on its run date,
seen in the General Ledger like any JV. Reverse runs from this screen,
not from the JV screen.

## Rights

As Journal Entries; activating, pausing, ending, skipping and reversing
need the post right.
