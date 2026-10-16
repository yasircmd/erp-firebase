# UX testing, Tier 3: the plan and the open questions

Status: **design** (2026-10-16). Nothing here is built until the owner has
answered its questions (CLAUDE.md, "Design before code").

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
