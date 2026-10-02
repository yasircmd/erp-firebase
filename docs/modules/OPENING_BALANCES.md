# Opening Balances

Status: **design agreed** by the owner (2026-10-02); being built.

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
