# Transaction documents from RTDB to Firestore

Status: **design agreed** (owner, 2026-10-17: the recommendations). Step 0 live 2026-10-17 (runs #163, #164). Next: phase T1. Step 0, the home page,
is built (below). Nothing else is built until the owner agrees the design.

## The owner's direction (2026-10-17)

An expert advised keeping only master data in RTDB: a stock report
downloads every stock transaction ever saved, which costs Firebase usage.
The owner asked for an honest opinion, then: "proceed with the home-page
fix and the design doc". Measuring live usage first is not needed: the
project is still in development.

## Today

**Where the data is.** Master data, settings, number counters and the
transaction documents are in RTDB. The general ledger (`journalEntries`),
fixed-asset postings, HR and payroll documents are in Firestore. The global
lock (lock.js) is in Firestore. Rules are deny-all on both: only Cloud
Functions read and write.

**How it is read.** RTDB has no query in the code at all (before step 0).
To find one company's, one month's or one status's records, a function
downloads the whole collection and filters it in memory. Each such read
grows with every document ever saved, so it gets slower and costlier
every month, and in the end a function runs out of memory or time.

| Collection | Whole-collection reads (hand-written) | Ported (legacy) functions using it |
|---|---|---|
| `stock/transactions` (GRN, MI, Production, WM, Adjustment, Physical Count, DN, Purchase / Sales Return) | 18 in 12 files: stock reports, aging, period closing, returns, follow-ups, the GRN / MI / WM / Adjustment lists | Delivery Note, Physical Count, Production, the stock reports, the invoices' eligible GRNs / DNs, Data Reset |
| `customerInvoices`, `vendorInvoices` | 7 | the invoice lists, posting and reversal |
| `salesOrders`, `purchaseOrders`, `purchaseRequisitions`, `inventoryPurchaseRequisitions` | 3 | their lists, approvals, eligible-for lists |
| `jobOrderBatches`, `jobOrderLines` | 0 | Job Orders, Production |
| `pdcCheques` | 3 | — |
| `approvalInstances` | 2 | approvals of the ported modules |

About 37 ported functions read these collections. They can change only
through patches in tools/legacy-port/.

**How a stock posting writes.** Under the global lock, it does three
writes:
1. the document's status, in RTDB;
2. the running balances (`stock/ledger/{item}/{warehouse}`), one atomic
   multi-path update in RTDB;
3. the GL entry, in Firestore.

These span two databases, so the posting is not atomic as a whole.
commitAttempt.js narrows the gap and makes a half-done posting
detectable. It cannot rule one out.

## Step 0, built: the home page reads only what it shows (2026-10-17)

Every home page visit downloaded ten whole collections to find the user's
drafts (`getMyDraftsForUser`), plus every approval instance ever made
(`getPendingApprovalsForUser`, `getMyRejectedSubmissions`) and the
requisitions and Job Order lines (`getMyFollowUpTasksForUser`). It now asks
RTDB for the records in one status only (`orderByChild('Status')
.equalTo(...)`), which the database answers from its own index:
- the drafts (Draft);
- the approvals (Pending, Rejected);
- the follow-ups: Submitted requisitions; Accepted Job Order lines, with
  only their own batches; Posted stock transactions for the deliveries
  waiting for an invoice.

- **functions/src/rtdbStatus.js**: `withStatus(path, status)`, and the
  list of paths that have the index.
- **database.rules.json**: `.indexOn: ["Status"]` on those paths. Still
  deny-all: an index opens nothing.
- **Found while testing:** without the index the database refuses the query
  ("Index not defined"). It does not quietly download everything. So
  **the rules deploy goes first**, then the functions (deploy set
  `home-indexed-reads`).
- **Tests:**
  - unit test functions/test/unit/rtdbStatus.test.js: each listed path has
    its index, the rules stay deny-all, an unlisted path is refused;
  - new follow-ups test C (requisitions and Job Order lines, which had no
    test);
  - the existing drafts, approvals and follow-ups suites.
- **Negative controls, each verified then restored:**
  - the drafts read asks for Posted: 3 tests fail;
  - the follow-ups ask for the wrong status: test C fails;
  - an index removed from the rules: the query is refused.

The deliveries-to-invoice follow-up still reads every posted stock
transaction. RTDB filters on one field only, and "a delivery, posted, not
invoiced" needs three. Step 0 cannot fix that; Firestore can.

## Proposal

### 1. What moves, what stays

- **Moves to Firestore:**
  - the transaction documents: stock transactions, customer and vendor
    invoices, sales and purchase orders, the two requisitions, Job Order
    batches and lines, PDCs;
  - approval instances, last.
- **Stays in RTDB:**
  - master data (customers, vendors, items, the chart of accounts,
    org units…), settings, roles and permissions, the tree;
  - number counters (numbering.js): small, and issued in one atomic
    update.
- **The running stock balances** (`stock/ledger`): question 238. My
  recommendation is to move them too. A stock posting would then write
  the document, the balances and the GL in **one Firestore transaction**,
  atomic as a whole. That closes the gap commitAttempt only detects, and
  it is the biggest gain of the move after the cost.

### 2. Layout

- **One collection per kind, the same ids.** Each RTDB collection becomes
  one Firestore collection: `stockTransactions`, `customerInvoices`, and
  so on. Each document keeps its id, so approvals, attachments, GL
  references, e-invoices and links keep working.
- **The fields stay as they are.** Lines stay inside their document. A
  document's limit is 1 MiB, thousands of lines.
- **Added for queries:**
  - `ItemIDs` and `WarehouseIDs` arrays on stock documents, so a report on
    one item finds its documents (`array-contains`) without reading the
    rest;
  - the period `yyyy-mm`.

### 3. Every reader becomes a query

- **Each whole-collection read becomes a query** on what it needs: company,
  type, status, date range, item. The composite indexes go in
  firestore.indexes.json, deployed with the rules.
- **Lists page with a cursor**, the way JV and CBT already page the GL
  (LIST_PAGING.md).
- **Reports read only their period:**
  - a stock report reads its item and date range;
  - aging reads only open documents.
- **Opening balances of a report** come from the period-closing balances
  where they exist (PERIOD_CLOSING.md), not from all history.

### 4. Posting

Today a stock posting runs in this order:
1. take the global lock;
2. compute the stock movement;
3. write the document, the RTDB balances and the Firestore GL, as three
   separate writes;
4. finalize the commit attempt.

With the balances moved (question 238), step 3 becomes one Firestore
transaction. Step 4 is then not needed for stock: the transaction either
happens whole or not at all. The global lock stays exactly as it is
(CLAUDE.md: whole-system on purpose).

### 5. The ported modules

The 37 ported functions read through `firebaseDbRequest_`.
1. **First**, the generator maps the moved paths to a Firestore adapter in
   that one helper. The ported modules keep working unchanged, still
   reading everything.
2. **Then** the heavy ones (the Delivery Note, Production and invoice lists,
   the eligible-for lists, the stock ledger report) get patches that use
   queries.

Behavior stays as in Apps Script, quirks included (MIGRATION.md). Only
where the data is read from changes.

### 6. Moving the data

Question 239.
- **If what is in the system today is test data**, there is no migration:
  the switch comes with a Data Reset of the transactional data, which is
  the simplest and safest way.
- **If it must be kept:**
  - a one-time script (tools/migrate-transactions/) copies each collection
    with the same ids;
  - it checks counts and totals (stock quantity and value per item and
    warehouse, the GL trial balance before and after);
  - the RTDB copy stays, read-only, until the owner confirms, then is
    removed.
  - The switch needs a short maintenance window with no postings
    (question 241).

### 7. Order, in phases

Each phase is one PR, with:
- tests and negative controls;
- Help confirmed or updated;
- a deploy of **all functions** (the shared helpers change);
- for the first phase, the rules and indexes deployed before the functions.

| Phase | Moves | Why this order |
|---|---|---|
| T1 | Stock transactions (+ balances if 238 says so) | the biggest collection, and the one the expert named |
| T2 | Customer invoices, Sales Orders | the sales side reads stock documents (DN) |
| T3 | Vendor invoices, POs, PRs, IPRs | the purchase side, with GRN from T1 |
| T4 | Job Orders, PDCs | smaller |
| T5 | Approval instances | read by every module, safest last |

### 8. Tests

- **The suites seed RTDB.** About 600 emulator tests seed data through
  `reset(fixture)`. The helper learns to write the moved collections to
  Firestore, so the tests themselves change little.
- **New tests cover:**
  - each query (it returns only what it should);
  - each posting's atomicity (a failure halfway leaves nothing written);
  - for a migration, the migration checks.

### 9. Costs and risks

- **Firestore bills per document read, not per GB downloaded.** The saving
  comes from the queries: a query reads only matching documents. A
  report that still read every document would cost about the same as
  today.
- **Size:** this is the largest change since the migration. It covers
  about 30 hand-written readers, 37 ported ones, the approval registry,
  attachments, Data Reset, the chart-of-accounts usage check, period
  closing and e-invoicing. As a rough guide, T1 alone is about the size
  of a Tier 3 wave.
- **Doing it now is cheaper than later.** There is no real data yet, and
  every module added in the meantime adds more readers to change.

## Questions for the owner

237. **Scope.** All transaction documents in phases T1–T5 (recommended),
     or only stock transactions for now?
238. **Running stock balances.** Move them with the stock documents, so a
     posting is one atomic transaction (recommended)? Or keep them in
     RTDB, keeping today's commit-attempt check?
239. **Existing data.** Is everything in the system now test data, so the
     switch comes with a Data Reset and no migration (recommended if so)?
     Or must it be migrated?
240. **Approval instances.** Move them too, as the last phase T5
     (recommended)? Or keep them in RTDB, which leaves the home page's
     approvals reading by Status (step 0)?
241. **Switching.** If data must be migrated (239): is a maintenance
     window of about 30 minutes, with no postings, acceptable for each
     phase?
242. **Order.** T1 stock first, as above (recommended)? Or another order?

## The owner's answers

- **239 (2026-10-17):** the transactional data has been reset ("all
  transaction data reset now"). There is nothing to migrate, so no
  migration script. Question 241 (the maintenance window) then does not
  apply. Each phase switches with a Data Reset of its collections if test
  data has been entered in the meantime.
- **237, 238, 240, 242 (2026-10-17):** "agree all recommendations". All
  transaction documents move, in phases T1–T5; the running stock balances
  move with the stock documents, so a posting is one atomic Firestore
  transaction; approval instances move last (T5); stock first (T1).

## A rule from MULTI_CORPORATE.md (2026-10-17)

One app will serve several corporates, each in its own database. So the new
code takes `rtdb` / `firestore` from firebaseAdmin.js at call time and keeps
no data in module-level variables (a cache would be shared between
corporates in one function instance).

## As built: phase T1a (2026-10-17), stock documents and balances in Firestore

T1 is built in two PRs: **T1a** (this) moves the storage; **T1b** makes a
stock posting one atomic Firestore transaction with its GL entry (it threads
a transaction through glWriting.js, large enough for its own PR).

**Where they are.**
- `stockTransactions/{id}`: what was RTDB `stock/transactions/{id}`, same
  id, same fields.
- `stockLedger/{itemId}|{warehouseId}`: what was `stock/ledger/{item}/{wh}`.
- The stock number counters and the reservations (`stock/counters`,
  `stock/reservations`) stay in RTDB. Reservations move with Sales Orders
  (T2).

**functions/src/stockStore.js** (new) is the one place that reads and
writes them:
- **The same shape as RTDB gave.** `normalize()` reproduces RTDB's storage
  rules, measured on the RTDB emulator: null and empty objects or arrays
  vanish; keys are sorted, integer keys first; an integer-keyed object
  comes back as an array when more than half its indices are present.
  `toStore()` makes that storable: Firestore refuses holes and arrays
  directly inside arrays. The query fields are kept under `_q` (the items,
  the warehouses, the period) and never returned. So no reader had to
  change what it does with a document.
- **Queries are equality only:** type, status, company, source invoice,
  sale, number, vendor, customer, period, and an item or a warehouse
  (`array-contains`). Firestore serves these from its automatic
  single-field indexes, so there is no composite index to deploy first. A
  missing one is refused in production but never on the emulator, so the
  store refuses any other kind of query. Date ranges are filtered by the
  caller, as before.
- **`rtdbStyle(path, method, payload)`** answers the old RTDB paths with
  RTDB's get / put / patch / post / delete semantics. It serves:
  - the ported modules: legacy/runtime.js `firebaseDbRequest_` routes the
    stock paths there, so the generated code and the patches are
    unchanged. Data Reset clears and counts them the same way. A
    multi-path root update that names a stock path is refused;
  - the tests: `_helpers` `reset` / `val` / `put` / `patch`.

**What reads less now.**

| Reader | Before | Now |
|---|---|---|
| GRN, MI, WM, Adjustment, Purchase / Sales Return lists | every stock transaction | that type |
| Returns against an invoice, returnable lines | every stock transaction | the invoice's GRNs / DNs by id, and its returns |
| Retail sale's returns, receipt, reversal, return lookup | every stock transaction | the sale's returns; the company's sales |
| Aging, Batch Expiry, Reorder | every stock transaction | the company's posted ones |
| Period Closing: unfinished, deliveries not invoiced | every stock transaction | the company's; its posted Delivery Notes |
| Home: drafts; deliveries to invoice | stock by Status (step 0) | a Firestore query; posted Delivery Notes only (RTDB could filter on one field) |
| Point of sale, Reorder: balances | the whole ledger | the warehouse's |
| Fixed-asset postings: a GRN's vendor | a field read per GRN | the GRNs by id |

**Still reading everything, as planned (§5):**
- the ported modules (Delivery Note, Physical Count, Production, the stock
  ledger / valuation reports, the invoices' eligible GRNs / DNs, Data
  Reset), until their patches use queries;
- the chart-of-accounts usage check, which by nature searches every
  document.

**Tests.**
- **New:** functions/test/emulator/stockStore.emulator.test.js. Every case
  runs the same operations against the RTDB emulator itself and through
  stockStore, and the reads must be identical: tricky values, updates by
  path, whole-collection writes, the ledger, and the queries (and what
  they refuse).
- **Negative controls, verified then restored:**
  - RTDB's array rule loosened by one: 2 tests fail;
  - the query fields leaked into what is returned: 4 tests fail;
  - the GRN list asking for another type: 2 list-paging tests fail;
  - a purchase return's lines without the invoice's GRNs: 7 tests fail.
- **Regression:** every emulator suite (119 files, groups of 8 with a
  restart between) passes.
- **Found by the regression:** a retail sale's return lookup, narrowed to
  the sales, lost the sale's returns its callers read (fixed). The
  glReferences suite made a second default app (fixed in the test).
- **The suites:** they seed and read stock by its RTDB paths through the
  helpers. Their 42 direct `rtdb.ref('stock/…')` calls became the helpers'
  `put` / `patch` / `val`.
- **unit/periodLockGuard:** finds the stock-posting files by `stockStore.`
  too. The read-only reports that query posted stock are listed as read
  only.

**Going live.**
- **All functions** (stockStore is reached by every stock module, the
  legacy runtime, commitAttempt and stockMovement), with screens unchanged
  and no rules or index deploy.
- **Don't use the app during the deploy.** For about 1.5 hours some
  functions read Firestore and some RTDB, and a document saved then could
  be split between the two.
- **Stock entered before this deploy would stay in RTDB, unseen.** There
  is none: the owner confirmed (2026-10-17) that nothing was entered after
  the reset (decision 239). So no Data Reset is needed after the deploy.
- **The RTDB `.indexOn` Status on stock/transactions** stays until a later
  rules change. It is harmless, and removing it first would break the
  functions still running during the deploy.

## As built: phase T1b (2026-10-17), a stock posting is all or none

**What changed.** A stock posting was three separate writes under the
global lock: the GL entry, the running balances and the document's status
('Committing', then 'Posted'; commitAttempt.js). Now
**functions/src/stockPosting.js** `postStock(user, gl, ledgerUpdates,
documents, also)` writes them as **one Firestore batch**:
- the GL entry;
- every balance the posting moves;
- every document it changes: the posted one, or a reversal together with
  its original's mark;
- any other Firestore write of the posting (`also`): a reversal's mark on
  its original GL entry.

So all of them land, or none:
- a document goes from Draft (Rejected, PendingApproval) straight to
  Posted, and is never left 'Committing';
- a refused posting leaves no GL entry, no moved balance and no
  half-made reversal.

**Before the batch:** `buildStockGlEntry` validates the entry, checks the
period lock and takes the voucher number, so a refused posting moves
nothing. A voucher number taken by a posting refused at commit is skipped,
as before. Warehouse Movement has no GL entry: it is numbered
(`assignStockVoucherNumbering`, the same check) and then `postStock(user,
null, …)`.

**After the batch:** each posting's side effects in RTDB run as before:
- PO received quantities (GRN);
- Sales Order delivered quantities, reservations and their status
  (Delivery Note);
- shortfall allocation (Adjustment, Warehouse Movement, opening stock);
- Job Order progress (Production);
- the e-invoice (Sales Return).

They move into the batch with their own documents (T2, T3).

**Where.**
- **Hand-written:**
  - GRN, Material Issue, Stock Adjustment, Warehouse Movement, Purchase
    Return, Sales Return: post and reverse;
  - retail sale and retail return: post and reverse;
  - opening stock: post and reverse.
- **Ported:** Delivery Note, Physical Count, Production (post and
  reverse), through patches `stock-posting-atomic-*` in
  tools/legacy-port/patches.js. The generator maps `postStock_`,
  `stockPostedFields_` and `applyStockUpdate_`. Physical Count's
  `physical-count-store-movement-fields` lines run before the batch (the
  posted lines need them); the Delivery Note's Sales Order effects run
  after it.
- **Unchanged:** commitAttempt.js stays for the documents still in RTDB
  (Vendor and Customer Invoices, PDCs) until their phases.

**A limit:** a Firestore batch takes 500 writes, so a posting that would
move more than about 495 balances at once is refused, before anything is
written. Today there is no such limit; no real document comes near it.

**What is unchanged:** the posted documents' fields. `postedFields()`
writes what `finalizeCommitAttempt` wrote, the GL entry's fields, the
numbering and the lock.

**Tests.**
- **New functions/test/emulator/stockPosting.emulator.test.js:**
  - a posting writes its GL entry, balances and document together;
  - a batch the database refuses at commit (marking an original GL entry
    that no longer exists) leaves no GL entry, no balance and no document;
  - a posting too large for one batch is refused before anything is
    written.
- **unit/periodLockGuard:**
  - `stockPosting.js` is a covered journal writer, and stock posters are
    found by `postStock(` too;
  - `postStock` builds the checked entry before it commits;
  - a posting without a GL entry is numbered before `postStock`.
- **Negative controls, verified then restored:**
  - the GL entry written before the batch, as before T1b: the refused
    posting leaves its GL entry (test 2 fails);
  - Warehouse Movement numbered after postStock: the guard fails.
- **Regression:** the 25 stock-related suites pass on T1b, the ported
  modules after regeneration included.

**Going live:** deploy set `transactions-t1b`, all functions, no screens;
don't post stock during the deploy.

## As built: phase T1c (2026-10-17), the ported modules ask for what they need

T1a left the ported modules reading every stock transaction, as planned (§5).
Ten of them now ask stockStore for what they show, through patches
`stock-queries-*` (the generator maps `queryStockTx_` to `stockStore.queryTx`).
Each query is an equality query only, so no index is needed:

| Ported function | Now reads |
|---|---|
| getProductionEntries, getDeliveryNoteEntries, getPhysicalCountEntries (the lists) | that type |
| getEligibleGRNsForInvoice (Vendor Invoice) | the posted GRNs of the company and vendor |
| getEligibleDeliveryNotesForInvoice (Customer Invoice) | the posted Delivery Notes of the company and customer |
| getStockLedgerReport | the documents with that item |
| getMaterialVarianceReport, getProductionConsumptionReport | the company's posted ones |
| computeJobOrderLineProducedQty_ (Job Order progress) | the posted Production entries |
| recalculateStockLedger (Data Reset's rebuild) | the posted ones |

Each function still applies its own filters, unchanged, so what it returns
is the same. The query only stops it downloading what it would have thrown
away.

**Still reading everything, on purpose:**
- Stock Valuation and Stock Availability read the whole running-balance
  ledger, one small entry per item and warehouse, which they show in full;
- the chart-of-accounts usage check searches every document;
- Data Reset counts and clears every one.

**functions/test/unit/stockReads.test.js** fails if a hand-written reader
calls `stockStore.allTx()` or reads the stock paths whole, or a ported
function reads every stock transaction. The ones allowed are listed with
their reason.
- **Negative controls, verified then restored:** a whole read put back
  into getProductionEntries, and `stockStore.allTx()` added to grn.js:
  both reported;
  - the Vendor Invoice's GRN picker asking for another vendor: the Vendor
    Invoice suite fails (its picker test).
- **Regression:** the 15 suites of these functions pass (106 tests).

**Going live:** deploy set `transactions-t1c`, 14 functions. No data
moves, so the app can be used during the deploy.

## As built: phase T2 (2026-10-17), Sales Orders, Customer Invoices and reservations

One PR, the three steps of T1 together: the storage, the readers' queries
and the atomic postings.

**Where they are.** Same ids, same fields, the same shape RTDB gave:
- `salesOrders/{id}`: what was RTDB `salesOrders/{id}`; query fields under
  `_q`: the lines' items (`ItemCode`), the period.
- `customerInvoices/{id}`: what was `customerInvoices/{id}`; `_q`: the
  Delivery Notes it invoices (`DeliveryNoteID`), the Sales Orders its item
  lines deliver (`SalesOrderID`), the period.
- `stockReservations/{id}`: what was `stock/reservations/{id}`.

**The store, shared.** T1's shape-keeping logic moved out of stockStore.js
into **functions/src/docStore.js**: `normalize` / `toStore` / `fromStore`,
and `makeStore({ name, path, collection, fields, derived })`, which gives
a moved collection its get / getMany / all / set / update / remove /
equality `query` and the RTDB-path adapter. stockStore.js is now that
store for the stock transactions, plus the ledger; its exports are
unchanged (stockStore.emulator.test.js passes as before).
- **functions/src/salesStore.js** declares the three new stores.
- **functions/src/movedPaths.js** is the one list of moved RTDB paths
  (T1's and T2's). legacy/runtime.js `firebaseDbRequest_`, the test
  helpers, the approval registry readers, attachments, the home page,
  commitAttempt and the chart-of-accounts checks ask it where a path
  lives. `where(path, filters)` queries a moved collection and filters an
  RTDB one in memory, so a reader written for both (vendor and customer
  invoices) needs no change when vendor invoices move (T3).
- **An empty id is no document** (`get('')` is null). RTDB read the whole
  collection there, which the callers then found had no Status; the Sales
  Order of an invoice line without one is read that way.

**Readers that ask for what they need.**

| Reader | Now reads |
|---|---|
| Reservations of an order, an item and warehouse, a Production entry | those (equality queries) |
| Shortfall allocation, Job Order demand picker | the company's reserving orders |
| Delivery Note: orders to deliver; Customer Invoice: order lines to invoice | the customer's reserving orders |
| Production allocation to linked orders | those orders, by id |
| Delivery Note list: its invoice state | the listed deliveries' invoices by id, and the unposted invoices |
| Stock Availability; the Reorder report | the active reservations; the company's active ones |
| Sales Return: invoices to return against | the customer's invoices |
| Party ledger, statement, aging; party currency check | the party's invoices; aging: the posted ones |
| Period Closing: unfinished documents | the company's invoices |
| Sales rep portal: my orders | the rep's own |
| Home page drafts | the drafts (a query, no longer the RTDB Status index) |

Ported, through patches `sales-queries-*` (the generator maps
`queryMovedAny_`, `getMovedMany_`, `sortedDocs_`): getEligibleSOsForDelivery,
getDeliveryNoteEntries, getActiveReservationsForItem_,
getSalesOrderLinesWithShortfall_, allocateProducedQuantityToLinkedSalesOrders_,
rollbackJobOrderLineAfterReversal_, getStockAvailabilityList. Each still
applies its own filters, so what it returns is the same; merged queries
come back in id order, as the whole read had them.

**Still reading everything, on purpose:** the Sales Order and Customer
Invoice lists (every document of the user's companies, newest first: the
company filter is a list of companies, not one value), the
chart-of-accounts usage check and renumbering, Data Reset.
functions/test/unit/movedReads.test.js (salesReads until T3) fails on any other whole read.

**One posting, all or none** (decision 238, as for stock):
- **Delivery Note, post and reverse.** `salesPosting.planDelivery` works
  out, before anything is written, every Sales Order and reservation the
  posting changes, exactly as the step-by-step code did: each line's
  delivered quantity; its reservations used up oldest first (post) or the
  quantity reserved again on an order still reserving (reverse); each
  order's status refreshed. `planWriter(plan)` adds them to the posting's
  own batch (`postStock`'s `also`). Patches `sales-posting-atomic-*`.
- **Customer Invoice, post and reverse.** The GL entry, the posted invoice
  (or the posted reversal and the original's link) and each matched
  Delivery Note's mark (or unmark) are one batch, instead of three to five
  writes with a commit-attempt marker. commitAttempt.js is no longer used
  for them.
- **What changes:** a failure in an order or reservation step (a
  reservation that can't be reduced, a missing item on a reversal) now
  refuses the whole posting, where before it left a posted delivery with
  its order half updated. Nothing else: the same fields, numbers and
  checks.
- **Still two postings:** an invoice with item lines first posts its own
  Delivery Note, then itself (DIRECT_SALES_INVOICE.md); a failure between
  them leaves the delivery posted and the invoice a draft that already
  carries it, so posting the invoice again finishes it. Its reversal
  reverses that delivery after the invoice, as before. Shortfall
  allocation after a stock increase (Adjustment, Warehouse Movement,
  opening stock) and Production's Job Order effects still run after their
  posting: the Job Orders move in T4.

**Also fixed: renumbering an account rewrites the moved documents.**
coaRenumber.js rewrote every stored copy of a renumbered code by reading
RTDB; since T1a the stock transactions were in Firestore, so their copies
were left with the old code. It now reads and writes each moved collection
where it is (movedPaths.js). Found while moving the sales collections.

**Tests.**
- **New salesStore.emulator.test.js:** the three collections against RTDB
  itself through every kind of write (differential, as stockStore's); which
  paths moved; each store's queries and derived lists; merged queries in id
  order.
- **New salesPosting.emulator.test.js:** a delivery uses its reservations
  up oldest first, counts the order delivered and refreshes its status; a
  reversal gives it back and reserves again only on an order still
  reserving; a refused batch leaves no order, reservation, invoice, mark or
  GL entry, and the same posting then lands whole; the same for an invoice
  and its reversal.
- **deliveryNote.emulator.test.js:** a Partially Reserved order is offered
  for delivery, a draft is not (no test covered this; the negative control
  below found the gap).
- **unit/salesReads.test.js** (movedReads since T3), as stockReads for T1.
- **Negative controls, verified then restored:** reservations used up
  newest first (2 fail); the invoice written outside the batch (1);
  a wrong derived query field (1); the plan not written (1); the
  delivery's eligible orders without Partially Reserved (1, after the new
  test); a whole read added to fx.js (reported).
- **Regression:** every emulator suite passes (121 files, 593 tests); UI
  checks: the known failures only (help, home, trialBalance row heights,
  searchPicker's JV order).

**Going live:** deploy set `transactions-t2`, **all functions**, no screens,
rules or indexes. Don't use the app during the deploy. Sales Orders,
Customer Invoices and reservations entered in RTDB before it are not seen
afterwards (as agreed for test data, 239). The RTDB `.indexOn` on
salesOrders and customerInvoices stays until no live function queries it.

## As built: phase T3 (2026-10-18), the purchase documents

As T2, in one PR: storage, queries and atomic postings.

**Where they are.** Same ids, same fields, the same shape RTDB gave
(**functions/src/purchaseStore.js**, listed in movedPaths.js):
- `vendorInvoices/{id}`; query fields under `_q`: the GRNs it invoices
  (`GRNID`), the period;
- `purchaseOrders/{id}`; `_q`: the lines' items (`ItemCode`), the period;
- `purchaseRequisitions/{id}`, `inventoryPurchaseRequisitions/{id}`.

**Readers that ask for what they need.**

| Reader | Now reads |
|---|---|
| GRN: approved orders to receive | the vendor's approved orders |
| GRN list: its invoice state | the listed GRNs' invoices by id, and the unposted invoices |
| Purchase Return: invoices to return against | the vendor's invoices |
| Fixed Assets: the supplier behind a clearing item | those invoices, by id |
| Reorder: on order | the company's approved orders |
| Home: ready for you (submitted requisitions) | the submitted ones (a query, no longer the RTDB Status index) |
| Purchase Order: requisitions to order (ported, patch `purchase-queries-*`) | the company's submitted ones |
| Party ledger, statement, aging, currency check, period closing (vendors) | through `movedPaths.where` since T2: now a query |

Still read whole, on purpose: the four lists (every document of the user's
companies, newest first), the chart-of-accounts checks, Data Reset.
unit/movedReads.test.js covers all seven T2 and T3 collections.

**One posting, all or none:**
- **GRN, post and reverse** (hand-written grn.js): `planPOReceipts` works
  out each PO line's received quantity (grown, or given back but never
  below zero) before the posting, and the POs go in its batch.
- **Vendor Invoice, post and reverse** (patches
  `purchase-posting-atomic-*`): the GL entry, the posted invoice (or the
  posted reversal and the original's link) and each GRN's mark (or unmark)
  are one batch, with salesPosting.js's invoice writers, which take the
  collection. commitAttempt.js and writeStockGlEntry are no longer used by
  the ported code; unit/periodLockGuard now requires its postings to go
  through `postStock_`.

**Tests.**
- **New purchaseStore.emulator.test.js:** the four collections against
  RTDB through every kind of write; their queries; a GRN's PO quantities
  (a missing PO and a direct line change nothing, a reversal never below
  zero), and a refused batch leaving no PO, GL entry or GRN; a Vendor
  Invoice and its reversal, all or none.
- salesStore's "still in RTDB" example is now PDCs (T4).
- **Negative controls, verified then restored:** the reversal's sign
  ignored (1 fails); the POs not written (1); a wrong derived field (1);
  the PO's requisition picker asking for drafts (1, purchaseOrder suite);
  the GRN list without the unposted invoices (1, invoiceState suite); the
  ported postings mapped past stockPosting (periodLockGuard).
- **Regression:** every emulator suite passes (123 files, 623 tests); UI
  checks: the known failures only (help, home, trialBalance row heights,
  searchPicker's JV order, approvalRouting's PDC follow-up days, which
  fails on `main` too).

**Going live:** deploy set `transactions-t3`, all functions, no screens,
rules or indexes. Don't use the app during the deploy. Purchase documents
entered in RTDB before it are not seen afterwards. The RTDB `.indexOn` on
the four paths stays until no live function queries it.

## As built: phase T4 (2026-10-18), Job Orders and PDCs

As T2 and T3, in one PR.

**Where they are** (**functions/src/jobStore.js**, listed in movedPaths.js),
same ids and fields: `jobOrderBatches/{id}`, `jobOrderLines/{id}`,
`pdcCheques/{id}`.

**Readers that ask for what they need.**

| Reader | Now reads |
|---|---|
| Production: a batch's lines (ported `linesForBatch_`) | that batch's lines |
| Production: batches to produce against (ported) | the company's batches (every one only when no company is given) |
| PDC: duplicate cheque check | the same bank account's (issued) or party's (received) cheques |
| PDC lists; PDCs due; a party's pending cheques | that direction; the pending ones; the party's in the company |
| Party ledger (cheques pending), period closing, aging, sales rep | the pending ones; the company's; the rep's own |
| Home "ready for you": accepted Job Order lines, their batches | the accepted lines; their batches by id |

Still read whole, on purpose: the Job Order lists (batches, and the flat
list of lines with their batches). unit/movedReads.test.js covers all ten
T2–T4 collections. The RTDB Status index is now used only by recurring
journals and approval instances (T5).

**One posting, all or none:**
- **PDC (hand-written pdc.js):** post, clear (each cheque), bounce /
  cancel and undo clearing each write their GL entry and the cheque in one
  batch (`postStock`); a reversal also marks the original GL entry in it.
  commitAttempt.js is no longer used by any module (kept for now; its
  callers were the stock modules, the invoices and PDCs).
- **Production, post and reverse (ported, patches
  `job-posting-atomic-*`):** **functions/src/productionPosting.js**
  `planProduction` works out, before anything is written, what
  updateJobOrderLineProgressAfterProduction_,
  allocateProducedQuantityToLinkedSalesOrders_ and
  rollbackJobOrderLineAfterReversal_ did one write at a time after the
  posting:
  - post: the produced quantity allocated to the line's linked Sales
    Orders (new reservations carrying the posting's id), their status
    refreshed, the line In Progress or Completed;
  - reverse: the posting's own reservations released, the orders
    refreshed, the line stepped back (Accepted or Open by the batch's
    origin, or still Completed).

  The produced quantity those functions counted after the batch includes
  the entry being posted, so the plan counts it in (`inflightLines`).
  `planWriter(plan)` adds the lines, orders and reservations to the
  posting's batch. The three ported functions are no longer generated.

**What is still after its posting:** shortfall allocation after a stock
increase (Adjustment, Warehouse Movement, opening stock), and an invoice's
own delivery (T2). Both leave nothing half done: the first only reserves
free stock, the second is finished by posting again.

**Tests.**
- **New jobStore.emulator.test.js:** the three collections against RTDB
  through every kind of write; their queries; a production filling its
  linked order's shortfall and moving its line on, then complete; its
  reversal releasing only its own reservations and stepping the line back;
  each refused at commit leaving nothing, then landing whole.
- Suites that wrote these paths to RTDB directly now use `put`; salesStore's
  "still in RTDB" example is recurring journals.
- **Negative controls, verified then restored:** the entry being posted
  left out of the produced quantity (2 fail); a reversal releasing every
  active reservation (1); a batch's lines asked for the wrong batch (9,
  production and Job Order suites).

**Going live:** deploy set `transactions-t4`, all functions, no screens,
rules or indexes. Don't use the app during the deploy. Job Orders and PDCs
entered in RTDB before it are not seen afterwards.
