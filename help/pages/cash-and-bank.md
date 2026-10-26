---
title: Cash and Bank Transactions (CBT)
area: finance
order: 5
modules: [CBT]
sources: [functions/src/journal.js, functions/src/partyLedger.js]
summary: Payments, receipts and transfers through cash and bank accounts, with vendor and customer allocation.
reviewed: 2026-10-26
fingerprint: 4500a5d272729d19
---
## What it is for

Records every movement through a cash or bank account:

| Type | Use it for |
|---|---|
| Bank Payment / Cash Payment | Paying a vendor, an expense, an advance |
| Bank Receipt / Cash Receipt | Money received from a customer or anyone else |
| Fund Transfer | Moving money between your own cash and bank accounts |

## Before you start

- Your cash and bank accounts: the accounts under a group marked **Cash**
  or **Bank** in the [Chart of Accounts](chart-of-accounts.html) (110000
  Cash / Petty Cash and 120000 Bank Accounts come marked).
- Vendors and customers set up with their payables / receivables account.

## Step by step

1. Open **Cash and Bank Transactions** and select **New Transaction**.
2. Choose the **Transaction Type**, then the **Company**.
3. Choose the **Ledger Account**: the cash or bank account the money moves
   through (for a Fund Transfer, the account it moves *from*).
4. Fill the date, description and reference.
5. Add the other side, one line per account: who it was **Paid To**,
   **Received From**, or for a transfer the account it goes **To**; the
   **Amount**, a description, and a cost center where the account needs
   one.
6. For a vendor or customer, pick the **Vendor / Customer** and
   **Allocate** the amount to their bills (see
   [Paying and allocating](payments-and-allocation.html)).
7. **Save as Draft**, or post. Where an approval applies to that
   transaction type, it goes for approval instead.
8. **Print** gives the payment or receipt voucher.

### A vendor or customer in a foreign currency

For a party invoiced in a foreign currency (say USD), the line shows a
**USD amount** beside the **Amount**: enter both, what the bank moved in
the default currency and what it is in USD. The allocation is in USD. If
the bills were at another rate, the ERP adds the **exchange difference**
lines itself: one on the party's account and one on the company's
Exchange Gain / Loss account ([Currency Configuration](currencies.html)).

### A bank account in a foreign currency

If the **Ledger Account** is in a foreign currency (its Currency in the
[Chart of Accounts](chart-of-accounts.html), say USD), the screen shows
**Currency and rate**: the rate on the date, which you may change with a
reason. Enter the amounts in USD; the books take them in the default
currency at that rate. A vendor or customer paid from it must be in USD
too (or in no currency of its own for lines without a party).

A **Fund Transfer** from a default-currency account into a USD account
asks for the **USD amount** the account receives: the rate is what the two
amounts make. A transfer between two different foreign currencies goes
through a default-currency account for now.

### Cash from a sales rep

A sales rep's cash (their receipts from the Employee Portal, see
[Sales reps](sales-rep-portal.html)) waits on the company's **Rep Cash
Clearing** account, against the rep. To take it: a **Cash Receipt** into
the cash account, a line on the Rep Cash Clearing account, then choose the
**Sales rep** (shown as *Sales rep — AK Ahmed Khan*) and **Allocate** the
amount to the rep's receipts (RC-AK-000001 …). The rep's balance in the
portal drops by itself, and each receipt shows *Handed over*. A short
count is simply a smaller amount: what is left stays on the rep.

### Correcting a posted transaction

Select **Reverse Entry** and choose the date: a mirror entry is posted and
any bills it settled become unpaid again. Then enter it correctly.


From an invoice's **Linked documents**, **Create next** opens a new one here already started for the invoice's open amount. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## What happens in the books

- **Payment:** Dr each line's account (e.g. the vendor's payables), Cr the
  cash or bank account.
- **Receipt:** Dr the cash or bank account, Cr each line's account (e.g.
  the customer's receivables).
- **Fund Transfer:** Dr the account it goes to, Cr the account it comes
  from.

The entry gets a **Voucher No.** per type and company, and a **Txn Ref**.

## Rights

As Journal Entries: view, draft and post are separate rights. Approval
can be set per transaction type (Approval Configuration).

## Questions and mistakes

- **"…is closed for …"**: the date is in a closed month
  ([Period Closing](period-closing.html)).
- **The allocation doesn't fit**: a bill was paid by someone else in the
  meantime; the ERP checks again when posting. Open Allocate and choose
  again.
- **A posted payment settles the wrong bill**: open it and select
  **Re-match references** (the **rematch** right): choose the right bill
  without reversing the payment
  ([Paying and allocating](payments-and-allocation.html)).
- **"… is invoiced in USD: enter the line's USD amount beside its
  amount"**: fill the USD amount on that line.
- **A line marked in red** needs a cost center, profit center or project:
  its account requires it. The **Project** column shows once the company
  has a project.
- **A draft made by "Portal: …"** is a sales rep's cash collection from
  the Employee Portal ([Sales reps](sales-rep-portal.html)): check it and
  post it.
- **Post-dated cheques** are not entered here: use
  [Post-dated Cheques](post-dated-cheques.html).
