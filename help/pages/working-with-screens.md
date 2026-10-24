---
title: Working with screens
area: start
order: 2
summary: What every screen has in common: companies, dates, drafts and posting, messages, Copy to Excel, printing, attachments and closed months.
sources: [public/index.html]
reviewed: 2026-10-24
fingerprint: e3f827116956b2c4
---
## Company first

The ERP holds several companies. Most screens start with a **Company**
choice; you see only the companies assigned to you. When you have only one,
it is chosen for you. Lists, numbers and reports always belong to the
company chosen.

## Dates and periods

- Dates show as **dd/mm/yyyy** (31/12/2026) and months as **Sep-2026**,
  everywhere: on screen, in print and in what you copy to Excel.
- To enter a date, use the date field's calendar.

## Drafts, submitting and posting

Entry screens (journals, invoices, receipts and so on) follow the same
steps:

1. **New** opens an empty document. Fill the header (company, date,
   party) and the lines.
2. **Save Draft** keeps your work without any effect on the books or
   stock. Drafts appear in Home tasks under **My Drafts**, and you can
   change or delete them.
3. **Submit** or **Post**:
   - where an approval is set up for that document, **Submit** sends it to
     the approver (see [Approvals](approvals.html));
   - otherwise **Post** records it: the accounting entry and any stock
     movement are made, and the document gets its number.
4. A posted document cannot be edited. To correct it, **Reverse** it (a
   mirror entry, dated in an open month) and enter it again.

The list on each entry screen shows documents by status; search and open
any of them.

## Finding an account, item, customer or vendor

Wherever you choose an account, an item, a customer, a vendor or another
entry from a long list, you can search it:

- In a code box (the account on a journal line, the item on a GRN line),
  start typing. The matches show under the box straight away. Type **any
  part** of the code or the name: "trad" finds both *Trade Payables* and
  *Beta Trading*. Codes that start with what you typed come first, then
  names. Choose with the mouse, or with the arrow keys and **Enter**
  (after the arrow keys, **Tab** also chooses). **Esc** closes the list
  and keeps what you typed.
- In a long drop-down (a customer or vendor on a document, a journal
  line's party), click it or start typing a letter: a search box opens
  above the list.
- The last five entries you chose from each list appear first, under
  **Recent**. They are kept in this browser.
- On a phone the list fills the screen, with a box to type in.

Short drop-downs (a status, a company) work as before. The list offers
the same entries as before: for example, a journal offers only the
company's postable accounts.

## Messages and questions

Messages, confirmations ("Post this document?") and questions (for example
a reason for a reversal) appear in a box inside the ERP. Read them before
choosing: **Cancel** always leaves things as they were.

## Long lists

Document lists (journal entries, cash and bank, GRNs, purchase orders and
others) show the newest entries first, a page at a time. **Load next**
adds the following page below. Searching and filtering look through every
entry, not only the ones shown. **Rows** beside the count sets how many a
page holds: 25, 50 or 100. The choice is remembered in this browser for
every list.

## Copy to Excel and printing

- **Copy** (on lists and reports) copies the table; paste it into Excel
  and each value lands in its own cell.
- Entry screens with lines (journal entries, cash and bank, GRNs, the
  requisitions, sales orders and others) have **Copy Table** and **Paste
  from Excel**: copy the lines with their headings, fill them in Excel and
  paste them back. The headings row is skipped, and a paste with a wrong row
  is refused whole, naming the rows to fix.
- **Print** prints the report or document without the menus and buttons.
  To keep a PDF, choose "Save as PDF" as the printer.
- Printed documents (invoices, vouchers, orders, delivery notes and the
  like) share one look: their tables have a light, rounded frame and light
  lines between the cells. Payslips keep their own layout.

## Supporting documents

Entry screens have a **Supporting documents** section: **Add files** to
keep the vendor's bill, a delivery note or a receipt with the document. Files are
stored in the company's document storage, and anyone who can open the
document can open its files.

## Closed months

Finance closes each month after its checks (Period Closing). Once a month
is closed, nothing can be posted, reversed or approved with a date in it;
the ERP says which month is closed. Use a date in an open month, or ask
someone with the reopen right to reopen the month.

## Drilling down and going back

Reports link to their detail (a Trial Balance line to its ledger, a ledger
line to its document). Use **Back to …** on the opened screen to return to
the report where you left it.

You can leave a screen at any time, even while it is still loading: what
it was loading is dropped, and nothing on it is saved unless you saved it.

## Saving your place

The ERP signs you out after 10 minutes without activity (with a warning).
Save drafts as you go on long entries.
