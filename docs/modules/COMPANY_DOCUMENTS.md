# Company Documents (legal documents, contracts, licences)

Status: **built and tested** (2026-10-03; see [As built](#as-built-2026-10-03)).

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

## As built (2026-10-03)

**Company Documents** (new screen, `screens/COMPANYDOCS.html`):
- **List:** search (title, reference, party, notes), company, category and
  status filters. The status filter defaults to "Current" (not renewed or
  removed); the others are "Expiring or expired", Expiring, Expired,
  Active, Terminated, Renewed and Removed. Status shows in colour:
  Expiring (n days) in amber, Expired in red. A paperclip shows the file
  count.
- **A record:** company, category, title, reference, party (none, a
  vendor, a customer, or other by name), issue and expiry dates, notes.
  Status is Active or Terminated. Its files sit below in the same
  Supporting documents section as on entries. Under that: the other
  versions and the history (who did what, and which fields changed).
- **Renew** fills the form for the new version (new reference and dates)
  and saves a new record. The old one becomes "Renewed" (Superseded),
  keeps its files and links both ways.
- **Remove** asks for the reason. The files move to Removed in the
  storage, and the record stays, read-only, as Removed.
- **Categories** (Admin): add, rename, or stop using one.
- **View-only users** see everything and open files, but have no New,
  no changes and no Add files.
- **Folders:**
  `ERP Documents/<company>/Legal Documents/<category>/<title - reference>/`.

**Documents (n)** on every row of Company, Vendor and Customer Master,
for users who can open Company Documents. It opens the register filtered
to that company or party, with "Back to ..." and, for a party, "Add one
for this vendor / customer". The count is current documents only.

**Home:** "Company Documents Expiring or Expired" lists Active documents
expiring within 30 days (Asia/Dubai date) or already expired. It is shown
to users who can change the register, in their companies. Each item
opens the document.

**Behind it:**
- `functions/src/companyDocuments.js`: 8 callables.
- Firestore: `companyDocuments`, `companyDocumentCategories` (the nine
  are seeded on first use), `companyDocumentLog`.
- `attachments.js` gained the COMPANYDOCS source: folders under Legal
  Documents; adding and removing files needs **write**; nothing can be
  added to a removed record.
- The shell's Supporting documents section hides Add files for view-only
  users, and gained `supportingDocs.partyDocs(...)` for the master lists.
  Vendor and Customer Master are generated screens, so their edits are
  SCREEN_EDITS in `tools/legacy-port/generate.js`.
- Module `COMPANYDOCS`: access is Admin and Finance Manager, write is
  Admin.

**Tests:**
- The `companyDocuments` emulator suite (6) and `companyDocs.ui.js` (8).
  The light-mode guard (`supportingDocsTheme.test.js`) now also checks
  this screen; it caught a hover colour light mode didn't recolour.
- Four negative controls caught:
  - the Home task shown to view-only users;
  - view-only users adding files;
  - the Add button not following the server;
  - the Documents link shown without access.

**To go live** (in this order):
1. Deploy "functions set" `company-documents`.
2. Deploy "hosting".
3. Deploy "screens only".
4. In the app: link a menu node to **Company Documents**, and check its
   row in Roles & Permissions.
