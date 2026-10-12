---
title: Opening Balances
area: finance
order: 3
modules: [OPENINGBALANCES]
sources: [functions/src/openingBalances.js]
summary: Bring a company's position on its go-live date into the ERP: the trial balance, opening stock and unpaid invoices.
reviewed: 2026-10-12
fingerprint: 830b9bd695f7cd0b
---
## What it is for

When a company starts using the ERP, its balances from the old system are
brought in once, dated **the day before go-live** (go-live 1 January →
opening date 31 December). Three kinds, each on its own tab:

- **GL**: the trial balance (every account except the control accounts);
- **Stock**: quantity and unit cost per item and warehouse;
- **Open Invoices**: each vendor's and customer's unpaid documents and
  advances, so statements, aging and payment allocation work from day one.

## Before you start

- Opening Balances is for Admin users.
- An Equity account for **Opening Balance Clearing** (for example "Opening
  Balance Clearing").
- Items, warehouses, vendors and customers already set up (Master Data
  Import helps).

## Step by step

1. Choose the **Company**, set the **Opening date** and the **Opening
   Balance Clearing account**, and select **Save setup**.
2. On a tab, select **Copy headers** (or **Copy headers with a sample
   row**), paste into Excel, fill it in, then copy the rows and paste them
   into the grid.
3. Select **Check**. Every problem is listed by row and column (an unknown
   account, a missing batch number, a document entered twice…). Fix them
   in Excel and paste again.
4. When the check is clean, select **Post**. All rows post together, or
   none.
5. Repeat for the other tabs. When all three are in, the **Clearing
   balance** shown must be **zero**: then the GL, stock and open invoices
   agree.

### What each tab takes

| Tab | Columns (required ones marked on the screen) |
|---|---|
| GL | Account, Debit, Credit, Description, Cost Center, Profit Center |
| Stock | Item, Warehouse, Quantity, Unit Cost, Batch No, Expiry Date |
| Open Invoices | Party Type, Party, Document Type (Invoice / Advance), Document No, Document Date, Due Date, Amount, Description |

## What happens in the books

All dated on the opening date:

- **GL**: one entry with your rows; the difference goes to Clearing.
- **Stock**: the stock comes in at your cost (Dr each item's Inventory
  account, Cr Clearing).
- **Open Invoices**: one entry per party on its control account, each
  document kept with its own number, date and due date, so payments can
  be allocated against it like any invoice.

Inventory, Trade Payables and Trade Receivables are **not** entered on the
GL tab: their balances come from the Stock and Open Invoices tabs.

## Corrections

A posted batch can be **Reversed** as a whole (Admin, any time), then a
corrected one posted. A reversal is refused when a document in it has
already been paid, or the stock has since been used; undo those first.

## Good to know

- Amounts are in the default currency; quantities in the item's base unit.
- Dates in the paste may be dd/mm/yyyy or yyyy-mm-dd; at most 2,000 rows.
- The opening date and clearing account are fixed while any batch is
  posted.
