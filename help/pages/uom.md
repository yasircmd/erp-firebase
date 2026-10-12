---
title: Units of Measure
area: inventory
order: 2
modules: [UOM]
sources: [functions/src/masterData.js]
summary: Define the units used by stock transactions and reporting, including conversions where needed.
reviewed: 2026-10-12
fingerprint: 2388d04570609c33
---
## What it is for

**Units of Measure (UOM)** defines how quantities are represented in the ERP and how one unit converts to another.

## Before you start

- The team knows the real handling units used by the business.
- The item categories are already planned.

## Step by step

1. Open **UOM**.
2. Add the base units used by the business and the conversion rules between them.
3. Save and test the unit on a simple item or stock transaction.

## What happens in the books

UOM controls the quantity and conversion basis used by stock movements and reports. It does not post a journal entry on its own.

## Rights

This screen is usually restricted to admin or stock setup users.

## Questions and mistakes

- A transaction can fail if the chosen unit is not valid for the item.
- Conversion mismatches are common, so check each unit before posting stock.
