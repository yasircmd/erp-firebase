# Non-stock lines in GRN

Status: **live** since 2026-09-28 (PR #23, Deploy run #9). The owner
agreed the design as written, including the three points below.

## The request

"In GRN, currently not able to post non-stock, it should enable." Today a
GRN takes stock items only.
- Every line needs an item and a warehouse, and it posts Dr Inventory · Cr
  GRN Clearing.
- The PO picker greys out non-stock (category) lines. That restriction was
  added during the migration at the owner's request (docs/MIGRATION.md).
- A non-stock purchase is billed as a Vendor Invoice direct line, with no
  link to the PO.

## Owner's decisions (2026-09-28)

1. **Accounting:** a non-stock line posts **Dr the category's GL account
   · Cr GRN Clearing**.
   - The category's account is expense for Direct Expense and asset for
     Fixed Asset, as set in Procurement Setup.
   - There is no warehouse and no stock ledger.
   - The Vendor Invoice then bills it through the GRN, like stock lines.
2. **Source:** non-stock lines can come **from a PO's category lines, or
   be entered directly** in the GRN by category.
3. **Fully received PO lines** still show in the picker (over-receipt
   allowed, with the warning) until the PO is closed manually, as today.

## Design

### Storage: a separate list on the GRN

Non-stock lines are kept in their own list, `NonStockLines`, next to the
stock `Lines`.

Several parts of the system read every GRN's `Lines` as stock movements:
- Recalculate Stock Ledger (Data Reset);
- the stock and variance reports;
- GRN reversal;
- Purchase Return.

A line without an item there would break the stock ledger rebuild. Keeping
the lists apart leaves all of those untouched.

A non-stock line holds:
- CategoryID and its name;
- the GL account, resolved when posted;
- description, quantity and unit cost;
- cost center and profit center;
- for a PO line, SourcePOID and SourcePOLineID.

### Rules

- **Save:**
  - The category must be active and belong to the GRN's company, with a
    postable account.
  - Quantity and unit cost must be greater than zero.
  - For a PO line, the unit cost is locked to the PO line's price (as
    for stock) and the category must match the PO line's category.
- **Approval amount:** stock plus non-stock.
- **Post:** one GL entry.
  - Stock lines: Dr Inventory, as today.
  - Non-stock lines: Dr the category account, carrying the line's cost
    center and profit center.
  - One Cr GRN Clearing for the total.
  - A PO line's received quantity goes up, as for stock.
- **A GRN may be all non-stock.** The warehouse and stock steps are then
  skipped.
- **Reversal:** the mirror entry, and the PO's received quantity rolled
  back. The existing check that an invoiced GRN can't be reversed still
  applies.
- **Vendor Invoice:** a GRN's amount includes its non-stock lines. The
  eligible-GRN list, the draft save and the posting all use the same sum.
  This is a documented patch to the ported Vendor Invoice code.
- **Purchase Return:** non-stock lines can't be returned. A return moves
  stock, and they have none. Only the GRN's stock lines are offered, as
  today.

### Screen

- The PO picker makes category lines selectable. They go into a
  **Non-stock lines** grid below the stock grid, with columns: category,
  description, quantity, unit cost, cost center, profit center.
- **Add non-stock line** adds a direct line to that grid.
- The total and the print include both grids.

## Points the owner confirmed (2026-09-28, as recommended)

1. **Fixed Asset categories.** Fixed Assets capitalizes from open items on
   the **FA Clearing Account**. A GRN for a Fixed Asset category reaches
   Fixed Assets only if that category's GL account *is* the FA Clearing
   Account. If it points at an asset cost account, the purchase bypasses
   the asset register (as a Vendor Invoice direct line would today).
   **Recommended:** set Fixed Asset categories to the FA Clearing Account.
   Fixed Assets would also show the GRN's vendor as the supplier (a small
   change there).
2. **Billing twice.** Once a PO's non-stock line is received by GRN, the
   same purchase could still be billed again as a Vendor Invoice direct
   line, which has no link to the PO. **Recommended:** accept that, since
   users pick either route. The alternative, blocking it, needs a PO link
   on direct lines, a larger change.
3. **Non-stock lines can't be returned** through Purchase Return
   (above). **Recommended:** correct them with a debit note or a JV
   instead.

## Tests planned

- **Emulator suite:**
  - PO non-stock line received: the GL entry, and the PO line's received
    quantity;
  - a direct non-stock line;
  - a mixed GRN, and a non-stock-only GRN;
  - approval amount, rejection and resubmission;
  - reversal;
  - Vendor Invoice amount includes non-stock;
  - Recalculate Stock Ledger unaffected;
  - Purchase Return offers stock lines only;
  - refusals: a category from another company, an inactive category, a
    mismatched PO category.
- **UI check:**
  - the picker ticks a category line into the non-stock grid;
  - a direct non-stock line;
  - saving and posting from the screen.
- A negative control for each.

## As built (2026-09-28)

- **Server:** `functions/src/grn.js`:
  - save validates `NonStockLines`;
  - post and approval count them in the amount and post Dr the category
    account;
  - reversal mirrors them;
  - PO received quantities move for non-stock PO lines too.
  - A non-stock-only GRN skips the stock movement.
- **Category account check:** the category's account is re-checked when
  posting. A category changed to an invalid account since saving is
  refused, and nothing is posted.
- **Vendor Invoice:** two documented patches
  (`grn-non-stock-invoice-eligible-amount`,
  `grn-non-stock-invoice-draft-amount`); `codegs.js` regenerated.
- **Fixed Assets** (`fixedAssetsPostings.js`): a GRN clearing item, and
  a capitalization drawn from it, carry the GRN's vendor as supplier.
- **Screen** (`screens/GRN.html`):
  - PO category lines are selectable and fill the Non-stock grid, with
    category and price locked.
  - **Add Non-stock Line** adds a direct line.
  - Header cost center and profit center fill lines that have none.
  - Totals, the list total and the print include non-stock.
  - A posted GRN shows its non-stock lines read-only.
- **Fixed Asset categories and the clearing account.** Procurement Setup
  requires a Fixed Asset category's account to be of type **Asset**. For
  such a GRN to reach Fixed Assets, the company's Fixed Asset Clearing
  Account must therefore be an Asset-type account, and the category must
  point at it. A Liability-type clearing account can't be chosen for a
  category.
- **Tests:**
  - `functions/test/emulator/grnNonStock.emulator.test.js`, 7/7:
    - mixed GRN, and the PO price winning;
    - non-stock-only direct GRN;
    - Vendor Invoice amount and posting, and Purchase Return offering
      stock lines only;
    - approval threshold reached only through non-stock; rejection and
      correction; reversal and the PO rollback;
    - Recalculate Stock Ledger;
    - Fixed Asset clearing item with the vendor;
    - refusals.
  - `functions/test/ui/stockModules.ui.js` checks 5 and 7: PO category
    line into the non-stock grid, locked; a direct line posted from the
    screen, then read-only.
- **Deploy:** the Deploy workflow's "functions set, then screens", set
  `grn-non-stock` (10 functions).
