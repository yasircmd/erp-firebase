# Sales Return / Credit Note

**Status:** not started · **Roadmap:** [#2](../ROADMAP.md)

## Purpose

Take goods back from a customer and reduce what they owe. The credit note
is the financial document: it lowers the customer's receivable, reverses
the revenue and output tax, and puts the stock back.

## What already exists (from the code)

- **Delivery Note** (generated): ships stock Out against a Sales Order
  line (capped by remaining quantity and reservation, deviation #11) and
  books COGS: Dr Cost of Sales / Cr Inventory at WAC. The reversal
  re-reserves only for a still-open Sales Order (deviation #12).
- **Customer Invoice** (generated `commitCustomerInvoicePosting_`):
  bills posted DNs at the SO price locked at delivery. Dr Trade
  Receivables (the customer's `TradeReceivablesAccountID`); Cr revenue
  (the Sales Type's `GLAccountID`, per cost/profit center); Dr Discount
  Given; Cr Output Tax (company `OutputTaxAccountID`); round-off. Stored in
  RTDB `customerInvoices`.
- The default chart has **410000 Sales Returns & Discounts** (Revenue).
- No return, credit note or receipt tracking exists yet.

## Design (to be agreed)

_Proposed, pending the open questions:_ a Sales Return document picks a
posted, unreversed Customer Invoice and returns part or all of the
quantity on its DN lines.
- **Stock:** In to a chosen warehouse at the COGS cost recorded on the
  original DN line.
- **GL:** Dr Sales Returns & Discounts (or the original revenue account);
  Dr Output Tax; Cr Trade Receivables; and Dr Inventory / Cr Cost of Sales
  for the returned cost.
- **Lifecycle:** draft → post (→ approval) → reversal.

## Open questions for the owner

1. **Raised against what:** a posted Customer Invoice (partial
   quantities), a Delivery Note, or a free-standing note?
2. **Revenue side:** debit a separate Sales Returns account (410000), or
   reverse the original Sales Type revenue account?
3. **Returned stock:** back into the original warehouse, a chosen one, or
   a quarantine/QC warehouse? Always saleable again, or can it be written
   off?
4. **Sales Order:** should a return reopen the SO line's delivered
   quantity (so it can ship again), or is the SO left as is?
5. **Non-stock credit notes:** also needed (a price adjustment or
   discount with no goods returned)?
6. **Approvals, numbering, permissions:** as for Purchase Return.
