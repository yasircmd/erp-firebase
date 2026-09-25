# Purchase Return / Debit Note

**Status:** design agreed 2026-09-25 · **Roadmap:** [#1](../ROADMAP.md) · **Branch:** `purchase-return`

## Purpose

Send goods back to a vendor and reduce what the company owes them. The
debit note is the financial document: it lowers the vendor's payable,
takes the stock out, and reverses the matching input tax.

## Owner decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Raised against what | A posted, unreversed Vendor Invoice. Lines come from the items on its GRNs; partial quantities allowed, capped at invoiced quantity minus earlier live returns |
| 2 | Returns before invoicing | Not in this version. A whole-GRN return before invoicing uses the existing GRN reversal. Partial pre-invoice returns are deferred (they would change Vendor Invoice's GRN matching) |
| 3 | Value | Vendor side at the original invoice price, with the invoice's input tax and discount reversed in proportion. Stock out at current WAC. The difference goes to a new company account, **Purchase Return Variance** |
| 4 | Non-stock debit notes | Not in this version. A vendor-tagged JV (Party Payments) covers price corrections and rebates |
| 5 | Approvals | Yes: module `PURCHASERETURN` in Approval Configuration, off by default; approval amount is the debit note total |
| 6 | Numbering | Prefix `DBN` (`DN` is Delivery Note) |
| 7 | Permissions | As Vendor Invoice: access ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; draft ADMIN, FINANCE_MGR, ACCOUNTANT; post ADMIN, FINANCE_MGR |
| 8 | Offsetting the invoice | The debit note settles its own invoice automatically, up to the invoice's outstanding. Any remainder (invoice already paid) becomes an open debit item for the vendor, settled later by a JV/CBT Against it |
| 9 | Reversal | Whole debit note only. A Vendor Invoice can't be reversed while a live debit note exists against it |

## What already exists (from the code)

- **GRN** (`functions/src/grn.js`): receipt into a warehouse at the
  PO-locked cost, Dr Inventory / Cr GRN Clearing (company
  `GrnClearingAccountID`). A GRN reversal already exists, but only for the
  whole GRN, and it's refused once the GRN is invoiced (deviation #15).
- **Vendor Invoice** (generated `commitVendorInvoicePosting_`): matches
  GRNs, Dr GRN Clearing at each GRN's full `Amount`, Dr other expense
  lines (`DirectLines`), Dr Input Tax (company `InputTaxAccountID`), Cr
  Discount Received, Cr Trade Payables (the vendor's
  `TradePayablesAccountID`), plus round-off. Stored in RTDB
  `vendorInvoices`.
- **Party Payments** (`functions/src/partyLedger.js`): open items and
  their outstanding amounts are derived from posted invoices and New Ref
  lines, minus Against allocations on live journal entries. Invoice
  reversal is already refused while payments are allocated against it.
- **Shared:** `computeStockMovement` (Out lines cost at current WAC),
  `writeStockGlEntry`, voucher numbering (`STOCK_TRANSACTION_PREFIXES`),
  approvals, global lock, commit-attempt markers.

## Design

**Document.** A Purchase Return draft names a company, a vendor and one
posted Vendor Invoice of that vendor that is not a reversal, not reversed
and not pending reversal approval. Its lines are chosen from the item
lines of the invoice's source GRNs: item, warehouse (the GRN's), GRN
unit cost, and the quantity to return. Quantity per GRN line is capped at
the GRN line's quantity minus live returns already posted against it,
re-checked at post under the global lock.

**Values.** For each line, `ReturnValue = Quantity × GRN unit cost`
(the invoice clears GRNs at their full GRN value, so this is the invoiced
price). Let `ratio = Σ ReturnValue / invoice GRN subtotal`. The note
reverses `Discount × ratio` and `TaxAmount × ratio`, rounded to 2 dp.
`Total = Σ ReturnValue − discount share + tax share`.

**Posting** (one stock transaction, type `PurchaseReturn`, prefix `DBN`):
- Stock: Out from the GRN warehouse, costed at current WAC by
  `computeStockMovement`. Insufficient stock refuses the post.
- GL:
  - Dr Trade Payables (vendor's account) `Total`, tagged with the vendor
  - Cr Inventory (item's inventory account) at WAC value
  - Dr Discount Received (discount share), Cr Input Tax (tax share)
  - Dr/Cr **Purchase Return Variance** (company
    `PurchaseReturnVarianceAccountID`) for `Σ ReturnValue − WAC value`.
    Required only when that difference is non-zero; posting is refused
    with a clear message if it's missing.
- Offset: the payables line carries an Against allocation to
  `VendorInvoice:<id>` for `min(Total, invoice outstanding)`, and a New
  Ref for any remainder. The debit note becomes a Party Payments open item
  source exactly like a JV line, so the Vendor SOA and outstanding
  figures need nothing extra.

**Lifecycle:** Draft → Post (→ Pending Approval → Posted/Rejected when
the approval rule is on) → Reversal. Reversal posts the mirror stock and
GL entry and is refused while its New Ref remainder has Against
allocations on live entries (same rule as JV/CBT).

**Changes to existing modules** (recorded here as behavior changes):
- Vendor Invoice reversal is refused while a live Purchase Return exists
  against the invoice.
- Companies gain the optional `PurchaseReturnVarianceAccountID` field.
- Party Payments recognizes debit notes as allocation sources.

**Code:** hand-written `functions/src/purchaseReturn.js` modelled on
`grn.js`; emulator suite `functions/test/emulator/purchaseReturn.test.js`
plus UI checks, with a negative control.
