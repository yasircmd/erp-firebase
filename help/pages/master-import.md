---
title: Master Data Import
area: admin
order: 9
modules: [MASTERIMPORT]
sources: [functions/src/masterImport.js]
summary: Add or update ERP masters, employee records, opening balances and item barcodes from an Excel paste.
reviewed: 2026-10-13
fingerprint: b43a46033f1d0c76
---
## What it is for

**Master Data Import** loads many records from a spreadsheet in one checked batch. It covers setup and transaction-supporting records across company administration, finance, inventory, procurement, sales, fixed assets, users and HR. It can also update selected existing records, load opening leave and payroll provision balances, and add item barcodes.

## Full scope

In **Add new** mode, the import list follows this order because later records can depend on earlier ones:

1. **Company and organization:** Company; Organizational Units.
2. **Finance and item setup:** Chart of Accounts; Currencies; Unit of Measure (UOM); Item Sub-Category; Items.
3. **Suppliers and customers:** Vendors; Customer Classifications; Customers; Sales Types; Requisition Categories.
4. **Fixed assets and inventory:** Fixed Asset Classes; Fixed Asset Master; Bill of Materials; Inventory Valuation List; Price Lists.
5. **Access and HR:** Users; Employees; Leave Opening Balances; Payroll Provision Opening Balances.
6. **Item identification:** Item Barcodes.

Some imports use more than one row for a logical record: use one row per BOM component and one row per price-list line. Repeat the BOM or price-list details on its rows. A price-list import can add lines to an existing list; a new list also needs its currency and any classification mapping.

For Employees, active custom fields configured in HR Setup appear as additional columns. Employee numbers, item codes, vendor and customer codes, account codes, fixed-asset numbers and a company's Ref Code are assigned by the system; do not include them as new-record columns. Other references can usually be entered by code or exact name.

**Update existing** is offered for Company, Organizational Units, Chart of Accounts, Currencies, UOM, Items, Vendors, Customers, Fixed Asset Classes, Fixed Asset Master, Users and Employees. Use the record's code as the key (Username for Users and Employee No. for Employees). Item Sub-Categories, Customer Classifications, Sales Types, Requisition Categories, BOMs, Inventory Valuation Lists, Price Lists, openings and Item Barcodes do not have this update mode.

This import does **not** load GL opening balances, opening stock or vendor/customer open invoices. Those are accounting and stock postings, not master-data imports; see [Opening Balances](opening-balances.html).

## Before you start

- Prepare a tab-separated paste from Excel with the column headers in its first row. Use **Copy headers** or **Copy headers with a sample row** to get the exact columns for the selected import.
- Import prerequisite records first. For example, set up a company's accounts before importing items that refer to them, and set up HR designations and grades before Employees.
- Check each column's notes and required marker. Use the displayed company code or name, account, item and other reference codes/names as requested.
- You need access to Master Data Import, the relevant right for the selected module and access to each applicable company.
- For Users, prepare one temporary password on the screen for the batch. It must be at least six characters; it is not a spreadsheet column or part of the import log.
- For **Update existing**, decide which columns to change. The key identifies the record and cannot be changed; only pasted columns are updated.

## Step by step

1. Open **Master Data Import** and choose a type from the ordered list.
2. If the type offers **Rows**, choose **Add new** or **Update existing**. In Update mode, use **Copy current records** to get the key and editable values for records in your companies.
3. Copy the headers (and, for a new import, optionally the sample row) into Excel. Fill in the rows, then copy the headers and data back into the paste box.
4. Select **Check**. Review the row- and column-specific issues below the preview, correct the spreadsheet and check again. No changes are made by Check.
5. Select **Import** only after the whole batch checks clean, then confirm. Review the result summary, including system-generated codes where applicable.

## Checks and update rules

- Every row is checked against the same save rules as the corresponding screen, including required fields, references, company access, duplicate names and module-specific validation. A reference can use a code or an exact name; where supported, a row can refer by name to a record earlier in the same paste.
- The paste supports up to 2,000 rows. Headers can be in any order; matching ignores case and spacing. Numbers can include thousands separators. Yes/no fields accept Yes/No, Y/N, True/False or 1/0. Dates accept dd/mm/yyyy (also d/m/yyyy, dd-mm-yyyy and dd.mm.yyyy) or yyyy-mm-dd; impossible dates are rejected.
- **Add new is all or nothing.** If any row has an issue, nothing is imported. The import checks again when it runs; if a save fails, records created in that run are undone and the failure is reported.
- **Update existing is also all or nothing.** Only pasted columns change. A blank cell keeps its current value; type `-` to clear a value. Compulsory fields cannot be cleared, and locked fields are refused with an explanation. A check preview shows the changes; rows with no changes are skipped. If saving a later row fails, earlier changes in that batch are restored.
- Every row uses the selected module's own save rules. Update rights are available only for the types listed above and require the relevant edit right.

## Special cases

- **Users:** each imported user receives a sign-in using the email in the sheet and the temporary password entered on screen. Usernames and email addresses must be unique. Give each user the password securely and have them change it from the user menu after signing in.
- **Fixed Asset Master:** this creates asset records only. Put the asset's value and depreciation into the books through Fixed Asset Capitalization.
- **Bill of Materials:** use one row per component. The repeated parent BOM details must agree across all its rows, and an item with an active BOM cannot be overwritten by this import.
- **Inventory Valuation List:** only an active Finished Good or Semi-Finished Good with an active BOM in the company is eligible.
- **Leave Opening Balances:** import one row per employee and balance-based leave type. The date is the balance date; entitlement accrues from the following day. Correct an existing opening with an adjustment on the employee's leave card.
- **Payroll Provision Opening Balances:** import the employee's provision amount through the date shown. This is a balance already represented in the GL, not a new posting; later payroll runs provide only the change.
- **Item Barcodes:** import one row per barcode. A barcode can represent a pack quantity; leave Pack Qty empty for one item unit. Existing barcodes are changed or removed in Item Master.

## What happens in the books

Most imports create or update master/setup records and do not post a finance entry. Leave openings and payroll provision openings establish balances rather than posting them again; Fixed Asset Master creates asset cards but does not capitalize them. GL opening balances, stock openings and open invoices are outside this import.

## Rights

The user needs Master Data Import access and the required capability for the selected master or operation. Company access is checked for the rows being imported. Sensitive employee bank fields require the Employees **sensitive** right.

## Questions and mistakes

- **The import type or Update option is missing:** check Master Data Import access and the relevant module right. Update mode is not available for every Add new type.
- **A reference is not found or is ambiguous:** use its code, or the exact name of a record in the applicable company. Confirm prerequisite records were imported first.
- **Rows have issues:** use the row and column shown in the issue list; no rows are saved until the entire batch checks clean.
- **Import reports that nothing was changed:** a save failed after checking, for example because the data changed meanwhile. Correct the reported row and run Check again before importing.
- **An opening balance already exists:** use the relevant adjustment or balance screen to correct it; opening balances are not updated by import.
