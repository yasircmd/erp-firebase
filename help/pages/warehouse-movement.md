---
title: Warehouse Movement
area: inventory
order: 5
modules: [WAREHOUSEMOVEMENT]
sources: [functions/src/warehouseMovement.js, functions/src/stockMovement.js]
summary: Transfer stock between warehouses or locations while keeping the ledger and balances in step.
reviewed: 2026-10-17
fingerprint: 859a50ca6ca5bbc2
---
## What it is for

**Warehouse Movement** transfers an item quantity between two different warehouse/rack locations within the same company. It preserves total company inventory value while changing the physical location, and can be gated by Approval Configuration.

## Before you start

- Both source and destination are active Warehouse or Rack organizational units usable by the company.
- The item is active and the source location has enough quantity; the item has a valid UOM and batch details where required.
- The date is in an open period and the transfer's reason/description is documented.
- Approval Configuration is set if the business requires approval for this movement.

## Step by step

1. Open Warehouse Movement and create a document. Select company, date, description, optional reference, and default reporting dimensions.
2. Add lines by scanning/searching or pasting from Excel. For each line choose item, From Location, To Location, line description, UOM, positive quantity, batch when required, and cost/profit center as needed.
3. Confirm the source and destination differ, the entered unit is the item's base or configured alternate UOM, and the source has enough stock. The available quantity is a reference while editing; the server validates at posting.
4. Save as Draft or post. If approval is configured, posting submits the document and no stock moves until approval; a rejected movement can be corrected and resubmitted.
5. After posting, verify source and destination quantities in Stock Ledger/Availability. If incorrect, use Reverse Movement with a reason rather than editing posted lines.

## What happens in the books

No GL journal is created: moving stock within the company does not change its total value. The stock ledger records an Out at the source and an In at the destination at the same resolved cost; batch and receipt-age information move with the stock. Newly available stock at the destination can be allocated to open Sales Order shortfalls.

## Rights

WAREHOUSEMOVEMENT **access** controls viewing, **draft** creates/edits/deletes Draft documents, and **post** submits/posts, approves/rejects where assigned, and reverses. Company access applies.

## Questions and mistakes

- **Movement is refused:** check source quantity, valid Warehouse/Rack locations, different From/To, UOM conversion, positive quantity, description, and required batch number.
- **No quantity moved while pending approval:** this is expected; approval gates the stock ledger update.
- **No GL voucher appears:** this transaction has no GL entry by design; inspect stock ledger balances at both locations.
- **Destination Sales Order reservation changed:** inbound stock may automatically fill open order shortfalls at the destination.
- **Movement date is closed:** use an open date or follow Period Closing; do not bypass the period lock.

## Related pages

[Organizational Units](org-units.html) · [Stock Ledger](stock-ledger.html) · [Stock Availability](stock-availability.html) · [Approvals](approvals.html)
