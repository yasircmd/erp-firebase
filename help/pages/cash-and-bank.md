---
title: Cash and Bank Transactions (CBT)
area: finance
order: 5
modules: [CBT]
sources: [functions/src/journal.js, functions/src/partyLedger.js]
summary: Payments, receipts and transfers through cash and bank accounts, with vendor and customer allocation.
reviewed: 2026-10-12
fingerprint: 727c9f2af725cc4d
---
## What it is for

Records every movement through a cash or bank account:

| Type | Use it for |
|---|---|
| Bank Payment / Cash Payment | Paying a vendor, an expense, an advance |
| Bank Receipt / Cash Receipt | Money received from a customer or anyone else |
| Fund Transfer | Moving money between your own cash and bank accounts |

## Before you start

- Your cash accounts (codes starting 10) and bank accounts (codes starting
  11) in the [Chart of Accounts](chart-of-accounts.html).
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

### Correcting a posted transaction

Select **Reverse Entry** and choose the date: a mirror entry is posted and
any bills it settled become unpaid again. Then enter it correctly.

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
- **Post-dated cheques** are not entered here: use
  [Post-dated Cheques](post-dated-cheques.html).
