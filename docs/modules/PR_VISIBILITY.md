# Purchase Requisition: who sees which requisitions

Status: **built** (2026-10-02), not yet live. Design agreed by the owner
(2026-10-02).

## The request (owner, 2026-10-02)

"In Purchase Requisition, currently the module is assigned to all users,
and they can see what others request too. It should be changed:
1. The users responsible to process the Purchase Requisition from
   procurement can see all the list, the same as Follow-up Team —
   Procurement in Approval Configuration.
2. Who raises the Purchase Requisition and who needs to approve it can
   see their list only."

## How it works today

- **Who sees what:** everyone with access to the module sees every
  requisition of their companies: drafts, submitted, approved, closed.
- **Who acts on what:** the actions (save, submit, cancel, delete,
  approve) check the user's permission and the requisition's status. They
  do not check who raised it. Anyone who could open a requisition could
  cancel it.
- **What is recorded:**
  - every requisition records who raised it (`RequestedBy`);
  - when approval is on, its approval record lists each level's approver,
    and who decided.
  - Delegation moves a level to the new approver, and the record keeps
    that.
- **The Procurement follow-up team** is set per scope in Approval
  Configuration, beside the approval levels. Its scope follows the
  module's ScopeType: Global, Company, Division, Branch or Cost Center.

## Proposal

A user sees a requisition if any of these apply:

1. **They raised it.**
2. **They approve it:** they are, or were, the approver of one of its
   levels. That includes a level delegated to them, and a level they
   already decided.
3. **They are in the Procurement follow-up team** for the requisition's
   scope.

Everyone else sees none. The company restriction stays as today on top.

The same rule applies everywhere a requisition can be reached, not only
the list:
- opening it from Home tasks, or by a report's link;
- the actions: save, submit, cancel, delete, approve;
- search and "Load next 100" (the server only returns what the user may
  see).

So a requisition can't be opened, or cancelled, by guessing its link.

**Unchanged:**
- **Purchase Order:** choosing which approved requisitions to order still
  shows every eligible one to PO users. That is procurement's job.
- **Approval Tracker:** unchanged; it's its own module with its own
  access.

## The owner's decisions (2026-10-02)

- **Inventory Purchase Requisition: not included.** Only Sales use it;
  no one else has access.
- **Approvers:** from when it waits on them, and afterwards.
- **Procurement team:** their team's scope only, and not drafts, unless
  they drafted them (owner, later the same day).
- **Admins:** see all.

The questions as asked:

1. **Inventory Purchase Requisition too?** It has the same Procurement
   follow-up team. Recommended: yes, the same rule.
2. **Approvers: when do they see a requisition?**
   - *From when it waits on them, and afterwards* (recommended). They
     can look back at what they approved or rejected.
   - *Only while it waits on them.*
3. **Procurement team: which requisitions?**
   - *Their scope only* (recommended): with a team per company or cost
     center, a member sees that scope's requisitions, as their Home tasks
     already do.
   - *All requisitions* of their companies, whatever the team's scope.
4. **Admins:**
   - *See all* (recommended), for support and audit.
   - *Follow the same rule as everyone.*

## What changes in the code (once agreed)

- **Server:** one shared check, "may this user see this requisition", in
  a new hand-written file. It is used by:
  - the list (with paging and search);
  - the open-by-id path;
  - every requisition action.
  The Code.gs functions change through documented patches.
- **Screens:** none expected. The list just returns fewer requisitions.
- **Deploy:** a functions set (no screens).

## Tests (planned)

- **Emulator:**
  - the raiser, an approver (pending, decided, delegated), a team member
    in and out of scope, an Admin, and an unrelated user each see exactly
    the right requisitions;
  - an unrelated user can't open, cancel, delete or submit one by id;
  - search and paging only return visible ones.
- **UI:** the list for an unrelated user and for a team member.
- **Negative controls** for each rule.

## As built (2026-10-02)

- **`functions/src/prVisibility.js`** (hand-written): `visibilityFor(user)`
  reads once what the rule needs and returns `canSee(requisition)`.
  `canSeeRequisition(user, id, requisition)` checks one. The company
  restriction is part of it.
  - **The raiser:** `RequestedBy` or `CreatedBy`, which hold the username
    (or the uid).
  - **Approvers:** every approver on any of the requisition's approval
    records, in its levels or its decisions. A resubmission starts a new
    record, and the earlier one's approvers keep sight of it. So does an
    approver whose level was delegated away (`Delegations`), as "were the
    approver" says.
  - **The Procurement team:** the team for the requisition's scope (the
    module's ScopeType in Approval Configuration), as their Home tasks
    use. The team sees every requisition in its scope **except drafts**:
    a draft stays with whoever drafted it until it is submitted (owner,
    2026-10-02). A team member who drafts one sees it as its raiser.
  - **Admins:** every requisition in their companies.
- **Code.gs functions** (patches `pr-visibility-*`):
  - **The list** (`getPurchaseRequisitionEntries`) returns only what the
    user may see.
  - **Every action** answers "Requisition not found." for a requisition
    the user may not see: save (editing), submit, approve/reject, close,
    cancel and delete.
  - Delete had no company check before; it has one now, through this.
  - The checks reach `prVisibility.js` through the generator's MAPPED
    table (`prVisibilityFor_`, `canSeePurchaseRequisition_`), so they are
    awaited.
- **Unchanged:** Purchase Order's choice of approved requisitions, the
  Approval Tracker, Inventory Purchase Requisition, and the screen.
- **Tests:**
  - **The `prVisibility` suite (3):**
    - who sees what: raiser, another raiser's draft, the approvers, the
      team per cost center, an unrelated user, and an Admin;
    - an approver keeps sight after deciding, and after delegation both
      approvers do;
    - an unrelated user can't cancel, close, delete, submit, edit or
      decide by id, and nothing changes.
  - **`purchaseRequisition`:** its Viewer now sees none (it used to see
    all), as agreed.
  - **Negative controls, seven caught:**
    - no raiser rule;
    - no approver rule;
    - team ignoring scope;
    - no Admin rule;
    - no delegated-from approver;
    - cancel unchecked;
    - drafts shown to the team.
  - **Regression:** the existing suites and screen checks for
    requisitions, Purchase Order, drafts, routing, delegation and the
    Tracker pass.
  - **No UI test of its own:** the screen is unchanged, and it lists
    what the server returns.
- **Deploy:** "functions set", set `pr-visibility`. No screens, no
  Hosting.
