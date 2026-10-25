# Item user code (UX round 2, item 26)

**Status:** design agreed (owner, 2026-10-24, Q293: in the shell) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 3 · **Decided:** Q276 (owner,
2026-10-24)

## What was decided (Q276)

Each item may have a **user code** of the owner's choosing, apart from the
system code (e.g. RM-000123, from Numbering) and the barcodes. Where an
item has one, **lists, pickers and prints show the user code**, else the
system code; search finds either; the system code stays in the item's
details. Unique in the corporate (shared and company items alike),
ignoring case.

## What the code shows

The system code is more than a label: it's the key every document line
stores (Sales Order, GRN, Delivery Note, invoices, stock moves, BOMs,
price lists …) and the value the screens match items by. It appears in
**27 screens, about 400 places**, plus their prints and Copy to Excel. So
the system code stays the key, untouched in the data. The user code is
how it's **shown and typed**.

## The item itself (either way)

- Item Master: a **User code** field (optional), checked unique in the
  corporate ignoring case, as the username is (patch on the item save);
  searched in Item Master's list; a column in Master Import.
- The item lists the screens load carry `UserCode`.

## Q293: how the screens show it

**Decided (owner, 2026-10-24): (a), once in the shell.**

- **(a) Once, in the shell (proposed),** as dates are formatted today
  (DATE FORMAT): one block in the shell, for every screen, now and later.
  - Shown text (lists, reports, prints, Copy to Excel): text that is an
    item's system code shows its user code, the system code in its
    tooltip.
  - Typing: an item box takes the user code as well as the system code
    (and the search picker lists and finds both); the shell turns it into
    the system code before the screen sees it, so no screen's logic
    changes.
  - The one limit: inside a line's item box, once chosen, the box holds
    the system code (it's what the screen reads); the user code shows
    beside it.
  - One build, about a day; generated screens need no SCREEN_EDITS.
- **(b) Screen by screen:** each of the 27 screens and their prints
  changed to show the user code, the item boxes too. Exact everywhere, but
  several PRs, and every screen added later must remember it.

## As built (2026-10-24)

- **Server.** Patches `item-user-code` / `item-user-code-field` on
  saveItem: `UserCode`, optional, 1–30 letters, digits, `- _ / .`
  (starting with a letter or digit), unique in the corporate ignoring
  case, and never another item's system code; blank clears it. Master
  Import's Items have a **User Code** column (its update mode too).
  `getItemUserCodes` (functions/src/itemCodes.js) gives the shell
  `{ ItemCode: UserCode }` for the items of the user's companies and the
  shared ones.
- **Shell** (public/index.html, ITEM CODES, after DATE FORMAT; loaded at
  sign-in and on every return to Home, and after an Item Master save):
  - shown text whose whole text is a system code, or that starts with one
    before " — ", shows the user code, the system code in the tooltip;
  - an item box (an input with a list, or the search picker's
    `data-picker-list`) takes the user code: on change it becomes the
    list's own option for that item, and the screen hears an input as
    well; once chosen, the user code shows beneath the box
    (`.item-ucode`);
  - the search picker shows the user code as the item's code and finds the
    system code too;
  - Copy to Excel: cells that are a system code read as the user code;
    paste (the clipboard read and paste events): a first-column cell that
    is a user code becomes the system code, on a screen with an item list
    (item code is the first column of every item grid);
  - `keep-code` opts an element out (Item Master's code column and its
    form).
- **Limits.** A screen's own search box (for example a report's item
  filter) matches what that screen searches: the system code and the name,
  not the user code. Item Master's search finds either.
- **Tests:** itemUserCode suite (3), itemUserCode UI (4); negative
  controls (the system-code check on the server; shown text, and the typed
  code, in the shell) caught.
