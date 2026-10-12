---
title: Units of Measure
area: inventory
order: 2
modules: [UOM]
sources: []
summary: Configure active unit codes and quantity precision; alternate-unit conversions are maintained per item.
reviewed: 2026-10-12
fingerprint: 4b99bd3bedda06e2
---
## What it is for

**Units of Measure (UOM)** maintains the available unit codes and whether quantities in each unit must be whole numbers or may use decimals. It does not define a global conversion table; an item's alternate unit and conversion factor are maintained on that item in Item Master.

## Before you start

- The business has agreed its unit codes/names and quantity precision rules.
- Item owners know the base UOM and any alternate-UOM conversion factor required for each item.
- Default units (PCS, KG, LTR, MTR, BOX) are seeded when needed; review the existing list before adding duplicates.

## Step by step

1. Open UOM and review each code, name, decimal rule, and status.
2. Add a unit with a unique code (up to 8 characters), name, and **Allow decimals** setting. If decimals are allowed, set the permitted decimal places from 0 to 6.
3. Keep units inactive rather than deleting a unit that may be referenced by existing items or transactions.
4. In Item Master, assign the item's base UOM and optional alternate UOM/conversion factor. Test a transaction in both units and verify the stored base quantity.

## What happens in the books

UOM setup does not post a journal. Its precision rules validate entered quantities; the item's conversion factor converts an allowed alternate UOM into its base quantity for stock movements and reports.

## Rights

UOM access controls viewing; the UOM write right controls adding, editing, and activating/deactivating units. Item Master has separate rights for assigning units and item-specific conversion factors.

## Questions and mistakes

- **Fractional quantity is rejected:** the selected unit is configured as whole numbers only; either enter a whole quantity or ask the setup owner to confirm whether decimals should be allowed.
- **Alternate unit is unavailable:** configure it on the item in Item Master; UOM itself does not create item conversions.
- **Converted stock quantity is wrong:** verify the item's conversion factor and whether the transaction entered base or alternate units.
- **Unit is inactive:** reactivate it only if new transactions should use it; historical documents keep their recorded quantities.

## Related pages

[Item Master](item-master.html) · [Stock Adjustment](stock-adjustment.html) · [Warehouse Movement](warehouse-movement.html)
