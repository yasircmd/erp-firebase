---
title: Item Master
area: inventory
order: 1
modules: [ITEMMASTER]
sources: [functions/src/masterData.js, functions/src/itemCategories.js, functions/src/itemSearch.js]
summary: Maintain the master item record used by purchase, stock movement, valuations and stock reports.
reviewed: 2026-11-14
fingerprint: b6cbcb33a108946f
---
## What it is for

**Item Master** is the core record for every stocked item. It defines the item, its stock rules, and the company data that allows purchasing and inventory movement.

## Before you start

- The item category and units are already set.
- The company has its stock accounts and item coding rules.
- The item is active for the relevant warehouse and company.

## Step by step

1. Open **Item Master** and choose the company.
2. Add or edit the item record: code, description, unit and category. The **Sub-Category** list shows the category's shared sub-categories and those of the item's company (while the item has no company yet, every company's, named with their company: choosing one gives the item that company); **New…** beside it opens Item Sub-Category to add one (save the item first: you come back to Item Master and open it again).
3. Set the stock and cost details required by the company.
4. Save the item and check it appears in the stock routines.

## Finding an item

The list shows the items **100 at a time**, in code order. **Load more**
below it adds the next 100; the count above says how many are shown so far.

- **Search** looks through every item, not only those shown: type the
  start of an item code or user code, a word of the name, or part of a
  word (from 3 letters: "olt" finds *Hex Bolt*). Type several words to
  narrow it: each must be in the item. A barcode typed or scanned whole
  finds its item. The best matches show first, up to 200; type more to
  narrow it.
- The **Category**, **Company** and **Status** filters choose the items
  listed, from every item.
- **Copy to Excel** copies every item the filters and search keep (not
  only the page shown), one row each: item code, user code, name,
  category, sub-category, unit, company, batch tracking and status. Paste
  it into Excel.
- In **Labels**, type part of an item's code, name or barcode to find it,
  then enter how many labels to print. Items you have given a number stay
  in the list while you search for more.
- Under **Barcodes for own products**, **Preview numbers for items without
  a barcode** finds them among every item of the category chosen, up to
  500 at a time.

## Your own item code

The system gives each item its **item code** from its category (for
example RM-000123). You can also give an item a **User code** of your own
in the item form, for example *BRG-6204* or *A100*: up to 30 letters,
digits, - _ / or . (starting with a letter or digit).

- Everywhere else in the ERP, the item shows its user code in place of the
  item code: lists, reports, prints and what you copy to Excel. Hold the
  mouse over it to see the item code.
- Where you enter an item on a line, you can type either code, and the
  search list shows and finds both. Once chosen, the box shows the item
  code with the user code beneath it.
- A pasted line can have the user code in its first column.
- A user code is unique in your organisation (ignoring capitals), and can't
  be another item's item code. Leave it blank for none.
- Item Master itself shows both: the item code, with the user code
  beneath it. Search finds either.

The item code stays what the ERP stores on every document, so adding or
changing a user code changes nothing already entered.

## Its tax

**Tax code** is the code a document line takes for the item, from the
company's [Tax Configuration](tax-configuration.html) (for example SR for
standard-rated VAT, GST18 for 18% GST). **HSN / SAC** is India's
classification: an HSN code for goods (4, 6 or 8 digits), a SAC code for
services (6 digits starting 99). Both are optional where the company has no
use for them.

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
