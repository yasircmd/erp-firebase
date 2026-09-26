# Sales Return / Credit Note

**Status:** deployed 2026-09-25 · Sales Returns Account per Sales Type deployed 2026-09-26 · **Roadmap:** [#2](../ROADMAP.md) · **Branch:** `sales-return` (from `purchase-return`)

## Purpose

Take goods back from a customer and reduce what they owe. The credit note
is the financial document: it lowers the customer's receivable, reverses
the revenue and output tax, and puts the stock back.

## Owner decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Raised against what | A posted, unreversed Customer Invoice. Lines come from the items on its Delivery Notes; partial quantities allowed, capped at invoiced quantity minus earlier live returns. Credited at the DN line's locked price, with the invoice's discount reversed in proportion and output tax recomputed on the net (the invoice's own formula). Returns before invoicing use the existing whole-DN reversal; partial pre-invoice returns are deferred |
| 2 | Revenue side | A separate contra-revenue account, not the Sales Type's Revenue account. ~~A company **Sales Returns Account** in Company Master~~ **Changed 2026-09-26:** each **Sales Type** has its own Sales Returns Account (Sales Invoice Configuration, after Revenue Account), because sales under different tax treatments can't all be returned to one account. With the invoice's cost center |
| 3 | Returned stock | In to a warehouse chosen per line, defaulting to the DN's warehouse, at the DN line's original unit cost (reverses exactly the COGS booked: Dr Inventory / Cr Cost of Sales; no variance). No write-off inside the return: damaged goods are written off afterwards with Stock Adjustment. A quarantine/QC warehouse is just an ordinary warehouse chosen on the return |
| 4 | Sales Order | Left as is: delivered quantity and reservations are not touched. A replacement goes through a new Sales Order |
| 5 | Non-stock credit notes | Not in this version. A customer-tagged JV (Party Payments) covers price adjustments and rebates |
| 6 | Approvals, numbering, permissions | Gateable module `SALESRETURN` in Approval Configuration, off by default, approval amount the credit note total. Prefix `CRN`. Permissions as Customer Invoice: access ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; draft ADMIN, FINANCE_MGR, ACCOUNTANT; post ADMIN, FINANCE_MGR |
| 7 | Offsetting the invoice | The credit note settles its own invoice automatically, up to the invoice's outstanding. Any remainder (invoice already paid) becomes an open credit for the customer, settled later by a JV/CBT Against it (a refund, or offset against a later invoice) |
| 8 | Reversal | Whole credit note only, not approval-gated (as Purchase Return). A Customer Invoice can't be reversed while a live credit note exists against it |

## What already exists (from the code)

- **Delivery Note** (generated): ships stock Out against a Sales Order
  line (capped by remaining quantity and reservation, deviation #11) and
  books COGS: Dr the item's Sales COGS account / Cr Inventory at WAC. Each
  posted line stores its `UnitCost`/`TotalValue` (the WAC it left at) and
  its `UnitPrice` (the SO price). The whole-DN reversal re-reserves only
  for a still-open Sales Order (deviation #12) and is refused once the DN
  is invoiced.
- **Customer Invoice** (generated `commitCustomerInvoicePosting_`):
  bills posted DNs at the SO price locked at delivery (DN `Amount` = Σ
  quantity × `UnitPrice`). Dr Trade Receivables (the customer's
  `TradeReceivablesAccountID`); Cr revenue (the Sales Type's
  `GLAccountID`, with the header cost/profit center); Dr Discount Given;
  Cr Output Tax (company `OutputTaxAccountID`); round-off. Discount is on
  the subtotal (DNs plus direct lines), tax on the net of discount. Stored
  in RTDB `customerInvoices`.
- **Party Payments** (`partyLedger.js`) derives each invoice's outstanding
  and open items from the GL; invoice reversal is already refused while
  payments are allocated to it.
- **Purchase Return** (`purchaseReturn.js`, [PURCHASE_RETURN.md](PURCHASE_RETURN.md))
  is the mirror image and the code model: invoice-line picker, derived
  returnable quantities, party allocation on the GL line, whole-note
  reversal, invoice reversal guard.
- The default chart has **410000 Sales Returns & Discounts** (Revenue).

## Design

**Document.** A Sales Return draft names a company, a customer and one
posted Customer Invoice of that customer that is not a reversal, not
reversed and not pending reversal approval. Its lines are chosen from the
item lines of the invoice's source DNs: item, the DN line's unit price
and unit cost, the quantity to return, and the warehouse it comes back
into (default: the DN line's). Quantity per DN line is capped at the DN
line's quantity minus live returns already posted against it, re-checked
at post under the global lock.

**Values.** `ReturnValue = Quantity × DN UnitPrice` per line.
`DiscountShare = invoice Discount × ΣReturnValue / invoice Subtotal`,
`Tax = (ΣReturnValue − DiscountShare) × TaxPercent`, `Total = ΣReturnValue
− DiscountShare + Tax`, each rounded to 2 dp. The invoice's round-off
isn't reversed. `CostValue = Quantity × DN UnitCost` per line.

**Posting** (one stock transaction, type `SalesReturn`, prefix `CRN`):
- Stock: In to the chosen warehouse at the DN line's `UnitCost`.
- GL:
  - Dr **Sales Returns** (company `SalesReturnsAccountID`) `ΣReturnValue`,
    with the invoice's cost/profit center
  - Cr Discount Given (discount share), Dr Output Tax (tax share)
  - Cr Trade Receivables (customer's account) `Total`, tagged with the
    customer
  - Dr Inventory / Cr the item's Sales COGS account, `CostValue` per line
- Offset: the receivables line carries an Against allocation to
  `CustomerInvoice:<id>` for `min(Total, invoice outstanding)`, and a New
  Ref for any remainder.

**Lifecycle:** Draft → Post (→ Pending Approval → Posted/Rejected; a
failed commit at approval returns it to Rejected) → Reversal. Reversal
takes the stock back Out of the warehouse it went into (refused if it's no
longer there) and is refused while its New Ref remainder has been settled
by a live JV/CBT. Stock can only leave at the **current average cost**, so
the reversal mirrors the Sales Returns, discount, tax and receivables
lines exactly but books the stock side afresh, like a delivery: Dr Sales
COGS / Cr Inventory at that cost. When the average has moved since the
return, the reversal's cost differs from the return's.

**Changes to existing modules:**
- Customer Invoice reversal is refused while a live Sales Return exists
  against the invoice (`invoiceAllocations.js`, as for Vendor Invoice).
- Company Master gains the optional `SalesReturnsAccountID` (generator
  patches on `saveCompany`, the hand-maintained screen).
- Voucher-type maps (`journal.js`, `masterData.js`, Stock Ledger Report
  patch), registries and a seed menu node, as for Purchase Return.

**Code:** hand-written `functions/src/salesReturn.js`, modelled on
`purchaseReturn.js`; emulator suite `functions/test/emulator/salesReturn.emulator.test.js`,
UI check `functions/test/ui/salesReturn.ui.js`, smoke entry, negative
controls.

## As built (2026-09-25)

**Callables** (`functions/src/salesReturn.js`):
`getReturnableCustomerInvoices`, `saveSalesReturnDraft`,
`postSalesReturn`, `decideSalesReturnApproval`, `deleteSalesReturnDraft`,
`getSalesReturnEntries`, `reverseSalesReturn`. Screen:
`functions/modules/SALESRETURN.html`.

**Record** (RTDB `stock/transactions/SRTD-…`, `TransactionType:
'SalesReturn'`): `SourceInvoiceID/Number`, `CustomerID`, the invoice's
dimensions, and lines with `SourceDNID`, `SourceDNLineNo`, `WarehouseID`
(chosen), `Quantity` (base unit), `UnitPrice`, `ReturnValue`, `UnitCost`
(the DN line's), `CostValue`, and the DN line's cost/profit center (used
on the COGS line). Totals: `ReturnValue`, `DiscountAmount`, `TaxAmount`,
`Total`, `CostValue`, and after posting `AllocatedToInvoice`.

**Choices made while building** (not owner decisions; say if any should
change):
- The return's date, description and an optional customer return
  reference are entered. Dimensions come from the invoice.
- Quantities are in the item's base unit. The warehouse must be one of
  the invoice's company (or unassigned).
- A DN line that left at no recorded cost (average 0) can't be returned
  into stock. The stock ledger refuses an inbound line at cost 0.
- Reversal isn't approval-gated, as for Purchase Return.

**Changes to shared and existing code:** prefix `SalesReturn: 'CRN'` in
`glWriting.js`. Customer Invoice reversal (request and approval) is
refused while a live return exists (`invoiceAllocations.js`).
`SalesReturn → SALESRETURN` in the `journal.js`/`masterData.js` maps and,
by generator patch, the Stock Ledger Report's. Company Master gains
`SalesReturnsAccountID` (three generator patches plus the hand-maintained
screen). Registries: `moduleRegistry.js` and `approvalRegistry.js`, plus
a seed menu node under Accounts Receivable.

**After deploy:** link "Sales Return / Credit Note" into the live menu
with Tree Management, and set each company's Sales Returns Account (e.g.
410000). Deploy set: `tools/deploy-sets/sales-return.txt`. It needs the
Purchase Return set deployed too, because this branch contains both.

**Tests:** `functions/test/emulator/salesReturn.emulator.test.js` (6
tests) and `functions/test/ui/salesReturn.ui.js` (4 checks). Negative
controls, each confirmed caught, then restored:
1. Stock returned at the selling price instead of the delivered cost:
   3 tests failed.
2. The Customer Invoice return guard removed: 2 tests failed, including
   the paid-then-unpaid invoice that only this guard protects.
3. A reversal at the original cost instead of the current average:
   1 test failed.

## Change (2026-09-26): Sales Returns Account per Sales Type

**Why (owner):** because of sales tax, all sales returns can't be
recorded in one account. Local and export sales, for example, need their
returns kept apart, just as their revenue already is.

**Owner decisions (2026-09-26):**
- The Sales Returns Account moves from Company Master to each Sales Type
  in Sales Invoice Configuration, as a field after Revenue Account. The
  Company Master field is **removed**, with no fallback.
- It is **required** when a Sales Type is saved, including when an
  existing Sales Type is next edited.

**As built:**
- `saveSalesType` (generator patches `sales-type-returns-account`)
  requires `SalesReturnsAccountID` and checks it the same way as the
  Revenue account: active, postable, Revenue-type, not restricted to
  another company. It's stored on the Sales Type.
- Sales Return: each line records the Sales Type it was invoiced under
  (`SalesTypeID`, taken from its Delivery Note on the invoice). Posting
  debits each Sales Type's Sales Returns Account with its lines' value,
  one GL line per account, with the invoice's cost/profit center as
  before. Reversal mirrors it line for line. A return is refused at
  posting (or at final approval, which sends it back to Rejected) if a
  line's Sales Type has no Sales Returns Account or it is no longer valid.
  The message names the Sales Type.
- Company Master: the field, its screen control and its three generator
  patches are gone. A value already saved on a company stays in the
  database, but nothing reads it.
- Sales Invoice Configuration's screen is now hand-maintained (`handScreens`
  in `tools/legacy-port/modules.json`). It has the new field and a table
  column that shows "Not set" in amber for Sales Types still without one.
- Bug fixed in passing: the Sales Types table wasn't redrawn once the
  chart of accounts had loaded, so account names could show as "—"
  depending on load order. It now redraws, as it already did for
  classifications.
- Posted returns keep their GL entries. Their reversals mirror the
  original lines, so they still use the old company account.

**Tests:** salesReturn suite 7/7 (new: lines of two Sales Types posted to
two accounts and mirrored on reversal; Sales Type save rules; missing or
invalid account refused at post and at approval), salesInvoiceSetup,
partyStatement, customerInvoice, masters1 and purchaseReturn 27/27, UI
4/4, smoke 101/101. Negative controls, each caught by its own test, then
restored: every line posted to the first line's Sales Type (split test
failed); the required check removed from `saveSalesType` (save-rules
test failed).

**After deploy:** in Sales Invoice Configuration, set a Sales Returns
Account on every Sales Type that's used in sales. Until then, returns of
those types are refused at posting.
