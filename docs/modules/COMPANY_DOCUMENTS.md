# Company Documents (legal documents, contracts, licences)

Status: **design agreed** by the owner (2026-10-03; decisions below).

## The request (owner, 2026-10-03)

"Yes, develop to store company legal documents, contract, etc". This is
the follow-up to supporting documents on entries
([ATTACHMENTS.md](ATTACHMENTS.md)), which covers vouchers only.

## What exists today (from the code)

- **The storage is ready:** the connected Google Drive, the private
  "ERP Documents" folder, the upload checks (type by name and content,
  10 MB), open through the ERP, and "removed means moved, never deleted"
  (`attachments.js`, `documentStorage.js`). A new module reuses all of
  it.
- **Company records:** Company Master. It is read by Admin, Finance
  Manager, Accountant and Viewer; only Admin writes. Users see only their
  assigned companies.
- **Home tasks** already show counted reminders (approvals, drafts,
  recurring journals due, follow-ups), so an expiry reminder fits there.
- **Nothing tracks expiry today:** no licence, insurance or contract
  dates.

## Proposed design

### 1. A document register, not just files

A legal document has more to it than its file: a renewal date, a
reference number, and who the other party is. So each document is a
**record** with its files attached (one or several, e.g. scan pages or
the signed copy plus annexes):

| Field | Notes |
|---|---|
| Company | Required; one of the user's companies |
| Category | Trade Licence, Memorandum / Articles, VAT / Tax Registration, Contract, Lease / Tenancy, Insurance, Bank, Power of Attorney, Other (Admin can add categories) |
| Title | e.g. "Warehouse lease – Al Quoz" |
| Reference no. | Licence / policy / contract number |
| Party | Optional: a vendor, a customer, or free text (landlord, bank, authority) |
| Issue date / Start date | |
| Expiry date | Optional; drives the reminders |
| Status | Active, Expired (automatic from the date), Superseded, Terminated |
| Notes | |
| Files | Same checks as entries: PDF, Word, Excel, images, 10 MB each |

**Renewal:** "Renew" makes a new record linked to the old one (new
dates, new files). The old one becomes Superseded and stays for history.

### 2. Screens

- **Company Documents** (new): a list with company, category, status
  and an "expiring within" filter; search by title, reference or party;
  colour by status (expired red, expiring soon amber). Opening one shows
  its details and files (the same file section as on entries).
- **Company Master:** a "Documents (n)" link that opens the register
  filtered to that company.
- **Vendor / Customer Master:** see question 5.

### 3. Folders in Drive

`ERP Documents/<company>/Legal Documents/<category>/<title or reference>/`,
next to the year folders. Removed files go to `Removed/` as today.

### 4. Reminders

A Home task, **"Documents expiring"**, counts the documents expiring
within N days (and those already expired, until renewed or marked
Terminated). Each item opens the document. Who sees it: question 3.

### 5. Behind it (for the record)

- New hand-written module `functions/src/companyDocuments.js`.
- Firestore `companyDocuments` (one record each). Files reuse the
  attachments store, as entry "COMPANYDOCS".
- Every change is logged (who, when, what changed).
- Module `COMPANYDOCS` with the capabilities **access** (view) and
  **write** (add, edit, renew, remove files), set per role in Roles &
  Permissions.
- No change to database rules.

## Open questions for the owner

1. **Who can see these documents?** They are sensitive (salaries in
   contracts, owners' IDs in the MOA). Proposed: a separate permission
   for Company Documents, plus company access. Default: Admin and
   Finance Manager may see; only Admin may add or change.
2. **Categories:** is the list in §1 right? Should Admin be able to add
   categories?
3. **Expiry reminders:** how many days ahead (proposed 30), and who sees
   the Home task (proposed: everyone who can add or change the
   documents)?
4. **Removing:** a whole document record, or its files: Admin only,
   moved to Removed, never deleted (as for posted entries)?
5. **Vendor and customer documents** (trade licence, contract, VAT
   certificate of a vendor): include them in this register (Party =
   that vendor or customer), also show them on the Vendor / Customer
   Master, or leave that for later?

## The owner's decisions (2026-10-03)

| # | Question | Decision |
|---|---|---|
| 1 | Who sees / changes | **Own permission** (Company Documents, plus company access). Default: Admin and Finance Manager view; Admin adds and changes. Adjustable per role in Roles & Permissions |
| 2 | Categories | **The nine proposed; Admin adds, renames or deactivates more** (a category in use can't be deleted) |
| 3 | Reminders | **30 days ahead**, a "Documents expiring" Home task (expired ones too, until renewed or terminated), for everyone who can add or change the documents |
| 4 | Removing | **Anyone who can change the documents** (write permission). Files move to Removed in Drive, never deleted; a removed record stays in the history as Removed |
| 5 | Vendor / customer documents | **In the register** (Party = the vendor or customer), and Vendor / Customer Master shows "Documents (n)" for that party |

"Admin" for categories means the Admin users (as for Document Storage).
