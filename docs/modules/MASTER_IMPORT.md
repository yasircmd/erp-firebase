# Master Data Import (from Excel)

Status: **design**, awaiting the owner's decisions (2026-10-02).

## The request (owner, 2026-10-02)

"Develop a module to upload from Excel for all master data like Company,
Organizational Units, COA, Item Code, Vendor, Customer, Fixed Asset
Master, Inventory Valuation List, Price List, Users. If any one is
selected, the user can copy the header to paste in a spreadsheet, and
after filling it, paste it here. Any issue will be mentioned below."

## The idea

One new screen, **Master Data Import**:

1. **Choose what to import** (e.g. Item Master).
2. **Copy headers.** The screen copies the column headers for it, one
   row, ready to paste into Excel.
   - The columns are listed on the screen with what each one takes and
     whether it's required.
   - Optionally, a sample row is included.
3. **Fill in Excel, then paste.** Copy the filled rows (headers
   included) and paste them into the screen's box. The screen shows them
   as a table.
4. **Check.** Every row is checked on the server, by the same rules as
   entering it by hand. The issues show under the table, row by row
   (e.g. "Row 7, UOM: 'PCS2' not found"), and the rows with issues are
   highlighted.
5. **Import**, once there are no issues. A summary shows what was
   created.

### Working rules (proposed)

- **The same rules as by hand.** Each row goes through the master's own
  save function. Nothing can be imported that couldn't be entered by
  hand, and every check (e.g. an account's type, a duplicate code) is
  the same.
- **References by code, not internal id:**
  - company by its Ref Code;
  - an account by its account code;
  - a UOM, sub-category or warehouse by its code;
  - a vendor or customer by its code.
  - The server turns them into ids, and an unknown code is an issue on
    that row.
- **Rows that refer to each other in one paste work.** For example, an
  organizational unit whose parent is a few rows above it.
- **Dates** in dd/mm/yyyy, as shown everywhere (yyyy-mm-dd accepted
  too). Numbers without thousand separators, or with them.
- **Who can import:** the new module's access, **and** the right to edit
  that master (e.g. importing items needs Item Master write).
- **Recorded:** who imported what, when, and how many rows.

### The order matters

Some masters refer to others, so they must exist first:
1. Company;
2. Organizational Units;
3. Chart of Accounts;
4. UOM and Item Sub-Category;
5. Items;
6. Vendors and Customers;
7. Fixed Asset Classes, then Fixed Asset Master;
8. BOM, then the Inventory Valuation List (it needs items with an active
   BOM);
9. Price Lists;
10. Users (they refer to companies and roles).

The screen lists them in this order and says what each one needs.

### Notes on some items in the list

- **Users:**
  - creating a user creates their sign-in, which needs an email and a
    password;
  - **passwords in a spreadsheet are a risk:** see question 4.
  - The role must already exist; companies go by Ref Code, comma
    separated.
- **Fixed Asset Master** creates the asset cards only. The value and
  depreciation start with **Fixed Asset Capitalization** (a posting, not
  master data), as today.
- **Inventory Valuation List** only takes items that have an active BOM
  (its existing rule).
- **Price List** is a header plus its lines: one row per line, with the
  price list's name repeated, so one paste can create a list with its
  lines.

## Possibly missing from the list

Master data that exists in the system but isn't in the request:
- **Unit of Measure (UOM)** and **Item Sub-Category**, which items
  depend on;
- **Requisition Categories** (Procurement Setup);
- **Customer Classifications and Sales Types** (Sales Invoice
  Configuration);
- **Currencies**;
- **Fixed Asset Classes** (Fixed Asset Configuration), which assets
  depend on;
- **Bill of Materials (BOM)**, which the Inventory Valuation List depends
  on.

Not master data, but usually needed to go live from another system:
**opening balances**. These would be postings (journal / stock / open
invoices), so a separate design.
- GL opening balances;
- opening stock (quantity and cost per warehouse);
- vendors' and customers' open invoices.

## The owner's decisions (2026-10-02)

1. **Codes:** "Item code, GL code, etc. should be created by the system
   only; the user provides the same data that is filled in a master."
   So the sheet has exactly the fields the master's own form asks for:
   - **system-made codes are never in the sheet:**
     - account code (from the type and parent);
     - item code (from its category);
     - vendor and customer codes;
     - the company's Ref Code.
   - **codes the form asks for stay in the sheet:** Org Unit code, UOM
     code and Currency code, as on their forms.
   - Each row is a new record; existing records are edited on their own
     screens, as today.
2. **All or nothing.** Every row is checked first, and nothing is
   imported while any row has an issue.
   - If a save still fails during the import (e.g. someone else just
     used the same name), the import stops, and the records it created
     in that run are removed again. The list is never left half-imported.
3. **Masters:** the ten requested, plus:
   - UOM and Item Sub-Category;
   - Fixed Asset Classes and BOM;
   - Requisition Categories, Customer Classifications and Sales Types,
     and Currencies.
   - Opening balances come later, as their own design.
4. **Users:** one temporary password typed on the import screen for the
   batch, never in the sheet. Each user changes it after signing in.

### Follow-up questions (2026-10-02)

The questions as asked:

1. **Existing records:** when a row's code already exists (e.g. an item
   code), should the import:
   - *add new ones only*: an existing code is an issue on that row
     (recommended for a first version, safest); or
   - *also update existing ones* from the sheet.
2. **All or nothing?**
   - *Import only when every row is fine* (recommended): fix the
     issues, paste again, import once.
   - *Import the good rows*, and list the rest to fix and paste again.
3. **Which masters?** The ten in the request, plus which of the
   "possibly missing" ones.
4. **Users' passwords:**
   - *one temporary password typed on the screen* for the whole batch,
     which each user should change (recommended); or
   - *a password column* in the sheet.

## What changes in the code (once agreed)

- **Server:** a new hand-written `functions/src/masterImport.js`:
  - one definition per master: its columns, what each column takes, and
    how codes become ids;
  - two callables: `checkMasterImport` (no writes) and
    `runMasterImport`. Each row is saved through the master's own save
    logic.
- **Screen:** a new `screens/MASTERIMPORT.html` (hand-written), with
  in-app messages only, as every screen.
- **Registry:** the new module, Admin access by default; add it to the
  menu tree in the app.
- **Deploy:** a functions set with screens.

## Tests (planned)

- **Emulator, per master:**
  - a good paste imports exactly what manual entry would;
  - each kind of issue is reported on the right row and column, and
    nothing is written;
  - codes are resolved;
  - rows refer to each other within one paste;
  - write permission is required.
- **UI:**
  - copy headers;
  - paste, check, issues shown, fix and import.
- **Negative controls** per rule.
