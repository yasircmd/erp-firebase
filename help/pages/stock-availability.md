---
title: Stock Availability
area: inventory
order: 8
modules: [STOCKAVAILABILITY]
sources: []
summary: Review sellable item on-hand, active sales-order reservations, and free quantity by warehouse.
reviewed: 2026-10-24
fingerprint: 22c41a9c14c5f52c
---
## What it is for

**Stock Availability** is a current snapshot for sellable items: it shows on-hand quantity, active Sales Order reservations, and free quantity for each item/warehouse. Free is on-hand minus reserved; it does not include purchase orders that are on order.

## Before you start

- Items are active and have a price on a Price List; the report uses the same sellable-item definition as Sales Order.
- Stock transactions and active reservations are up to date for the company.
- The user has Stock Availability report access and company access.

## Step by step

1. Open Stock Availability and select the company. The report loads item/warehouse rows with nonzero on-hand or reserved quantity.
2. Search by item code/name, optionally filter to a warehouse, or tick **Negative free stock only** to find rows where active reservations exceed on-hand.
3. Compare On-Hand, Reserved, and Free. Use the item/warehouse row that matches the sales promise or warehouse request; a company-wide total can hide a shortage at a particular location.
4. To see what a **Reserved** quantity is for, select it: the Sales Orders reserving it show under the row (number, date, customer and quantity, oldest first). Select an order's number to open it, if you may open Sales Orders. Select the quantity again to close the list.
5. For a replenishment view that includes approved purchase orders, use [Reorder / Low Stock Report](reorder.html) instead.

## What happens in the books

This report is read-only. It does not reserve stock, change stock, or post a journal. On-Hand comes from the stock ledger; Reserved comes from active Sales Order reservations.

## Rights

STOCKAVAILABILITY **access** controls viewing, limited to companies the user can access.

## Questions and mistakes

- **Item is missing:** it must be active and priced on at least one Price List; raw material/WIP without a selling price is intentionally excluded.
- **Free is negative:** select the Reserved quantity to see which Sales Orders hold it, and review them and actual on-hand by warehouse; this view does not include inbound purchase orders.
- **Company total seems sufficient but order can't ship:** reservations and stock are location-specific; compare the order's warehouse row.
- **A posted receipt/issue is absent:** verify the source transaction's company, warehouse, status, and stock ledger update.

## Related pages

[Reorder / Low Stock Report](reorder.html) · [Stock Ledger](stock-ledger.html) · [Sales Order](sales-order.html)
