# Entry layout: compact transaction entry screens, sticky top

Requested 2026-11-02 (owner): "optimize the design of all transaction entry
screens, including JV, CBT, SO, PO, invoices and other entries. Currently
these screens occupy more space than necessary ... ensure that the top-level
parameters remain fixed (sticky) while scrolling through the entry details."
Example given: Vendor Invoice (2 columns of tall fields, number and TXN ref
on lines of their own, a boxed Dimensions section, one full-width row per
matched GRN, Adjustments and totals stacked, the buttons at the bottom).

## Decisions (owner, 2026-11-02)

- **Q383 Sticky:** the title bar (number, status and the action buttons)
  plus one compact row of the key fields. The rest scrolls away, so the
  lines keep most of the screen.
- **Q384 Density:** fields 4 across on a wide window (2 on a narrow one, 1 on
  a phone), smaller fields and gaps; the number and TXN ref on the title
  line; the dimensions in the same grid instead of a box; about half the
  header's height.
- **Q385 Sections:** tightened too: adjustments beside the totals, matched
  documents as chips.
- **Q386 Rollout:** a pilot of three (Vendor Invoice, Sales Order, JV); the
  owner tries them live; then the other entry screens.

## As built: the pilot (2026-11-02)

- **The shell** (public/index.html): the ENTRY LAYOUT CSS block (classes a
  screen opts into: `entry-layout`, `entry-sticky`, `entry-bar`,
  `entry-meta`, `entry-actions`, `entry-fields` with `span-2`, `span-all`,
  `cols-3`, `cols-6`, `entry-hint`, `entry-panel`, `entry-split`,
  `entry-chips`, `entry-section-title`), and the ENTRY LAYOUT script, which
  keeps `--app-bar-h` at the app bar's height (the app bar got
  `id="app-bar"`) so the sticky part sits just under it. Below 768 px, in
  the phone view and in print nothing sticks. The sticky part takes
  `bg-slate-900/95`, so the light theme colours it like the app bar.
- **The screens** (all three hand-maintained, edited directly): each
  input, select and button kept as it was (same ids and classes; the
  screens' code is unchanged), only moved:
  - title bar: Back, title, number and TXN ref, status, then every action
    button (from the bottom row, now removed: Save Draft, Post / Confirm,
    Delete, Reverse, Close, Reopen, Cancel, Duplicate, Re-match, Print,
    Proforma, View GL Impact);
  - key fields: Vendor Invoice: Company (with Project), Vendor, Invoice
    Date, Vendor's invoice no.; Sales Order: Company, Customer, Order
    Date, Requested Delivery Date; JV: Company, Entry Date, Reference,
    Description (with its posted-edit buttons);
  - then one row (6 across on a wide window): the four dimensions and the
    Description (JV: Currency; its "line default" note is the Cost Center
    label's tooltip; Vendor Invoice's vendor note is the Vendor box's);
  - Vendor Invoice: matched GRNs as chips (and no empty "— —" when a GRN
    has no description); Direct Lines' title and Add Line on one row;
    Adjustments (with the line-tax table) beside the Totals.
- **Measured** at 1400 x 900 (first visible part of the entry to the lines
  table): Vendor Invoice 533 -> 205 px (-62 %), Sales Order 469 -> 254
  (-46 %), JV 366 -> 210 (-43 %).
- **Tests:** ui/entryLayout (6: per screen, the key fields in one row, the
  actions in the sticky bar, every id once, the header at most 60 % of
  before; with 25 lines scrolled, the bar, actions and key fields still in
  view; a 600 px window sticks nothing). Negative control: the sticky
  position removed -> the three scroll checks fail; restored. The screens'
  own suites pass (Vendor Invoice: invoiceState, multiCurrency,
  purchaseTax, supportingDocs, createNext, singleCompany; Sales Order:
  creditControl, orderTax, proforma, stockAvailability, salesOrderClose,
  itemUserCode, draftTasks; JV: lineGrids, gridClipboard, gridPaste,
  dateFormat, listPaging, budget, bankRec, rematch; and printStyle,
  phoneView, searchPicker, projectsEInvoice, rolesMatrix, developer, glRec,
  home, corporateSignIn).
- **Deploy:** "screens only" (the three screens), then "hosting"
  (public/index.html and the Help). No functions.

## Owner's review (2026-11-03)

"All looks good except date, it has more width": on a wide window the key
row and the dimension row are now flexible rows (`.entry-fields.keys`): a
date takes 10rem (`.entry-date`), the party and the description a double
share (`.grow-2`), the rest share the remaining width. The Project field
joins the dimension row after Profit Center (PROJECTS_DIMENSIONS.md,
Q387-Q392).

## Next (after the owner's review)

The other entry screens, the same way: CBT, Purchase Order, Customer
Invoice, Delivery Note, GRN, Purchase / Sales Return, Stock Adjustment,
Material Issue, Warehouse Movement, PDC, Purchase Requisition, Retail
Sales, Production, Physical Count and the rest with an entry view. Ported
screens that are generated (not on modules.json's handScreens list) take
it through SCREEN_EDITS.
