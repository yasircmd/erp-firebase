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

Live 2026-11-02 (PR #210; runs #279 screens, #280 Hosting).

## Owner's review (2026-11-03)

"All looks good except date, it has more width": on a wide window the key
row and the dimension row are now flexible rows (`.entry-fields.keys`): a
date takes 10rem (`.entry-date`), the party and the description a double
share (`.grow-2`), the rest share the remaining width. The Project field
joins the dimension row after Profit Center (PROJECTS_DIMENSIONS.md,
Q387-Q392).

## As built: the sales chain (2026-11-03)

With projects step 2 (PROJECTS_DIMENSIONS.md): **Delivery Note** (key row
Company, Customer, Date, Reference; then the dimensions, Project and the
Description), **Customer Invoice** (Company, Customer, Date, Description;
then the dimensions, Project and the currency row) and **Sales Return**
(Company, Customer, Invoice, Date; then Reference, Description and the
invoice's project), each with its actions in the sticky bar. A
`.span-all` cell in a flexible row takes a whole row
(`.entry-fields.keys > .span-all`). Tests: ui/projectsSales.

## Wave 1: purchase and cash (2026-11-03)

The owner (2026-11-03): the layout of every entry screen is the main
request; projects were a suggestion (steps 3-5 parked). Wave 1, by hand
(the screens are hand-maintained; PDC Issued is built from PDC Received by
tools/build-pdc-screens.js):

- **Purchase Order:** edit view: key row Company, Vendor, PO Date, Cost
  Center (its note in the tooltip); Delete / Save / Submit in the bar. The
  detail view: Print and Cancel / Revise / Resubmit / Close / Reopen in the
  bar, the Vendor, Currency, Cost Center and Date row under it.
- **GRN:** key row Company, Vendor, Date, Reference (the long notes in the
  tooltips); then the dimensions and the Description, above the Purchase
  Order picker; GL impact, Labels, Print and the actions in the bar.
- **Purchase Return:** Company, Vendor, the invoice (its hint under it),
  Return Date; then the credit note reference and the Description.
- **CBT:** the five transaction types as compact buttons in the sticky
  part, then Company, Ledger Account, Date, Reference; Currency, the
  dimensions and the Description in one row (the line-default note in the
  Cost / Profit Center tooltips).
- **PDC Received / Issued:** Company, Customer / Vendor, Date, Bank
  Account (Issued), Reference; the dimensions, Replaces and the Description
  above the cheques.

Header at 1400 px (first visible part to the lines): Purchase Order
382 -> 263 px, GRN 796 -> 300, Purchase Return 467 -> 245, CBT 715 -> 324,
PDC 314 -> 205. Tests: ui/entryLayoutWave (wave 1, 12 checks: the key row,
the actions in the bar, every id once, the header at most 75 % of before,
still in view when scrolled, nothing sticky on a phone). Negative control:
CBT's key row back in a two-column grid -> the one-row check fails;
restored.

## Wave 2: stock and requisitions (2026-11-03)

The stock family (Stock Adjustment, Material Issue, Warehouse Movement,
Physical Count, Production; the GRN's template) and the two requisitions:

- **Stock family:** key row Company, (Material Issue: the Issue / Return
  choice, compact; Production: the Job Order), Date, Reference; then the
  dimensions and the Description (with its posted-edit buttons) in one row.
  GL impact, Labels, Print and every action in the bar. The long notes
  (Company, Entry Type, Job Order) are the tooltips.
- **Purchase / Inventory Purchase Requisition:** Company, Date, Needed By,
  Priority; then the dimensions and the Description / Purpose.

Header at 1400 px: Stock Adjustment 618 -> 300 px, Material Issue 692 ->
279, Warehouse Movement 602 -> 300, Physical Count 618 -> 300, Production
655 -> 276, the requisitions 546 -> 254. Tests: ui/entryLayoutWave wave 2
(14 checks). Negative control: Warehouse Movement's sticky part made a plain
block -> its two checks fail; restored.

## Wave 3: the rest (2026-11-03)

- **Fixed asset entries** (Capitalization, Capital Work in Progress,
  Retirement, Additional Depreciation; one template): the GL impact and
  every action (from the bottom row) in the bar; the field grid as the key
  row (date narrow, reason / description wider).
- **Recurring JV:** its actions were already in the title bar; now sticky,
  with Company, Description, Reference; the dimensions in one row under it
  (no box).
- **Employee Changes, Loans, Interim Payment:** the title bar (actions
  already there) sticky, with Employee, Type, the date or amounts as the key
  row; the reason / note in the row under it.
- **Final Settlement, Budget:** their title bar (with every action) made
  sticky; their bodies are working panels, unchanged.
- **Left as they are:** Earnings & Deductions (its entry is already one
  inline row), the asset card and the BOM (master records, not postings;
  the BOM is a generated screen), Retail Sales (a point-of-sale screen).

Header at 1400 px: Recurring JV 573 -> 470 px, Capitalization and CWIP 247
-> 201, Retirement 338 -> 218, Additional Depreciation 226 -> 117, Employee
Changes 275 -> 195. Tests: ui/entryLayoutWave wave 3 (14 checks; these were
compact already, so the header is checked at 75-90 % of before). Negative
control: Additional Depreciation's key row back in a two-column grid -> its
one-row check fails; restored.

## Next (after the owner's review)

Every entry screen has the layout (waves 1-3). The owner reviews; changes
from that review go here. A generated (ported) screen that needs it later
takes it through SCREEN_EDITS.
