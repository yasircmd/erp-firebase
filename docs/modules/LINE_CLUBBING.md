# One GL line per identical posting (and the Stock Ledger report)

Status: **built** 2026-10-02, not yet live.

## The request (owner, 2026-10-02)

"In inventory to GL posting, check if each line create separate line, if
yes need to club into one total for each account. Also in stock ledger."

It did: every stock document posted one GL line per document line on
each side (a 12-line GRN gave 12 Inventory lines), and the Stock Ledger
report showed one row per line.

## The owner's rule

- **GL:** lines are one when account, cost center, profit center and
  description are all the same; anything different stays a separate line
  ("if in inventory line's description is different, it should be
  separate line in GL").
- **Stock Ledger report:** the same: "if match all cc + pc + description
  then one line".

## As built

- `functions/src/lineClubbing.js`:
  - `clubGlLines`: one line per account + side (debit or credit) + cost
    center + profit center + description, amounts summed, in the order
    each first appears. Debits and credits are never netted. A line
    tagged with a vendor or customer (with its allocations) is never
    clubbed.
  - `clubStockLines`: within one document, for one item at one warehouse:
    one row per direction + cost center + profit center + description;
    quantities and values summed; the unit cost is their average.
- **GL:** `glWriting.buildStockGlEntry` clubs the lines before checking
  and numbering them. Every entry the system posts goes through it, so the
  rule applies to all of them:
  - GRN, Material Issue, Stock Adjustment, Production, Physical Count;
  - Delivery Note, Vendor and Customer Invoices, Purchase and Sales
    Returns;
  - PDC, Fixed Assets;
  - Recurring Journal runs and Opening Balances.

  Manual JV and CBT entries are unchanged: their lines are as the user
  entered them.
- **Stock Ledger report** (`getStockLedgerReport`, patch
  `stock-ledger-report-club-lines`): the document's lines of the item at
  the warehouse are clubbed before the running balance. Closing quantity
  and value are unchanged.
- Entries posted before this keep their lines; only new postings are
  clubbed. The stock ledger balances are not affected (lines are clubbed
  for display and GL only, the stock movement is the same).

## Tests

- `lineClubbing` emulator suite (3):
  - a GRN whose identical lines give one Inventory line, while a
    different description or cost center stays separate, and the
    clearing side is one line;
  - the Stock Ledger report clubs identical rows, keeps a different
    description separate, and the closing is unchanged;
  - the rules: no netting, party lines untouched, order kept.
- Negative controls, all caught:
  - no GL clubbing;
  - description left out of the key;
  - no report clubbing.
- Full regression: 334 emulator tests. One expectation was updated: the
  opening stock test, whose four lines share account and description, now
  expects one Inventory line. Smoke and UI checks are green, apart from the
  known environment-only home failures.
