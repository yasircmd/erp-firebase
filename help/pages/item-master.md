---
title: Item Master
area: inventory
order: 1
modules: [ITEMMASTER]
sources: [functions/src/masterData.js, functions/src/itemCategories.js]
summary: Maintain the master item record used by purchase, stock movement, valuations and stock reports.
reviewed: 2026-10-16
fingerprint: c263e3dfc2241898
---
## What it is for

**Item Master** is the core record for every stocked item. It defines the item, its stock rules, and the company data that allows purchasing and inventory movement.

## Before you start

- The item category and units are already set.
- The company has its stock accounts and item coding rules.
- The item is active for the relevant warehouse and company.

## Step by step

1. Open **Item Master** and choose the company.
2. Add or edit the item record: code, description, unit and category. The **Sub-Category** list shows the category's shared sub-categories and those of the item's company; **New…** beside it opens Item Sub-Category to add one (save the item first: you come back to Item Master and open it again).
3. Set the stock and cost details required by the company.
4. Save the item and check it appears in the stock routines.

## Categories of your own

Besides the five categories (Raw Material, Semi-Finished Good, Finished
Good, Consumable, Scrap), you can add your own, for example **Spare
Parts**. Select **New category…** under Category in the item form, then
enter:

- the **name**;
- the **code prefix** (2 to 6 letters or digits, for example SP). Its
  items get codes with it and their own running number: SP-000001,
  SP-000002 and so on. The format can be changed in
  [Numbering](numbering.html), like the five;
- which of the five it **behaves like**. That decides what a BOM, a Job
  Order and Production allow (Spare Parts behaving like Consumable can be
  a BOM component, but is not produced);
- whether it is **shared** by all companies or one company's.

Anyone who can open Item Master can add one. The new category then
appears in the Category list and the filter, after the five. Sub-categories
can sit under it ([Item Sub-Category](item-sub-category.html)).

An item's category, the five or your own, can't change after the item is
made, because its code depends on it. Existing items stay where they are.

## What happens in the books

The item master does not create a ledger entry itself. It provides the item definition that the purchase, stock issue, transfer and valuation processes use.

## Rights

Users need write access for item setup. Read access is often broader than write access.

## Questions and mistakes

- If an item does not appear on a stock screen, check the item status and the company assignment.
- If the item has no cost basis, the system will not post a trade movement correctly.
