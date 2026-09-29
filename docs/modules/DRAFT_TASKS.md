# Drafts in Home Tasks

Status: **built, awaiting deploy** (2026-09-29).

## The request (owner, 2026-09-28)

> Any draft entry also should be in Tasks until posted or deleted. If
> another user updated the draft entry then it should be in the last
> updated user's task only.

## Owner's decisions (2026-09-28)

1. **Which drafts:** every transaction module that saves drafts, and
   Recurring Journal templates still in Draft.
2. **Rejected documents** stay where they are today, under **Rejected —
   Needs Your Resubmission**. A document shows in one block, never both.
3. **Purchase Order and Sales Order** screens are fixed so a task opens the
   entry itself. Today they ignore the task and show the list.
4. **Who sees a draft:** only its last updater. Nobody else, including
   admins, sees it in their Tasks.

## Rules

- A draft is a document whose `Status` is exactly `Draft`. Submitting it
  for approval, posting it or deleting it removes the task. A document
  sent back as **Rejected** moves to the Rejected block (decision 2).
- **Last updater** = the draft's `UpdatedBy`, or `CreatedBy` if it has
  none. It's compared with the signed-in user's actor name, the same value
  every save writes: the profile's username, or the uid if there is none.
  Every save path stores `UpdatedBy`, so an edit by another user moves the
  task to that user.
- The user must still have **access** to the module (Roles & Permissions)
  and to the draft's company. A user who lost either doesn't see it.
- Newest first (last saved time).

## Sources

| Module | Where drafts are kept |
|---|---|
| GRN, Material Issue, Production, Warehouse Movement, Stock Adjustment, Physical Count, Delivery Note, Purchase Return, Sales Return | RTDB `stock/transactions` (by `TransactionType`) |
| Purchase Requisition | RTDB `purchaseRequisitions` |
| Inventory Purchase Requisition | RTDB `inventoryPurchaseRequisitions` |
| Purchase Order | RTDB `purchaseOrders` |
| Sales Order | RTDB `salesOrders` |
| Job Order Request | RTDB `jobOrderBatches` (a draft is a batch) |
| Vendor Invoice | RTDB `vendorInvoices` |
| Customer Invoice | RTDB `customerInvoices` |
| PDC Received / Issued | RTDB `pdcCheques` (by `Direction`) |
| Recurring Journal Entries | RTDB `recurringJournals` (templates in Draft) |
| JV, CBT | Firestore `journalEntries` (by voucher type) |
| Capitalization, Additional Depreciation, Retirement, Capital Work in Progress | Firestore `faPostings` (by `ModuleID`) |

Not included: masters (a Planned fixed asset is a record, not a draft),
reports and the Depreciation Run, which has no draft.

## Design

- **Server:** `getMyDraftsForUser` in functions/src/homeTasks.js reads the
  sources above and returns the caller's drafts: module, label, document
  id, description, date, company and last saved time.
- **Home:** a **My Drafts** block in Tasks, below Rejected. Its count is
  in the Tasks button's total. A row shows the module, the description and
  when it was last saved. Clicking it opens the module on that draft, like
  every other task.
- **Opening a draft:** every module above already opens an entry from a
  task, except:
  - **Purchase Order** and **Sales Order** (decision 3). Both become
    hand-maintained screens.
  - **Job Order Request**, which opens a line from an approval task. A
    draft is a batch, so the screen also accepts a batch id.
- **Cost:** one read of each source per Home load, the same reads the
  module lists already make.

## As built (2026-09-29)

- `getMyDraftsForUser` returns each draft's module, label, document id,
  description, document date, company and last saved time, newest first.
- The three screens above, and **GRN**, open a task's entry only after
  the list, the permissions and the form's dropdowns have loaded.
  - **GRN fix:** a task could open a GRN before its permissions arrived,
    and then the draft showed no Save or Post button. It was seen once in
    about six test runs. Now the screen waits for them.
- **Tests:**
  - The `draftTasks` emulator suite (3) covers every source, the
    exclusions, lost module access, and real saves.
  - `draftTasks.ui.js` (7) opens a PO, SO, Job Order batch, GRN and JV
    draft from its task. The permissions are held back on all but JV,
    which has the race below.
  - `home.ui.js` gains a My Drafts check.
  - `tools/test-deploy-hosting.sh` (9) covers the Hosting deploy.
- **Negative controls, each caught:**
  - creator in place of last updater;
  - non-drafts included;
  - company check dropped;
  - module access check dropped;
  - PDC direction swapped;
  - PO not waiting for permissions;
  - SO never opening a task;
  - JO batch not opened;
  - JO Save not redrawn after permissions;
  - GRN not waiting for permissions;
  - drafts left out of the Tasks count;
  - the Hosting script's REPLACE_ME and public/ guards.

## Found while building it, not fixed

Most other screens that open an entry from a task don't wait for their
permissions either, going by their code: CBT, JV, the invoices, stock
modules, returns, PDC, Fixed Assets and Recurring Journal. Only GRN and JV
were tested. If the permissions answer after the list, the entry shows no
Save or Post button until it's reopened. The permissions usually come
first. Physical Count and
Production are generated screens, so fixing them needs a screen patch.

## Deploying it

Functions `getMyDraftsForUser` (new) and `getModuleFragment` (PO and SO
become hand-maintained). The screen release carries PURCHASEORDER,
SALESORDER, JOBORDERREQUEST and GRN. The **Home block is in
public/index.html**, so it needs a Hosting deploy. The Deploy workflow now
has a **hosting** task for that (tools/deploy-hosting.sh), guarded
against REPLACE_ME placeholders.
