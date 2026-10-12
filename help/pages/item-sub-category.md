---
title: Item Sub Category
area: inventory
order: 3
modules: [ITEMSUBCAT]
sources: [functions/src/masterData.js]
summary: Group items by type or line so stock and reporting match the company’s product structure.
reviewed: 2026-10-12
fingerprint: df72675a16769430
---
## What it is for

**Item Sub-Category** adds a second classification beneath Item Master's fixed item category. For example, a Raw Material item may be classified as Metals or Packaging. Each sub-category belongs to exactly one of the five fixed parent categories; this is an item-list organization/filtering aid, not a new ledger or stock category.

## Before you start

- Agree the sub-category names and which fixed parent category each belongs to: Raw Material, Semi-Finished Good, Finished Good, Consumable, or Scrap.
- Check the existing list before adding a similar label. Item Sub-Categories are shared classifications, not company-specific records.

## Step by step

1. Open **Item Sub-Category** and review the list by name, parent category, and status.
2. Select **Add Sub-Category**, choose the fixed parent category, enter a name, and save.
3. To change an existing classification, edit its name, parent category, or status. Reactivate an inactive sub-category if it should be selectable again.
4. Open Item Master and assign the sub-category to the appropriate items. Item Master filters the available sub-categories by the item's selected parent category.

## What happens in the books

Sub-Categories do not affect item-code generation, stock quantity, costing, or GL posting. The fixed parent Item Category continues to control the item's stock/production class; the sub-category provides additional classification for item setup and filtering.

## Rights

ITEMSUBCAT **access** allows viewing; **write** allows adding, editing, deactivating, and reactivating sub-categories. Item Master has its own rights for assigning a sub-category to an item.

## Questions and mistakes

- **Parent category is wrong:** edit the sub-category and choose one of the five fixed parent categories; a sub-category cannot belong to multiple parents.
- **Sub-category is missing on an item:** confirm it is Active and its parent matches the item's fixed Category.
- **Changing it does not change an item code or ledger:** that is expected; sub-category is for organization/filtering, not item numbering or accounting.
- **Cannot find company-specific settings:** sub-categories are shared; the same classification list is used across companies.

## Related pages

[Item Master](item-master.html) · [Stock Availability](stock-availability.html) · [Stock Valuation](stock-valuation.html)
