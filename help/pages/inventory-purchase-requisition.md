---
title: Inventory Purchase Requisition
area: procurement
order: 4
modules: [INVENTORYPURCHASEREQUISITION]
sources: [functions/src/stockMovement.js]
summary: Raise a stock requisition for inventory needs before the warehouse buys and receives the goods.
reviewed: 2026-10-12
fingerprint: 2008d03a02797ec3
---
## What it is for

**Inventory Purchase Requisition** is the stock-specific version of a purchase request. It is used when a warehouse or department asks for a stock purchase before a supplier order is raised.

## Before you start

- The stock item and warehouse details are known.
- The item is in Item Master and is active for purchase.
- The workflow and any approval steps are ready.

## Step by step

1. Open **Inventory Purchase Requisition** and choose the company.
2. Add the item, quantity and warehouse or location.
3. Add any notes for the purchasing team.
4. Submit it for approval when required.
5. When approved, it can be used to raise the purchase order.

## What happens in the books

This requisition still does not post a financial entry; it is a control document that prepares a future stock purchase.

## Rights

Requestors need access and draft rights. Approvers need the approval right for the requisition.

## Questions and mistakes

- If a warehouse does not appear, the warehouse or company setup may be incomplete.
- If a stock item is not available, check its item master and item status.
