# Master Data Import (from Excel)

Status: **Part 1 live** 2026-10-02 (PR #47; Deploy run #46). **Part 2
live** 2026-10-02 (PR #48; Deploy runs #47 and #48). Item account fix
live (PR #49; Deploy run #49). Design agreed by the
owner (2026-10-02).

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

## As built, Part 2 (2026-10-02)

- **The list is now 18, in import order:**
  1. Company
  2. Organizational Units
  3. Chart of Accounts
  4. Currencies
  5. UOM
  6. Item Sub-Category
  7. Items
  8. Vendors
  9. Customer Classifications
  10. Customers
  11. Sales Types
  12. Requisition Categories
  13. Fixed Asset Classes
  14. Fixed Asset Master
  15. Bill of Materials
  16. Inventory Valuation List
  17. Price Lists
  18. Users
  - Currencies moved up (price lists and vendors may use them), and
    classifications come before customers.
- **New kinds of values:**
  - **dates:** dd/mm/yyyy (also d/m/yyyy, dd-mm-yyyy, dd.mm.yyyy, or
    yyyy-mm-dd); an impossible date such as 31/02/2026 is an issue.
  - **several references in one cell,** separated by commas: a user's
    companies.
- **The masters, as their own save functions take them:**
  - **Customer Classifications** (`saveCustomerClassification`): name,
    export yes/no, company.
  - **Sales Types** (`saveSalesType`): revenue and returns accounts
    (postable Revenue); restricted to a classification by name, which may
    be one just imported.
  - **Requisition Categories** (`saveRequisitionCategory`): the GL
    account must be Asset for Fixed Asset and Expense for Direct Expense.
  - **Fixed Asset Classes** (`saveFaClassFor`, the class save moved out
    of its callable unchanged):
    - code (unique), name, kind, defaults, account determination by code
      or name;
    - a depreciating kind needs a method and useful life (the same check
      as the save).
  - **Fixed Asset Master** (`saveFaAssetFor`, likewise):
    - creates the asset cards (Planned); the asset number is given by the
      system (FA-01-000001…);
    - class by code or name; a depreciating class needs a Cost Center;
    - empty method or life take the class's defaults; valuation is
      checked as on the screen.
    - **The duplicate check here is the serial and tag numbers,** not
      the description, since two assets can share a description.
  - **Bill of Materials** (`saveBom`): a row per component, grouped by
    parent item.
    - The parent's columns (version, effective from, notes) must agree
      on each row of its BOM.
    - A parent that already has an active BOM is an issue (saving would
      switch that BOM off); it is changed on the BOM screen.
    - The component rules are the save's.
  - **Inventory Valuation List** (`saveInventoryValuationLine`): only an
    active Finished or Semi-Finished Good of that company with an active
    BOM. One line per item and date.
  - **Price Lists** (`savePriceList`, then `savePriceListLine`): a row
    per line, grouped by company and list name.
    - **A new list** needs a currency; its classification mapping is
      checked against other active lists, and against other new lists in
      the paste.
    - **An existing list gets the lines added;** its currency and mapping
      are left as they are.
    - The same item and date twice in a list is an issue.
  - **Users** (`saveFirebaseUser`):
    - username, full name, email, role (by name), companies (by Ref Code
      or name, separated by commas);
    - a **temporary password typed on the screen** (at least 6
      characters), sent with the import and never stored in the sheet or
      the log;
    - username and email must be unique;
    - each user gets a sign-in and changes the password from the user
      menu (Change Password).
- **Patches** `import-bom-id` and `import-user-id`: `saveBom` and
  `saveFirebaseUser` also return the new record's id, which the undo
  needs. Nothing else in them changes. (`reactivateBom` returns what
  `saveBom` returns, so it carries the id too.) The `bom` and `userMgmt`
  suites' exact-result checks were updated to expect the id.
- **Undo** now also covers:
  - Firestore records (asset classes, assets);
  - a user's sign-in account as well as their record;
  - the asset-number counter (given back unless used meanwhile);
  - a price list's lines and the list itself (if this run created it).
- **Screen:** a temporary-password box appears for Users. The summary
  now counts rows ("12 rows imported into Price Lists").
- **Tests:**
  - **The `masterImport2` emulator suite (7):**
    - classifications, sales types and requisition categories;
    - FA classes and assets;
    - BOM grouping and its rules;
    - inventory valuation eligibility;
    - price lists, new and existing;
    - users, with sign-ins, uniqueness and the password not logged;
    - undo of users, their sign-ins, assets and the asset counter.
  - **The Part 1 suite (9) still passes,** with the new order.
  - **`masterImport.ui.js` (5):** adds the Users password box.
  - **Negative controls, ten caught:**
    - one BOM's columns not compared;
    - an active BOM overwritten;
    - always a new price list;
    - no temporary password check;
    - duplicate email;
    - no sign-in undo;
    - no asset-number counter;
    - no valuation eligibility;
    - duplicate serial;
    - bad dates accepted.
- **Deploy:** "functions set", set `master-import-2`, with screens.

## Fix (2026-10-02): item account rules as Item Master's

The owner pointed out the Consumption account note on Item Master:
"Debited when this item is issued to production (Material Issue),
credited back when this item is produced (Production Entry). Not
restricted to Expense-type accounts — a Liability or Asset account is
equally valid here."

- **Item Master's own save does that already:** Consumption only has to
  be postable (and in the item's company). Sales COGS and Write-off must
  be Expense or COGS.
- **The import's check got two of these wrong:**
  - it demanded Expense or COGS for Consumption, which is stricter than
    the screen;
  - it took any postable account for Write-off, which is looser; that
    row would then have failed at the save and been undone.
- **Now the check matches the save,** and the column notes say so.
- **Test:** the Items test adds a Liability Consumption account (now
  imported) and an Asset Write-off account (an issue).
- **Negative controls caught: two.** Consumption limited to Expense
  again, and Write-off of any type.
- **Deploy:** "functions set", set `master-import-item-accounts`. No
  screens.

## Part 3 design: updating existing records (proposed 2026-10-05)

### The request (owner, 2026-10-05)

"One suggestion in Master Data Import to update existing record: I
created 40 employees, now I need to update their line manager. Plan how
to make it possible, not only for Employees but other modules too."

Today each row creates a new record (decision 1: "existing records are
edited on their own screens"), so 40 line managers mean 40 records
opened by hand.

### The idea: a second mode, "Update existing"

On Master Data Import, after choosing the master:
- **Add new** (as today), or **Update existing** (new).
- In Update mode the sheet's **first column is the key**: the record's
  own code (Employee No. EMP-0001, Item Code, Vendor Code, Account Code,
  Org Unit code, UOM code, ...). A name is not accepted as the key: names
  change and can repeat.
- **Only the columns you paste are changed.** A sheet of two columns,
  `Employee No.` and `Line Manager`, changes the line manager of those
  employees and nothing else. Headers are matched as today.
- **Blank cells:** question 8.
- **Copy current records** (question 10): the screen gives the master's
  existing records as a sheet, with the key and the current values,
  ready to edit in Excel and paste back.

### How a row is updated (same rules as the screen)

- The record is found by its key (in the user's companies); an unknown
  key is an issue on that row.
- Its current values are read, the pasted columns laid over them, and the
  result is saved **through the master's own save, with its id**: the
  same function the edit screen calls. Every rule (references, types,
  unique names, accounts, rights) applies exactly as on the screen.
- References in the sheet work as today: by code or exact name, including
  another record in the same paste (e.g. a line manager who is updated in
  an earlier row).
- **All or nothing** (decision 2): every row is checked first; if a save
  still fails, the rows already saved in that run are put back to their
  values from before the run.
- The preview lists, per row, what changes: "EMP-0007 · Line Manager:
  (none) → EMP-0002 Sara Khan". Rows with no change are skipped and
  counted.
- **History:** where the master keeps one (Employees, Fixed Asset Master),
  each change is written to it as "Import (update)".

### What can't be changed by an update

Fields a record locks after it is created, on its own screen, stay locked
here, and the column is refused in Update mode with the reason:
- **Employees:** company, designation, grade, division, branch, cost
  center (through Employee Changes, which carry dates and approvals); the
  employee number; pay (not in the sheet); bank columns only with the
  "sensitive" right, as today.
- **System codes** (item, account, vendor, customer codes, the company's
  Ref Code): they are the key, never changed.
- **Accounts:** type and parent once entries are posted, as COA Master.
- **Items:** category (it makes the code), as Item Master.
- **Users:** password (not in the sheet); role and companies change as on
  User Management.
- Openings (leave balances, opening provisions) aren't updated by import:
  they are corrected with an adjustment, as today.

### Which masters (question 11)

All the masters that have an edit screen today:
- **Part 1:** Company, Org Units, Chart of Accounts, UOM, Item
  Sub-Category, Items, Vendors, Customers, Currencies;
- **Part 2:** Customer Classifications, Sales Types, Requisition
  Categories, Fixed Asset Classes and Master, Inventory Valuation List,
  Price Lists, Users, Employees.

BOM and price lists have several rows per record: an update would replace
the whole BOM / list from its rows (as their screens save them whole).

### Rights

The same right as editing the record on its own screen (e.g. Employees
"write"; Item Master "write"). Without it, Update mode isn't offered for
that master.

### Open questions for the owner

8. **Blank cells in Update mode:** *keep the current value* (a blank
    means "no change"; to clear a value, type `-`)? Or *clear it* (the
    sheet is the full truth for its columns)?
9. **The key:** the record's *code only* (Employee No., Item Code, ...)?
    Or also *an exact name* when it is unique?
10. **Copy current records:** add a button that gives the existing
    records (key + current values) as a sheet to edit and paste back? It
    also works as an export of each master.
11. **Scope and order:** *Employees first*, in its own small step (your
    line managers now), then the other masters? Or *all masters at once*?

### The owner's decisions for Part 3 (2026-10-05)

| # | Question | Decision |
|---|---|---|
| 8 | Blank cells | **Keep the current value.** To clear a value, type `-`. |
| 9 | The key | **The record's code only** (Employee No., Item Code, ...). |
| 10 | Copy current records | **Yes:** the existing records as a sheet, to edit and paste back. |
| 11 | Scope and order | **Employees first** (step 3a), then the other masters (step 3b). |

## As built, Part 3a: updating Employees (2026-10-05)

**Master Data Import → Employees → Rows: "Update existing"** (the choice
shows only for masters that can be updated; Employees in this step):
- **The columns:** the key, **Employee No.**, first; then every Employees
  column except company, division, branch, cost center, designation,
  grade and work schedule. Those change through an Employee Change (dated
  and approved), so a pasted column of them is refused with that reason.
- **Copy current records:** the user's employees (their companies) as a
  sheet, the key then those columns, values in the form they paste back
  (dates dd/mm/yyyy, the line manager by Employee No., grade and units by
  code). Bank columns are left out without the Employees "sensitive"
  right. Pasted back unchanged, it changes nothing.
- **The paste:** the key column and any of those columns, in any order.
  - **the key:** the Employee No. only (decision 9); an unknown one, or
    the same one twice, is an issue on that row;
  - **a blank cell keeps the value; `-` clears it** (decision 8); a
    compulsory column can't be cleared;
  - references as when adding: by code or exact name;
  - bank columns need the sensitive right.
- **Line managers are checked after the whole paste:** not the employee
  themselves, not someone who has left, and no loop (Sara under Ali,
  Ali under Sara, in one paste or with the existing ones).
- **Check** lists each row's changes ("Line Manager: (empty) → EMP-0001
  Sara Khan"), counts the rows with no change, and holds Import back while
  any row has an issue.
- **Update** saves each changed row through the Employees save, with the
  record's id, so every rule of the employee screen applies. Each change
  is written to the employee's history as an Edit, reason "Import
  (update)".
- **All or nothing:** if a save still fails, the rows already saved in
  that run are put back as they were, and their history entries removed.
- **The log** (`masterImports`): Mode Update, Status Updated or Undone,
  the number updated.

**Behind it:**
- `masterImport.js`: `UPDATES` (one definition per master that can be
  updated: key, locked columns, how to read and save a record),
  `checkUpdate`, `employeeUpdateRules`, `updateRows`, and the callable
  `getMasterImportRecords`; `checkMasterImport` and `runMasterImport` take
  `mode: 'update'`;
- `hrEmployees.saveEmployeeFor`: an edit's history carries the import's
  reason.

**Tests:**
- the `masterImportUpdate` suite (5);
- `masterImportUpdate.ui.js` (4);
- negative controls (see the PR).

**To go live:** "functions set" `master-import-3a`, with the screens.

**Next:** step 3b, the other masters (Company, Org Units, Chart of
Accounts, UOM, Item Sub-Category, Items, Vendors, Customers, Currencies,
Customer Classifications, Sales Types, Requisition Categories, Fixed
Asset Classes and Master, Inventory Valuation, Price Lists, Users).

## Part 3b design: updating the other masters (proposed 2026-10-05)

The same Update mode as Employees (decisions 8–10): the key is the
record's code, only pasted columns change, a blank keeps and `-` clears,
Copy current records gives the sheet. Each row is saved through the
master's own save with the record's id, so its rules (account types,
parents, company, duplicates) apply as on its screen. A rule only the
save knows about (e.g. an account with children can't become postable)
stops the update at that row and puts back the rows before it (all or
nothing).

**Proposed, by master** (locked = refused in the sheet, with the reason):

| Master | Key | Locked (and why) |
| --- | --- | --- |
| Company | Ref Code | Tax Type / Tax Number (a company can hold several; edit on Company Master) |
| Organizational Units | Code | Type, Company (units are referenced by type and company) |
| Chart of Accounts | Account Code | Account Type, Parent Account, Postable, Company (the code is built from type and parent; postings depend on them) |
| Currencies | Code | — |
| Unit of Measure | Code | — |
| Items | Item Code | Category (the code is built from it), Company |
| Vendors | Vendor Code | Company |
| Customers | Customer Code | Company |
| Fixed Asset Classes | Code | Kind (the assets of a class follow it) |
| Fixed Asset Master | Asset Code | Class, Company; the save keeps its own rules after capitalization |
| Users | Username | Email (it is the sign-in), password (not in the sheet) |

**Open questions:**

12. **Masters without a code** (Item Sub-Categories, Customer
    Classifications, Sales Types, Requisition Categories): leave them to
    their screens (decision 9: code only; they are few)? Or key them by
    exact name?
13. **BOM, Inventory Valuation, Price Lists:** leave them to their screens
    (they hold versions and lines by date)? Or include them?
14. **Users:** include (full name, role, companies; email locked)? Or
    leave users to User Management?

### The owner's decisions for Part 3b (2026-10-05)

| # | Question | Decision |
|---|---|---|
| 12 | Masters without a code | **No update option** (Item Sub-Categories, Customer Classifications, Sales Types, Requisition Categories). |
| 13 | BOM, Inventory Valuation, Price Lists | **No update option.** |
| 14 | Users | **Included:** full name, role, companies; email locked. |
| — | The locked columns | **As proposed** in the table above. |

## As built, Part 3b: updating the other masters (2026-10-05)

**Update existing** now covers every master with a code (decisions
12–14), with the same rules as Employees (key = the code, only the pasted
columns, blank keeps, `-` clears, Copy current records, all or nothing):

| Master | Key | Locked |
| --- | --- | --- |
| Company | Ref Code | Tax Type, Tax Number (its tax numbers are kept as stored) |
| Organizational Units | Code | Type, Company |
| Chart of Accounts | Account Code | Account Type, Parent Account, Postable, Company |
| Currencies | Code | — |
| Unit of Measure | Code | — |
| Items | Item Code | Category, Company |
| Vendors | Vendor Code | Company |
| Customers | Customer Code | Company |
| Fixed Asset Classes | Code | Kind |
| Fixed Asset Master | Asset No. | Company, Class |
| Users | Username | Email; the status is kept as stored |
| Employees (3a) | Employee No. | Company, division, branch, cost center, designation, grade, work schedule |

- **No update option** (decisions 12–13): Item Sub-Categories, Customer
  Classifications, Sales Types, Requisition Categories (no code), BOM,
  Inventory Valuation, Price Lists (versions and lines by date), and the
  openings (leave balances, provisions).
- **Each row** is the record as stored with the pasted columns laid over
  it, made into the form's data by the master's own import definition and
  saved through **the master's own save, with the record's id**. So every
  rule of its screen applies (accounts of the right type and company,
  unique names, a vendor's Local/Foreign, a capitalized asset's rules). A
  rule only the save knows stops the update at that row: nothing is
  changed (the rows before it are put back).
- **References** work as when adding, by code or exact name, among the
  record's own company (accounts, classes, units) and, for an item's
  sub-category, its category's.
- **Users:** companies a user already has may stay even if the importer
  can't see them; a company being added needs the importer's access.

**Behind it:** `masterImport.js` `legacyUpdate` (one definition per
master: key, id field, locked columns, what to keep) and `updateRows`
(snapshot and put back, Realtime Database or Firestore).

**Tests:**
- the `masterImportUpdate2` suite (6): the specs; **Copy current records
  pastes back unchanged for every master**; each locked column refused;
  an update per master through its own save; rights and company access;
  the undo;
- `masterImportUpdate` (5) and `masterImportUpdate.ui.js` (4) updated;
- negative controls (see the PR).

**To go live:** "functions set" `master-import-3b` (no screen change).
