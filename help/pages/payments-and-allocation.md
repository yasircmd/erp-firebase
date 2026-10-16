---
title: Paying and allocating against bills
area: finance
order: 6
summary: How payments, receipts and adjustments are tied to a vendor or customer and matched to their invoices.
sources: [functions/src/partyLedger.js]
reviewed: 2026-10-16
fingerprint: 05103bd9c29be626
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

## Fixing a wrong pick: Re-match

A posted payment or receipt that settles the wrong bill (or should have
left part as an advance) doesn't need to be reversed. Open the posted
entry in [Cash and Bank Transactions](cash-and-bank.html) or
[Journal Entries](journal-entries.html) and select **Re-match
references**:

1. **Allocate…** on the vendor or customer line shows the party's open
   items, counting this entry's own allocation back in, so the bill it
   settled now shows its full outstanding again.
2. Choose again (for example **Clear**, then the right bill), and select
   **Done**.
3. Select **Save re-match** and give the reason.

Only which items the entry settles changes: its amounts, accounts and date
stay, so the books don't change. The bills' outstanding, the statements
and the aging follow at once. It works in a closed month too, because
nothing is posted. Each re-match is kept with the entry (who, when, the
reason, and what it settled before and after). **Cancel re-match** leaves
the entry as it was.

- Re-match has its own right, **rematch**, on Journal Entries and on Cash
  and Bank (Roles & Permissions).
- An advance (New Ref) that another entry has already set against a bill
  can't become smaller than what that entry uses; re-match that entry
  first.
- Entries posted by other modules (post-dated cheques, returns, retail
  sales, opening balances) keep their matching in their own module.

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
- For a party in a **foreign currency**, bills, payments and allocations
  are all in its currency. A bill is settled when its foreign amount is;
  any difference in the default currency is posted as an exchange gain or
  loss ([Cash and Bank](cash-and-bank.html)). For now foreign-currency
  allocation is entered in Cash and Bank; journals, PDCs and opening
  balances in a foreign currency come next.
