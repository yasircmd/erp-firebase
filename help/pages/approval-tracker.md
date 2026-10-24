---
title: Approval Tracker
area: admin
order: 7
modules: [APPROVALTRACKER]
sources: [functions/src/approvals.js, functions/src/approvalDelegation.js]
summary: Track each approval request, see who acted and follow the current status of a document.
reviewed: 2026-10-24
fingerprint: 62ee29aea584c2f7
---
## What it is for

**Approval Tracker** is an audit view of approval instances across gated modules. It shows one row per required approval level, including levels still Pending, the assigned approver, decision/reason, self-approval flag, and time taken from initial submission.

## Before you start

- An approval instance exists for the document; ungated documents do not appear as approval activity.
- The user has Approval Tracker access and, if delegating, the relevant delegation right.
- The document number, module, approver, and date range are known for narrowing the register.

## Step by step

1. Open Approval Tracker. Filter by module, document number, approver, status (Pending, Approved or Rejected), and submitted date range.
2. Review each level's Decision: Pending, Approved, or Rejected. Pending time is calculated live from the instance creation time; completed time is measured from the original submission, not from the prior level.
3. Inspect the rejection/approval reason, self-approved indicator, and any current delegation note. Copy the filtered rows to Excel for audit follow-up.
4. If the user is authorized, select **Delegate** on a pending level to assign that one level to another user with a reason. Admins may also delegate all pending levels of an absent approver; an approver may delegate their own pending levels.
5. Verify the delegate and reason in the tracker. A delegation changes who can act on the pending level; it does not change the approval threshold or approve the document.
6. An Admin can **Close** a rejected document that will not be submitted again: it leaves its submitter's tasks, and its row shows "Closed, not resubmitted" and who closed it. The rejection and its reason stay on record.

## What happens in the books

The tracker is read-only apart from delegation and closing a rejection. It does not post journals or change the underlying transaction. The originating module posts only when its approval workflow reaches the required final state.

## Rights

APPROVALTRACKER access controls viewing. Delegation rights are separate: approvers can delegate their own pending approvals; Admin can delegate another approver's pending work. Access to the underlying document remains controlled by its module and company permissions.

## Questions and mistakes

- **A document is missing:** check that its module approval was enabled and applicable levels existed when it was submitted; the tracker records approval instances, not all transactions.
- **The pending approver is unexpected:** compare the document's amount and scope with Approval Configuration and check any delegation shown.
- **Time Taken looks longer than the previous level:** duration is from initial submission, so each level's clock overlaps.
- **Cannot delegate:** only pending levels can be delegated; check whether the current user may delegate that approver/level and whether the delegate is active.
- **A document is approved but not posted:** approval tracking ends at the decision; the source module may still require a separate post or payment action.

## Related pages

[Approval Configuration](approval-configuration.html) · [Approvals](approvals.html) · [User Management](user-management.html)
