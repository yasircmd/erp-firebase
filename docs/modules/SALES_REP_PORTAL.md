# Sales reps in the Employee Portal (UX Tier 3, T)

Status: **design agreed** (owner's direction 2026-10-16, round 16).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 3, T).

## The owner's direction (2026-10-16)

No new app: check whether the sales-rep work can go into the current
**Employee Portal**.

## Today

- **The Employee Portal** (public/ess.html, functions/src/essPortal.js) is
  built for phones.
- **How employees sign in:** with their employee code and a password set
  by HR, or straight in through a linked ERP user.
- **What it has:** Home, leave, payslips, loans, requests (pay queries,
  advances and loans, expense claims), the line manager's Team page, and
  the end-of-service statement.
- **How it works:** each page is an action of the one `essPortal`
  function, which checks who is asking (the employee) and what they may do
  (their own records, their team's).
- **No sales rep yet:** there is no "sales rep" on customers or orders.
  Sales Orders and receipts are made in the ERP by users with those
  rights.

## Feasibility: yes

The portal already has what this needs: a phone layout, a sign-in tied to
the employee, actions checked on the server, in-app dialogs, and the
search picker's pattern for long lists. Sales becomes another tab for
employees who are sales reps. Nothing in the ERP's own screens changes.
The portal's actions call the same Sales Order and receipt code the ERP
uses, so every rule (prices, stock reservation, approvals) still applies.

## Proposal

- **Who is a sales rep:** an employee marked **Sales rep** for a company.
  Each customer can have a **Sales rep**, the employee who looks after it.
  A rep sees only their own customers (question 230).
- **A Sales tab in the portal:**
  - **My customers:** each with its balance and overdue amount (from the
    SOA), and a tap to call. There is no credit limit in the ERP yet:
    Customer credit control is still open on the roadmap.
  - **New order:** customer, then items from the customer's price list,
    with the quantities. It is saved as a **draft Sales Order** in the
    ERP, under the rep's name. The office confirms it, or the rep submits
    it if allowed (question 231).
  - **Collect a payment:** the customer, the amount, cash or cheque. A cash
    receipt is saved as a draft CBT receipt to the rep's cash account. A
    cheque becomes a draft PDC Received with a photo of the cheque. The
    office posts both (question 232).
  - **My orders and collections:** their status (draft, confirmed,
    delivered, invoiced) and today's totals.
- **Offline:** the portal is a web page and needs a connection. Working
  without signal is possible, by keeping drafts on the phone and sending
  them when back online, but it is a larger step (question 233).

## Questions for the owner

- **230.** Does a rep see only the customers assigned to them, or all of
  the company's customers? Recommended: only their own. A manager role
  sees all.
- **231.** A rep's order: a draft the office confirms, or confirmed by the
  rep (stock reserved at once) within limits (discount, and credit once credit control exists)?
  Recommended: draft first, and confirming by the rep later if wanted.
- **232.** Collections: a draft receipt or PDC the office posts
  (recommended), or posted at once? Does each rep have their own cash
  account (petty cash per rep)?
- **233.** Must it work **without a connection**, with drafts kept on the
  phone until back online? Recommended: not in phase 1. Most areas have
  signal, and it adds risk (duplicates, stale prices).
- **234.** Prices: the customer's price list only, or may the rep give a
  discount (up to a limit)?
- **235.** Should a rep see stock available by warehouse when ordering?
  Recommended: yes, the quantity free to sell.
- **236.** Visit notes and the rep's location on a visit: needed?
  Recommended: later, if at all.

## The owner's decisions (2026-10-16)

| # | Decision |
|---|---|
| 230 | A rep sees only the customers assigned to them; a manager role sees all. |
| 231 | A rep's order is a draft Sales Order the office confirms. |
| 232 | Collections are draft CBT receipts or draft PDCs the office posts; a rep may have their own cash account. |
| 233 | No offline mode in phase 1. |
| 234 | The customer's price list only. |
| 235 | The rep sees the stock free to sell. |
| 236 | No visit notes or location for now. |
| (all) | "Go with your recommendations" (owner, 2026-10-16). |
