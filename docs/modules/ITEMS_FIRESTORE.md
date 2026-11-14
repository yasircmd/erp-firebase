# Large item catalogues (design; owner, 2026-11-13)

Status: **design agreed 2026-11-14** (QI1–QI6; see *The owner's decisions*). **Steps 1, 2, 3a, 3b-1 and 3b-2 built 2026-11-14** (see *As built*); 3b-3 (sales and purchase screens, the portals, the shell's item codes) next.
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
- **QI8** (2026-11-14, asked while building step 3): the items are copied
  to Firestore before the deploy and again after it, the newer edit of
  each item winning, then checked, exported and deleted. Users do not
  edit items (Item Master, Master Import) between the two copies.
- **Step 3 in two** (2026-11-14): 3a moves the items (this section's
  as-built), 3b brings the server search to the pickers and pages Item
  Master.
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
- **Found after step 1 (2026-11-14):** about 20 more reads of the whole
  catalogue went through a `val('items')` helper, which step 1's search
  (for `ref('items')`) did not match. Converted here: Retail Sales' sale
  building, confirming, returns and reversals (their lines), an invoice's
  stock lines (each item as met, by code or id), e-invoicing's lines (by
  code), dimension rules (by id), the rep portal's order (by code), and
  the MIS stock tiles and stock on hand (the ledger's items). The
  remaining ones are pickers (the retail counter's list, the rep portal's
  catalogue: step 3b) or need every item (below).
- **Kept reading every item, for step 3:** period closing's stock check
  and the Correction JV's inventory accounts. They need the inventory
  account of every item, moved or not (an inventory account with a GL
  balance and no stock is what the check finds; a CJV may not move a line
  onto any inventory account). The regression caught this when they read
  only the stocked items. Step 3 keeps a summary of the items' inventory
  accounts, updated on every item write. The same goes for the MIS
  control accounts (misData.controlAccounts) and Opening Balances (every
  item's inventory account, and stock lines matched by code or exact name:
  step 3's lower-case search fields). Master Import's duplicate check and
  the MIS builder's item data set genuinely compare against every item.
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

## As built: step 3a (2026-11-14)

- **itemStore.js on Firestore:** `items/{id}`, a document store
  (docStore.makeStore) with equality queries on Status, CompanyID,
  ItemCode, Category, SubCategoryID and, under `_q`, CodeLower,
  UserCodeLower, NameLower, Words (array), Grams (array: every 3-letter
  fragment of each word, QI2) and Reorder ('yes' with a reorder level,
  QI7). Its calls stay (byIds, byCodes, forLines, forReport,
  forReportLines, stocked, withReorderLevel), plus byCodeIgnoringCase,
  byNameIgnoringCase, bySubCategory, all, inventoryAccounts and
  rebuildAccounts.
- **movedPaths.js** answers the old path `items` from it, so the ported
  code reads and writes the items unchanged. The audit log's wrapper keeps
  the items' changed fields from Firestore now (auditWrites FIRESTORE), and
  docStore no longer records a master's "document" entries
  (spec.auditDocuments false).
- **itemAccounts:** `{company or *}_{account}` with a Count, kept on every
  item write (the store's afterWrite) and rebuilt after the copy: period
  closing's stock check, the Correction JV, MIS's control accounts read it
  instead of every item. Data Reset's Item Master clears it too (a patch).
- **The item master's duplicate checks** (saveItem's user code,
  saveItemSubCategory's other company): by the lower-case fields and the
  sub-category, not every item (the two patches' reads).
- **Every other reader** of the item list goes through the store: the
  pickers and the Item Master list read every item (`all()`) until step
  3b's server search; Opening Balances and Master Import read the items
  through movedPaths; the MIS builder through the store.
- **The move (QI6, QI8):** itemMigration.js `copy` (the old items not in
  Firestore, or newer there by UpdatedAt / CreatedAt; then the summary
  rebuilt), `check` (every old item in Firestore, the same or newer) and
  `finish` (check, then a JSON export of the old items to the firm's Cloud
  Storage, `item-exports/{corporate}/{time}.json`, then their deletion
  from the Realtime Database). Client Management → **Items move** runs
  them for one corporate (100 too): `moveDeveloperItems`, Developer write,
  in that corporate through the functions' own grant.
- **Tests:** emulator itemsFirestore (4: an item saved through the old
  path, in Firestore with its search fields; the summary through create,
  change and delete; the move with the newer edit winning, the check, the
  export and the deletion; finish refused while the check fails, and the
  Client Management call), the earlier item tests on Firestore, and the
  unit guards (movedReads lists the items' whole readers until 3b).
- **Regression:** 882 emulator tests and 298 unit tests passed. The first
  run caught Master Import's undo and update, which put the items back
  straight into the Realtime Database (now through movedPaths), and the
  stockModules suite, which seeded its items there.
- **Deploy, in this order:**
  1. Set **items-3a-move** (moveDeveloperItems) with **--screens**: Client
     Management gets the Items move panel.
  2. Ask users not to edit items. In Client Management → Items move, for
     each corporate (100 and every Active client): **Copy**.
  3. Set **items-3a**: every function.
  4. For each corporate: **Copy** again, **Check**, then **Finish**. Users
     may edit items again.

## As built: step 3b-1 (2026-11-14)

Step 3b is three PRs (owner, 2026-11-14): 3b-1 the search itself, Item
Master and the Retail Sales counter; 3b-2 the stock screens' pickers; 3b-3
the sales and purchase screens, the portals and the shell's item codes.

- **itemSearch.js (new):** the candidates of a text come from the search
  fields only, never the whole catalogue. A barcode typed whole
  (`itemBarcodes/{code}`); the code's and user code's start (range reads on
  `_q.CodeLower` and `_q.UserCodeLower`, 60 each); from 3 letters up to
  three 3-letter fragments of the longest word (`_q.Grams`, array-contains,
  300 each, QI2), below 3 the exact word (`_q.Words`). The candidates are
  then ranked: the code or user code's start, the name's start, a word's
  start, anywhere; every word typed must be in the item.
  - `searchItems` {q, companyId, status, category, stockOnly, sellable,
    limit}: the caller's companies only; sellable is "on a price list"
    (priceListLines by ItemCode).
  - `getItemsByIds` {ids}: a document's items, of the caller's companies.
  - `getItemsPage` {q, companyId, category, status, after} (QI3): 100 at a
    time in code order, read 300 at a time up to 3,000 a call; the cursor is
    the last item's code and id (two items with one code are both listed).
    With q, the search's best 200.
  - `getItemsExport` (QI3): every item the filters and search keep, as
    tab-separated text built on the server (the one whole read of this
    module, guarded by unit/itemStore).
- **itemBarcodes.js:** `getItemBarcodes` takes `itemIds` (by the ItemID
  index), and `generateItemBarcodes` chooses the items without a barcode
  of a category on the server (`withoutBarcode`, up to 500).
- **The shell's picker server mode** (public/index.html,
  `window.itemSearchList(datalist, { value, onItem, filters })`): a list
  that asks `searchItems` as you type (2 letters, 250 ms after the last
  key), with "Searching…", "Type at least 2 letters." and "The best N: type
  more to narrow." in its footer, and its recent picks kept per list.
- **Item Master:** the list a page at a time with **Load more**, its
  filters and search on the server, **Copy to Excel** from
  `getItemsExport`, the page's barcodes with it; the labels panel searches
  on the server and keeps the items given a number.
- **Retail Sales:** the counter holds no catalogue (`getRetailCounter`
  returns `items: []`). `findRetailItems` {companyId, warehouseId, date,
  q | ids} answers a scan (the barcode, with a pack's units), a code or a
  name, and refreshes the lines' stock and prices. Its price is the price
  list's line by ItemCode on that date. Scans made quickly one after
  another queue: none is dropped (the old screen held the whole list and
  never waited).
- **Indexes:** RTDB priceListLines ItemCode and itemBarcodes ItemID
  (database.rules.json); Firestore's own single-field indexes serve the
  code order and the search fields (unit/firestoreIndexes lists the page's
  sort).
- **Tests:** emulator itemSearch (3) and itemPages (4: pages to the end with
  two items of one code across the page boundary, the filters and a search,
  Copy to Excel, barcodes by item and the items without one); retailSales
  (findRetailItems by ids in order, a pack's scan, a code, a name, the price
  on a date) and retailTax; UI: retailSales (11, a double Enter included),
  itemBarcodes, itemCategories, labelPrinting, smoke. Negative controls:
  a pack's units, the fragments read from the words, a code-only cursor,
  a scan dropped while another is asked: each caught.
- **Regression:** 889 emulator tests and 298 unit tests passed.
- **Deploy:** after items-3a. The "database rules" task first, then set
  **items-3b-1** (34 functions, 5 new: their invoker bindings) with
  **--screens**; the screens release redeploys Hosting, which carries the
  shell's server mode.

## As built: step 3b-2 (2026-11-14)

The stock screens no longer read every item (`getActiveItems`): GRN,
Material Issue, Stock Adjustment, Warehouse Movement, Physical Count,
Production, BOM and Stock Ledger.

- **The shell's item catalogue** (public/index.html, `window.itemCatalog`):
  the items a screen has met, kept in one list (`cat.list`, which the
  screen's own `items` is, so its lookups by code and id are unchanged).
  - Items come in from the screen's documents (the list's page brings its
    lines' items, `forDocs`), from the item box's server search (3b-1),
    from "Search items" (`results`, 2 letters), from a paste
    (`ensureCodes` of the item column), and from a scan (`prepare`: the
    barcode's item, else the code).
  - A code typed in full is asked of the server when typing pauses
    (300 ms) or the box is left. Every box holding it then gets its
    input and change events again, so a line redrawn meanwhile is filled
    too.
  - Production with a Job Order lists that Job Order's items, as before:
    asked by their codes when its Job Orders load. A GRN's Purchase Orders
    bring their lines' items.
  - BOM: the parent and component filters ask the server from 2 letters.
    The BOMs' own items (parent and components) come with the list.
- **getItemsByCodes** (itemSearch.js) {codes, companyId}: active items by
  item code or user code, ignoring case, of the company and shared, up to
  500. `pickFields` now carries WriteOffAccountID too.
- **Tests:** emulator itemSearch (+1: codes, any case, user code, the
  inactive and another company's left out); UI stockModules 14/14 (after
  its emulator suite, which seeds it), production, stockScanning,
  stockLedgerBack, gridClipboard, lineGrids, labelPrinting,
  warehouseCostCenter, createNext, draftTasks, entryLayoutWave, listPaging,
  singleCompany, stockReports, compactForms, dynamicToggle and smoke.
  stockModules now checks the screens never call getActiveItems.
  Negative controls, each caught:
  - the Active filter dropped;
  - a paste not asked first (BOM);
  - a scan not asked first (GRN);
  - the answer given only to the box that asked (Stock Adjustment's line,
    redrawn meanwhile).
- **Deploy:** after items-3b-1. Set **items-3b-2** (35 functions; getItemsByCodes
  new: its invoker binding) with **--screens**; no rules.

