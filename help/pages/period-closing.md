---
title: Period Closing (month-end and year-end)
area: finance
order: 14
modules: [PERIODCLOSE]
sources: [functions/src/periodClosing.js, functions/src/periodLock.js]
summary: Check and close each month so nothing more can be posted into it, and close the financial year into Retained Earnings.
reviewed: 2026-10-18
fingerprint: 955e8a908ffa853f
---
## What it is for

Closing a month locks it: nothing can be posted, reversed or approved with
a date in it, so reported figures stay as reported. Closing the year moves
its profit or loss into Retained Earnings.

## Before you start

On the **Setup** tab, per company:

- the **Financial year**: January – December or April – March (fixed after
  the first year-end);
- the **Retained Earnings account**;
- the **checklist**: each item set to **Block** (the month can't close
  while it finds something), **Warn** (listed, but the month can still
  close) or **Off** (not checked).

| Checklist item |
|---|
| Drafts dated in the period, not posted |
| Documents waiting for approval |
| Recurring journals due and not posted |
| Depreciation not run for the month |
| Payroll for the month not posted |
| Post-dated cheques matured and not cleared |
| Deliveries posted, not invoiced |
| Customer Aging agrees with the receivables accounts |
| Vendor Aging agrees with the payables accounts |
| Stock value agrees with the inventory accounts |
| The Trial Balance balances |

Two lists of your own, also each Block, Warn or Off:

- **Accounts that must be zero at month end**: clearing and suspense
  accounts, such as a GRN clearing or payroll clearing account. A balance on
  the account at the month's end is a finding, with the amount.
- **Steps to tick before closing**: your own steps, such as "Bank
  reconciliation done" or "Petty cash counted". Until the step is ticked
  for the month, it is a finding.

## Step by step

### Close a month

1. Open **Period Closing**, choose the **Company**; the **Months** grid
   shows the year.
2. On the first open month, run the **Checklist**: each item shows what
   it found, with the documents.
3. Tick the steps you have done. Anyone who can close months can tick
   them; the **Log** keeps who ticked and when, and the closed month keeps
   its ticked steps. If the month is reopened, its steps are ticked again
   before it closes again.
4. Fix what blocks, then select **Close**. Months close in order.

### Reopen a month

Select **Reopen** on it and give the reason. The months after it reopen
too; the ones before stay closed. Every close and reopen is in the
**Log**.

### Close the year

When all twelve months are closed (and the previous year is closed),
select **Close the year**. After you confirm, a **Year-End Closing**
entry (YEC-…) dated on the last day of the year moves every income, cost
of sales and expense balance, by account and cost center, to Retained
Earnings. **Reopen the year** (with a reason) reverses that entry; a
month of a closed year can't be reopened until its year is.

## What happens in the books

Closing a month posts nothing. Closing the year posts the Year-End Closing
entry. The [P&L](financial-statements.html) leaves it out; the
[Trial Balance](trial-balance.html) can show the year before it.

## Payroll and depreciation in a closed month

Reversing or redoing a payroll run, a settlement, a loan or depreciation
of a closed month offers to date it in **the first open month** instead;
the entry records the original date.

## Rights

Viewing and the checklist: Period Closing access. Closing and reopening
are separate rights (by default Admin and Finance Manager).

## Questions and mistakes

- **"yyyy-mm is closed for …"** on any screen: the document's date is in a
  closed month. Use an open month's date, or reopen the month here.
- **Can't close**: a blocking checklist item found something; open it to
  see the documents.
