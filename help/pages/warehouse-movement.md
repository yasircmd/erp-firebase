---
title: Warehouse Movement
area: inventory
order: 5
modules: [WAREHOUSEMOVEMENT]
sources: [functions/src/stockMovement.js]
summary: Transfer stock between warehouses or locations while keeping the ledger and balances in step.
reviewed: 2026-10-12
fingerprint: 838e68dcbc16d72e
---
## What it is for

**Warehouse Movement** moves stock from one warehouse or location to another without changing the overall company stock, but changing where it sits.

## Before you start

- Both warehouses or locations are configured.
- The item exists and the source location has stock available.

## Step by step

1. Open **Warehouse Movement**.
2. Select the source warehouse, destination warehouse and item.
3. Enter the quantity and any movement notes.
4. Post the movement and check the balances at both locations.

## What happens in the books

The warehouse balance moves from one location to another while the stock ledger keeps the history of the transfer.

## Rights

Users need access and post rights for stock transfer.

## Questions and mistakes

- If the movement is refused, check the source quantity and whether the destination warehouse is valid.
