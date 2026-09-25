# Sales Return / Credit Note

**Status:** tested · **Roadmap:** [#2](../ROADMAP.md) · **Module ID:** `SALESRETURN`

## Purpose

Take goods back from a customer, or correct a customer invoice's value,
and reduce what they owe. The credit note is the financial document: it
lowers the customer's receivable, books the returned sales value and
output tax, and puts returned stock back.

## Owner decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Raised against what | A **posted Customer Invoice** only (partial quantities allowed) |
| 2 | Revenue side | A separate **Sales Returns account** per company (the chart's 410000 Sales Returns & Discounts), not the original Sales Type revenue account |
| 3 | Returned stock | Back to the **Delivery Note's warehouse by default**, changeable per line (e.g. a QC store), at the cost the Delivery Note took out |
| 4 | Sales Order | **Left as is.** A return doesn't reopen delivery; a replacement is a new Sales Order |
| 5 | Value-only credit notes (price correction, rebate) | **Yes**, as value lines on the same note, with tax reversed at the invoice's tax % |
| 6 | Approvals | **Gateable** for posting and reversal, like Customer Invoice |
| 7 | Settlement | **Automatic** against its own invoice. Anything beyond the invoice's outstanding becomes a New Ref in the customer's favour |
| 8 | Where the Sales Returns account is set | On the **Sales Return screen**, as a company-level setting editable by users with Company Master Data write access |
| 9 | Numbering | Voucher prefix `CRN` |
| 10 | Permissions | Same defaults as Customer Invoice |

Menu: the existing tree node *Accounts Receivable (FI-AR) → Sales Reurn /
Credit Note* (the name's typo can be fixed in Tree Management) gets Module
ID `SALESRETURN` once deployed.

## What already exists (from the code)

- **Delivery Note** (generated): stock Out per line (`ItemID`,
  `WarehouseID`, `Quantity`, `UnitPrice`, and `UnitCost` = the WAC taken
  out), GL Dr the item's `SalesCogsAccountID` (falling back to
  `ConsumptionAccountID`) / Cr Inventory. Stored in `stock/transactions`.
- **Customer Invoice** (generated): `SourceDeliveryNotes` (each with its
  `SalesTypeID`, `Amount` and the DN's lines in the same order),
  `DirectLines`, `Discount`, `TaxPercent`, `TaxAmount`, `RoundOff`,
  `Total`. GL: Dr the customer's Trade Receivables, Dr Discount Given,
  Cr revenue per Sales Type, Cr Output Tax. RTDB `customerInvoices`.
- **Party ledger** (roadmap #0): as for Purchase Return.

## Design

It mirrors [PURCHASE_RETURN.md](PURCHASE_RETURN.md), with the sides swapped.

### Document

`stock/transactions/{id}` with `TransactionType: 'SalesReturn'`: its In
lines count in the stock ledger report and Data Reset's rebuild. Fields as
for Purchase Return, with `CustomerID` and `SourceInvoiceID`.

### Lines

- **Goods lines:** the Delivery Note lines behind the invoice, each with
  its delivered quantity, invoiced unit price and the unit cost the DN took
  out. The user enters a return quantity (capped at delivered minus earlier
  posted, unreversed returns) and a warehouse (default: the DN's).
- **Value lines:** account, description, amount, cost center (for P&L
  accounts), no stock.

### Amounts

Goods value at the invoiced unit price. Discount share pro rata to the
invoice's `Discount`. Tax at the invoice's `TaxPercent`. The note total,
with earlier notes, can't exceed the invoice `Total`.

### GL (one entry, voucher `CRN-…`)

| Account | Dr | Cr |
|---|---|---|
| Sales Returns (company setting) | goods value | |
| Discount Given (company) | | discount share |
| Output Tax (company) | tax | |
| Each value line's account | amount | |
| Customer's Trade Receivables (tagged with the customer) | | Total |
| Item Inventory account | stock value at the DN's cost | |
| Item COGS account (as the DN used) | | stock value at the DN's cost |

### Settlement, lifecycle and guards

As for Purchase Return:
- The receivables line allocates Against its invoice up to its
  outstanding at post, and the rest becomes a New Ref.
- Draft → post → approval → reversal, with commit-attempt markers.
- A reversal takes the stock back out and releases the settlement. It's
  refused while its New Ref is allocated elsewhere, and a reversal can't
  itself be reversed.
- Customer Invoice reversal is refused while a posted return exists
  against it, and JV reversal refuses a credit note's GL entry.

Reversing a return takes the stock out at current WAC through the normal
Out path, so it fails if that stock has since been used.

## Known limits

- The GL Report's drill-down doesn't link `CRN` entries back to this
  screen, as with Purchase Return.

## Build notes (2026-09-25)

- **Code:** `functions/src/returns.js` (one engine for Purchase Return and
  Sales Return), `functions/src/soa.js` (both statements). The screens
  `PURCHASERETURN.html`, `SALESRETURN.html`, `VENDORSOA.html` and
  `CUSTOMERSOA.html` are generated from `tools/screen-templates/` by
  `build.js`. Edit the template, not the output.
- **Shared changes:**
  - `writeStockGlEntry` keeps a line's party tag.
  - Voucher prefixes `DBN`/`CRN`.
  - Module registry, default permissions and the approval registry list
    the four modules.
  - JV reversal refuses a note's GL entry.
  - Vendor/Customer Invoice reversal is refused while a posted return
    exists against it.
- **Tests:** `functions/test/emulator/returns.emulator.test.js` (9),
  including Data Reset's stock ledger rebuild replaying returns and their
  reversals exactly. `functions/test/ui/returns.ui.js` (2) drives a debit
  note and a vendor statement through the real screens.
- **Negative controls:**
  - API: returnable-quantity cap and invoice guard disabled, 3 of 9 fail.
  - UI: the screen sending no lines, 1 of 2 fails.
- **Full run:** 199/199 emulator tests, 101/101 smoke, all UI checks.
- **Deploy set:** `tools/deploy-sets/returns-and-soa.txt` (39 functions:
  22 new, 16 existing that read the changed registries or guards,
  `getModuleFragment` last).
