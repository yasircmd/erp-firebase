---
title: Item Sub Category
area: inventory
order: 3
modules: [ITEMSUBCAT]
sources: [functions/src/masterData.js]
summary: Group items by type or line so stock and reporting match the company’s product structure.
reviewed: 2026-10-16
fingerprint: d7842de71ae04408
---
## What it is for

**Item Sub-Category** adds a second classification beneath Item Master's fixed item category. For example, a Raw Material item may be classified as Metals or Packaging. Each sub-category belongs to exactly one of the five fixed parent categories; this is an item-list organization/filtering aid, not a new ledger or stock category.

## Before you start

- Agree the sub-category names and which fixed parent category each belongs to: Raw Material, Semi-Finished Good, Finished Good, Consumable, or Scrap.
- Check the existing list before adding a similar label. A sub-category is either **shared** by all companies or belongs to **one company**, as items do.

## Step by step

1. Open **Item Sub-Category** and review the list by name, parent category, and status.
2. Select **Add Sub-Category**, choose the fixed parent category and the company (or *All Companies — shared*), enter a name, and save. From Item Master, **New…** beside Sub-Category opens this form with the item's category and company already chosen; **Back to Item Master** returns (the item is opened again).
3. To change an existing classification, edit its name, parent category, or status. Reactivate an inactive sub-category if it should be selectable again.
4. Open Item Master and assign the sub-category to the appropriate items. Item Master offers the sub-categories of the item's parent category that are shared or belong to the item's company; a shared item can use only shared ones.

## What happens in the books

Sub-Categories do not affect item-code generation, stock quantity, costing, or GL posting. The fixed parent Item Category continues to control the item's stock/production class; the sub-category provides additional classification for item setup and filtering.

## Rights

ITEMSUBCAT **access** allows viewing; **write** allows adding, editing, deactivating, and reactivating sub-categories. Item Master has its own rights for assigning a sub-category to an item.

## Questions and mistakes

- **Parent category is wrong:** edit the sub-category and choose one of the five fixed parent categories; a sub-category cannot belong to multiple parents.
- **Sub-category is missing on an item:** confirm it is Active and its parent matches the item's fixed Category.
- **Changing it does not change an item code or ledger:** that is expected; sub-category is for organization/filtering, not item numbering or accounting.
- **A sub-category is missing for a company:** it belongs to another company; make one for this company or a shared one.
- **Can't make a sub-category one company's:** an item of another company, or a shared item, already uses it.

## Related pages

[Item Master](item-master.html) · [Stock Availability](stock-availability.html) · [Stock Valuation](stock-valuation.html)
