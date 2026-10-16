---
title: Bill of Materials
area: production
order: 2
modules: [BOM]
sources: [functions/src/masterData.js]
summary: Define what a finished product is made of and how the materials are consumed during production.
reviewed: 2026-10-16
fingerprint: 8f30c995f35f4803
---
## What it is for

**Bill of Materials (BOM)** is the dated production recipe for a Finished Good or Semi-Finished Good. It records the components and required quantities for one unit of the parent item; Material Variance uses the BOM version effective on each production date.

## Before you start

- The parent item exists in Item Master as a Finished Good or Semi-Finished Good.
- Each component exists as a Raw Material, Semi-Finished Good, or Consumable and has a base unit of measure.
- The recipe version, effective date, component quantities per one parent unit, and expected scrap percentages have been approved by production.

## Step by step

1. Open BOM and search/filter the list by parent item or status. Select **New BOM**, or open an existing record and choose **Duplicate** to create a new version from it.
2. Select the parent Finished or Semi-Finished Good, enter the recipe version and **Effective From** date, and add notes if needed.
3. Add eligible component items. Enter quantity per one unit of the parent in the component's base UOM, plus Scrap % where applicable. Paste rows from Excel using Component Code, Quantity, and Scrap %; review the resulting UOM and quantities.
4. Save the BOM. When a BOM is marked Active, another Active BOM for the same parent is automatically deactivated. Effective dates still matter: historical reports select the recipe that applied on the transaction date, not simply today's active row.
5. Deactivate or reactivate a recipe from the list when its use changes. Keep prior versions for historical production and variance analysis; do not rewrite an old recipe to represent a later change.

## What happens in the books

Saving a BOM creates no stock or GL posting. Production uses the recipe to calculate expected components and finished output; the BOM's effective date also determines expected component usage in Material Variance reports.

## Rights

The BOM access right controls viewing; write rights control creating, editing, duplicating, and changing status. Follow the business's production-maintenance controls when granting write access.

## Questions and mistakes

- **Parent item is missing:** only active Finished Goods and Semi-Finished Goods can be parents; create or correct the item in Item Master first.
- **Component is missing:** use Raw Material, Semi-Finished Good, or Consumable items. Check the item's base UOM and active status.
- **Historical variance uses a different recipe:** check Effective From dates; a report for an earlier production date uses the version effective then.
- **Another version became inactive:** only one BOM per parent can be Active at a time. The prior version remains available for history; confirm the new effective date is correct.
- **Production standard quantity looks wrong:** quantity is per one parent unit, in the component's base UOM; verify quantity and Scrap % before saving.

## Related pages

[Item Master](item-master.html) · [Production](production.html) · [Production & Consumption](production-consumption.html) · [Material Variance](material-variance.html)
