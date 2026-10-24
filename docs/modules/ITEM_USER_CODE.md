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
