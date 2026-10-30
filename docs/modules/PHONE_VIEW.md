# A phone view (UX round 2, item 33)

Status: **agreed** (2026-10-30), **built** (2026-10-30; As built below). Q280 decided (owner, 2026-10-26): Home
with its tasks and approvals, and the reports and balances (Stock
Availability, the statements, aging, the Trial Balance): looked up and
approved on a phone, not entered. Q335-Q337 decided (owner, 2026-10-30), below.

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

## The owner's decisions (2026-10-30)

| # | Decision |
|---|---|
| Q335 | Screens not chosen stay as today on a phone, with a **closable notice** "This screen is best on a computer". |
| Q336 | **A compact approval card** on Home: summary, lines in short, history; Approve, or Reject with a reason; "Open the full document" for more. |
| Q337 | **By report**: the Trial Balance and aging keep their first column fixed and scroll the rest; Stock Availability and the statements show a card per row. |

## The questions as asked

| # | Question | Recommendation |
|---|---|---|
| Q335 | The screens not chosen (data entry, setup), on a phone: **(a)** as today, desktop-width (pinch to zoom), or **(b)** the same, with a notice "This screen is best on a computer"? | **(b)**: a one-line notice that can be closed, so a phone user knows why the page is small, without blocking anyone who needs it. |
| Q336 | Approving on a phone: **(a)** a compact approval card on Home (summary, lines, history, Approve / Reject with reason; "Open the full document" for more), or **(b)** each document's own screen made phone-friendly? | **(a)**: one card serves all 25 kinds of document; (b) would rework 25 desktop screens for a task a card does better on a small screen. |
| Q337 | Wide report tables on a phone: **(a)** the first column fixed and the rest scrolled sideways, or **(b)** one card per row (item, party or account) with its figures listed? | **(a)** for the Trial Balance and aging (figures read across columns); **(b)** for Stock Availability and the statements, where a row is a thing to look up. |

## As built (2026-10-30)

- **The switch** (public/index.html, the PHONE VIEW block): a phone is a
  device under 640 px wide (the smaller of the screen's and the window's
  width). On a phone, the sign-in, Home and the seven screens of Q280
  (`PHONE_SCREENS`: STOCKAVAILABILITY, CUSTOMERSOA, VENDORSOA,
  CUSTOMERAGING, VENDORAGING, INVENTORYAGING, TRIALBALANCE) get the
  viewport `width=device-width` and the class `phone-view` on `<html>`.
  Every other screen gets `width=1024` (as a phone showed it before) and,
  until closed, the notice "This screen is best on a computer"
  (`phone-desktop-screen`). Closing it holds for the tab's session
  (sessionStorage `erp-phone-notice`). A computer and a tablet are
  unchanged. The switch runs on Home (`showTreeNav`), when a screen opens
  (`openModule`), and on a resize or rotation.
- **Home:** the top bar and the menu's controls wrap to the phone's
  width, task lines are taller, and the company filter and the user menu
  open as sheets from the bottom.
- **The reports, by report (Q337),** shaped in the shell once their
  tables are drawn (and redrawn: a MutationObserver on the screen), so
  the generated screens are unchanged:
  - Trial Balance and the three aging screens (`SCROLL_SCREENS`): the
    table's container scrolls sideways, with the first column fixed
    (sticky, at least 9rem, at most 45% of the width);
  - Stock Availability and the statements: one card per row, each cell
    under its column's heading (`data-label` from the `thead`; a cell
    spanning columns, such as a total's label, has none).

  Not built as proposed: the "Filters" sheet. The filters wrap to the
  phone's width instead, which keeps every screen's own controls
  untouched. Copy to Excel and Print are not hidden; the Help says they
  are better done on a computer.
- **The approval card (Q336):** on a phone, a pending approval on Home
  opens `#approval-card` instead of the document's screen.
  - `getApprovalSummary({instanceId})` (functions/src/homeTasks.js)
    refuses unless the approval is Pending and holds an undecided level
    of the caller's ("This approval is not waiting on you."). A Job
    Order line counts only its lowest undecided level, as Home does. It
    reads the document through `fetchApprovalSourceDocument`. It returns
    the document in short (`approvalCard.summarize`: date, party,
    description, amount and currency, status, up to 15 lines and how many
    more), the levels with their approvers, the decisions so far, who
    submitted it, the caller's level, and `Decide`.
  - `Decide` is the module's own decide function and the name of its id
    (`approvalCard.DECIDE`, 29 modules; the Purchase Order and the
    invoices with the ported modules' positional arguments; an invoice's
    reversal and a PO's reopening through their own functions). The card
    calls it exactly as the module's screen does, so the module's own
    checks, rights and levels apply. A refusal, which these functions
    return as `{success: false, error}`, is shown, and the card stays
    open.
  - A Job Order line, a reimbursement claim and an absence have more to
    decide than approve or reject: no `Decide`, so their card offers
    "Open the full document" only.
- **Tests:** unit/approvalCard (every decide function is deployed and
  reads the id the card sends; the reversal and reopening variants; the
  level rule; the summary), emulator/approvalCard (a gated Purchase
  Order: the approver's card, others refused, decided through `Decide`),
  ui/phoneView (Home at the phone's width; the card, a refusal and an
  approval; the fixed column and the cards; the notice; a computer
  unchanged). Negative controls: the decide map's id key (`grnId` →
  `grnID`), the switch (`isPhone` always false) and the refusal check,
  each caught and restored.
- **Deploy:** set `ux2-phone` (5 functions: the closure of homeTasks.js,
  with `getApprovalSummary` new), then the "hosting" task (the shell, its
  styles and the Help). No screen, rule or moduleRegistry change.
