# Compact lists and forms: Item, Vendor and Customer Master

Status: forms **live** 2026-10-02 (PR #50; Deploy runs #50–#52). The
one-line lists (below) missed PR #50: they go live with a "screens only"
run after their own PR.

## The request (owner, 2026-10-02)

"Make Item Master and related module in Compact view same like we did
for CBT." Clarified: "We fixed the CBT module by reducing space, same
like need here", for **Item Master, Vendor Master and Customer Master**.

The CBT compact (PR #38, [LINE_GRIDS.md](LINE_GRIDS.md)) tightened
tables and line grids. These masters' lists are already tables, so
they got that then. What was still spacious is their **Add / Edit
form**: tall fields, wide gaps, padded sections, and long grey help
notes that wrapped to five or six lines under a narrow field.

## What changed

Only the Add / Edit form of the three screens. Nothing in what is saved,
checked or shown in the lists changes.

| | Before | Now |
|---|---|---|
| Field (input / select) padding | 0.5rem × 0.75rem | 0.25rem × 0.5rem |
| Space between form rows | 1rem | 0.5rem |
| Grid gaps (rows × columns) | 1rem | 0.4rem × 0.75rem |
| Label to field | 0.25rem | 0.1rem |
| Section boxes (Unit of Measure, GL Account Linkage, Bank Details) | 1rem padding, 0.75rem between rows | 0.5rem × 0.75rem, 0.35rem |
| Window padding | 1.5rem | 0.9rem × 1rem |
| Long help notes | wrapped in full | **one line** ending "…"; the full text on hover, and the note opens in full when clicked or tapped (closes when you click elsewhere) |

Measured on the Add form at desktop width: Item Master **1152 → 800 px
(31 % shorter)**, Vendor and Customer Master **1046 → 783 px (25 %)**.
The Item form now fits a laptop screen without scrolling.

The amber notes (Category / Classification can't be changed after
creation) are warnings, not help, and are left in full.

## How it's built

The three screens are generated from the Apps Script source, so the
change is a generator transform, `tools/legacy-port/compactForms.js`,
run by `generate.js` next to the list-paging one. It:

- adds a `<style>` block at the top of the screen, scoped to that
  screen's own form (`#im-modal` / `#im-form`, `#ven-…`, `#cus-…`), so
  no other screen and no printout is affected, and no Hosting deploy is
  needed;
- gives each grey help note inside the form the class `form-note`, its
  full text as `title`, and `tabindex="0"` (so a click or tap opens it).

Every pattern must match (the form once, and the expected number of
notes: 5 on Item, 1 each on Vendor and Customer), so a changed source
fails the generator instead of silently skipping.

Another generated master can get the same by adding a line to
`SCREENS` in `compactForms.js`. A hand screen would copy the style block.

## Tests

`functions/test/ui/compactForms.ui.js` (10 checks), for each screen:

- fields, labels and gaps have the compact values;
- each help note is one line with its full text as the tooltip, opens
  when clicked and closes again;
- the form is at least 20 % shorter than the same form with the compact
  style switched off.

The test machine can't reach Tailwind's CDN, so when Tailwind is missing
the test adds a stand-in with Tailwind's own values for the utilities
these forms use; the "before" measure is then the real spacing.

Negative controls, both caught: no style block (9 of 10 checks fail);
notes without `tabindex` (the three "opens when clicked" checks fail).
The smoke (123) and single-company (54) UI checks, which open these
screens, still pass.

## The lists too (owner, 2026-10-02, follow-up)

The owner then showed the **Item Master list**: each row was two or three
lines tall, because the code broke at its hyphen ("CONS-" / "000001"),
the company name wrapped ("NEXUS PRODUCTION LLC" / "(03)") and the three
action icons wrapped onto a second line. "Fix this issue, nothing roll
back what already done": the compact forms stay, and the lists of the
three screens now get, from the same scoped style block:

- every cell but the name on **one line** (code, category, company,
  contact, status, actions), and the column headers on one line
  ("Sub-Category");
- the name column keeps at least 14rem, so a normal name stays on one
  line too; only a very long one wraps;
- on a narrow screen the list scrolls sideways (its existing scroll
  box) instead of rows growing tall;
- smaller padding on the action icons, and a tighter filter bar.

Test: `compactForms.ui.js` now also checks, at an 800 px window (the
width where the old layout wrapped exactly as in the owner's
screenshot), that no cell or header of the first row is on more than one
line and the row is under 36 px (13 checks). Negative control: without
the one-line rule, all three screens fail with Code, Company / Category,
Contact and Actions wrapped.
