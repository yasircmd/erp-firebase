# Supporting Documents (attachments on entries)

Status: **live and in use** 2026-10-03 (PRs #60, #61; see
[As built](#as-built-2026-10-03)). Google Drive connected by the owner.

**Moving the root folder:** "ERP Documents" can be moved anywhere in the
connected Drive (the owner keeps it in a project folder): the ERP works
by folder id, and keeps access to what it created. Don't put it in a
folder shared with people who shouldn't see every company's documents
(it takes that folder's sharing), and don't delete it or rearrange the
folders inside it.

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

(As proposed. The storage set-up and some details changed: see the
owner's decisions, "Storage for now" and [As built](#as-built-2026-10-03).)

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

## The owner's decisions (2026-10-03)

| # | Question | Decision |
|---|---|---|
| 1 | Storage | **Google Drive.** For now, the owner's own Google Drive, connected once by Admin (owner, 2026-10-03, follow-up); later a Workspace Shared Drive |
| 2 | Who sees and adds | **Anyone who can open the entry** (module + company access), approvers included |
| 3 | Removing | **Before posting: the uploader or Admin; after posting: Admin only.** A removed file moves to a "Removed" folder, never deleted (one exception: Data Reset's Supporting Documents moves every file to the storage's trash, DATA_RESET.md decision 286) |
| 4 | Modules | **All 27 entry modules at once** (one shared component) |
| 5 | Year folder | The document's own date (as proposed; not asked) |
| 6 | Master data | Not now (as proposed; not asked) |

## Storage for now: the owner's own Google Drive (owner, 2026-10-03)

The owner has no Google Workspace yet and offered a folder shared with
"anyone with the link". That can't work, and isn't safe:
- Google refuses files from a service account in a personal Drive (it has
  no storage of its own there), so uploads would fail.
- Anyone who obtains the link would see every company's documents.

Agreed instead: **"Connect Google Drive"**.
- Admin signs in once with their Google account and allows the ERP the
  narrow `drive.file` permission: only the files and folders the ERP
  itself creates.
- The ERP creates a **private** "ERP Documents" folder in that Drive (with
  the company / year / voucher-type layout) and uploads as that account,
  into its storage (15 GB free, or Google One).
- Users only get files through the ERP; the folder link is shown to
  Admin only.
- Later, a one-time "Move to Shared Drive" step moves everything to
  Workspace. The screens don't change.

## Set-up needed from the owner (once, before go-live)

1. Google Cloud console, project `erp1-8f4cd`:
   - enable the **Google Drive API**;
   - **OAuth consent screen**: External, app name "ERP", your email;
     scope `.../auth/drive.file`; then **Publish app** ("In
     production"). With only this scope Google does no review; left in
     "Testing", the connection would expire every 7 days.
   - **Credentials → Create OAuth client ID**, type "Web application",
     with the authorized redirect URI
     `https://us-central1-erp1-8f4cd.cloudfunctions.net/driveOAuthCallback`.
2. In the ERP, Admin → **Document Storage**:
   - paste the client ID and client secret;
   - click **Connect Google Drive** and sign in with the account that
     will hold the documents;
   - click **Test connection**.

The client secret and the connection are kept server-side only (never in
the repository, never sent to a browser).

## Build plan

1. **Server** (`functions/src/attachments.js`, hand-written):
   - the storage adapter: Google Drive over its REST API, signed in as
     the connected account (OAuth, `drive.file`); nothing to install;
   - the folder logic (company / year / voucher type / number; drafts
     renamed on posting);
   - the access check per module, reusing each module's own rules;
   - the callables and the audit log.

   Tests run against an in-memory stand-in for Drive, so they need no
   Google account. The real Drive is checked by Test connection after the
   deploy.
2. **Document Storage screen** (Admin): link, test, folder layout.
3. **Shell component** (`public/index.html`, a SUPPORTING DOCUMENTS
   block): the bottom section, upload, open, remove, and the paperclip
   count. Hosting deploy.
4. **The 27 screens**: each mounts the section in its entry form and adds
   the paperclip to its list (hand screens edited; generated ones through
   a generator transform, as for copy / paste).
5. **Posting hook:** when an entry gets its number, the draft folder is
   renamed.
6. Tests, negative controls, regression, docs, deploy sets (functions +
   hosting + screens), PR.

## As built (2026-10-03)

**Where it shows.** Every one of the 27 entry screens has a **Supporting
documents** section just below the entry (Purchase Order: both the draft
form and the detail view; Job Order: the batch form and a line's detail,
which show its batch's documents; Depreciation Run: below a run opened
with "Lines"). It shows:
- the files (name, size, who added it and when); click a name to open it:
  a PDF or picture opens in a new tab, Word and Excel files download;
- **Add files** (several at once) or drag them onto the section;
- a bin next to a file the user may remove, which asks first.

A new entry shows "Save the draft to attach documents". Lists show a
paperclip with the count next to the document number. Printing is
unchanged. The section is not part of the entry form: adding a file
doesn't count as an unsaved change.

**Checks before anything is sent:** the type (by extension) and 10 MB;
refused files are listed in one message, the rest are added. The server
checks again, also by content.

**Behind it.**
- Shell: the SUPPORTING DOCUMENTS block in `public/index.html`
  (`supportingDocs.mount({ module, view, id, list })`; one line per
  screen plus `data-doc-id` on list rows). Physical Count and Production
  are generated screens: their two edits are SCREEN_EDITS in
  `tools/legacy-port/generate.js`.
- Server: `functions/src/attachments.js` (callables, access, folders,
  file checks) and `functions/src/documentStorage.js` (Google Drive over
  its REST API with the connected account's refresh token; an in-memory
  stand-in on the emulators).
- Firestore: `attachments` (one record per file), `attachmentFolders`
  (folder ids), `attachmentLog` (every upload and removal),
  `settings/documentStorage` (client, token, root folder; server only).
- Access: the module's access, the entry's company, and the module's own
  rule (Purchase Requisition visibility). Removal: the uploader before
  the entry has a number, Admin (Document Storage access) any time.
- A draft's files are in `Drafts/<type> - <id>/`; once the entry has its
  number, the folder moves to `<company>/<year>/<type>/<number>/` the next
  time its documents are listed or added.
- **Document Storage** (Admin): status and account, the folder link,
  the OAuth client (the secret is never shown back), the redirect URI to
  copy, Connect / Reconnect, Test connection, Disconnect. Saving a
  different client ID ends the connection (the old sign-in belongs to the
  old client): connect again.

**Tests:** the `attachments` emulator suite (5) and
`supportingDocs.ui.js` (9: new entry, add with refused files, paperclip,
open and download, remove, an entry getting its id while open, the
section in all 27 screens, a GRN, the Document Storage screen and that it
is Admin only). Four negative controls caught: no client-side type check,
no reload when the entry's id changes, one screen's section removed, and
a new client keeping the old connection.

**Light mode** (fix 2026-10-03, owner): the shell's light theme recolours
a fixed set of slate classes; the section had used two others
(`bg-slate-800/50`, `divide-slate-700/60`) and stayed dark. It now uses
mapped ones, and `functions/test/unit/supportingDocsTheme.test.js` checks
that the section and the Document Storage screen use only slate classes
light mode recolours.

**To go live** (in this order):
1. Deploy, "functions set", set `supporting-documents`.
2. Deploy, "hosting".
3. Deploy, "screens only" (or tick screens in step 1).
4. In the app: link a menu node to **Document Storage** (System Admin).
5. The owner's set-up above: Google Cloud OAuth client, then Connect
   Google Drive, then Test connection.
