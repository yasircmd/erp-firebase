---
title: Journal Entries (JV)
area: finance
order: 4
modules: [JV]
sources: [functions/src/journal.js, functions/src/partyLedger.js]
summary: Record any accounting entry by debits and credits: accruals, corrections, reclassifications, write-offs.
reviewed: 2026-10-14
fingerprint: c474877d4ebf695c
---
## What it is for

A Journal Voucher (JV) records an entry directly in the accounts: debit
and credit lines that must balance. Use it for anything no other screen
records: accruals and provisions, corrections, reclassifications,
discounts and write-offs, settling an advance against a bill.

For money in or out of a cash or bank account, use
[Cash and Bank Transactions](cash-and-bank.html) instead.

## Before you start

- The accounts exist and are postable (see
  [Chart of Accounts](chart-of-accounts.html)).
- Expense, revenue and cost-of-sales lines need a **cost center**.

## Step by step

1. Open **Journal Entry Processing (JV)** and select **New Journal Entry**.
2. Fill the header: **Company**, **Entry Date**, **Description**, and if
   used the **Reference**, **Division**, **Branch**, **Cost Center** and
   **Profit Center** (the header's cost and profit centers are the lines'
   defaults).
3. Add the lines: **Account Code**, **Debit** or **Credit**, description,
   and the cost or profit center where needed. You can paste lines from
   Excel into the grid.
4. A line on a vendor's or customer's account needs the **Vendor /
   Customer**, and its **Allocate** (see
   [Paying and allocating](payments-and-allocation.html)).
5. Check that total debits equal total credits.
6. **Save as Draft** to finish later, or **Post Entry**. Where an approval
   is set up, the entry goes for approval instead (see
   [Approvals](approvals.html)).

### Correcting a posted entry

A posted entry can't be edited. Select **Reverse Entry**, choose the
reversal date (in an open month): a mirror entry is posted and the
original stays on record. Then enter the right one. The description of a
posted entry can still be corrected with the edit button next to it.

Entries posted by other screens (invoices, cheques, payroll, opening
balances…) are reversed from their own screen; the JV screen refuses them
and says where.

## What happens in the books

When posted, each line is recorded on its account and date, and the entry
gets its numbers: the **JV number** (per company and year) and the **Txn
Ref** (the finance reference, shared with other finance documents). It
shows in the [General Ledger](general-ledger.html),
[Trial Balance](trial-balance.html) and the statements.

## Rights

Viewing, drafting and posting are separate rights (Roles & Permissions).
Approval, where set up, is by the approvers in Approval Configuration.

## Questions and mistakes

- **"…is closed for …"**: the entry date is in a closed month. Use a date
  in an open month, or ask for the month to be reopened
  ([Period Closing](period-closing.html)).
- **A cost center is required**: expense, revenue and cost-of-sales lines
  need one.
- **A party is required**: a line on a vendor's payables or customer's
  receivables account must name that party, and only that party's own
  account may be used.
