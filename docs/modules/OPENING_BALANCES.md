# Opening Balances

Status: **built** 2026-10-02, not yet live. Design agreed by the owner
(2026-10-02). As built: see the end.

## The request (owner, 2026-10-02)

From the Master Data Import discussion: "Opening balances (later)", then
"go for the opening balance". Bringing a company's position on its
go-live date into the system:

1. **GL opening balances:** the trial balance on the go-live date.
2. **Opening stock:** quantity and cost of each item in each warehouse.
3. **Open invoices:** each vendor's and customer's unpaid bills and
   invoices (and advances), so SOAs, ageing and payment allocation work
   from day one.

## What already exists (from the code)

- **GL** is the journal (`journalEntries`, Firestore). The Trial
  Balance, GL Report, Balance Sheet and Cash Flow all read from it. An
  opening balance is just a posted entry dated on or before the go-live
  date. The Trial Balance already shows an "Opening" column for anything
  dated before its From date.
- **Stock** is the RTDB stock ledger per item and warehouse (quantity,
  value, moving-average `AvgCost`), changed only through
  `stockMovement.js`, with the GL entry from `glWriting.js`. **Stock
  Adjustment can't be used for opening stock:** an increase takes the
  item's current average cost and is refused when stock is zero ("Use
  GRN or Production Entry to establish an initial cost basis first").
- **Open items** (PARTY_PAYMENTS.md) are derived, not stored. They are
  either a posted Vendor or Customer Invoice, or a **New Ref** on a
  posted JV/CBT line on the party's control account. Payments allocate
  "Against" either kind. A New Ref today carries only the JV's number and
  date. Its due date is the JV date, and it has no invoice number of
  its own.
- **Fixed assets:** already covered. Fixed Asset Capitalization has a
  "take-over of an existing asset" with no GL entry (FIXED_ASSETS.md
  decision 7). The GL opening carries the cost and accumulated
  depreciation accounts.
- **Master Data Import** (MASTER_IMPORT.md) gives the paste-from-Excel
  pattern: copy headers, paste, check every row (issues by row and
  column), all or nothing.

## Proposed design (for the owner to confirm)

### One clearing account ties the three together

Every opening entry posts against one **Opening Balance Clearing**
account (an Equity account the owner names in the setup).

- GL opening lines: Dr / Cr each account; the difference to Clearing.
- Opening stock: Dr each item's Inventory account; Cr Clearing.
- Open vendor bills: Cr the vendor's Trade Payables; Dr Clearing.
  Customer invoices are the mirror image. Advances go on the opposite
  side.

Inventory, Trade Payables and Trade Receivables are **control accounts**.
In the GL opening they are not keyed: their balances come from the stock
and open-item uploads, so the sub-ledgers and the GL agree by
construction. When everything is in, **Clearing must be zero**. The
screen shows its balance, and anything left is the difference to
investigate.

### Entry: paste from Excel, like Master Data Import

A new screen, **Opening Balances**, with three tabs (GL, Stock, Open
Invoices), each with:

- copy headers;
- paste;
- check (issues by row and column);
- post (all or nothing).

Proposed columns:

- **GL:** Account (code or name), Debit, Credit, Org Unit / dimensions
  if the account needs them.
- **Stock:** Item (code or name), Warehouse, Quantity, Unit Cost; Batch
  No and Expiry for batch-tracked items.
- **Open invoices:** Party type (Vendor / Customer), Party (code or
  name), Document No (their original invoice number), Document Date, Due
  Date (blank = date + the party's payment terms), Amount, and Type
  (Invoice / Advance).

### What gets posted

- **GL:** one posted JV with a new voucher type `Opening`, dated on the
  opening date.
- **Stock:** one stock movement per row, at the given unit cost (a new
  "Opening Stock" transaction type, so the Stock Ledger shows where it
  came from), with its GL entry. It is the only way into stock with a
  cost that isn't a GRN or Production.
- **Open invoices:** one `Opening` JV per party, one line per document,
  each line a New Ref. The New Ref gains three optional fields, used only
  here: **Document No, Document Date, Due Date**. The SOA, ageing and
  the allocation picker show these instead of the JV's. Payments
  allocate against them exactly as against any New Ref; nothing else
  changes.

### Who and when

- Admin only, like Master Data Import.
- Per company, against its **opening date**.

## The owner's decisions (2026-10-02)

| # | Question | Decision |
|---|---|---|
| 1 | Opening date | **Per company; entries dated the day before go-live** (e.g. go-live 01-Jan → 31-Dec) |
| 2 | Inventory, Trade Payables, Trade Receivables | **Derived** from the stock and open-invoice uploads through the Opening Balance Clearing account, which must end at zero; not keyed in the GL tab |
| 3 | Corrections | **Any time, Admin only:** reverse an opening batch and post a corrected one, or add a missed batch; every batch logged |
| 4 | Batch-tracked items | **A row per batch** (Batch No, Expiry) |
| 5 | Open invoices | **Per document** (number, date, due date); a party without detail can use one row |
| 6 | Approval | **None:** Admin-only, posted directly once the check passes, logged |
| 7 | Currency | **Base currency only** |

## As built (2026-10-02)

**Server:** `functions/src/openingBalances.js`. **Screen:**
`screens/OPENINGBALANCES.html` (hand screen). Menu: System Admin →
Configuration & Data Management → Opening Balances. Admin only
(`OPENINGBALANCES` access, default ADMIN).

### Setup, per company

`openingBalances/settings/<companyId>`: **OpeningDate** (the day before
go-live) and **ClearingAccountID** (an active, postable Equity account of
that company or for all companies). Both are fixed while any batch of the
company is posted: reverse the batches to change them.

### The three tabs (copy headers, paste, check, post)

| Tab | Columns (* required) | Checks |
|---|---|---|
| GL | Account*, Debit, Credit, Description, Cost Center, Profit Center | Account by code or exact name, postable and active; **not** a control account (any vendor's payables, customer's receivables, item's inventory) and not the clearing account; a debit or a credit, not both; Cost Center for Expense, Revenue and COGS accounts; one row per account |
| Stock | Item*, Warehouse*, Quantity*, Unit Cost*, Batch No, Expiry Date | Item and warehouse/rack of this company; quantity and cost above zero; batch number for batch-tracked items; one row per item, warehouse and batch |
| Open Invoices | Party Type*, Party*, Document Type* (Invoice / Advance), Document No*, Document Date*, Due Date, Amount*, Description | Party of this company with a valid control account; document date on or before the opening date; due date not before it (blank: date + the party's payment terms); the same document twice, in the paste or in a live batch, is an issue |

References are by code or exact name (the company's own first). Dates
are dd/mm/yyyy (or yyyy-mm-dd). At most 2,000 rows. Posting checks again
under the global lock: all or nothing.

### What a batch posts (all dated on the opening date)

- **GL:** one entry, voucher type `OpeningBalance` (numbers
  `OB-yy-cc-nnnnnn`): the rows, and the difference to Clearing.
- **Stock:** a stock transaction `OpeningStock` (`OS-…`), lines In at the
  given cost (moving average, as a GRN), with its entry: Dr each item's
  Inventory, Cr Clearing. Batch number and expiry are kept on the lines,
  as GRN does. Sales Order shortfalls are allocated as for any receipt.
- **Open Invoices:** one entry per party (`OB-…`), a line per document on
  the party's control account (vendor invoice Cr, vendor advance Dr;
  customer the other way), each a **New Ref** carrying DocumentType,
  DocumentNo, DocumentDate and DueDate; the net to Clearing.

Every opening entry carries `OpeningBatchID`, `OpeningCompanyID` and
`OpeningKind`. The batch log is `openingBalances/batches/<id>`.

**Opening documents behave as invoices** (partyLedger): open items,
the JV/CBT/PDC allocation picker, an allocation's RefNumber and the
statement's open items and ageing show the document's own number, date
and due date ("Opening invoice" / "Opening advance"). Payments allocate
Against them like any New Ref.

**The Clearing balance** shown on the screen is the net of the opening
entries' Clearing lines, split by tab. GL, Stock and Open Invoices agree
when it is zero.

### Reversal (any time, Admin; decision 3)

A batch reverses as a whole, dated on the opening date:

- GL and Open Invoices: each entry mirrored (party tags kept, nothing
  allocated, like a JV reversal). An open document already settled
  refuses it ("…has been settled by …, reverse that first").
- Stock: the stock is taken out **at the batch's own cost**, not the
  average (a new opt-in `AtCost` on stockMovement's Out lines; the last
  of the stock takes the whole remaining value). So a corrected batch
  leaves the cost, and Clearing, as if it had never been posted, and the
  stock ledger rebuild (Data Reset) replays it identically. Refused when
  the stock has since been used ("…cannot be taken back: insufficient
  stock…").

Opening entries can't be reversed from JV ("reverse it from that
module"). Data Reset has an **Opening Balance Batches** category (clear
it with GL Journal Entries and Stock Transactions); the setup is kept.

### Not in this step

- Fixed assets: the existing take-over (FIXED_ASSETS.md decision 7) adds
  assets without a GL entry; their cost and accumulated depreciation
  accounts are rows in the GL tab. Nothing checks the two agree.
- Quantities are in the item's base unit only.

### Tests

- `openingBalances` emulator suite (8): setup and access, each tab's
  issues, posting each tab, open documents paid by CBT and shown in the
  SOA ageing, reversal of each (and refusals), the cost after a reversed
  stock batch and the ledger rebuild, another company's user.
- `openingBalances.ui.js` (4).
- `dataReset` updated for the new category.
- Negative controls, all caught:
  - control accounts allowed in GL;
  - stock reversed at the average;
  - documents shown by the entry's number;
  - Post enabled despite issues (UI).
