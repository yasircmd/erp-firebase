# Aging Reports: Customer, Vendor and Inventory (design, 2026-10-11)

**Owner, 2026-10-11:** "Three modules need to be developed: customer,
vendor and inventory aging report. Then we go for the month-end and
year-end module."

## Today

- **Customer SOA / Vendor SOA** already age **one party at a time**: the
  open items as at the end date (invoices, opening documents, advances,
  on-account balances), their due dates (invoice date + the party's payment
  terms, or an opening document's own due date) and five buckets: Not yet
  due, 1–30, 31–60, 61–90, 90+ days overdue
  (`functions/src/partyStatement.js`, open items from `partyLedger.js`).
- There is no view of **all** customers or vendors at once, and no
  inventory aging. Stock is held at **moving average cost** per item and
  warehouse (`stock/ledger`), with every movement in `stock/transactions`.

## Proposed

Three report modules, one screen each, own access rights (so e.g. sales
staff can see customer aging only), read-only:

### Customer Aging and Vendor Aging (one engine)

- **Filters:** company, "as at" date (default today), customer / vendor
  (one, several or all), classification, and "only overdue".
- **One row per party:** total outstanding and the buckets (decisions
  below), with the party's payment terms, credit/advance shown as decided,
  and the oldest overdue days. Totals row. Click a party to expand its open
  items (number, date, due date, days overdue, outstanding); click an item
  to open the invoice or entry, as the SOA does.
- **Same numbers as the SOA:** the same open-item engine, run once for all
  parties (the invoices and entries read once, not per party). A party's
  row equals its SOA's aging at the same date — a test checks this.
- **Pending PDCs** (received / issued, not yet cleared) shown as a column
  for information, not deducted, as in the SOA.
- **Control check:** the report total against the receivables / payables
  control accounts in the GL at the date, with the difference shown, as
  the SOA's reconciliation does.
- Copy to Excel and Print (an internal report: the title bar stays).

### Inventory Aging

- **Filters:** company, warehouse (one or all), item category, "as at"
  date (default today), "only items with stock".
- **One row per item** (per warehouse when one is chosen): quantity on
  hand, value (at the moving average cost the stock ledger holds), and
  the quantity and value in each age bucket, plus the last receipt and last
  issue dates. Totals row; Copy to Excel; Print.
- **How stock gets an age (decision 120):** the quantity on hand is taken
  to be the most recent receipts (first in, first out): walking back from
  the "as at" date through the item's receipts (GRN, production output,
  opening stock, positive adjustments and counts), each receipt's quantity
  fills the stock on hand until it is all accounted for; each part takes
  its receipt's date. Value = quantity × the current average cost (the
  books hold average cost, not per-receipt layers, so the age split is of
  quantity; the total value matches the stock ledger).
- **Warehouse transfers** keep the stock's age (a transfer is not a new
  receipt): for "all warehouses" they cancel out; for one warehouse a
  transfer in counts as a receipt dated as the stock it moved (its
  source's age, worked out the same way).
- **Returns to vendor and issues** reduce stock and need no date of their
  own under first in, first out.

## Open questions (round 7)

118. **Customer / vendor buckets.**
     - By **days overdue** (from the due date), the SOA's buckets: Not yet
       due, 1–30, 31–60, 61–90, 90+ — recommended (one meaning everywhere);
     - or by **days since the invoice date**, with the same buckets;
     - or both, with a switch on the screen.
119. **Advances and unapplied credits** (payments not matched to an
     invoice, credit notes left open).
     - A separate **"Unapplied credits"** column, subtracted to give the net
       balance; the buckets show only what is owed — recommended (no
       guessing which invoice a payment was for);
     - or applied to the oldest invoices first in the report (FIFO).
120. **How inventory is aged.**
     - **By receipt date, first in first out** (as above) — recommended:
       standard stock aging;
     - or **by last movement** (days since the item was last received or
       issued): a slow / non-moving stock report instead.
121. **Inventory buckets.**
     - 0–30, 31–60, 61–90, 91–180, 181–365, over 365 days — recommended;
     - or 0–90, 91–180, 181–365, over 365 days (fewer columns).

## The owner's decisions, round 7 (2026-10-11)

| # | Question | Decision |
|---|---|---|
| 118 | Customer / vendor buckets | **Both, with a switch on the screen**: by days overdue (from the due date: Not yet due, 1–30, 31–60, 61–90, 90+), the default and the SOA's meaning; or by days since the invoice date (0–30, 31–60, 61–90, 91–120, over 120 — "not yet due" has no meaning there). |
| 119 | Advances and unapplied credits | **A separate "Unapplied credits" column**, subtracted to give the net balance; the buckets show only what is owed. |
| 120 | How inventory is aged | **By receipt date, first in first out**; value at the current average cost. |
| 121 | Inventory buckets | **0–30, 31–60, 61–90, 91–180, 181–365, over 365 days.** |
