# Large item catalogues (design; owner, 2026-11-13)

Status: **design agreed 2026-11-14** (QI1–QI6; see *The owner's decisions*). **Steps 1 and 2 built 2026-11-14** (see *As built*); step 3 next.
Item 3 of UX batch 4 (docs/modules/UX4.md), decision Q510: "design first,
for everyone": moving the items to Firestore for every corporate, with
screens searching items on the server as you type instead of loading them
all, measured on a 50,000-item test catalogue first.

## What was measured (2026-11-13)

`functions/test/perf/items50k.perf.js` seeds a catalogue in the emulators
and times today's calls and screens. The items are made up, about 430 bytes
each, close to a real item record. Emulator times are not production times,
but the amounts of data are exactly what production would move.

| | 500 items | 50,000 items |
|---|---|---|
| Item data in the database | 0.2 MB | **21.3 MB** |
| `getActiveItems` (every item picker) | 47 ms, 159 KB | **2.1 s, 16 MB** |
| `getItems` (the Item Master list) | 34 ms, 221 KB | **2.3 s, 22 MB** |
| `getSellableItems` (Sales Order, Retail Sales)¹ | 30 ms | 1.7 s |
| `getStockAvailabilityList`¹ | 51 ms | 1.7 s |
| `getReorderReport` | 60 ms, 114 KB | 2.2 s, 11.5 MB |
| Save a 1-line GRN draft | 71 ms | **1.9 s** |
| Save and post a 1-line GRN | 203 ms | **2.8 s** |
| Stock Valuation report¹ | – | 1.8 s |
| Item Master screen, ready | 5.0 s | **14.7 s**, 25 MB of browser memory |
| GRN screen, ready | 5.7 s | 6.2 s, **16 MB downloaded** |
| Sales Order / Stock Availability / Retail Sales screens¹ | 1.6–2.0 s | 1.9–3.2 s |

¹ The test catalogue has no stock or price lists, so these answered with
little or nothing: their time is the reading of every item. With real stock
and prices (a supermarket sells every item), they would also send back
megabytes.

**What it shows.**

1. **Everything that touches items reads the whole catalogue.** About 70
   places do: 38 in the hand-written functions, 32 in the ported ones. At
   50,000 items each such read is 21 MB and about 2 s, even when the
   request needs one item. A one-line GRN save goes from 71 ms to 1.9 s.
2. **Each screen with an item picker downloads the whole catalogue** to
   the browser: 16 MB for a GRN, 22 MB for Item Master. On a shop's
   connection or a phone, that is the slowest part of the system.
3. **The cost grows with it.** The Realtime Database bills the data read,
   including by our own functions (about US$1 per GB, Firebase's published
   price). A shop posting 1,000 stock documents a day would read about
   21 GB a day for items alone, around US$600 a month, before any screen
   opens.
4. **Memory.** A function holding 21 MB of item JSON uses well over 100 MB
   while it parses and filters it, close to a 256 MB function's limit with
   anything else it does. Twice the catalogue would start failing.

## Why moving to Firestore alone would not help

Firestore bills each document read (about US$0.06 per 100,000). A
whole-catalogue read there is 50,000 reads, about US$0.03, on every call:
the same 1,000 postings a day would cost about US$900 a month. Moving the
data without changing the readers makes it worse, not better.

The fix is in the readers: each reads only the items it needs. Where the
items are stored then matters much less, and Firestore becomes worth it
for what it can do that the Realtime Database can't: searching items by
company, status and word on the server.

## What the readers need

| Readers | Examples | Count | What they should read |
|---|---|---|---|
| A document's own lines | every stock entry's save, post and reverse; the tax previews; orders; Delivery Note; Production; Physical Count; BOMs | about 40 | only its lines' items, by id (one read each, or one batch) |
| Pickers and lists | `getActiveItems`, `getSellableItems`, the Item Master list, the portal's quote items, built-module links, item user codes | about 8 | a server search as you type; the Item Master list a page at a time |
| Reports across items | Stock Availability, Valuation, Ledger, aging, reorder, tax reports, period closing's stock check, material variance | about 12 | only the items the report covers: those with stock or movement in the company and period (the stock ledger already says which) |
| Lookups | barcodes, label sheets, a BOM's components | about 6 | by barcode, by id |

## The proposal

### One item store: functions/src/itemStore.js

Every reader goes through it, as the documents do through their stores
(TRANSACTIONS_FIRESTORE.md):

- `byIds(ids)`: the items of a document's lines, one batched read.
- `search({ q, companyId, status, category, sellable, limit })`: what a
  picker shows as you type: the item code's start, an exact barcode, a
  word of the name starting with what was typed, or (from 3 characters)
  any part of the code or name (QI2); 50 at most.
- `page({ companyId, filters, after, size })`: the Item Master list, 100
  at a time.
- `forReport(companyId, ids)`: the items a report covers.
- `byBarcode(code)`, `byCode(code)`.

The ported code (32 places) changes through patches in
tools/legacy-port/patches.js, as for T1.

### Pickers searching on the server

The shell's search picker (SEARCH_PICKER.md) gains a server mode. An item
box marked `data-search="items"` asks `searchItems` as you type (after 2
characters, a pause of 250 ms) instead of holding a list. It comes with
the move to Firestore (step 3): the Realtime Database can't answer it. Nothing else
about the picker changes: keys, recent picks (kept per browser), and the
code-then-name order. A screen keeps its own rules about which items it
offers (sellable, stock items, one company) by passing them to the search.

### The items in Firestore

Once the readers are done, the items move to Firestore, `items/{id}`, as
the documents did in T1:

- `movedPaths.js` answers the old RTDB path, so code left on it keeps
  working while the move happens.
- Each item gets two search fields, kept by the store on every save:
  `Words` (the lowercased words of its code, name and barcodes, for a
  word's start) and `Grams` (every 3-letter fragment of its code and name,
  for "inside words", QI2). A search asks Firestore with `array-contains`
  on one of them (the typed text's rarest fragment) plus the company and
  status, then keeps the items that contain the whole text. Composite
  indexes: company + status (+ category) with each search field.
- Master Import, Data Reset, the audit log's wrapper (auditWrites.js: from
  its RTDB list to its Firestore list), period closing and the tests
  follow.
- The move itself: a one-time copy per corporate, run with the release,
  like T1's. It checks the copy (the count, and every item compared field
  by field), writes a JSON export of the old RTDB items to the firm's
  Cloud Storage, then deletes them (QI6). The export is the only way back.

### Cost and speed afterwards (estimated)

A one-line GRN reads 1 item instead of 50,000. A picker search reads 50 at
most. The Item Master list reads 100 a page. At 1,000 stock documents
(about 10,000 item reads with their saves and posts) and 5,000 searches (up
to 250,000) a day, that is under 8 million item reads a month: about US$5,
against roughly US$600 today at that catalogue size. GRN saves and screen
loads go back to the 500-item times, whatever the catalogue's size.

## The owner's questions

| # | Question | Options | Recommended |
|---|---|---|---|
| QI1 | The order of the work? | (a) the readers first, on the Realtime Database, then the move to Firestore; (b) both at once, reader by reader; (c) the readers only, keeping the Realtime Database | **(a).** The readers are the fix and can be tested on today's data; the move is then small. (b) mixes two kinds of risk in every step. (c) works, but the Realtime Database can only search one field at a time, so a picker couldn't search by company and word together on the server. |
| QI2 | What does an item picker match as you type? | (a) the code's start, an exact barcode, or the start of any word of the name; (b) also any part of a word ("olt" finding "bolt") | **(a).** It covers how people search, and Firestore answers it from its index. (b) needs a separate search service (cost, another system to run). |
| QI3 | The Item Master list? | (a) 100 at a time with search and filters; Copy to Excel exports the whole filtered list, built on the server; (b) keep loading every item | **(a).** (b) is the 14.7 s and 22 MB above. |
| QI4 | Reports across items (Stock Availability, Valuation, Reorder, aging)? | (a) read only the items with stock or movement in the company; (b) keep reading every item | **(a).** An item with no stock and no movement adds nothing to these reports, and the stock ledger already lists the ones that do. |
| QI5 | When does a small corporate change? | (a) every corporate at once, the same code everywhere (Q510: "for everyone"); (b) only corporates over a size | **(a).** One code path to test and maintain; small catalogues get slightly faster too. |
| QI6 | The old RTDB items after the move? | (a) kept read-only for 30 days, then deleted by the release; (b) deleted at once | **(a).** A way back if something was missed, as with T1. |

## The owner's decisions (2026-11-14)

- **QI1:** the readers first, on the Realtime Database; then the move to
  Firestore.
- **QI2:** a picker matches the code's start, an exact barcode, a word's
  start, and also any part of a word ("olt" finds "bolt"), from 3
  characters.
- **QI2b:** inside words through 3-letter fragments stored on each item in
  Firestore: no other service, no item data outside the corporate's
  project.
- **QI3:** the Item Master list 100 at a time, with search and filters;
  Copy to Excel exports the whole filtered list, built on the server.
- **QI4:** the reports read only the items with stock or movement in the
  company.
- **QI5:** every corporate at once, the same code everywhere.
- **QI7** (2026-11-14, asked while building step 2): the Reorder report
  also reads the items that have a reorder level, so an item never
  received stays on it, as before (an index on ReorderLevel).
- **QI3, when** (2026-11-14): the Item Master list's paging moves to step
  3, with its Barcodes & Labels search and every picker, built once on
  Firestore's search (on the Realtime Database a server search would still
  scan the list).
- **QI6:** the old RTDB items are deleted at once, once the copy is
  checked (not kept 30 days). The migration writes a JSON export of them
  to the firm's Cloud Storage first, as the only way back.

## The steps

1. itemStore.js on the Realtime Database; the ~40 document readers to
   `byIds`, the ported ones by patch; the measurement again (a GRN save
   back near 71 ms).
2. The reports to `forReport` (QI4, QI7); the barcode lookups.
3. The move to Firestore: the store, movedPaths, the search fields and
   indexes, `searchItems` and the picker's server mode on every item
   picker (QI2), the Item Master list paged with its server-built Copy to
   Excel and its labels search (QI3), the item master's own duplicate
   checks, the copy with its check, export and deletion (QI6),
   Master Import, Data Reset, the audit log's list.

Each step is its own PR with its own deploy set. Steps 1 and 2 touch most
stock and sales modules, so they deploy every function; step 3 also
deploys the rules (indexes) first.

## As built: step 1 (2026-11-14)

- **functions/src/itemStore.js:** `byIds(ids)`, `forLines(...lineLists)`
  (the ids a document's lines name) and `byCodes(codes)`, each returning
  `{ id: item }`, the shape a whole read gave, so the callers' code after
  the read is unchanged. `byCodes` is one query per code on `ItemCode`,
  which database.rules.json now indexes on `items` (unit/rtdbStatus allows
  that one index besides the Status ones).
- **Hand-written document readers** (every save, post and reverse of GRN,
  Material Issue, Stock Adjustment, Warehouse Movement, Purchase and Sales
  Return; the purchase and sales tax previews; the budget check; the
  allocation of production to sales orders; a built module's item actions;
  quotations' pricing and the rep's order) read only their documents'
  items, by id or by code.
- **Ported document readers** (20: BOM, Production, Delivery Note,
  Physical Count, Inventory PR, Price Listing line, Sales Order save,
  confirm and claim, Job Order, Purchase Order, the Vendor Invoice's tax
  on posting and reversal) through 18 new patches (items-only-their-own)
  and the two tax patches' arguments; generate.js maps `itemsByIds_`,
  `itemsForLines_` and `itemsByCodes_` to the store.
- **Still reading the whole catalogue, for step 2:** the reports (stock
  reports, aging, tax reports, period closing's stock check, material
  variance, production consumption, stock ledger recalculation), the
  pickers and lists (`getActiveItems`, `getItems`, `getSellableItems`,
  eligible Job Order items, item user codes, built-module links, the
  portal's price-list items), the BOM list, barcodes and labels, the
  Correction JV's inventory accounts, and the item master's own
  uniqueness checks (saveItem, saveItemSubCategory).
- **Tests:** unit itemStore (2: the document readers never read the whole
  catalogue, hand-written and ported; the line ids), emulator itemStore
  (3: by id, by line and by code; a GRN finds its item and refuses an
  unknown one; a ported Price Listing line by code). Negative controls:
  forLines reading nothing, byCodes finding nothing, a ported reader back
  to the whole read: each failed a test.
- **Measured again** (emulators, 50,000 items): a 1-line GRN save takes
  53–71 ms once its function is warm, against 1.9 s before this step, the
  same as with 500 items (72–75 ms). The store's read of one item by id
  is 4 ms, by code 89 ms. The pickers, lists and reports are unchanged
  until step 2 (getActiveItems still 16 MB).
- **Regression:** 874 emulator tests and 297 unit tests passed. The first
  run caught the Delivery Note, whose lines name their Sales Order line,
  not the item: its items are now those of the orders it ships.
- **Deploy:** set items-1. FIRST the "database rules" task (the ItemCode
  index: without it the database refuses the code queries). Then every
  function (the generated port and most stock and sales modules changed).
  No new function, screen or Hosting change.

## As built: step 2 (2026-11-14)

- **itemStore.js:** `forReport(ids, companyId)` (the items a report
  covers, of the company; above `BULK_AT` = 2,000 of them, one read of
  the list, keeping only those), `forReportLines(lines, companyId)` (a set
  of documents' lines, by ItemID or ItemCode), `linesOf(docs)`,
  `stocked(companyId)` (every item with a stock ledger entry: stock or
  movement) and `withReorderLevel(companyId)` (QI7, the ReorderLevel index
  in database.rules.json).
- **Hand-written reports:** Batch Expiry and Reorder (their transactions',
  ledger's, reservations' and orders' items, and those with a reorder
  level), Inventory aging (the items moved), tax reports (the documents'
  lines). Barcodes: an item's barcodes, generation and the
  label sheet read only their items.
- **Ported reports** (11 more patches, items-reports): Stock Valuation (the
  ledger's items), Stock Ledger (its one item), Material Variance (its
  documents' and BOMs' items), Production & Consumption (its documents'),
  Stock Availability (the ledger's and reservations'), the ledger
  recalculation (the postings'), the BOM list (its parents).
  `generate.js` maps `itemsForReport_`, `itemsForReportLines_` and
  `itemsLinesOf_`.
- **Kept reading every item, for step 3:** period closing's stock check
  and the Correction JV's inventory accounts. They need the inventory
  account of every item, moved or not (an inventory account with a GL
  balance and no stock is what the check finds; a CJV may not move a line
  onto any inventory account). The regression caught this when they read
  only the stocked items. Step 3 keeps a summary of the items' inventory
  accounts, updated on every item write.
- **Still reading the whole catalogue, for step 3:** the pickers
  (`getActiveItems`, `getSellableItems`, eligible Job Order items, item
  user codes, built-module links, the portal's price-list items), the Item
  Master list and its labels panel (`getItems`), and the item master's
  duplicate checks (saveItem, saveItemSubCategory: they compare codes
  ignoring case, which Firestore's lower-case search fields answer).
- **Tests:** unit itemStore (3: also the reports and barcodes never read
  the whole catalogue), emulator itemStore (7: also forReport,
  forReportLines, stocked, withReorderLevel; the bulk path; the Reorder
  report keeping a never-received item with a level; Stock Valuation from
  its ledger). Negative controls: no reorder-level items, the company not
  filtered, the bulk path returning everything, Stock Valuation reading no
  items: each failed a test.
- **Deploy:** set items-2. FIRST the "database rules" task (the
  ReorderLevel index), then every function. No new function, no screen.
