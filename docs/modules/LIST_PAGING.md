# List paging, Gmail-style

Status: **live** 2026-10-02 (PR #44; Deploy runs #42, #43, #44,
[DEPLOY_LOG.md](../DEPLOY_LOG.md)). Design agreed by the owner
(2026-10-02), with the recommended answers.

## The request (owner, 2026-10-02)

"Module like JV & CBT listing default last 100 entries, then option is
only for full load only. Is it possible instead another 100 only? but in
search should also include beyond 100 - all search result of 100 balance
next 100. The same logic of Gmail inbox."

## How it works today

- **Which screens:** nine document lists show the newest 100 and a
  "Load all" link: JV, CBT, GRN, Material Issue, Warehouse Movement,
  Stock Adjustment, Production, Physical Count and Purchase Order.
- **Search and filters** (search box, company, status, dates, type) run
  in the browser, over the entries already loaded only. On the first
  100, a search for an older entry finds nothing, and nothing says so.
- **A gap in "Load all" for JV and CBT:** it loads at most 1,000 entries
  without saying so. Beyond 1,000, the oldest entries can't be reached
  from the list at all. The stock lists have no such cap.
- **Where the entries are:**
  - JV and CBT are in Firestore. Firestore can't search for "contains
    this text", so a text search has to read the entries and check them.
  - The stock documents are in the Realtime Database. Their list
    functions already read every entry on each load, then send 100.

## Proposal

1. **Load 100 more.** Under the list, "Showing 1–100 of 1,234 ·
   **Load next 100**". Each click adds the next 100 older entries, until
   all are shown. "Load all" goes, and with it the 1,000 cap.
2. **Search and filters run on the server, across every entry** the user
   can see (their companies), newest first:
   - typing in search (after a short pause), or changing a filter, asks
     the server again;
   - it returns the first 100 matches and how many there are in all:
     "1–100 of 342 matches · **Load next 100**";
   - clearing the search returns to the plain list.
   - What search matches doesn't change: JV number and description for
     JV, as today on each screen.
3. **Opening an older entry from a report** (e.g. the GL Report's
   drill-down) opens it directly, as now, without loading the whole
   list first.
4. **The order:** newest created first, as the "most recent 100" always
   was. "Next 100" continues strictly after the last entry shown, so an
   entry added meanwhile can't shift or repeat a page. The screen still
   shows the rows it has loaded sorted by date, as before.

## Cost, honestly

- **Reads.** A JV/CBT search reads every JV (or CBT) entry of the user's
  companies once per search, because Firestore has no text search. At
  today's volumes (thousands) this is well inside the free daily reads
  and takes about a second. At hundreds of thousands it would need a
  proper search index instead. That's not needed now, but it's where the
  limit is.
- **The plain list** (no search) reads only the 100 it shows for JV and
  CBT. The stock lists read all their entries as today.

## The owner's decisions (2026-10-02)

Answered: **add below**, **all nine lists**, **remove "Load all"**.

1. **Next 100: add below, or replace the page?**
   - *Add below* (recommended): the list grows, 1–200, 1–300. You can
     still scroll back, and Copy/print see everything shown.
   - *Replace, like Gmail*: page 2 shows 101–200 only, with ‹ Newer /
     Older › arrows.
2. **Which screens:**
   - JV and CBT now, the rest later; or
   - all nine lists at once (recommended: the same behavior everywhere,
     and one shared piece of code).
3. **Keep a "Load all"** as well? Recommended: no. With search on the
   server it isn't needed, and loading everything gets slower as data
   grows.

## What changes in the code (once agreed)

- **Server:** the list functions accept `search`, the filters, and a
  "continue after" marker, and return `{entries, total, next}`. One shared
  helper does the matching and paging, so every list behaves the same.
  The old `limit` keeps working, for anything else that calls them.
- **Screens:** the notice and "Load next 100" button, and search/filters
  calling the server (debounced). JV and CBT are hand screens; the stock
  screens are generated, so their change is a documented screen edit in
  the generator.
- **Deploy:** a functions set, then screens.

## Tests (planned)

- **Emulator:** for 250 entries:
  - pages of 100, 100 and 50, with no gaps or repeats;
  - a search that finds entries beyond the first 100, with its count;
  - filters (company, status, dates) combined with search;
  - only the user's companies;
  - the next page stays correct while a new entry is added.
- **UI:** "Load next 100" adds rows; a search finds an old entry.
- **Negative controls** for paging (an off-by-one) and for the search
  scope (the first 100 only).

## As built (2026-10-02)

- **Server:**
  - `functions/src/listPaging.js` (new, shared): matching, newest-first
    order, and the `next` marker. The marker is the last entry's
    CreatedAt and id.
  - Each list function takes a `page` argument: `search`, `from`/`to`,
    its filters (CompanyID, Status; CBT also VoucherType; GRN also
    InvoiceStatus), `after`, or `id`. It returns
    `{entries, total, next, filtered}`.
  - Without `page`, the old `limit` behaves exactly as before, for
    anything else that calls it.
  - **JV and CBT (Firestore):**
    - The plain list reads only the page shown: ordered by CreatedAt,
      then the document id, starting after the marker. That is the
      index the list already uses.
    - If that index were ever missing, the list falls back to reading
      everything rather than failing, and logs it.
    - A search or filter reads the user's companies' entries; the
      company and voucher type filters narrow that read.
  - **The stock lists and Purchase Order (Realtime Database)** already
    read everything, so they page and match in memory.
  - **Drill-down by `id`:** it also matches the posted GL entry's id
    (LinkedJVID), as the screens' own lookups did. It still checks the
    user's companies.
  - **A single-company user:** the shell fills that company into the
    company filter. That narrows nothing, so it isn't counted as a
    filter: the list still says "entries", and JV / CBT still read one
    page.
  - **Legacy lists** (Purchase Order, Production, Physical Count) are
    changed through patches `list-paging-purchase-order`,
    `list-paging-production` and `list-paging-physical-count`.
- **Shell:** the LIST PAGING block in `public/index.html`,
  `createListPager`:
  - the notice "Showing 1–100 of 1,234 entries. Load next 100", or
    "… matches" when searching, or "N matches" when everything is shown;
  - typing pauses 300 ms before asking the server;
  - a newer request replaces an older one;
  - while a drill-down is fetching its entry, reloads are held off.
    Opening a screen sets the company filter, and that reload would
    otherwise replace the drill-down.
- **Screens:**
  - Hand screens: JV, CBT, GRN, Material Issue, Warehouse Movement and
    Stock Adjustment were converted once by `tools/legacy-port/listPaging.js`;
    Purchase Order by hand.
  - Generated screens: the generator converts Production and Physical
    Count on every run.
  - Each screen still filters what it has loaded straight away while
    the server answers.
- **Tests:**
  - **The `listPaging` emulator suite (11):**
    - pages of 100 / 100 / 50 with no gaps or repeats, including 30
      entries created in the same millisecond across a page boundary;
    - search and filters beyond the first 100;
    - companies;
    - a page unaffected by an entry added meanwhile;
    - drill-down by id;
    - the old `limit`;
    - CBT types; GRN's invoice filter; PO vendor search;
    - the other five lists;
    - the single-company filter.
  - **`listPaging.ui.js` (5):**
    - JV "Load next 50", search and drill-down;
    - Production (generated);
    - PO vendor search.
  - **Negative controls:** nine caught (see ROADMAP.md). The
    single-company shortcut changes only how much is read, not what is
    returned, so no test can catch it.
- **Deploy:**
  1. Deploy → "hosting" first: the screens need the shell's
     `createListPager`.
  2. Then "functions set", set `list-paging`, with screens.
