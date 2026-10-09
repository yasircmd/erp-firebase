# GL references: the audit sequence of each journal (proposed 2026-10-06)

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
