---
title: Statements of Account (Vendor and Customer)
area: finance
order: 9
modules: [VENDORSOA, CUSTOMERSOA]
sources: [functions/src/partyStatement.js]
summary: Everything posted with one vendor or customer over a period, the running balance, what is still open, and pending cheques.
reviewed: 2026-10-26
fingerprint: 9c455198688a3b85
---
## What it is for

A statement of account (SOA) shows one vendor's or customer's history for
a period: opening balance, every invoice, payment, receipt, note and
adjustment with a running balance, the closing balance, and what is still
open by document.

## Step by step

1. Open **Vendor Statement of Account** or **Customer Statement of
   Account**.
2. Choose the **Company** and the vendor or customer.
3. Choose **From** and **To**, and select **Run**.
4. Read it:
   - the rows with debit, credit and balance;
   - **open items**: each unpaid document with its due date, days overdue
     and outstanding amount, and the aging of what is open;
   - **pending PDCs**: cheques not yet cleared at the end date;
   - a check against the party's account in the General Ledger.
5. Select a document number to open it (Back returns to the statement).
6. **Print** for the party, or **CSV** to open it in Excel.

## Good to know

- The open items always add up to the closing balance, because every
  amount on a party's account is allocated (see
  [Paying and allocating](payments-and-allocation.html)).
- The print leaves out the internal GL check.
- For a party in a **foreign currency** the statement is in its currency
  (it says so under the payment terms), with a **Balance** column in the
  default currency beside it. The open items show each document's rate
  and its outstanding amount in the default currency. Exchange
  differences are in the default-currency balance only. The GL check
  uses the default-currency balance.
