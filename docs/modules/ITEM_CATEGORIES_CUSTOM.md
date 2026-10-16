# Item categories beyond the five (UX Tier 3, N)

Status: **design agreed** (owner, 2026-10-16; UX_TIER3.md round 15).
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
