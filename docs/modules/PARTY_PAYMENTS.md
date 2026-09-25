# Party Payments & Bill-wise Allocation (JV and CBT)

**Status:** design agreed · **Roadmap:** [#0](../ROADMAP.md)

## Purpose

Let JV and CBT record **which vendor or customer** a payment, receipt or
adjustment belongs to, and **how it's allocated**:
- **New Ref:** a new open item for the party, such as an advance paid
  before any bill exists.
- **Against Ref:** offsets one or more bills already posted (Vendor or
  Customer Invoices), or an earlier New Ref such as an advance.

CBT handles payments and receipts. JV handles adjustments: discount,
writing off a balance, settling an advance against a bill.

This settles roadmap decision #0 (tag payments with a party, plus
allocation against bills). It's the base for Vendor SOA and Customer SOA,
and gives every invoice an outstanding amount.

## Owner decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 0 | Scope | Tagging **and** bill-wise allocation now |
| 1 | Reference types | New Ref and Against Ref only (an advance is a New Ref) |
| 2 | Mandatory tagging | Yes: every line on a vendor's or customer's control account must name the party |
| 2a | Which account a tagged line may use | Only that party's own `TradePayablesAccountID` / `TradeReceivablesAccountID`. Discount and write-off amounts go on the other line |
| 3 | Split lines | Yes: one line can settle several bills |
| 4 | Advance settlement | A JV with two lines on the party's account, one Against the bill, one Against the advance |
| 5 | Invoice reversal with payments allocated | Refused until those payments are reversed |
| 6 | Historical payments | Left untagged. Invoices posted before this start fully outstanding; anything already paid needs a settling JV |
| 7 | Due dates | Invoice date + the party's `PaymentTermsDays` |
| 8 | Structural change | JV and CBT move out of the generator first, as a separate commit with no behavior change |

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
  `TradeReceivablesAccountID`, and both have `PaymentTermsDays` and an
  optional `CompanyID`.
- **Invoices:** a posted Vendor Invoice credits the vendor's payables
  account with `Total`, and a Customer Invoice debits receivables with its
  `Total`. They're stored in RTDB `vendorInvoices` / `customerInvoices`,
  with nothing recording what has been paid against them.

## Structural change: JV and CBT out of the generator

JV, CBT and their screens were generator output, so hand edits would be
overwritten if `tools/legacy-port/generate.js` were re-run.
- Their 8 callables (`saveJournalDraft`, `saveCbtDraft`,
  `deleteJournalDraft`, `postJournalEntry`, `decideJournalEntryApproval`,
  `reverseJournalEntry`, `getJournalEntries`, `getCbtEntries`) move into a
  hand-written `functions/src/journal.js`, starting from the generated code
  unchanged, and `functions/index.js` exports them. The generator already
  skips anything `index.js` exports by hand.
- JV and CBT stay in `tools/legacy-port/modules.json` (the generator
  still scans their original screens for the shared calls such as
  `getDefaultCurrency`), but a new `handScreens` list stops it writing
  their `functions/modules/*.html`, which are now hand-maintained. The
  same list covers VENDORINVOICE and CUSTOMERINVOICE, whose screens get an
  Outstanding column.
- A `keep` list makes the generator always emit the `codegs.js` helpers
  that hand-written code imports, so a re-run can't drop them.

That move is a behavior-neutral first commit, tested on its own, before
any feature change.

## Design

### Line tagging

A JV or CBT line may carry:
- `PartyType`: `Vendor` or `Customer`
- `PartyID`, plus `PartyName` (snapshot for display)
- `Allocations`: a list of `{ RefType: 'New' | 'Against', RefID, Amount }`

Rules, checked at save and again at post:
- A line on any vendor's payables account or any customer's receivables
  account must name a party (decision 2).
- A tagged line's account must be that party's own control account
  (decision 2a). A tag on any other account is refused.
- A party restricted to a company can only be used in that company's
  entries.
- The allocations must add up to the line amount. A tagged line sent with
  no allocations gets one New Ref for its full amount. At most one New
  Ref per line.

### Open items and outstanding: derived, not stored

An open item is anything with an outstanding balance for a party:
- a posted Vendor/Customer Invoice that isn't a reversal, isn't reversed
  and isn't pending reversal approval: `RefID = VendorInvoice:<id>` or
  `CustomerInvoice:<id>`, amount = `Total`, side Cr (vendor) or Dr
  (customer)
- a New Ref on a posted JV/CBT line: `RefID = NewRef:<jvId>:<lineNo>`,
  amount and side from the line

Outstanding = amount − the Against allocations on **live** entries, where
live means Posted, not reversed and not itself a reversal.

Nothing about allocations is stored outside the journal entries. The
earlier draft proposed a separate open-items store; deriving it instead
means there is one source of truth and nothing to keep in sync. Posting,
reversal, Data Reset and "clear selected records" all stay consistent on
their own, and every allocation is committed by the single write of its
own entry.

To find them cheaply, each entry also stores `PartyKeys`
(`['Vendor:V1', …]`) and `AllocatedRefs` (the Against RefIDs). Both are
array-contains queries on one field, so no composite index is needed.

### Direction

An allocation must reduce the item: the line's side (Dr/Cr) must be
opposite to the item's. A payment to a vendor (Dr Payables) settles a
vendor bill (Cr Payables). A receipt from a customer (Cr Receivables)
settles a customer invoice (Dr Receivables). An advance paid (Dr
Payables, New Ref) is settled by a Cr Payables line Against it.

### Posting

At `postJournalEntry` (under the global lock), every Against allocation
is re-checked against the item's outstanding *at that moment*, including
several lines of the same entry against one item. A draft's snapshot
isn't trusted, the same rule as deviations #11, #14 and #16.

With an approval gate the entry goes to PendingApproval and allocates
nothing yet. `decideJournalEntryApproval` now takes the global lock and,
on an Approve, re-checks the allocations first. If they no longer fit,
the approval is refused with the reason, and the approver can Reject it
back for editing. This also closes the "TXN reference assigned without
the lock" quirk for this path.

### Reversal

Reversing a JV/CBT releases its allocations automatically, since the
reversed entry no longer counts as live. It's refused while any New Ref
it created is allocated by another live entry: that settlement must be
reversed first. The reversal entry keeps the party tags, for the SOA, but
carries no allocations.

A reversal can't itself be reversed when it has party-tagged lines. That
would re-post the payment in the GL without re-allocating it. Post a new
entry instead.

### Invoices

- `requestReverseVendorInvoice` / `requestReverseCustomerInvoice` and
  their reversal-approval decisions refuse while any live entry allocates
  against the invoice (decision 5). They're wrapped by hand, under the
  global lock, around the generated functions.
- `getVendorInvoiceEntries` / `getCustomerInvoiceEntries` add
  `Outstanding`, `PaymentStatus` (Unpaid / Partly paid / Paid) and
  `DueDate` to each posted invoice. The invoice lists show them.

### New callables

- `getPartyAccounts({ companyId })`: vendors and customers usable in that
  company, with their control account codes. The screens use it to know
  which lines need a party.
- `getPartyOpenItems({ partyType, partyId, companyId, excludeJvId })`:
  that party's open items with date, number, due date, side and
  outstanding. `excludeJvId` leaves out the entry being edited.

Both need access to JV or CBT.

### Screens

- **CBT and JV:** a line whose account is a party control account shows a
  Party picker. After choosing the party, an Allocate panel lists its open
  items (items on the opposite side only), each with an amount box. The
  remainder becomes a New Ref automatically.
- A posted entry shows each line's party and allocations.
- **Vendor/Customer Invoice lists:** Outstanding and payment status
  columns.

## Known gaps

- On the approval path, `decideApprovalForDocument_` writes Status Posted
  and the TXN reference follows in a second write, as before. The
  allocations are already on the entry, so no data is split between the
  two writes.
- Historical payments stay untagged (decision 6).
