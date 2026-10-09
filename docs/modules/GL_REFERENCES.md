# GL references: the audit sequence of each journal (agreed 2026-10-06, built 2026-10-09)

## The owner's request (2026-10-06)

> Go STK references issues.

This follows payroll step 6. Payroll journals now take their own PRL-
sequence (docs/modules/HR_PAYROLL.md, decision 48).

## What happens today

Every GL entry carries two numbers:
- its **voucher number** (JV-…, GRN-…, FAD-…), per type and year;
- its **TransactionRef**, a lifetime audit sequence across all entries.

There are three of those sequences:

| Sequence | Who takes it | Counter |
|---|---|---|
| **TXN-** | Journal Vouchers, Cash & Bank Transactions (finance) | `gl/transactionRefCounter` |
| **STK-** | everything written through the shared stock posting path | `stock/counters/transactionRef` |
| **PRL-** | payroll (step 6) | `payroll/counters/transactionRef` |

The stock path is used by:
- stock documents, rightly: GRN, Material Issue, Production, Warehouse
  Movement, Stock Adjustment, Physical Count, Delivery Note, Purchase
  Return, Sales Return, Opening stock;
- finance documents written that way only for convenience, which take
  STK- wrongly:
  - Fixed Assets: capitalization, depreciation, additional depreciation,
    retirement, Capital Work in Progress;
  - PDC: received, issued, and their clearing;
  - Recurring Journal runs;
  - Opening balances (GL and open invoices);
- Vendor Invoice and Customer Invoice. These are AP/AR documents, but
  they took STK- in Apps Script too, which is a preserved quirk
  (question 50).

## The GL report's link

The GL report opens each entry in its module, by voucher type. Every
type above has a mapping except **Opening balances** (OpeningBalance,
OpeningStock). Those go to Journal Vouchers, which says the entry can't
be found.

## Proposed

- **The finance documents take the finance sequence** (question 49), from
  their next posting. That covers Fixed Assets, PDC, Recurring Journal and
  Opening balances (GL); their reversals follow their own.
- **Stock documents keep STK-** (Opening stock included).
- **Entries already posted keep their reference** (question 51): an audit
  number is never rewritten.
- **The link:** Opening balance journals open in Opening Balances, which
  highlights the batch that posted them and shows the journal.

## Open questions

49. **The finance documents' sequence:**
    - TXN-, the same as Journal Vouchers and Cash & Bank (recommended);
    - or a prefix of their own per module (FAS-, PDC-, RJV-, OBL-).
50. **Vendor and Customer Invoices:**
    - move them to the finance sequence too (recommended: they are AP/AR
      documents);
    - or keep STK- as in Apps Script.
51. **Entries already posted:**
    - keep their reference (recommended);
    - or give them new references.

## The owner's decisions (2026-10-06)

| # | Question | Decision |
|---|---|---|
| 49 | The finance documents' sequence | **TXN-**, the same as Journal Vouchers and Cash & Bank. |
| 50 | Vendor and Customer Invoices | **The finance sequence too.** |
| 51 | Entries already posted | **Kept as they are**; only new postings change. |

## As built (2026-10-09)

- **functions/src/glWriting.js:** `transactionRefFor(voucherType)` picks
  the sequence for every entry written through the shared path:
  - payroll types → PRL- (`payroll/counters/transactionRef`);
  - `FINANCE_VOUCHER_TYPES` → TXN- (`gl/transactionRefCounter`, the
    counter Journal Vouchers and Cash & Bank already use, so the numbers
    run on from theirs): FACapitalization, FADepreciation,
    FAAdditionalDepreciation, FARetirement, FAAuCCost, FAAuCSettlement,
    PDCReceived, PDCReceivedClear, PDCIssued, PDCIssuedClear,
    RecurringJV, OpeningBalance, VendorInvoice, CustomerInvoice;
  - everything else → STK- (`stock/counters/transactionRef`).
  Their reversals use the same voucher type, so they follow their own
  sequence. Opening balance reversals (openingBalances.js, which builds
  its reversal itself) use `transactionRefFor` too.
- **Not changed:** entries already posted (decision 51); reversals made
  with the generic "Reverse" of Journal Vouchers (journal.js), which
  already took TXN-; Physical Count's clean count, which takes STK-
  (stock).
- **The GL report's link:** masterData maps OpeningBalance and
  OpeningStock to `OPENINGBALANCES`. New callable `findOpeningBatch
  ({ jvId })` returns the batch (and its company) that posted or
  reversed the journal; not found → "That journal was not posted by an
  opening balance batch."; the caller needs Opening Balances access and
  the company. The screen, opened with `OpenEntryId`, selects that
  company and highlights the batch row (scrolled into view); changing
  the company clears it.
- **Journal Vouchers' Reverse** (journal.js `reverseJournalEntry`): the
  "posted by … — reverse it from that module" refusal now comes before
  the post-right check. With the new mapping the right was looked up on
  Opening Balances, which has none, so the refusal had become "You do
  not have permission to post or reverse entries in OPENINGBALANCES".
- **Tests:** `glReferences.emulator.test.js` (4: each type's sequence;
  opening GL / invoices TXN- after JV's, opening stock STK-, reversals;
  a posted reference kept; the GL link, `findOpeningBatch` and its
  refusals) and `glReferences.ui.js` (2). Negative controls caught: a
  finance type dropped from the list; the OpeningBalance mapping
  removed; opening reversals forced to STK-; the company check removed
  from `findOpeningBatch`; the screen's highlight removed.
- **Deploy:** `tools/deploy-sets/gl-references.txt`, with `--screens`
  (OPENINGBALANCES).
