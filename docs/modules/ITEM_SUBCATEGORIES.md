# Item Sub-Categories by company

Status: **built, tested** 2026-10-14 (branch `tier2-ux-fixes`).

## The request (owner, UX testing, 2026-10-14)

"Option for new Item Category also" and "check item category and sub-category
at company level". The owner, asked how: open the category screen from Item
Master; category and sub-category at company level; then "no need heavy code
change, just add option to add more categories", shared or one company (the
Location pattern).

## Why sub-categories, not new categories

The five Item Categories (Raw Material, Semi-Finished Good, Finished Good,
Consumable, Scrap) are not a list: each has its item-code prefix and counter
(and Numbering's formats), BOM and Production rules name them, and five
screens, the import and the ported code list them. New categories would touch
all of that. Sub-categories already add groups under the five; the owner chose
this light option (2026-10-14).

## As built

- **Shared or one company's** (patches `subcat-company-save`, `-store`,
  `-store-new`): `CompanyID` on the sub-category ('' = shared), the user must
  have the company. It can't become one company's while an item of another
  company, or a shared item, uses it.
- **Items** (patch `item-subcat-company`): an item uses a shared
  sub-category or one of its own company's; a shared item only a shared one.
- **Item Master's picker** (patch `subcat-company-read`; ITEMMASTER): the
  category's shared sub-categories and the item's company's, refreshed when
  the company changes. **New…** beside Sub-Category asks first (the item
  isn't saved), then opens Item Sub-Category on its Add form with the
  category and company, with **Back to Item Master**.
- **Item Sub-Category screen** (SCREEN_EDITS): Company in the form and the
  list; the Add form and Back when opened from Item Master.
- **Master Data Import:** a Company column on the Item Sub-Categories sheet
  (duplicates checked per category and company); an item's sub-category is
  looked for among its company's and the shared ones.
- Tests: `itemSubCategories` suite (4), `itemSubCategories.ui.js` (2); the
  item, masters, import and BOM suites pass; negative controls caught (the
  item's check; Item Master's filter).
