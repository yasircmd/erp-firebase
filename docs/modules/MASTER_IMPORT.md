# Master Data Import (from Excel)

Status: **Part 1 live** 2026-10-02 (PR #47; Deploy run #46). Design agreed by the
owner (2026-10-02). Part 2 to follow.

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

5. **References:** by code, or by exact name. A record created earlier
   in the same paste can be referred to by its name. A name that matches
   two records is an issue: use its code.
6. **The same name twice is an issue:** in the paste, or already
   existing (same kind, same company). So a list pasted twice can't
   create everything twice.
7. **Two parts:**
   - **Part 1:** Company, Organizational Units, Chart of Accounts, UOM,
     Item Sub-Category, Items, Vendors, Customers, Currencies.
   - **Part 2:** Fixed Asset Classes and Master, BOM, Inventory Valuation
     List, Price Lists, Users, Requisition Categories, Customer
     Classifications and Sales Types.

The first questions as asked:

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

## As built, Part 1 (2026-10-02)

- **Server:** `functions/src/masterImport.js` (hand-written).
  - **Callables:**
    - `getMasterImportSpecs`: the list in import order, with each
      one's columns, what each takes, and a sample row;
    - `checkMasterImport`: checks a paste, writes nothing;
    - `runMasterImport`: checks again, then imports.
  - **One definition per master:** its columns, and how a row becomes
    what the master's own save function takes. Each row is saved through
    that Code.gs save (`saveCompany`, `saveOrgUnit`, `saveAccount`,
    `saveUOM`, `saveItemSubCategory`, `saveItem`, `saveVendor`,
    `saveCustomer`, `saveCurrency`). So its permission check, company
    check and every rule apply as by hand.
  - **The paste:** text copied from Excel, tab-separated, with quoted
    cells (a tab, a line break or a quote inside a cell) handled. Up to
    2,000 rows. Headers in any order; matching ignores case and spacing,
    and a trailing `*`.
  - **Values:**
    - Yes/No takes Yes, No, Y, N, True, False, 1, 0;
    - numbers may have thousand separators;
    - lists take the stored value or its label ("Raw Material" or
      "RawMaterial").
  - **The check, before any write:**
    - the right to change that master;
    - unknown, repeated or missing required columns;
    - required values, lists, Yes/No, numbers, emails;
    - references, by code or exact name (an account by its code or name
      among the row's company's and all-company accounts);
    - access to the row's company;
    - the same name in the paste or already existing;
    - each master's own rules that can be checked up front: a Rack's
      parent is a Warehouse; a parent account is a header of the same
      type and company; account kinds for items, vendors and customers;
      a Foreign vendor's or export customer's country; unique Org Unit,
      UOM and Currency codes; a 3-letter currency code; decimal places
      0–6.
  - **All or nothing:** with any issue, nothing is imported. If a save
    still fails during the import (a rule only the save knows, or a
    change made meanwhile):
    - the records created in that run are removed again;
    - the code counters (item, vendor, customer) are put back, unless
      someone else used them in the meantime;
    - the row and its reason are reported. "Nothing was imported."
  - **A log:** each run is recorded in `masterImports`: who, when, which
    master, how many rows, what was created, Imported or Undone.
  - **Not offered in Part 1:**
    - a company's accounts (set on Company Master once the Chart of
      Accounts exists);
    - the default currency (set on Currency Configuration);
    - a Status column: everything imports as Active.
- **Screen:** `screens/MASTERIMPORT.html` (hand-written).
  - Choose from the numbered list. The columns table shows what each
    takes.
  - "Copy headers", or "Copy headers with a sample row".
  - Paste, then Check: the rows are shown with their row numbers; rows
    with issues are highlighted, and the issues are listed below by row
    and column.
  - Import is only enabled for the exact paste that checked clean.
    Editing it turns Import off again.
  - An in-app confirmation, then a summary with the codes given (e.g.
    "RM-000001 to RM-000040").
- **Module:** `MASTERIMPORT` in the registry (Admin access by default),
  and a menu entry under SYSTEM ADMIN → Configuration & Data Management
  for new installs. Existing installs link a node in Module Tree &
  Navigation.
- **Tests:**
  - **The `masterImport` emulator suite (9):**
    - the list and its access;
    - Chart of Accounts with a header and children in one paste;
    - issues by row and column, with nothing written;
    - items by code or name, with system-made codes;
    - org units with a rack under a warehouse above it;
    - vendors and customers, including a name matching two accounts;
    - company with a parent above, UOM and Currency;
    - the right to change the master;
    - a failed save undoes the run, with the counter put back.
  - **`masterImport.ui.js` (4):**
    - the order and the columns, and copying the headers;
    - a paste with issues;
    - fix, check, import;
    - a stale check holds Import back.
  - **Negative controls, eight caught:**
    - duplicate names allowed;
    - importing despite issues (caught once a test had an issue the
      save itself allows);
    - no same-paste references;
    - no undo;
    - no write-right check;
    - no company check;
    - in the UI, Import enabled despite issues, and a stale check.
- **Deploy:** "functions set", set `master-import-1`, with screens. Then
  link a menu node to Master Data Import.
