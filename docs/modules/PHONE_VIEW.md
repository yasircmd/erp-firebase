# A phone view (UX round 2, item 33)

Status: **proposed** (2026-10-30). Q280 decided (owner, 2026-10-26): Home
with its tasks and approvals, and the reports and balances (Stock
Availability, the statements, aging, the Trial Balance): looked up and
approved on a phone, not entered. Q335-Q337 open.

## Today

- **The ERP has no viewport tag**, so a phone lays every page out about
  980 px wide and shrinks it to fit: tiny text, pinch and zoom. (The
  Employee Portal is built for phones and stays as it is.)
- **Home** lists the user's tasks: approvals, rejected items to resubmit,
  drafts, cheques due, documents expiring and so on. An approval opens the
  document's own screen (`openHomeTaskDocument`), where Approve and Reject
  are. About 25 kinds of document go through approval (Purchase Order,
  GRN, Vendor Invoice, Journal Entry, Leave, Payroll …), each a full
  desktop screen.
- **The reports** chosen in Q280 are Stock Availability, the Customer and
  Vendor Statements, Customer, Vendor and Inventory Aging, and the Trial
  Balance. They are tables of 6 to 9 columns.

## Proposed

1. **The phone layout only where it helps.** The viewport tag is set (width
   = the device's) on Home and the chosen screens, and taken away again on
   any other screen. Every other screen stays as today on a phone,
   desktop-width (Q335). Nothing changes on a computer.
2. **Home on a phone:**
   - tasks as full-width cards with large touch targets;
   - the menu as a full-screen list, a search at the top;
   - the company filter and the user menu as sheets from the bottom.
3. **Approvals on a phone (Q336 (a)):** tapping an approval opens a
   compact **approval card**, not the full screen:
   - the document's number, type, date, party, amount, its lines in short,
     who submitted it, and the history of decisions;
   - **Approve**, and **Reject** with a reason (as today, through the same
     approval functions, with the same rights and levels);
   - "Open the full document" for anything more.

   This needs one new function to read a document's summary for an
   approver.
4. **The reports on a phone:**
   - the filters fold into a "Filters" sheet;
   - the table keeps its first column (the item, party or account) fixed and
     scrolls the rest sideways (Q337 (a));
   - totals stay at the bottom;
   - Copy to Excel and Print stay on a computer.
5. **What doesn't change.** Data entry screens, rights, the approval
   levels and every check stay as they are.

## Open questions (the owner's)

| # | Question | Recommendation |
|---|---|---|
| Q335 | The screens not chosen (data entry, setup), on a phone: **(a)** as today, desktop-width (pinch to zoom), or **(b)** the same, with a notice "This screen is best on a computer"? | **(b)**: a one-line notice that can be closed, so a phone user knows why the page is small, without blocking anyone who needs it. |
| Q336 | Approving on a phone: **(a)** a compact approval card on Home (summary, lines, history, Approve / Reject with reason; "Open the full document" for more), or **(b)** each document's own screen made phone-friendly? | **(a)**: one card serves all 25 kinds of document; (b) would rework 25 desktop screens for a task a card does better on a small screen. |
| Q337 | Wide report tables on a phone: **(a)** the first column fixed and the rest scrolled sideways, or **(b)** one card per row (item, party or account) with its figures listed? | **(a)** for the Trial Balance and aging (figures read across columns); **(b)** for Stock Availability and the statements, where a row is a thing to look up. |
