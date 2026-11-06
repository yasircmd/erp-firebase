# UX round 3: the owner's issues and suggestions (2026-11-06)

Status: **decisions made** (owner, 2026-11-06, Q411-Q414); building in three
waves.

## The owner's list (2026-11-06)

"Next UX - Issues & Suggestions:"

1. Limit number of bug send by client per day to 10.
2. Yellow color font hard to read in light mode - in Support & E-invoice in
   customer invoice, etc.
3. Limit post dated entry until current month end date.
4. Item Sub-Category - add search option.
5. In Item master - no Item Sub-Category listing to create a new item.
6. Limit What's new in Help in a single page, make next page for old.
7. Add warning for back from Roles & Permissions without save in case edited.
8. Additional informations for Bank account - bank account details.
9. Change auto log off to 30 minutes.

## The owner's decisions (2026-11-06)

| # | Item | Decision |
|---|---|---|
| Q411 | 3 | **All entries, cheques excepted:** every transaction's own date (JV, Cash & Bank, invoices, stock documents, payroll and the rest) may not be after the current month's last day, on save and on post. A PDC's cheque dates and the due / expected dates (delivery, Valid until, due dates) stay free. |
| Q412 | 6 | **What's new in pages of 30:** the latest 30 entries on What's new, then pages of 30 (Next / Previous). |
| Q413 | 8 | **Bank account details, all three:** the details on the bank account in Chart of Accounts (bank name, branch, account holder, account number, IBAN, SWIFT / BIC, currency, notes); **printed on invoices** (Customer Invoice, Proforma, Quotation) and **shown in Cash & Bank / PDC** (when the account is chosen, and on their prints), each of the two **switched on or off** ("somewhere to enable or disable"). |
| Q414 | 1 | **10 new issues per client corporate a day** (UAE time); replies and files are not limited; the 11th is refused with a clear message. |

Taken as the plain reading (say if any should differ):

- **Item 2:** in the light theme, every yellow / amber text is darkened to a
  readable amber (the shell's LIGHT THEME block), wherever it is, not only on
  the two screens named.
- **Item 9:** sign-out after 30 minutes without activity (the warning 30
  seconds before stays).
- **Item 7:** Roles & Permissions asks before leaving with unsaved changes
  (the in-app dialog), as the other screens' leave guard does.
- **Item 4:** a Find box on Item Sub-Category's list (name, parent category,
  company).
- **Item 5:** a fault to reproduce and fix (the sub-categories offered to a
  new item).
- **Item 8, the switches:** on each bank account (two ticks: "Print on
  invoices", "Show in Cash & Bank / PDC"), so a company with several banks
  chooses which one its invoices carry.

## Plan

- **Wave 1, small changes:** items 1, 2, 4, 5, 6, 7, 9.
- **Wave 2:** item 3, the date limit, through the shared posting checks
  (periodLock / each module's save) with the cheque and due dates left out.
- **Wave 3:** item 8, the bank account details, their prints and the two
  switches.

## As built: wave 1 (2026-11-06)

- **Item 1** (support.js): the issue counter `supportCounters/{corporate}`
  also keeps `Day` (UAE) and `DayCount`, in the same transaction as the
  number; the 11th new issue of a day is refused ("... sent 10 issues today,
  the most for a day. Add to an open issue, or send it tomorrow."), taking no
  number. Replies and files are not counted; another corporate is not.
- **Item 2** (public/index.html, LIGHT THEME): `text-amber-300`,
  `text-amber-300/90`, `text-amber-200` and `text-orange-300` darkened, as
  `text-amber-400` already was. unit/lightThemeYellows checks that every
  yellow / amber / orange text class a screen uses has its override.
- **Item 4** (ITEMSUBCAT, through SCREEN_EDITS): a Find box (name, parent
  category, company).
- **Item 5** (ITEMMASTER, a hand screen): two faults found. The list was built
  before the sub-categories had loaded when a new item was opened at once,
  and never again: it is now rebuilt when they arrive. And a new item has no
  company until one is chosen further down the form, so a company's
  sub-categories were not offered: while the item has no company, every
  company's are offered too, named with their company, and choosing one gives
  the item that company. (A behaviour change from the port, asked for:
  recorded in ITEM_SUBCATEGORIES.md.)
- **Item 6** (tools/help/lib.js): a page's front matter `paged: N` builds it in
  parts of N "- " entries, each under its date heading, with Newer / Older
  links; each part is in the search and the sitemap. What's new has
  `paged: 30` (four pages today).
- **Item 7** (ROLES, through SCREEN_EDITS): a changed tick sets the screen's
  `window.hasUnsavedChanges()`, so the shell's Back asks first; saving clears it.
- **Item 9** (public/index.html): `IDLE_TIMEOUT_MS` 30 minutes; the Help's two
  mentions changed.
- **Tests:** emulator/support (the daily limit), ui/ux3Wave1 (items 4, 5, 7),
  unit idleTimeout, lightThemeYellows, helpPaged. Negative controls, each
  caught and restored: no daily limit (the support test fails); the amber-200
  override removed (lightThemeYellows); 31 entries a page (helpPaged); the
  company filter as before and the Roles tick not marking a change (both UI
  tests fail).
- **Results:** emulator/support 4/4; unit 232/232; UI ux3Wave1 3/3, support,
  help 7/7 (its search check takes What's new on any page), home 19/19, smoke
  123/123, rolesMatrix, singleCompany 58/58, oneTitle, hiddenIcons.
- **Deploy:** `ux3-wave1` (7 functions of support.js) with --screens, then
  Hosting.

## As built: wave 2, item 3 (2026-11-06)

The owner added, while it was being built: "Payroll should be able to post
upto next 12 months".

- **The rule** (functions/src/periodLock.js): `latestDate(type)` is the last
  day of the current month (UAE); for payroll's GL types (Payroll,
  PayrollPayment, PayrollLoan, PayrollProvision, FinalSettlement) the last day
  of the month 12 months on. `assertNotPostDated(date, what, type)` refuses a
  later date, naming the latest allowed.
- **On post:** `assertOpen` (the period lock) now checks it first, so every
  place that posts, sends for approval or writes a GL entry does: glWriting
  (`buildStockGlEntry` passes the entry's type: payroll's 12 months;
  `assignStockVoucherNumbering`), approvals, journal.js, PDC, Fixed Assets,
  Opening Balances. A payroll or depreciation reversal moved to an open month
  is checked too.
- **On save:** docStore (every transaction store) refuses a document whose own
  date (`dateField`) is set or changed to after the month: stock documents
  (TransactionDate), Sales Order (SODate), Customer and Vendor Invoice
  (InvoiceDate), Purchase Order (PODate), Purchase and Inventory Purchase
  Requisition (PRDate, IPRDate), PDC (TransactionDate: its cheque dates are
  free). The ported modules' saves go through these stores, so they are
  covered too. A document saved with such a date before the rule keeps it
  through other changes. Also: JV and Cash & Bank drafts (journal.js), the
  quotation's date (Valid until free), Fixed Assets' posting drafts, a payroll
  run's month (12 months ahead).
- **Not checked** (their dates are naturally later): cheque dates, delivery
  and expected dates, Valid until, due dates, leave and HR requests, Job Order
  lines.
- **Help:** Working with screens (Dates and periods), Period Closing,
  Quotations, Payroll run, What's new; pages whose sources changed confirmed.
- **Tests:** unit/postDated (the limit, payroll's, the message),
  emulator/postDated (a JV draft, a Sales Order through the ported save and its
  store, an old one kept, a quotation, posting a document saved earlier),
  emulator/pdcMultiCheque (the entry's date checked, cheques months ahead
  posted). numbering's year-restart check now uses an earlier year (2027 is
  after this month). unit/periodLockGuard takes the type argument; PAYROLL_TYPES
  is a frozen list (unit/corporateContext). Negative controls, each caught and
  restored: the docStore guard off (the Sales Order test fails); the rule off
  (unit/postDated fails).
- **Results:** full emulator regression all passed but essPortal "who is away
  today" (date-dependent, fails on main too); unit 234/234; UI smoke 123/123,
  quotation 7/7, crmPortal 4/4, createNext 7/7, documentLinks, directSalesInvoice
  4/4, pdc 10/10, entryLayout 6/6, home 19/19.
- **Deploy:** `ux3-wave2`, every function (periodLock, glWriting and docStore
  reach them all): from Cloud Shell, then Hosting. No screens, no rules.
