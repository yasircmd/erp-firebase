# Purchase Return / Debit Note

**Status:** design agreed · **Roadmap:** [#1](../ROADMAP.md) · **Module ID:** `PURCHASERETURN`

## Purpose

Send goods back to a vendor, or correct a vendor bill's value, and reduce
what the company owes. The debit note is the financial document: it
lowers the vendor's payable, takes returned stock out, and reverses the
matching input tax.

## Owner decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Raised against what | A **posted Vendor Invoice** only (partial quantities allowed) |
| 2 | Returns before invoicing | Not supported: the invoice comes first |
| 3 | Value, and where the stock-cost difference goes | Payable and tax at the **invoiced price**. Stock leaves at today's WAC. The difference goes to the **item's Material Consumption account** (`ConsumptionAccountID`) |
| 4 | Value-only debit notes (price correction, rebate) | **Yes**, as value lines on the same note, with tax reversed at the invoice's tax % |
| 5 | Approvals | **Gateable** in Approval Configuration for posting and reversal, like Vendor Invoice |
| 6 | Settlement | **Automatic** against its own invoice. Anything beyond the invoice's outstanding becomes a New Ref in the company's favour |
| 7 | Numbering | Voucher prefix `DBN` (DN is taken by Delivery Note) |
| 8 | Permissions | Same defaults as Vendor Invoice: access ADMIN, FINANCE_MGR, ACCOUNTANT, VIEWER; draft ADMIN, FINANCE_MGR, ACCOUNTANT; post ADMIN, FINANCE_MGR |

Menu: the existing tree node *Accounts Payable (FI-AP) → Purchase Return /
Debit Note* gets Module ID `PURCHASERETURN` once deployed.

## What already exists (from the code)

- **GRN:** received stock lines carry `ItemID`, `WarehouseID`,
  `Quantity`, `UnitCost` (the PO-locked price). Stored in RTDB
  `stock/transactions`.
- **Vendor Invoice** (generated): `SourceGRNs` (each with its `Amount`),
  `DirectLines`, `Discount`, `TaxPercent`, `TaxAmount`, `RoundOff`,
  `Total`. GL: Dr GRN Clearing / direct accounts / Input Tax, Cr Discount
  Received, Cr the vendor's Trade Payables. RTDB `vendorInvoices`.
- **Party ledger** (`partyLedger.js`, roadmap #0): open items and
  outstanding are derived from party-tagged lines on live journal
  entries. An invoice's outstanding drops when a line allocates Against
  it.
- **Shared:** `computeStockMovement` (Out at current WAC, refuses
  negative stock), `writeStockGlEntry`, voucher numbering, approvals, the
  global lock, commit-attempt markers.

## Design

### Document

RTDB `stock/transactions/{id}` with `TransactionType: 'PurchaseReturn'`,
stored like the other stock documents so that the stock ledger report and
Data Reset's ledger rebuild include its Out lines. Fields: `CompanyID`,
dimensions, `VendorID`, `SourceInvoiceID`/`SourceInvoiceNumber`,
`TransactionDate`, `Description`, `VendorRefNumber` (the vendor's credit
note number, optional), `Lines`, `ValueLines`, `Discount`, `TaxPercent`,
`TaxAmount`, `Subtotal`, `Total`, status and reversal links.

### Lines

- **Goods lines:** the GRN lines behind the invoice (`SourceGRNs`), each
  with its received quantity and invoiced unit cost. The user enters a
  return quantity. It's capped at the received quantity minus what earlier
  posted, unreversed returns took. Stock leaves the GRN line's
  warehouse. Posting fails if that warehouse no longer holds enough.
- **Value lines:** account, description, amount, cost center (for P&L
  accounts), no stock.

### Amounts

- Goods value = Σ return qty × invoiced unit cost.
- Discount share = the invoice's `Discount` × goods value ÷ invoice
  `Subtotal` (pro rata, so a returned item gives back its share of the
  discount).
- Tax = invoice `TaxPercent` × (goods value − discount share + value
  lines).
- Total = goods value − discount share + value lines + tax.
- No round-off on notes. The total, together with earlier notes on the
  same invoice, can't exceed the invoice's `Total`.

### GL (one entry, voucher `DBN-…`)

| Account | Dr | Cr |
|---|---|---|
| Vendor's Trade Payables (tagged with the vendor) | Total | |
| Item Inventory account | | stock value at WAC |
| Item Material Consumption account | WAC − invoiced cost, if positive | invoiced cost − WAC, if positive |
| Discount Received (company) | discount share | |
| Input Tax (company) | | tax |
| Each value line's account | | amount |

### Settlement (decision 6)

The payables line is party-tagged. At post (under the global lock) it
allocates **Against** its invoice up to the invoice's outstanding at that
moment. The rest is a **New Ref**, which later payments, receipts or JVs
can allocate against. It's the same mechanism as JV/CBT, so outstanding,
the invoice list's Payment column and the statements pick it up with no
extra state.

### Lifecycle

Draft → Post (→ PendingApproval → Approved) → Posted → Reversal (→
PendingReversalApproval). The flow and guards follow Vendor Invoice:
- Commit-attempt markers around the stock + GL write.
- A reversal returns the stock at the value that left, reverses the GL,
  and releases the settlement.
- A reversal is refused while its New Ref is allocated elsewhere.
- A reversal can't itself be reversed.

### Guards added elsewhere

- **Vendor Invoice reversal** is refused while any posted, unreversed
  return exists against it, even if the return was fully a New Ref.
- **JV reversal** refuses a debit note's GL entry ("reverse it from that
  module").

## Known limits

- Returns only against posted invoices (decision 2). Goods received but
  not yet invoiced go back through a GRN reversal, as today.
- The GL Report's drill-down doesn't link `DBN` entries back to this
  screen. That mapping lives in the generated code.
