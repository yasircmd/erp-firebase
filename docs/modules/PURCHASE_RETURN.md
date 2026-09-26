# Purchase Return / Debit Note

**Status:** deployed 2026-09-25 · cost-center fix deployed 2026-09-26 · **Roadmap:** [#1](../ROADMAP.md) · **Branch:** `purchase-return`

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
price). The invoice takes its discount on the whole subtotal (GRNs plus
direct lines) and tax on the net of discount, so the note does the same
for its own share: `DiscountShare = invoice Discount × ΣReturnValue /
invoice Subtotal`, `Tax = (ΣReturnValue − DiscountShare) × TaxPercent`,
`Total = ΣReturnValue − DiscountShare + Tax`, each rounded to 2 dp. The
invoice's round-off isn't reversed.

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

## As built (2026-09-25)

**Callables** (`functions/src/purchaseReturn.js`):
`getReturnableVendorInvoices`, `savePurchaseReturnDraft`,
`postPurchaseReturn`, `decidePurchaseReturnApproval`,
`deletePurchaseReturnDraft`, `getPurchaseReturnEntries`,
`reversePurchaseReturn`. Screen: `functions/modules/PURCHASERETURN.html`.

**Record** (RTDB `stock/transactions/PRTD-…`, `TransactionType:
'PurchaseReturn'`): `SourceInvoiceID/Number`, `VendorID`, the invoice's
dimensions, and lines with `SourceGRNID`, `SourceGRNLineNo`, `Quantity`
(base unit), `InvoiceUnitCost`, `ReturnValue`. Posting adds `Direction:
'Out'` and the WAC `UnitCost`/`TotalValue` to each line, plus
`StockValue`, `VarianceAmount` and `AllocatedToInvoice`. What's left to
return on a GRN line is derived from live returns (posted or committing,
not reversed, not a reversal), never stored.

**Choices made while building** (not owner decisions; say if any should
change):
- The return's date, description and an optional vendor credit-note
  reference are entered. Its dimensions are copied from the invoice.
- Quantities are entered in the item's base unit.
- **Reversal is not approval-gated**, like GRN and the other stock
  modules. Vendor Invoice reversals are gated; this can be added.
- A failed commit at final approval sends the return back to Rejected
  with the reason, the same as Vendor Invoice.
- The reversal brings stock back at the unit cost it left at and mirrors
  the GL entry line for line. Both GL entries are then marked
  reversed/reversal (`ReversedByJV`/`ReversalOfJV`), so their allocations
  stop counting and the invoice's outstanding is restored.

**Changes to shared and existing code:**
- `glWriting.js`: prefix `PurchaseReturn: 'DBN'`. `writeStockGlEntry` now
  keeps `PartyType/PartyID/PartyName/Allocations` on a line that has
  them. No other caller sends them, so nothing else changes.
- `invoiceAllocations.js`: Vendor Invoice reversal (request and approval)
  is refused while a live return exists. That matters even when nothing
  is allocated: an invoice paid, then returned, then the payment reversed.
- `journal.js` / `masterData.js`: `PurchaseReturn → PURCHASERETURN` in
  the voucher-type map, so the JV screen refuses to reverse a DBN entry
  and GL Report drill-through opens this screen.
- Company Master: optional `PurchaseReturnVarianceAccountID`. The server
  save uses three generator patches (`tools/legacy-port/patches.js`,
  marked NEW DEVELOPMENT). The screen became hand-maintained
  (`handScreens` in `tools/legacy-port/modules.json`), because patches
  apply only to Code.gs.
- Stock Ledger Report rows link here (generator patch
  `stock-voucher-type-purchase-return`).
- Registries: `moduleRegistry.js`, `approvalRegistry.js`, and a menu
  node in `treeSeedNodes.js` (fresh installs only).

**After deploy:** link "Purchase Return / Debit Note" into the live menu
with Tree Management. The seed node only applies to an empty tree. Set a
Purchase Return Variance Account on each company that will post returns
with a cost difference. Deploy set: `tools/deploy-sets/purchase-return.txt`.

**Tests:** `functions/test/emulator/purchaseReturn.emulator.test.js` (6
tests) and `functions/test/ui/purchaseReturn.ui.js` (4 checks). Negative
controls, each confirmed caught, then restored:
1. Tax on the gross instead of the net: 4 tests failed.
2. The Vendor Invoice return guard removed: 2 tests failed. One of them
   actually reversed an invoice that had a live return against it.
3. The note never settling its invoice: 2 tests failed.

## Fix (2026-09-26): cost center on the variance line

**Bug, reported live:** posting failed with "Line 4: account 510001 (COGS)
requires a Cost Center." The company's Purchase Return Variance Account
is a COGS account, which needs a Cost Center, and the variance line took
the cost center from the Vendor Invoice header. That header field is
optional and was empty. The emulator suite never caught this because its
invoice always had one.

**Behavior change (owner: "cost centre should be same of original
purchase entry"):** each return line now carries the cost center (and
profit center) its goods were received under: the GRN line's, else the
GRN header's, else the invoice header's. That value goes on:
- the return's stored lines (`CostCenterID`, `ProfitCenterID`);
- the Inventory credit for the line, mirroring the GRN's own debit;
- the Purchase Return Variance, now one line per cost center, each for
  the variance of the lines received under it. A center whose variance
  nets to zero gets no line.

The payables, discount and tax lines still use the invoice header, as
the invoice itself does. Drafts saved before the fix pick up the cost
centers at post, because lines are rebuilt from the GRNs then. If a GRN
has no cost center anywhere and the invoice header has none either, the
error still appears. There's no purchase cost center to copy in that case.

**Tests:** new emulator test `cost centers: …` (COGS-type variance
account, invoice without a cost center, two GRNs under CC1/CC2, post and
reversal). Negative control: the pre-fix `purchaseReturn.js` fails that
test, then restored. Suite 7/7, UI 4/4.
