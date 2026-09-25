# Purchase Return / Debit Note

**Status:** not started · **Roadmap:** [#1](../ROADMAP.md)

## Purpose

Send goods back to a vendor and reduce what the company owes them. The
debit note is the financial document: it lowers the vendor's payable,
takes the stock out, and reverses the matching input tax.

## What already exists (from the code)

- **GRN** (`functions/src/grn.js`): receipt into a warehouse at the
  PO-locked cost, Dr Inventory / Cr GRN Clearing (company
  `GrnClearingAccountID`). A GRN reversal already exists, but only for the
  whole GRN, and it's refused once the GRN is invoiced (deviation #15).
- **Vendor Invoice** (generated `commitVendorInvoicePosting_`): matches
  GRNs, Dr GRN Clearing, Dr other expense lines, Dr Input Tax (company
  `InputTaxAccountID`), Cr Discount Received, Cr Trade Payables (the
  vendor's `TradePayablesAccountID`), plus round-off. Stored in RTDB
  `vendorInvoices`.
- **Shared:** `computeStockMovement` (Out lines cost at current WAC),
  `writeStockGlEntry`, voucher numbering (`STOCK_TRANSACTION_PREFIXES`),
  approvals, global lock, commit-attempt markers.
- No return, debit note or payment tracking exists yet.

## Design (to be agreed)

_Proposed, pending the open questions:_ a Purchase Return document picks
a posted, unreversed Vendor Invoice and returns part or all of the
quantity on its GRN lines.
- **Stock:** Out from the original warehouse.
- **GL:** Dr Trade Payables; Cr Inventory at the current WAC; Cr Input
  Tax on the returned value. Any difference between the invoice cost and
  the WAC goes to a variance account.
- **Lifecycle:** draft → post (→ approval) → reversal, like the invoices.

## Open questions for the owner

1. **Raised against what:** a posted Vendor Invoice (partial quantities),
   a GRN (before or after invoicing), or a free-standing note?
2. **Returns before invoicing:** allow them (then no payable is touched
   yet), or require the invoice first?
3. **Value:** use the original purchase price (from the invoice/GRN), or
   the current stock value (WAC)? Where does a difference go?
4. **Non-stock debit notes:** also needed (a price correction or rebate
   with no goods returned)?
5. **Approvals:** gateable in Approval Configuration like the invoices?
6. **Numbering:** voucher prefix (for example `PR` / `DBN`).
7. **Permissions:** which roles get access, draft and post?
