# Item categories beyond the five (UX Tier 3, N)

Status: **built** 2026-10-16 (branch tier3-wave2); design agreed by the owner the same day (UX_TIER3.md round 15).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, N).
The owner chose sub-categories first (Tier 2, 2026-10-16: "just add an
option to add more categories", ITEM_SUBCATEGORIES.md). This item is only
needed if sub-categories don't cover it.

## Today

- **The five categories** are Raw Material (RM), Semi-Finished (SFG),
  Finished Good (FG), Consumable (CONS) and Scrap (SCRAP). They are fixed
  in the ported code, Numbering, Master Data Import and five screens.
- What hangs on them:
  - **the item code:** the prefix and its own sequence (RM-0001 …);
  - **BOM:** a parent must be FG or SFG, a component RM, SFG or CONS;
  - **Job Orders and Production:** FG or SFG with an active BOM;
  - the **reports**, which filter and group by them.

  A category can't change after an item is made.
- **Stock, costing, the GL and sales don't depend on the category:** each
  item has its own inventory, consumption, sales COGS and write-off
  accounts.
- **Sub-categories** (live 2026-10-16) sit under one of the five, shared
  by all companies or one company's, and can be added from Item Master
  (**New…**). They filter and group; they don't change the code.

## Proposal (only if the answer to 203 is yes)

A **category of your own**, made in a new **Item Categories** list:

- a name (e.g. Spare Parts);
- its own **code prefix** and sequence (SP-0001), formatted in Numbering
  like the five;
- **behaves like** one of the five, which decides the BOM and production
  rules (Spare Parts behaves like Consumable: a BOM component, not
  produced);
- shared by all companies or one company's, like sub-categories.

Inside the ERP the item keeps the base category it behaves like, so stock,
BOM and production don't change. The item's own category gives its code,
its name on screens and prints, and the report grouping. Sub-categories can
sit under it.

## Questions for the owner

- **203.** Do sub-categories cover it now (e.g. Consumable → Spare Parts)?
  If yes, nothing more is built (recommended until a need appears). If
  no: what categories do you need, and why must they be categories
  (their own code prefix?) rather than sub-categories?
- **204.** Must a new category have its **own code prefix** and sequence
  (SP-0001), or may its items keep the base category's codes (CONS-0101)?
- **205.** Who may add categories: Admin only (recommended), or whoever
  may change Item Master?
- **206.** Shared by all companies or one company's, like sub-categories?
  Recommended: the same choice per category.
- **207.** Existing items: stay in their base category (recommended), or
  may they be moved to a new category (their code would then change, as a
  renumbering)?

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 203 | Sub-categories **don't** cover it: build categories of your own. |
| 204 | Each has its **own code prefix** and sequence. |
| 205 | **Anyone with access** may add categories (Item Master access, not only Admin). |
| 206 | Shared by all companies or one company's, chosen per category (the recommendation). |
| 207 | Existing items stay in their category (the recommendation). |

## As built (2026-10-16)

- **functions/src/itemCategories.js** (new) keeps
  `itemCategories/{id} { Name, Prefix, BaseCategory, CompanyID, Status }`.
  - `getItemCategories` returns the five and the categories you can see
    (shared, or your companies').
  - `saveItemCategory` needs Item Master access (205: not write, not
    Admin only). Its checks:
    - a name of 2 to 60 characters, not a name of the five or another
      category in the same scope;
    - a prefix of 2 to 6 letters or digits starting with a letter,
      uppercased, not another category's;
    - the prefix must not give the same codes as any numbering type
      (vendor, customer, the five …), which `numbering.prefixClash`
      checks as Numbering itself does;
    - the base is one of the five;
    - the company is yours, or none for shared.
  - After a category is made, only its name and status change. The
    prefix, base and company stay with its items (207).
- **Codes (204):** numbering.js gives each category its own type
  `item:X-<id>`, "Item — <name>", with the code format `<Prefix>-` and 6
  digits and its counter at `itemCounters/<Prefix>`. Numbering lists the
  types and changes their format like the five (`loadItemCategoryKinds`
  in getNumbering and saveNumberingFormat).
- **Items:** patches `item-custom-category*`.
  - The item's save takes `CustomCategoryID`. `checkForItem` checks that
    the category exists, is active (for a new item), matches the item's
    base Category, and belongs to the item's company (or is shared, for a
    shared item).
  - The item keeps the base as its `Category`, so BOM, Job Orders,
    Production, stock, costing and the reports' base grouping are
    unchanged. Its code comes from the category's own type.
  - Neither the base nor the custom category changes after creation.
- **Sub-categories:** a sub-category's ParentCategory may be `X-<id>`
  (`validParent`). An item of a custom category uses that category's
  sub-categories, not the base's.
- **Screens:**
  - **Item Master** (hand-maintained) adds **New category…** under
    Category: an inline form with name, prefix, behaves like and company.
  - The custom categories appear after the five in the form and the
    filter, as "Spare Parts (SP, like Consumable)". The list shows the
    item's own category.
  - **Item Sub-Category** (generated; SCREEN_EDITS) offers them as
    parents.
- **Not done:**
  - The stock reports (Stock Valuation, Production Consumption) still
    filter and group by the five, where a custom category's items fall
    under their base.
  - Master Data Import's item sheet takes only the five. Either can follow
    if wanted.
- **Tests:** functions/test/emulator/itemCategories.emulator.test.js.
  - The category's checks, the right and the list.
  - The codes (SP-000001, SP-000002), the base kept, the checks, the lock,
    Numbering's rows and an inactive category.
  - Sub-categories under it.
