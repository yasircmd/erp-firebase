# Vendor SOA (Statement of Account)

**Status:** not started · **Roadmap:** [#3](../ROADMAP.md)

## Purpose

A read-only statement for one vendor over a date range: opening balance,
every invoice, debit note and payment in date order, a running balance,
and the closing balance. Printable or exportable to send to the vendor.

## What already exists (from the code)

- **Vendor Invoices** (RTDB `vendorInvoices`) carry `VendorID`, number,
  date, totals, status and reversal links.
- **Debit notes:** not yet built (see
  [PURCHASE_RETURN.md](PURCHASE_RETURN.md)).
- **Payments:** posted through CBT (Firestore `journalEntries`,
  `VoucherType` cash/bank). **CBT lines store only a GL account, with no
  vendor.** Nothing records what's paid or outstanding per invoice.
- Each vendor has its own `TradePayablesAccountID`.

## Design (to be agreed)

Depends on roadmap decision **#0** (how a payment is tied to a vendor):
- **A:** list invoices, debit notes and the CBT lines tagged with this
  vendor.
- **B:** read the GL for the vendor's payables account.
- **C:** read the new Vendor Payment documents with their allocations.

The layout, whatever the source:
- **Columns:** date, document, reference, debit, credit, running balance.
- **Rows:** opening balance first, closing balance last.
- **Filters:** company, vendor, date range.
- **Access:** company-scoped like every report.

## Open questions for the owner

1. **Roadmap #0:** option A, B or C?
2. **Invoice detail:** show open/paid status per invoice (needs C), or
   only the running balance?
3. **Aging:** include an aging summary (0–30, 31–60, 61–90, 90+ days)?
4. **Output:** on screen only, print/PDF, or Excel export?
5. **Currency:** statements in the invoice currency, or the company's
   base currency?
