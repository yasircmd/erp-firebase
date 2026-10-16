# UX testing, Tier 3: the plan and the open questions

Status: **wave 1 design agreed** (owner, 2026-10-16: "go with your
recommendations"); waves 2 and 3 still design. See "The owner's
decisions, round 14" at the end.

Tier 3 is the part of the 2026-10-14 UX testing (docs/ROADMAP.md) that is a
feature, not a fix. Each item below says what the system does today (checked
in the code), the proposal, and the owner's open questions. The questions
are numbered on from round 13 (Help, decisions 148–151).

## Already there (no work)

- **Cost centres for one company or all.** Every Organizational Unit,
  cost centres included, is already either *All Companies — shared* or one
  company's (Organizational Units → the unit's Company). Employees, fixed
  assets and the documents only offer a unit of their company or a shared
  one.

## The order proposed

1. **Wave 1: extend what exists** (small; one PR, item by item). Each uses
   a mechanism already in the system, so the risk is low and the value is
   daily: items A–G.
2. **Wave 2: medium features**, one design doc each, after wave 1: H–N.
3. **Wave 3: the large, cross-module ones**, one design doc each, in this
   order because the later ones depend on the earlier: multi-currency and a
   company's own currency; inter-company; projects; print customization;
   UAE e-invoicing; the sales-rep app (O–T).

Strong recommendation: start the **multi-currency design** (O) in parallel
with wave 1, even though it is built last. Inter-company, e-invoicing and
an Indian company (INR) all depend on it, and it touches every posting, so
its decisions shape the others.

## Wave 1: extend what exists

### A. A delivery waiting for its invoice stays in Tasks

**Today:** Home tasks have *follow-up teams* (Approval Configuration, beside
the approval levels): the users who act next once a document is ready, e.g.
Procurement on a submitted requisition until a PO is made from it. The
Delivery Note list already shows each delivery's invoicing state.

**Proposal:** a follow-up team on **Delivery Note**, *Invoicing*: a posted
(approved) delivery is a Home task for the team until it is fully invoiced.

- **152.** Who gets it: the Invoicing team only, or the team and the user
  who made the delivery?
- **153.** A delivery invoiced in part: stays a task until every line is
  invoiced (recommended), or leaves at the first invoice?

### B. PDCs coming due: tasks for chosen people, not only the entry user

**Today:** Home shows "Post-dated Cheques Due to Clear" to every role that
can post PDCs (PDC.md, decision 5): not chosen people.

**Proposal:** a follow-up team on **PDC Received** and **PDC Issued**,
*Treasury*, set per company in Approval Configuration: each cheque becomes a
Home task some days before its date until it is cleared, bounced or
cancelled.

- **154.** How many days before the cheque date does the task appear (0 =
  on the day)? One number for all, or per company?
- **155.** Once a team is set, does everyone who can post PDCs still see
  the Home list too, or only the team (recommended: only the team, with the
  list as today where no team is set)?

### C. Excel paste into Purchase / Inventory Purchase Requisition and Sales Order lines

**Today:** ten entry screens have **Copy / Paste** with headings (JV, CBT,
GRN, Material Issue, …; docs/modules/LINE_GRIDS.md). The two requisitions
and the Sales Order have neither.

**Proposal:** the same Copy / Paste on these three: Copy gives the headings
(also on an empty grid, to fill in Excel), Paste skips them.

- **156.** An item code in the paste that isn't found: refuse the whole
  paste and name the rows (recommended), or add the rest and list the
  ones skipped?
- **157.** Prices on a Sales Order paste: take the pasted price, or always
  the price list's (and ignore a pasted price)?

### D. The month-end checklist: deliveries not invoiced, clearing accounts, your own items

**Today:** ten built-in checks, each Block / Warn / Off per company (Period
Closing → Setup).

**Proposal:**
1. A built-in check: **deliveries posted but not invoiced** in the month.
2. A new kind, **"this account must be zero at month end"**: you pick the
   accounts (GRN clearing, payroll clearing, suspense …), each Block / Warn
   / Off.
3. A new kind, **a step to tick**: free text ("Bank reconciliation done"),
   ticked by the person closing, kept in the closing log.

- **158.** The default for the new built-in check: Warn or Block?
- **159.** Ticked steps: anyone who can close the month may tick, or a
  named person per step?

### E. Retail: a customer found by code or mobile number

**Today:** the counter sells to the Retail Customer, or a customer chosen
from the list by name.

**Proposal:** a search box at the counter that finds a customer by code,
name or mobile number; an unknown mobile can create a new customer there
(name and mobile) with the right to add customers.

- **160.** A mobile number unique per company (recommended), or may two
  customers share one?
- **161.** Should the counter create customers at all, or only find them?

### F. Shareholders in Company Master

**Proposal:** a Shareholders section on the company: name, nationality, ID
or passport number, shares held, % (worked out), from date. Printed on the
company profile.

- **162.** Must the shares add up to 100%? Keep history (a shareholder who
  sold, with a to date), or the current list only?
- **163.** Who may see it: everyone with Company Master access, or a
  separate right (it is personal data)?

### G. Fixing a wrong reference on a payment without reversing it (Tier 2)

**Today:** a payment's matching (New Ref / Against Ref) is changed only by
reversing the whole entry, and that is refused while another entry is
matched to it, so one wrong pick can mean a chain of reversals.

**Proposal:** **Re-match** on a posted JV / CBT / invoice: change which
invoices or advances its party lines settle, with a reason. The books don't
change (the amounts and accounts stay); only the matching does, so the SOA
and the aging follow at once. Kept in the entry's history.

- **164.** Who may re-match: a new right (recommended), or anyone who may
  post the entry?
- **165.** In a closed month: allowed (the books don't change), or refused
  like a posting?

## Wave 2: medium features (a design doc each)

- **H. Direct sales invoice, and Sales Order → invoice without a delivery.**
  Today stock leaves at the Delivery Note; the invoice would then post the
  stock and its cost too. Questions on returns, partial invoicing and
  services.
- **I. Payroll: change an employee's cost centre for a run, and split one
  employee's cost across several cost centres by %.** Today each payslip
  posts to the employee's one cost centre.
- **J. End-of-service format with the final settlement** (a printed EOS
  statement in your layout).
- **K. Vendor and customer: your own extra fields** (as HR Setup's extra
  fields for employees).
- **L. A searchable ledger / customer / vendor picker on every screen**
  (one shared component).
- **M. Chart of Accounts numbering:** no account directly under a class
  head (100000 → 110000 → 110001), and **renumber a used account within its
  group** (rewrites the code everywhere it is copied; logged).
- **N. Item categories beyond the five**, if sub-categories don't cover it
  (its own prefix, "behaves like" one of the five).

## Wave 3: large, cross-module (a design doc each)

- **O. Multi-currency and a company's own base currency** (e.g. INR for an
  Indian company): documents in a foreign currency, exchange rates,
  revaluation, reports in the company's currency.
- **P. Inter-company transactions**: one company's sale is the other's
  purchase; due-to / due-from; eliminations.
- **Q. Projects** as a dimension like cost and profit centres.
- **R. Print customization**: per document, what prints (e.g. which tax
  number), logo, terms.
- **S. UAE e-invoicing**: regulatory; depends on the requirements in force
  and an accredited service provider; the first step is to confirm them.
- **T. A sales-rep app**: orders and payments on a phone, offline or not.

## The owner's decisions, round 14 (2026-10-16)

The owner: "Go with your recommendations." Where the questions above gave
none, the recommendation is the one written here.

| # | Question | Decision |
|---|---|---|
| 152 | Who gets an approved delivery's invoicing task | The **Invoicing** follow-up team; where no team is set for the scope, the user who made the delivery. |
| 153 | A delivery invoiced in part | Stays a task until **every line** is invoiced. |
| 154 | Days before the cheque date | **3 days**, one setting for all companies (changeable in Approval Configuration). |
| 155 | Who sees PDCs coming due once a team is set | **Only the Treasury team**; where none is set, as today (every role that can post PDCs). |
| 156 | An unknown item code in a paste | **Refuse the whole paste** and name the rows. |
| 157 | Prices on a Sales Order paste | The **price list's** price where the item has one; else the pasted price. |
| 158 | Default for "deliveries not invoiced" | **Warn**. |
| 159 | Who ticks a closing step | **Anyone who can close the month**; the log records who ticked and when. |
| 160 | A customer's mobile number | **Unique per company**. |
| 161 | New customers from the counter | **Yes**, for a user with Customer Master's write right (name and mobile). |
| 162 | Shareholders' total; history | Not forced to 100%, but **warned** when it isn't; **history kept** (a to date for one who left). |
| 163 | Who sees shareholders | A **separate right** (Company Master, "shareholders"): it is personal data. |
| 164 | Who may re-match | A **new right** (Re-match) on the entry's module. |
| 165 | Re-match in a closed month | **Allowed** (the books don't change), and logged. |

## As built: wave 1

- **A** (2026-10-16): `followUps.js` adds DELIVERYNOTE (Invoicing):
  posted, not reversed, no `MatchedToInvoiceID` (a delivery is invoiced
  whole), for the team of its scope, else its maker (`CreatedBy`: username
  or uid); "To invoice: <customer>". Users without Delivery Note access get
  none. Tests: `followUpTasks` suite; negative control caught.
- **B** (2026-10-16): PDCRECEIVED / PDCISSUED (Treasury) follow-up modules;
  `approvalFollowUpSettings/PDC/DaysBefore` (default 3, 0-60, saved with a
  PDC team in Approval Configuration). `getPdcsDueForUser`: a cheque whose
  scope has a team goes only to the team (module access), up to DaysBefore
  ahead; else, as before, to those with the post right, from its date.
  Tests: `followUpTasks` suite, `approvalRouting` suite (8) and UI (4);
  negative control caught.

- **C** (2026-10-16): Purchase Requisition, Inventory Purchase Requisition
  and Sales Order have **Copy Table** / **Paste from Excel** (Paste only while
  the document can be edited; Ctrl+V of several cells into the grid does the
  same). The shared `window.gridClipboard` (index.html, LINE GRIDS) copies
  with headings and skips them on paste. Each row is checked (category /
  item, warehouse, unit, cost centre by code; quantity above 0): one wrong
  row refuses the whole paste and the message names the rows (156). On a
  Sales Order a line takes the price list's price where the item is on it,
  else the pasted one (157). Screens only, no functions. Tests:
  `gridPaste.ui.js` (4); negative control (refusal and list price) caught.
- **D** (2026-10-16): `periodClosing.js` adds the built-in check
  **deliveries** ("Deliveries posted, not invoiced": posted up to the
  month's end, no `MatchedToInvoiceID`, not reversed; Warn by default, also
  for settings saved before it, 158). Settings gain `ZeroAccounts` [{
  AccountID, Mode }] (the company's postable accounts, at most 50; GL
  balance at the month's end, "Not zero" with Dr / Cr) and `Steps` [{ ID,
  Text, Mode }] (at most 30). `tickPeriodClosingStep` (the close right,
  159): `Ticks/{month}/{stepId}`, logged Tick / Untick; refused for a
  closed month. Closing copies the steps and their ticks into
  `Closed/{month}/Steps`; reopening clears the reopened months' ticks.
  Checklist items carry `Kind` (check / zero / step). Tests:
  `periodClosing` suite (6, a new D test) and UI (6); negative control
  (invoiced filter, ticks) caught.
- **E** (2026-10-16): the counter's customers carry their `Phone` (the
  mobile); **Find** above the customer list filters by code, name or
  mobile (digits, the last 9). `createRetailCustomer` (Retail Sales access
  and Customer Master's write right, 161): a name and a mobile; Local, on
  the Retail Sales receivables account, code from the Local sequence,
  under the global lock. One mobile per customer of a company (160),
  `customerPhone.js`: compared on the last 9 digits, against active
  customers of the same company or shared ones; also in Customer Master's
  `saveCustomer` (and so the import), legacy patch
  `customer-mobile-unique`, only when the number is new or changed, so
  customers saved before keep saving. Tests: `retailSales` suite (a new E
  test) and UI (11); negative control (full-digit compare) caught.
