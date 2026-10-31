# Customer credit control (design)

Requested 2026-10-30 (owner), after the Budget module: "Prepare a Budget
and forecast module first then customer credit control". It picks up the
roadmap's open item from Customer SOA decision C1: a credit limit per
customer and a check on new sales for customers who are over their limit
or overdue. **Status: design agreed 2026-10-31 (Q360–Q365); C1 built 2026-10-31; C2 (the check) next.**

## What already exists (from the code)

- **Customers** (RTDB `customers`, the ported Customer Master):
  `PaymentTermsDays`, `DefaultCurrency`, `Status`, and an optional
  `CompanyID` (blank = shared by every company). There is no credit-limit
  or hold field.
- **What a customer owes**, per company: `agingReports.partyAging`
  (Customer Aging, the SOA). For each customer it gives the open invoices
  with their due dates (the invoice date plus the payment terms), the
  credits not yet applied, and the **cheques in hand** (pending PDCs
  received, `PendingPdc`). A PDC is not posted until it clears, so a
  cheque in hand is still in the receivable.
- **Sales documents** (all in Firestore through salesStore):
  - **Sales Order** (ported): `confirmSalesOrder` gives it its number and
    reserves the stock. It has no approval.
  - **Delivery Note** (ported): posted, with approval levels.
  - **Customer Invoice** (ported, hand screen): posted, with approval
    levels; it also covers the direct sales invoice and an invoice from a
    Sales Order.
  - **Proforma Invoice**: not a sale, nothing posted.
  - **Retail Sales**: paid at the till (the retail customer).
  - **Rep portal orders** (salesRep.js): draft Sales Orders, confirmed in
    the ERP.
- **A model to copy:** the Budget module's spending check (BUDGET.md,
  B3) on the ported Purchase Order and Vendor Invoice. It uses a
  per-company setting (Off, Warn or Block), the user's consent on the
  request, an override right with a reason, and a record on the document
  that its approvers see. The ported functions call it through
  tools/legacy-port/patches.js.

## Decisions

| # | Decision |
|---|---|
| Q360 | **A limit per customer in each company** (owner, 2026-10-31), in that company's base currency. Blank: no limit; 0: cash only. |
| Q361 | **Exposure, a per-company setting** (owner, 2026-10-31): the receivable only (open invoices less unapplied credits), or the receivable plus deliveries not yet invoiced and confirmed Sales Orders not yet delivered. Starts at the second. Cheques in hand count either way. |
| Q362 | **Overdue is checked** (owner, 2026-10-31): an invoice overdue by more than the company's grace days (0: any). |
| Q363 | **Checked at confirming a Sales Order and posting a Customer Invoice** (owner, 2026-10-31), including direct invoices; not at the Delivery Note. |
| Q364 | **A manual credit hold** per customer and company (owner, 2026-10-31), with a reason; it refuses credit sales whatever the setting. |
| Q365 | **Off / Warn / Block, a per-company setting** (owner, 2026-10-31), with an override right and a reason, as the budget check. |

## The proposal

- **The limit:** an amount in the company's base currency for each
  customer. A blank limit means no limit; 0 means cash only.
- **Exposure:** what the customer owes plus what is coming
  (see Q361). **Available** is the limit less the exposure.
- **The check:** it runs when a sale commits the company (see Q363). It
  checks two things:
  - **over the limit:** the exposure plus this document is more than the
    limit;
  - **overdue:** the customer has an invoice overdue by more than the
    company's grace days (Q362).
- **What happens** is the company's setting, as with the budget check:
  - **Off:** no check.
  - **Warn:** the user must confirm, and the warning is recorded on the
    document for its approvers.
  - **Block:** refused. Someone with the override right may go ahead with
    a reason.
- **A credit hold** on a customer (Q364) refuses every credit sale until
  it is lifted, with the reason and who set it.
- **A Credit Control screen:**
  - the limits and holds per customer;
  - a report of limit, exposure, available and overdue for each
    customer, with those over the limit or on hold first, and the
    documents behind each figure;
  - the company's settings.

  Customer Master stays as it is.
- **Phone card and rep portal:** the approval card shows the credit
  warning. The rep portal shows the available credit, which completes
  the open item in SALES_REP_PORTAL.md.

## Build plan (proposed)

- **C1:** limits, holds, settings, exposure and the Credit Control report
  (screen, Help, What's new).
- **C2:** the check on the chosen documents (patches to the ported
  functions), with its record and the approvers' view; the phone card and
  the rep portal.

## The questions as asked

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q360 | **Where a limit applies** (a customer can be shared by every company) | (a) one limit per customer, for all companies together; (b) a limit per customer in each company | **(b)**: each company is its own legal entity with its own receivable, and the aging is already per company. |
| Q361 | **What counts as exposure** | (a) the receivable only (open invoices less unapplied credits); (b) (a) plus deliveries not yet invoiced and open (confirmed, not yet delivered) Sales Orders; (c) a per-company setting | **(b)**, with cheques in hand still counted (they are in the receivable until they clear). An order commits the company before it is invoiced. |
| Q362 | **Overdue** | (a) not checked, the limit only; (b) checked: any invoice overdue by more than the company's grace days (0 = any) | **(b)**: overdue is usually the earlier warning sign. |
| Q363 | **Where the check runs** | (a) confirming a Sales Order only; (b) confirming a Sales Order and posting a Customer Invoice (including direct invoices); (c) (b) plus posting a Delivery Note | **(b)**: the order is the commitment, and an invoice may have no order. A Delivery Note from a checked order would be checked twice. |
| Q364 | **A manual credit hold** | (a) none, the limit and overdue only; (b) a hold per customer and company, with a reason, that refuses credit sales whatever the setting | **(b)**: it is the usual way to stop a customer at once (a dispute, a returned cheque). |
| Q365 | **Warn or block** | (a) a per-company setting, Off / Warn / Block with an override right, as the budget check; (b) always block, released through approval levels | **(a)**: the same as the budget check, so users meet one pattern. |

## As built: step C1 (2026-10-31)

- **Module:** `CREDITCONTROL` (Accounts Receivable in the tree; Help in
  Sales and Retail). It has five rights:
  - *access* reads;
  - *write* sets limits;
  - *hold* places and lifts holds;
  - *setup* changes the settings;
  - *override* is for step C2.

  All five are in now, so C2 needs no second full deploy.
- **Data (Firestore):**
  - `creditLimits/{CompanyID}__{CustomerID}`: `Limit` (null means none),
    `Hold`, `HoldReason`, `HoldBy`, `HoldAt`, and `History` (the last 100
    changes);
  - `creditSetup/{CompanyID}`: `Check` (Off, Warn or Block; **Off** to
    start), `Exposure` (ReceivableAndOrders, the default, or Receivable),
    and `GraceDays` (0 to 365).
- **Check: Off to start.** This is a judgment call, not one of the
  owner's decisions. With the check on, every overdue customer of every
  company would start being warned the day C2 is deployed, so each
  company switches it on itself.
- **Server (`creditControl.js`, with the pure parts in `creditCalc.js`):**
  - `getCreditControl`;
  - `saveCreditLimit`: an amount of 0 or more, or blank for none;
  - `setCreditHold`: a reason is required to place a hold;
  - `saveCreditSetup`;
  - `standings(companyId, only)`, exported for C2 and the rep portal.
- **Which customers are listed:** each company's Active customers, its
  own and the shared ones. A customer of another company is refused.
- **The figures:**
  - **The receivable** is the customer aging's Net: open items less
    unapplied credits, in base. **Cheques in hand** (`PendingPdc`) are
    shown, and stay in the receivable.
  - **Deliveries not yet invoiced:** posted Delivery Notes that are not
    matched to an invoice, not reversed and not a reversal. They are
    valued at quantity × price in their order's currency.
  - **Open orders:** Reserved and Partially Reserved Sales Orders, valued
    at (ordered less delivered) × price in the order's currency.
  - Both are before tax (orders carry no tax), and converted to base at
    today's rate.
  - **Overdue:** open items more than the grace days past their due date
    (the aging's due basis).
  - **Standing:** Hold, OverLimit or Overdue. The list is sorted with
    holds first, then over the limit, then overdue, then by exposure.
- **The screen** (`screens/CREDITCONTROL.html`) has two tabs:
  - **Customers:** a limit typed in place, Put on hold and Lift hold
    (with an in-app prompt for the reason), a customer's documents, a
    filter for those needing attention, and Copy.
  - **Setup.**
- **Data Reset:**
  - Credit Limits & Holds (master data, browsable);
  - Credit Control Setup (setup).
- **Tests:**
  - unit/creditControl (2);
  - emulator/creditControl (1);
  - ui/creditControl (3);
  - the Data Reset counts.
  - Negative controls, each caught and restored:
    - a matched delivery still counted (unit);
    - the grace days ignored (emulator).
- **Deploy:** `tools/deploy-sets/credit-c1.txt` with `--screens`, then
  "hosting". It covers every function, because of moduleRegistry.
