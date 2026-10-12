# Expiry / Batch Report and Reorder / Low Stock Report (design, 2026-10-12)

**Owner, 2026-10-12:** "Now do the below modules: 1. Expiry / Batch report
2. Reorder / Low Stock Report."

## Today

- **Batches and expiry:** an item can be "Batch / Expiry tracked" (Item
  Master). Such an item needs a batch number whenever stock comes in (GRN,
  Production output, Stock Adjustment increase, Physical Count, Warehouse
  Movement, Opening Stock); GRN, Production and Opening Stock also record an
  expiry date. Going out (Material Issue, Delivery Note, Retail Sale), the
  batch is only an optional reference.
- **The stock ledger has no batch dimension:** quantities are kept per item
  and warehouse. So "how much of batch B is left" has to be worked out from
  the movements.
- **Reorder:** an item has one **Reorder Level** (Item Master, optional),
  for the item as a whole; no reorder quantity or maximum. Stock on order
  (purchase orders not yet received) and stock reserved for sales orders
  are known.

## Proposed: two report modules, read-only, own access rights

### Expiry / Batch Report (`BATCHEXPIRY`)

- **Filters:** company, warehouse (or all), category, "as at" date
  (default today), "expiring within" (days), batch-tracked items only.
- **One row per item, warehouse and batch** still in stock: batch number,
  received date, expiry date, days to expiry (negative = expired), quantity,
  value (average cost), and a status: Expired, Expiring (within the window),
  OK, No expiry date.
- Sorted by expiry date (soonest first); totals of expired and expiring
  value; Copy to Excel; Print; a row opens the Stock Ledger for that item.
- **How a batch's remaining stock is found** (question 144 below).

### Reorder / Low Stock Report (`REORDER`)

- **Filters:** company, warehouse (or all), category, "only below the
  reorder level".
- **One row per item** with a reorder level: on hand, reserved (sales
  orders), on order (purchase orders not yet received), available, the
  reorder level, the shortfall, and a suggested quantity to order; last
  receipt and issue dates; items with no stock at all show too.
- Copy to Excel; Print.

## Open questions (round 12)

144. **A batch's remaining stock** (issues usually don't name a batch).
     - **First expiry, first out (FEFO):** what goes out is taken from the
       batch that expires first (a named batch on the issue is taken from
       that batch) — recommended: what a well-run store does;
     - or first in, first out by receipt date;
     - or no quantities: a list of the batches received and their expiry
       dates only.
145. **"Expiring":** within a number of days chosen on the screen (default
     **90**) — recommended; or fixed bands (expired, 0–30, 31–60, 61–90,
     over 90).
146. **The reorder level's comparison.**
     - **Available = on hand − reserved + on order**, compared with the
       reorder level — recommended (what is really coming and going);
     - or on hand only.
147. **The suggested quantity.**
     - **The shortfall up to the reorder level** (no new fields) —
       recommended for now;
     - or a new **Reorder Quantity** field per item (the usual order size),
       suggested whenever the item is below its level.

## The owner's decisions, round 12 (2026-10-12)

| # | Question | Decision |
|---|---|---|
| 144 | A batch's remaining stock | **First expiry, first out**; a batch named on an issue is taken from that batch. |
| 145 | "Expiring" | **Within a number of days chosen on the screen, default 90.** |
| 146 | The reorder comparison | **Available = on hand − reserved + on order.** |
| 147 | The suggested quantity | **The shortfall up to the reorder level** (no new fields). |

## As built (2026-10-12)

- **Server:** `functions/src/stockReports.js`, two read-only callables,
  each behind its own module's access right (default Admin, Finance
  Manager, Accountant, Viewer, as the aging reports) and the user's
  companies:
  - `getBatchExpiryReport({ companyId, asOf, warehouseId, category,
    withinDays, batchTrackedOnly })`. `asOf` defaults to today,
    `withinDays` to 90 (a whole number 0–3650), `batchTrackedOnly` to true.
    The posted movements up to the date (a reversed document and its
    reversal both left out, as Inventory Aging) are replayed per item and
    warehouse into batch layers:
    - a receipt adds a layer (batch, expiry, receipt date, quantity);
    - an issue takes from the batch it names first, then **first expiry,
      first out** (no expiry date last; equal expiry by receipt date);
    - a Warehouse Movement takes the same way and moves those layers, so a
      batch keeps its expiry and receipt date in the new warehouse;
    - a receipt of a batch with no expiry date takes the date an earlier
      receipt recorded for that item and batch (Physical Count, Stock
      Adjustment and Warehouse Movement receipts carry no expiry date).
    One row per item, warehouse and batch (layers of the same batch and
    expiry merged, the earliest receipt shown), sorted by expiry date.
    Status: **Expired** (expiry before the date), **Expiring** (up to the
    date + N days), **OK**, **No expiry date**. Value: the quantity at the
    item-and-warehouse's average value (the replayed value ÷ quantity).
    Totals by status.
  - `getReorderReport({ companyId, warehouseId, category, onlyBelow })`.
    `onlyBelow` defaults to true. For each active item of the company with
    a Reorder Level above 0:
    - **On hand:** the stock ledger, in the company's warehouses (or the
      chosen one);
    - **Reserved:** Active stock reservations (sales orders);
    - **On order:** Approved purchase orders of the company, ordered less
      received per line (the item matched by its code; a line with no
      warehouse counts only when all warehouses are shown);
    - **Available** = on hand − reserved + on order; **Shortfall** =
      level − available (not below 0); **Suggested order** = the
      shortfall. Low items first, the largest shortfall (as a share of
      the level) first.
    - Last receipt and last issue dates from the posted movements (a
      transfer counts only when one warehouse is shown).
- **Assumption, PO units:** a purchase order line's quantity is compared
  with its received quantity as they stand. GRN adds received quantities in
  the item's base unit, and GRN's own "remaining on the PO" does the same
  sum, so an order entered in another unit is treated as GRN treats it.
- **Screens:** `screens/BATCHEXPIRY.html` and `screens/REORDER.html`
  (Stock Reports, modelled on Inventory Aging):
  - company (picked alone when the user has one), warehouse, category,
    Run; only the latest Run draws; search, Copy to Excel (tab-separated),
    Print.
  - Expiry / Batch: "as at", "expiring within" days, "batch-tracked items
    only"; four totals (expired, expiring, OK, no expiry date); a status
    filter on screen (all, expired, expiring, both, OK, none); a row opens
    the Stock Ledger for that item and warehouse from its receipt date,
    with Back.
  - Reorder: "only items below their reorder level" (re-runs when
    switched); low rows flagged.
- **Registries:** modules `BATCHEXPIRY` and `REORDER` (access only), menu
  nodes under Inventory Management after Inventory Aging.
- **Tests:** the `stockReports` emulator suite (3): first expiry first out
  over first receipt, a named batch, a transfer keeping batch and expiry, a
  later receipt taking the batch's expiry, the window, one warehouse, a
  reversed receipt, items not batch-tracked; a real GRN with batch and
  expiry against an approved PO, reserved and on order, a draft PO and a
  released reservation not counted, inactive and other-company items left
  out, one warehouse, the category; access and the checks. UI:
  `stockReports.ui.js` (2). Negative controls: 16, all caught. The Copy button no longer fails when the screen is left within 2 seconds of a copy (the UI check found it; Inventory Aging has the same line).
- **Not built (not asked):** a reorder quantity or maximum per item, a
  purchase requisition raised from the report, batches on outbound lines
  made compulsory.
