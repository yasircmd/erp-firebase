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
  - the query fields leaked into what is returned: 4 tests fail.
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
