# GL views: an entry's GL impact, multi-ledger listing, cost centers, payroll GL (design, 2026-10-10)

## The owner's request (2026-10-10)

> - In GL: the Txn Ref link to see the GL impact, the same as inventory
>   transactions; add the cost center too if any; Excel copy.
> - In GL: add a GL listing for multiple ledgers, without opening and
>   closing balances; Excel copy.
> - GL Report: a CC column also.
> - In payroll costing: the GL impact also, with CC; can copy to Excel.

## Today (from the code)

- **GL Report** (screens/GLREPORT.html, hand-maintained; server
  `getGlReport` in the ported code) lists one account, or a header with
  everything beneath it. It shows an opening balance, the lines with a
  running balance, and the closing balance. The cost center is a filter
  but not a column. The Voucher No. opens the source document; the Txn
  Ref is plain text. **Copy Table** copies the lines.
- **Inventory documents** (GRN, Delivery Note, Customer Invoice, Material
  Issue, …) have **View GL Impact**: a popup listing the entry's lines
  (account, name, debit, credit) from `getJournalEntryDetail`. It shows no
  cost center and has no copy.
- **Every GL line already carries its cost center** (`CostCenterID`). The
  shared line reader returns it; only the screens leave it out.
- **Payroll → Costing** shows each employee's earnings, deductions,
  provisions and total cost, with Copy to Excel. It doesn't show the
  journal the run posts (or will post): Dr each earning by the employee's
  cost center, Cr deductions, Salaries Payable, the provisions.

## Proposed

1. **The entry's GL impact from the Txn Ref** (GL Report, and the new
   listing): the Txn Ref becomes a link. It opens a popup with every line
   of that journal entry: account code and name, **cost center**,
   description, debit, credit, and the totals. It also offers **Copy to
   Excel** and "Open source document" (the link the Voucher No. has
   today). The same popup, with the cost center added, serves the
   inventory documents' View GL Impact, so they show it too.
2. **GL Report: a Cost Center column** (code and name, blank when the
   line has none), in the table, the print and Copy Table.
3. **GL Listing**, a new report next to GL Report: the lines of several
   ledgers, **with no opening, running or closing balance**. Each line:
   date, voucher no., Txn Ref (the link above), account, cost center,
   description, debit, credit. Totals of debit and credit at the end. The
   same filters as GL Report (dates, company, division, branch, cost
   center, profit center, drafts). Copy to Excel and Print.
4. **Payroll → GL Impact**, a view beside Costing: the run's journal by
   account and cost center (account, name, cost center, description,
   debit, credit, totals), with Copy to Excel. Posted: the posted
   journal. Approved, not yet posted: what it will post, worked out the
   same way and clubbed the same way.

All of it is read-only; nothing posts differently.

## Open questions

84. **GL Listing: choosing the ledgers.**
    - Pick any number of accounts from a searchable list; a header
      brings in every account beneath it — recommended;
    - or a range of account codes, from–to.
85. **GL Listing: the layout.**
    - One list by date, with Account and Cost Center columns, and the
      debit and credit totals at the end — recommended (it pastes into
      Excel as one table to sort and pivot);
    - or grouped by account, each with its own subtotal.
86. **Payroll GL Impact: when it shows.**
    - Once the run is approved: what it will post, then the posted
      journal after posting — recommended (it can be checked before
      posting);
    - or only after posting.
87. **Who sees GL Listing.**
    - Its own right in Roles & Permissions ("GL Listing", access), set
      like GL Report's (Admin, Finance Manager, Accountant by default) —
      recommended;
    - or anyone who can open GL Report.

## The owner's decisions (2026-10-10)

| # | Question | Decision |
|---|---|---|
| 84 | Choosing the ledgers | **Pick any number of accounts** from a searchable list; a header brings in every account beneath it. |
| 85 | Layout | **One list by date**, with Account and Cost Center columns, debit and credit totals at the end. |
| 86 | Payroll GL Impact | **From approval**: what the run will post, then the posted journal once posted. |
| 87 | Who sees GL Listing | **The same as GL Report** (its access right). So GL Listing is a second view of the GL Report screen ("Ledger" / "Listing"), with no menu node or right of its own. |
