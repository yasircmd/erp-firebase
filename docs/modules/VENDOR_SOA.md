# Vendor SOA (Statement of Account)

**Status:** design agreed 2026-09-25 · **Roadmap:** [#3](../ROADMAP.md) · **Branch:** `party-statements` (from `sales-return`)

## Purpose

A read-only statement for one vendor over a date range: opening balance,
every invoice, debit note and payment in date order, a running balance,
the closing balance, what's still open and how overdue it is. Printable or
exportable to send to the vendor.

## Owner decisions (2026-09-25, shared with [CUSTOMER_SOA.md](CUSTOMER_SOA.md))

| # | Question | Decision |
|---|---|---|
| 1 | Source of the figures | Party Payments (roadmap #0, option A plus allocation): the party's posted invoices plus every posted GL entry tagged with the party (JV, CBT, debit/credit notes). Opening balance = everything before the start date; running balance per row. Reversed documents and their reversals both appear, marked |
| 2 | Open/paid per invoice | Yes: an **Open items** section — each unpaid invoice or open credit with amount, outstanding, due date (invoice date + the party's `PaymentTermsDays`) and days overdue, computed **as at the statement's end date** (allocations dated later don't count) |
| 3 | Aging | Yes, from the due date: Not yet due, 1–30, 31–60, 61–90, 90+ days overdue, over the open items |
| 4 | Output | On screen, Print (browser print / save as PDF, as Trial Balance and GL Report), and CSV export. No email sending |
| 5 | Currency | The company's own currency only: no invoice or payment stores a foreign-currency amount |
| 6 | Shape | Two screens and modules (`VENDORSOA`, `CUSTOMERSOA`), access ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; one shared server engine |
| 7 | Scope per run | One party at a time: company, party, date range. A batch "all parties with a balance" run can come later |
| 8 | Reconciliation | When the party's payables/receivables account is used by no other party, compare the statement's closing balance with that account's GL balance for the company at the end date and flag any difference (usually an old untagged payment needing a settling JV) |

## What already exists (from the code)

- **Vendor Invoices** (RTDB `vendorInvoices`): `VendorID`, `CompanyID`,
  `TransactionNumber`, `InvoiceDate`, `VendorRefNumber`, `Total`, status and
  reversal links (`ReversedByInvoiceID`, `ReversalOfInvoiceID`). Their GL
  lines are **not** party-tagged; the invoice record is the source.
- **Tagged GL entries** (Firestore `journalEntries`, `PartyKeys` array,
  single-field `array-contains` query): JV, CBT, Purchase Return (DBN).
  Lines carry `PartyType`, `PartyID`, `Allocations`; entries carry
  `ReversedByJV` / `ReversalOfJV`.
- **Open items and outstanding:** `partyLedger.getOpenItemsForParty`
  (currently "as of now"; needs an as-of-date variant).
- **Reports:** print CSS and `window.print()` in TRIALBALANCE / GLREPORT.

## Design

**Rows**, in date order (then posting time), vendor side = credit
increases what we owe:
- each Vendor Invoice (and invoice reversal entry): Cr `Total`
- each tagged line of a posted GL entry for this vendor: Dr/Cr as posted
  (payments Dr, refunds/debit-note remainders etc. as they fall)

Columns: date, document number, type, reference / description, debit,
credit, running balance. Opening row first, closing row last. Marked:
"reversed" / "reversal of …".

**Open items as at the end date:** the same open items Party Payments
derives today (live invoices and New Refs, live meaning not reversed),
limited to those dated on or before the end date, with outstanding =
amount − the Against allocations on live entries dated on or before the
end date. Aging buckets compare each item's due date with the end date.
A document reversed after the end date is treated as reversed; the
statement shows current knowledge, not a historical snapshot.

**Reconciliation:** GL balance of the vendor's `TradePayablesAccountID`
for the company up to the end date vs the closing balance, shown only
when no other vendor/customer uses that account.

**Code:** `functions/src/partyStatement.js` (one engine, one callable per
party type), screens `VENDORSOA.html` / `CUSTOMERSOA.html`, emulator suite
and UI check, negative controls.
