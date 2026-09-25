# Customer SOA (Statement of Account)

**Status:** design agreed · **Roadmap:** [#4](../ROADMAP.md) · **Module ID:** `CUSTOMERSOA`

## Purpose

A read-only statement for one customer over a date range: the opening
balance, every invoice, credit note, receipt and adjustment in date order
with a running balance, and the closing balance. Printable or exportable
to send to the customer.

Menu: the existing tree node *Accounts Receivable (FI-AR) → Customer
Account Statement* gets Module ID `CUSTOMERSOA` once deployed.

It mirrors [VENDOR_SOA.md](VENDOR_SOA.md), with receivables in place of
payables.

## Design

One hand-written report function, `getPartyStatement`, serves both
statements. Each screen is a thin view over it.

### Filters

Company (required, limited to the user's companies), customer (required),
From and To dates.

### Rows

Everything posted for that customer in that company, in date order:
- **Customer Invoices:** each posted invoice, and each invoice reversal as its
  own row (from RTDB `customerInvoices`).
- **Every party-tagged journal line** naming this customer: credit notes,
  payments/receipts and adjustments through CBT and JV, and the
  reversals of any of these (reversal entries keep the party tag).

Only posted documents count. Drafts and anything pending approval are
left out. A reversed document and its reversal both appear, since both
happened and they net to zero.

### Columns

Date, document type, number, reference, description, Debit, Credit, and
the running balance.

### Balance

- Shown as **receivable**: debits (invoices) increase it, credits
  (receipts, credit notes) reduce it. A negative balance means the
  company owes the customer.
- **Opening balance:** every row before the From date.
- **Closing balance:** the last running balance.

### Output

On screen, **Print** (browser print / save as PDF, with the company
letterhead as the other screens print it) and an **Excel (CSV)**
download.

## Owner decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Roadmap #0 (tying payments to a party) | Party-tagged JV/CBT lines with bill-wise allocation, built and live |
| 2 | Content | The **running ledger** (opening, rows, closing). No open-items or aging section for now |
| 3 | Output | Screen, **print** and **Excel (CSV) export** |
| 4 | Currency | The system has one default currency and no conversion, so amounts are as posted |
| 5 | Permissions | Access only, same default roles as GL Report |

## Known limits

- Payments and receipts posted before party tagging went live
  (2026-09-25) carry no party, so they don't appear.
  Such history needs a settling JV (party payments decision 6).
