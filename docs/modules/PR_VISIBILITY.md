# Purchase Requisition: who sees which requisitions

Status: **design**, awaiting the owner's decisions (2026-10-02).

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

## Questions for the owner

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
