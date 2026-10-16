# A searchable ledger / customer / vendor picker on every screen (UX Tier 3, L)

Status: **built** 2026-10-16 (branch tier3-wave2). Design agreed by the owner the same day (the recommendations, questions 191–196; UX_TIER3.md round 15).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, L).

## Today

There is no shared picker. Each screen has its own, in one of four forms:

1. **Accounts:** a code box with the browser's suggestion list
   (`<datalist>`), on JV, CBT, Vendor / Customer Invoice, GL Report and
   Recurring JV. Typing the code works; searching by name depends on the
   browser, and the list looks different in each browser.
2. **Vendors and customers on a document:** a plain drop-down (`<select>`)
   of every active one: GRN, Vendor / Customer Invoice, Sales Order,
   Delivery Note, PDCs, the statements and the aging reports. It can't be
   searched: with hundreds of parties it is a long scroll.
3. **The party on a JV / CBT line:** a drop-down shown when the line's
   account is a control account.
4. **Retail Sales' customer** (live 2026-10-16): a **Find** box above the
   list, by code, name or mobile. This is the nearest to what is wanted.

None of the lists is paged: each screen loads the whole chart or the whole
vendor / customer list.

## Proposal

One **picker** in the shell, used in place of all four:

- you type part of the **code, name** (or, for a customer, the **mobile**),
  and the matches show at once, best first (code first, then name),
  without waiting for the server;
- arrow keys and Enter choose, Esc closes, and it works with a mouse and
  on a phone;
- each row shows the code, the name and a hint: an account's type and
  heading, or a party's company. Inactive entries are hidden unless the
  document already has one;
- it keeps the screen's own rules: only postable accounts of the company,
  only that account's parties, and so on (each screen still decides which
  entries are offered);
- in a grid (JV, CBT) it opens in the cell, so the keyboard flow of
  typing a code and pressing Tab stays the same.

It goes screen by screen, starting with the busiest (JV, CBT, the
invoices), with each screen's UI tests updated. The shared logic is
written and tested once.

## Questions for the owner

- **191.** Which screens first? Recommended: JV, CBT, Vendor Invoice,
  Customer Invoice, then the documents with a vendor / customer drop-down,
  then the reports.
- **192.** Also for **items** (GRN, Sales Order, Delivery Note …), which
  use the same browser list today? Recommended: yes, in the same pass.
- **193.** Search by **any part** of the name (e.g. "trad" finds "Beta
  Trading") (recommended), or only from the start?
- **194.** Show the account's **balance** in the picker? Recommended: no
  (slower, and a balance needs a date); the GL Report shows it.
- **195.** On a phone, a full-screen list (recommended) or the same small
  drop-down?
- **196.** Remember each user's **recent picks** at the top (e.g. the 5
  accounts last used on this screen)? Recommended: yes, kept in this
  browser.

## The owner's decisions (2026-10-16)

The recommendations, 191–196: JV, CBT and the invoices first, then the
documents with a vendor / customer drop-down, then the reports; items too;
any part of the name; no balance; full screen on a phone; each user's
recent picks first (kept in the browser).

## As built (2026-10-16)

- **One block in the shell:** SEARCH PICKER (script) and SEARCH PICKER
  CSS in public/index.html, both sliced into the UI harness by
  functions/test/ui/buildHarness.js. It takes over the screens' existing
  lists instead of each screen being changed, so no screen (generated or
  hand-written) was edited:
  - **Boxes with a suggestion list** (`<input list="…">`): accounts on JV,
    CBT, the invoices, GL Report and Recurring JV; items on GRN, PO, SO,
    the requisitions, the stock screens, Price Listing and Retail Sales;
    the PDC drawee. While the box has focus, the browser's own list is off
    (the `list` attribute moves to `data-picker-list` and comes back when
    focus leaves). Typing opens the picker under the box, and the typing
    stays in the box.
  - **Drop-downs** (`<select>`) with at least 12 entries: vendors,
    customers, a JV / CBT line's party, employees, and any other long
    list. A click, a tap, typing a letter or F4 opens the picker with its
    own search box. Shorter drop-downs stay the browser's own.
  - The screen's element stays the record. Choosing sets its value and
    fires `input` and `change`, as the browser does, so each screen's
    rules (which entries it offers, what a choice does) are unchanged.
    Tests that set values (`selectOption`, `fill`) work as before.
- **Opening:** only typing opens it (one character at a time, or a
  deletion). A value set all at once (a paste, a fill) does not, so paste
  from Excel and scripted entry are not interrupted. ArrowDown opens it on
  a box.
- **Matching (193):** every word typed must appear somewhere in the code
  or name. The order is: the code starts with it, then the name starts
  with it, then a word in the name starts with it, then anywhere. Ties
  keep the screen's own order (e.g. by code). At most 80 rows are shown,
  with "Showing 80 of N: type more to narrow".
- **Keys:** ↑/↓ move, Enter chooses (in a drop-down's search, Enter takes
  the first match), Esc closes and keeps what was typed, and Tab after
  arrowing chooses the highlighted row. Otherwise Tab moves on with what
  was typed, as before, so the grid's flow is unchanged.
- **Recent picks (196):** the last 5 picks of each list, first, under
  "Recent", kept in localStorage per list (by datalist or element id, or
  the party select's class).
- **Phone (195):** the ERP page has no viewport tag, so a phone lays it
  out about 980px wide. The picker goes full screen when the device's
  screen is under 640px wide, with its text scaled up to match. A tap is
  taken over at `touchend`, so the phone's own list doesn't open.
- **No balance (194).**
- **Opt-out:** `data-no-picker` on an element or a parent.
- **Not done, and why:**
  - The order of screens (191) wasn't needed: the shared block covers
    every screen at once. The UI regression ran over all of them.
  - There is no hint column (account type or heading, party company).
    Rows show what each screen puts in its list: the code and name for
    accounts and items, and the drop-down text for parties. A screen can
    add search words to an option with `data-search` (as Retail Sales
    could for a mobile number).
  - Retail Sales keeps its Find box (by mobile) above its customer list.
- **Tests:** functions/test/ui/searchPicker.ui.js (4).
  - JV account cell: any part, code first, choosing reaches the screen,
    the browser list is off and back.
  - Esc, fill doesn't open, arrow then Tab.
  - Customer Invoice's customer: own search, recent first, a short
    drop-down left alone.
  - Phone: full screen.
  - Negative control: with matching only from the start, all 4 failed.
    It was then restored.
