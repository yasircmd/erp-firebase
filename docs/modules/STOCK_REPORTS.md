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
