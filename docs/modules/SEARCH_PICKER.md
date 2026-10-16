# A searchable ledger / customer / vendor picker on every screen (UX Tier 3, L)

Status: **design, waiting on the owner's answers** (questions 191–196).
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
