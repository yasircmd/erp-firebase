# Supporting Documents (attachments on entries)

Status: **design**, awaiting the owner's decisions (2026-10-03). No code
until they are agreed.

## The request (owner, 2026-10-03)

"We need to add an option to attach supporting documents for entries like
JV, CBT, PO, GRN, Vendor invoice, etc.
1. Need an option to add the storage link like google drive, one drive,
   etc where all document saved by creating proper folders - company,
   year, voucher type wise
2. The original storage link can see only admin
3. Same users of entry or approval can access it, any time can update
   even after posting
4. Multiple documents can upload - doc file, pdf, image, excel maximum
   10 mb limit"

## What exists today (from the code)

- Nothing stores files yet: no Firebase Storage, no Google / Microsoft
  API, no stored secrets. Every read and write goes through Cloud
  Functions (deny-all rules), and that stays so: **users never get the
  storage itself, only the files, through the ERP**.
- 27 modules have entries (draft / post): JV, CBT, PDC Received and
  Issued, Recurring JV; Purchase Requisition, Inventory Purchase
  Requisition, Purchase Order, Job Order Request, Sales Order; GRN,
  Material Issue, Production, Warehouse Movement, Stock Adjustment,
  Physical Count; Vendor Invoice, Purchase Return, Delivery Note, Customer
  Invoice, Sales Return; Fixed Asset Master, Capitalization, CWIP,
  Additional Depreciation, Depreciation Run, Retirement.
- Who may see an entry is already decided per module: module access +
  company access (+ the Purchase Requisition visibility rules). Approvers
  reach an entry through Home Tasks / Approval Tracker with the same
  checks.

## Proposed design

### 1. Where files are kept: one storage, connected once by Admin

A new Admin-only screen, **Document Storage** (System Admin →
Configuration & Data Management):

- choose the provider and paste the **root folder link** (e.g. a Google
  Drive folder);
- **Test connection** (writes and deletes a small test file);
- see the folder layout it will create.

Only this screen shows the link (owner point 2). Users only ever see the
file list on the entry.

The ERP creates the folders itself, on first use:

```
<root folder>/
  01 - Nexus Production LLC/            (company Ref Code - name)
    2026/                               (year of the document date)
      Journal Vouchers/                 (voucher type)
        JV-26-01-000123/                (one folder per document)
          invoice-scan.pdf
          calculation.xlsx
      Goods Receipts/
        GRN-26-01-000045/ ...
```

A draft has no number yet: its files go in `Drafts/<draft id>/` and the
folder is renamed to the number when the entry is posted.

**Provider: the honest trade-offs.**

| | Google Drive | OneDrive / SharePoint | Firebase Storage (built in) |
|---|---|---|---|
| Setup by you | A Google Cloud service account, and a **Shared Drive** (Google Workspace) shared with it. Plain Gmail "My Drive" won't work: service accounts can't own files there | An Azure app registration with Microsoft Graph permission to one SharePoint site / OneDrive | None |
| Admin browses folders outside the ERP | Yes, in Drive | Yes, in OneDrive / SharePoint | Only in the Firebase console |
| Credentials kept by the ERP | A service-account key in Secret Manager | A client secret in Secret Manager | None |
| Cost | In your Workspace plan | In your Microsoft 365 plan | Pay-as-you-go storage, small |

Recommended: **Google Drive with a Shared Drive** if you have Google
Workspace, since it matches what you described. The code keeps the
provider behind one small adapter, so OneDrive can be added later
without touching the screens.

### 2. Who can see and add files (owner point 3)

On an entry, the **Attachments** section shows to anyone who can open
that entry: module access + company access, as today. That includes its
approvers, who open it from Home Tasks / Approval Tracker.
- **Add files any time**: draft, pending approval, posted, even reversed.
- **Open / download**: the file comes through the ERP after the same
  check; nobody gets a Drive link.
- **Remove**: see question 3.

### 3. The files (owner point 4)

- Several files per entry, uploaded together (drag and drop or Choose
  files).
- Types:
  - PDF;
  - Word (.doc, .docx);
  - Excel (.xls, .xlsx, .csv);
  - images (.jpg, .jpeg, .png, .heic, .webp).

  Anything else is refused, checked both by extension and by content.
- **10 MB per file**, refused with a clear message before the upload
  starts.
- Each file records: name, type, size, uploaded by and when, and (if
  removed) by whom and when.

### 4. On the screen

- **Bottom of the entry**, below the lines and totals and above the
  action buttons, is a **"Supporting documents (3)"** section with:
  - the file list (name, size, who and when, open, remove);
  - an **Add files** button / drop area.
- **A paperclip with a count** in each module's list ("📎 3"), so
  entries with documents are visible without opening them.
- A brand-new entry is saved as a draft first ("Save the draft to attach
  documents"), because the files need the entry to belong to.
- Printing is unchanged (attachments aren't printed).

The section is one shared component in the app shell (like the in-app
dialogs), so every module gets the same behaviour from one piece of code.
Each screen only says where to put it. That needs a **Hosting** deploy
once, plus the screens.

### 5. Behind it (for the record)

- New Cloud Functions:
  - `getAttachments` (the list for one entry);
  - `uploadAttachment` (one file, checked, then sent to storage);
  - `openAttachment` (streams the file back);
  - `removeAttachment`;
  - Admin-only: `getStorageSettings`, `saveStorageSettings`,
    `testStorageConnection`.
- Each checks "may this user open this entry?" with the module's own
  rules before anything else.
- The list of files lives in Firestore (`attachments`). The entry gets
  an `AttachmentCount` for the paperclip.
- Every upload, open and removal is logged.
- A 10 MB file fits in one function call (limit 32 MB); no change to
  the database rules.

## Open questions: the owner's decisions

| # | Question | Proposed |
|---|---|---|
| 1 | Which storage? | Google Drive, in a Shared Drive (Google Workspace) |
| 2 | Who can see an entry's documents? | Everyone who can open the entry (module + company access), approvers included |
| 3 | Removing a file | Before posting: the person who uploaded it, or Admin. After posting: Admin only. A removed file is moved to a "Removed" folder, not deleted |
| 4 | Which modules first? | All 27 entry modules in one go (one shared component); or a first set (JV, CBT, PO, GRN, Vendor Invoice, Customer Invoice, PR) then the rest |
| 5 | Year folder | The document's own date (not the upload date) |
| 6 | Master data too? | Not now (vendor trade licences, asset photos): later, same component |
