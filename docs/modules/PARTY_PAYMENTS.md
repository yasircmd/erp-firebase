# Party Payments & Bill-wise Allocation (JV and CBT)

**Status:** design · **Roadmap:** [#0](../ROADMAP.md)

## Purpose

Let JV and CBT record **which vendor or customer** a payment, receipt or
adjustment belongs to, and **how it's allocated**:
- **New Ref:** a new open item for the party, such as an advance paid
  before any bill exists.
- **Against Ref:** offsets one or more bills already posted (Vendor or
  Customer Invoices), or an earlier New Ref such as an advance.

This settles roadmap decision #0 (tag payments with a party, plus
allocation against bills). It's the base for Vendor SOA and Customer SOA,
and gives every invoice an outstanding amount.

## What already exists (from the code)

- **JV and CBT** share one engine in the generated code
  (`functions/src/legacy/codegs.js`). They're stored in Firestore
  `journalEntries` (`VoucherType` tells them apart) and saved through
  `saveJournalRecord_`.
  - **Posting:** `postJournalEntry` (under the global lock), or
    `decideJournalEntryApproval` when approval is required.
  - **Reversal:** `reverseJournalEntry` (JV and CBT entries only,
    deviation #13).
- **CBT entry:** the screen sends one cash/bank ledger plus "opposite
  lines" (account, amount, description, cost/profit center).
  `buildLinesFromVoucher_` turns those into GL lines.
- **Line fields are dropped:** the shared `validateAndNormalizeLines` in
  `glWriting.js` rebuilds each line from a fixed field list, so any party
  field sent today would be lost.
- **Parties:** each vendor has a `TradePayablesAccountID`, each customer a
  `TradeReceivablesAccountID`, and both have `PaymentTermsDays`.
- **Invoices:** a posted Vendor Invoice credits the vendor's payables
  account with `Total`, and a Customer Invoice debits receivables with its
  `Total`. They're stored in RTDB `vendorInvoices` / `customerInvoices`,
  with nothing recording what has been paid against them.

## Structural change: take JV and CBT out of the generator

JV, CBT and their screens are generator output, so hand edits would be
overwritten if `tools/legacy-port/generate.js` is ever re-run.
**Proposed:** move them out:
- Their callables move into a hand-written `functions/src/journal.js`,
  starting from the current generated code unchanged, and `functions/index.js`
  exports them. The generator skips anything `index.js` exports by hand.
- JV and CBT come out of `tools/legacy-port/modules.json`, and
  `functions/modules/JV.html` and `CBT.html` become hand-maintained.

That move is a behavior-neutral first commit, tested on its own, before
any feature change.

## Design (proposed)

**Line tagging.** A JV or CBT line may carry:
- `PartyType`: `Vendor` or `Customer`
- `PartyID`
- `Allocations`: a list of `{ RefType: 'New' | 'Against', RefID, Amount }`

Rules:
- A tagged line's account must be that party's payables or receivables
  account.
- On any line hitting a vendor's or customer's control account, the
  party is required (see question 2).
- The allocations must add up to the line amount.

**CBT screen.** An opposite line on a payables or receivables account
shows a Vendor/Customer picker. The screen then lists that party's open
items (bills and earlier New Refs, each with date, number, due date and
outstanding) to allocate against. Any remainder becomes a New Ref. The
JV screen gets the same controls per line.

**Open items.** An open item is anything with an outstanding balance for
a party:
- a posted, unreversed invoice: outstanding = `Total` − allocated
- a New Ref from a JV/CBT line: outstanding = its amount − allocated

Each open item stores its allocated total and the entries that allocated
it, so outstanding can be read directly and an SOA can list the history.

**Direction.** An allocation must reduce the item. A payment to a vendor
(Dr Payables) settles a vendor bill (Cr Payables); a receipt from a
customer (Cr Receivables) settles a customer invoice (Dr Receivables).

**Posting** (at post, and again at the approval commit, under the global
lock):
- Re-check that every Against allocation is ≤ the item's outstanding
  *at that moment*. A draft's snapshot isn't trusted, the same rule as
  deviations #11, #14 and #16.
- Record the allocations and create any New Refs.

**Reversal.** Reversing a JV/CBT releases its allocations and cancels
the New Refs it created. If a New Ref has since been allocated, the
reversal is refused until that settlement is reversed.

**Settling an advance against a later bill.** A JV with two lines on the
same party's account: one Against the bill, one Against the advance.
They net to zero in the GL, and both items drop to zero outstanding.

**Invoices.**
- The Vendor/Customer Invoice lists show Outstanding and a payment status
  (Unpaid / Partly paid / Paid).
- An invoice with allocations can't be reversed until those payments are
  reversed (see question 5).

## Open questions for the owner

1. **Reference types:** only New Ref and Against Ref? Or also Tally's
   **On Account** (party-tagged but not bill-wise) and a separate
   **Advance** type?
2. **Mandatory tagging:** must every new JV/CBT line on a payables or
   receivables account name the party? (Recommended: yes.)
3. **Split lines:** can one payment line settle several bills at once?
   (Recommended: yes.)
4. **Advance settlement:** by a JV as described, or a "settle advance"
   action on the invoice itself?
5. **Invoice reversal with payments allocated:** refuse until the payment
   is reversed (recommended), or release the allocation automatically,
   turning the payment into an on-account amount?
6. **Historical payments:** CBT/JV entries already posted in production
   have no party. Leave them untagged (the SOAs then show only new
   activity plus invoices), or build a one-off tool to tag them?
7. **Due dates:** invoice date + the party's `PaymentTermsDays`, for
   overdue marking and aging. Correct?
8. **Structural change:** agree to taking JV and CBT out of the generator
   as described above?
