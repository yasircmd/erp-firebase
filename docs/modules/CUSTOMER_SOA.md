# Customer SOA (Statement of Account)

**Status:** not started · **Roadmap:** [#4](../ROADMAP.md)

## Purpose

A read-only statement for one customer over a date range: opening
balance, every invoice, credit note and receipt in date order, a running
balance, and the closing balance. Printable or exportable to send to the
customer.

## What already exists (from the code)

- **Customer Invoices** (RTDB `customerInvoices`) carry `CustomerID`,
  number, date, totals, status and reversal links.
- **Credit notes:** not yet built (see [SALES_RETURN.md](SALES_RETURN.md)).
- **Receipts:** posted through CBT (Firestore `journalEntries`). **CBT
  lines store only a GL account, with no customer.** Nothing records
  what's received or outstanding per invoice.
- Each customer has its own `TradeReceivablesAccountID`.

## Design (to be agreed)

It mirrors [VENDOR_SOA.md](VENDOR_SOA.md), with receivables in place of
payables and debit/credit swapped. Building the two together from one
shared report function is the natural shape. It depends on roadmap
decision **#0**.

## Open questions for the owner

1. **Roadmap #0:** option A, B or C (shared with Vendor SOA)?
2. **Aging:** include an aging summary, and is it used for credit control
   (for example, warning on a new Sales Order when a customer is overdue)?
3. **Output:** on screen only, print/PDF, or Excel export? Sent to
   customers by email?
4. **Currency:** as for Vendor SOA.
