# Vendor SOA (Statement of Account)

**Status:** design agreed · **Roadmap:** [#3](../ROADMAP.md) · **Module ID:** `VENDORSOA`

## Purpose

A read-only statement for one vendor over a date range: the opening
balance, every invoice, debit note, payment and adjustment in date order
with a running balance, and the closing balance. Printable or exportable
to send to the vendor.

Menu: the existing tree node *Accounts Payable (FI-AP) → Vendor Account
Statement* gets Module ID `VENDORSOA` once deployed.

## Design

One hand-written report function, `getPartyStatement`, serves both
statements. Each screen is a thin view over it.

### Filters

Company (required, limited to the user's companies), vendor (required),
From and To dates.

### Rows

Everything posted for that vendor in that company, in date order:
- **Vendor Invoices:** each posted invoice, and each invoice reversal as its
  own row (from RTDB `vendorInvoices`).
- **Every party-tagged journal line** naming this vendor: debit notes,
  payments/advances and adjustments through CBT and JV, and the
  reversals of any of these (reversal entries keep the party tag).

Only posted documents count. Drafts and anything pending approval are
left out. A reversed document and its reversal both appear, since both
happened and they net to zero.

### Columns

Date, document type, number, reference, description, Debit, Credit, and
the running balance.

### Balance

- Shown as **payable**: credits (bills) increase it, debits
  (payments, debit notes) reduce it. A negative balance means the vendor
  owes the company.
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
