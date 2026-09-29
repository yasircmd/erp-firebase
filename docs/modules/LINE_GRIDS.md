# Line grids: compact, room for the name, no empty line once posted

Status: **built** (2026-09-29), not yet live.

## The request (owner, 2026-09-29)

"In Production Entry, the space of item name is less, add little more
space. Same like in similar module where line can be add for item or
account, make little compact by reduce space between rows and columns,
also after posting if the last line is empty (no item or account) remove
it."

## How it works

One rule in the app shell (`public/index.html`, the `LINE GRIDS CSS`
style block and the `LINE GRIDS` script block). It covers every entry
screen whose line grid is a `<tbody id="…-grid-body">`, and any future
screen that follows that naming:

- Production, Material Issue, Stock Adjustment, Physical Count,
  Warehouse Movement, GRN;
- JV, CBT, Vendor and Customer Invoice;
- PO, SO, PR, IPR, Job Order;
- Delivery Note, Sales and Purchase Returns.

The changes:

- **Compact:**
  - cells have less padding (about 1.5 px top and bottom, 3 px at the
    sides);
  - so do the fields inside them and the column headers.
- **Room for the name:** the Item Name / Account Name column is at least
  13rem (about 208 px) wide. In Production it was squeezed by the 12
  fixed-width columns around it.
- **No empty line once posted:**
  - Each grid keeps an empty last row to type the next line into, and
    drew it even for a posted entry.
  - When none of the grid's fields can be edited (posted, or awaiting
    approval where the screen locks it), an empty last row is hidden. A
    row counts as empty when its first field (the item or account) is
    blank.
  - A draft keeps it for typing.

## Every list and report too (owner, 2026-09-29)

"If possible also make compact for all modules, for the entry and report,
at row level."

- **All tables in every module screen** (entry lists, reports, statements,
  registers, modals) now have tighter rows and columns: about 5 px top and
  bottom, 10 px at the sides (the `COMPACT TABLES` block in the shell).
- **Unchanged:**
  - Trial Balance and GL Report keep their own, even tighter grid (their
    `…-compact` class);
  - entry line grids keep the rules above;
  - printed documents keep their own layout (the rule applies on screen
    only).

Most of these screens are generated from the Apps Script originals
(tools/legacy-port) and are never edited by hand, which is why this is
done once, in the shell.

## Tests

- `lineGrids.ui.js`:
  - a posted JV shows its two lines and no empty line, while a new draft
    keeps the empty line;
  - Production's grid has the compact padding and the item-name width;
  - the JV list's rows and header are compact, and the Trial Balance keeps
    its own tighter grid.
- Negative controls, each caught:
  - the empty line never hidden;
  - hidden in drafts too;
  - no item-name width;
  - no compact tables;
  - the general table rule winning inside line grids;
  - the Trial Balance not excluded.

## To go live

Deploy → **"hosting"** (the shell only).
