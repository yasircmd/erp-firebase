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

## As built (2026-10-11)

**Three modules** (rights `access`; default Admin, Finance Manager,
Accountant, Viewer), read-only:

- **Customer Aging** (`CUSTOMERAGING`) and **Vendor Aging** (`VENDORAGING`):
  one screen template (`screens/CUSTOMERAGING.html`; Vendor's is built by
  `node tools/build-aging-screens.js`, its `--check` run in the UI check).
  - Filters: company, "as at" date (default today), **Age by**: days
    overdue (Not yet due, 1–30, 31–60, 61–90, 90+) or days since the
    invoice date (0–30, 31–60, 61–90, 91–120, 120+); search; "only with
    something overdue".
  - One row per party with anything open: terms, the buckets, Owed,
    **Unapplied credits** (advances and open credits, decision 119), Net
    balance, pending PDCs (information, not deducted); totals. Click a row
    for its open items (document, type, date, due date, days,
    outstanding); **SOA** opens that party's statement for the year to
    the date.
  - **The GL check:** the control account(s) the company's parties use, at
    the date, against the report's net total ("agrees" or the difference).
    Not shown when a control account is shared with the other kind of
    party.
  - Copy (to Excel) and Print (an internal report: the title bar stays).
- **Inventory Aging** (`INVENTORYAGING`): company, warehouse (or all),
  category, "as at"; one row per item: on hand, value, the six buckets
  (values, or quantities with "Show quantities"), last receipt and issue;
  totals; Copy; Print. A ⚠ marks an item issued beyond the receipts on
  record (that part has no age).

**Server:** `functions/src/agingReports.js` — callables `getPartyAging`
and `getInventoryAging`.
- Parties: the invoices, journal entries and PDCs read once for the whole
  company; each party's open items from the same code as the SOA
  (`partyLedger.openItemsFrom`, `partyStatement.openItemRows`, both
  factored out of the SOA for this, which works as before).
- Inventory: the posted stock movements up to the date, a reversed
  document dropping out with its reversal (when that is also on or before
  the date), replayed in date order with first-in-first-out layers per
  item and warehouse; a warehouse transfer moves the layers it takes,
  keeping their dates. Value: the movements' own values (moving average),
  split across the buckets in proportion to the quantities.

**Screens** draw only the latest Run's answer (an older one answering late
is dropped), as fixed in Retail Sales.

**Tests:** `agingReports.emulator.test.js` (4: vendor buckets both ways,
unapplied credits, the GL check, each vendor agreeing with its SOA, an
earlier date; customer advance and a pending PDC; access; inventory first in
first out, a transfer keeping its age, a reversed receipt, a draft and
another company left out, the value as the stock ledger, one warehouse,
category), `test/ui/agingReports.ui.js` (4). Six negative controls, all
caught.

**Deploy:** `tools/deploy-sets/aging-reports.txt` with `--screens`. In the
app: menu nodes for the three reports and their access.
