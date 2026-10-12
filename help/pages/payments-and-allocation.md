---
title: Paying and allocating against bills
area: finance
order: 6
summary: How payments, receipts and adjustments are tied to a vendor or customer and matched to their invoices.
sources: [functions/src/partyLedger.js]
reviewed: 2026-10-12
fingerprint: acc1a800a6e854d8
---
## Why it matters

Each vendor and customer has its own account (payables or receivables).
To know what is still owed **per invoice** — for statements, aging and
due dates — every amount on those accounts names its party and says what
it settles.

## The two kinds of allocation

| Kind | Meaning | Example |
|---|---|---|
| **Against Ref** | Settles bills or invoices already posted (or an earlier advance) | Paying invoice VI-1021 in full and VI-1034 in part |
| **New Ref** | Opens a new item for the party | An advance paid before any bill exists |

A line's allocations add up to its amount. A line with no allocation
chosen is kept as a New Ref for its full amount.

## Step by step: a payment against bills

1. In [Cash and Bank Transactions](cash-and-bank.html) (Bank Payment),
   add a line on the vendor's payables account and choose the
   **Vendor / Customer**.
2. Select **Allocate**. The vendor's open items show with their date, due
   date and **Outstanding** amount.
3. Enter the amount against each bill, or select **Oldest first** to fill
   from the oldest. **Clear** starts again; **Done** keeps it.
4. Post. The bills show as Paid or Partly paid in the invoice lists.

## Settling an advance against a bill

Use a [Journal Entry](journal-entries.html) with two lines on the vendor's
account: one Against the bill, one Against the advance, same amount on
opposite sides.

## Discounts and write-offs

A JV: the party line Against the invoice, and the discount or write-off
amount on the expense or income account on the other line.

## Good to know

- A party line may only use **that party's own** payables or receivables
  account.
- When posting, the ERP checks again that each bill still has enough
  outstanding; if someone else paid it meanwhile, the post is refused with
  the reason.
- An invoice can't be reversed while payments are allocated to it:
  reverse those payments first.
- Due dates are the invoice date plus the party's payment terms.
