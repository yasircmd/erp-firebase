# Customer SOA (Statement of Account)

**Status:** deployed 2026-09-25 · **Roadmap:** [#4](../ROADMAP.md) · **Branch:** `party-statements` (from `sales-return`)

## Purpose

A read-only statement for one customer over a date range: opening
balance, every invoice, credit note and receipt in date order, a running
balance, the closing balance, what's still open and how overdue it is.
Printable or exportable to send to the customer.

## Owner decisions (2026-09-25)

The same eight decisions as [VENDOR_SOA.md](VENDOR_SOA.md) → Owner
decisions (source, open items, aging, output, currency, shape, one party
per run, reconciliation), with receivables in place of payables and
debit/credit swapped. Customer-only:

| # | Question | Decision |
|---|---|---|
| C1 | Credit control | Not in this module. A warning on new Sales Orders for overdue customers would change the ported Sales Order module, and there's no credit-limit field yet; it's a roadmap follow-up once the statements are in use |
| C2 | Email to customers | Not now (no email service; data leaving the system). Print to PDF and attach |

## What already exists (from the code)

- **Customer Invoices** (RTDB `customerInvoices`): `CustomerID`,
  `CompanyID`, `TransactionNumber`, `InvoiceDate`, `Total`, status and
  reversal links. Their GL lines are not party-tagged; the invoice record
  is the source.
- **Tagged GL entries:** JV, CBT (receipts, refunds), Sales Return (CRN).
- Everything else as in [VENDOR_SOA.md](VENDOR_SOA.md).

## Design

As [VENDOR_SOA.md](VENDOR_SOA.md) → Design, customer side: debit
increases what the customer owes. Each Customer Invoice (and reversal
entry) is Dr `Total`; receipts are Cr; a credit note is Cr (its
remainder an open credit). Reconciliation against the customer's
`TradeReceivablesAccountID`. Built on the same engine
(`functions/src/partyStatement.js`), screen `CUSTOMERSOA.html`.

## As built (2026-09-25)

Built with Vendor SOA on one engine: see [VENDOR_SOA.md](VENDOR_SOA.md) → As built.

## Compact view (owner, 2026-10-02)

"Both SOAs also make compact view, reduce amount font size, no need to
change print." On screen only (`@media screen` in VENDORSOA.html, built
into CUSTOMERSOA.html):
- tighter rows (0.15rem × 0.5rem) and sections;
- amounts at 0.72rem, other cells at 0.75rem, headers at 0.68rem;
- every column but the description on one line;
- smaller ageing tiles and title.

The printout is unchanged. Checked by `partyStatement.ui.js`, also under
print media.
