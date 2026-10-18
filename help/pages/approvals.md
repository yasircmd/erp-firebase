---
title: Approvals
area: start
order: 3
summary: How documents are submitted, approved, rejected and delegated.
sources: [functions/src/approvals.js]
reviewed: 2026-10-18
fingerprint: b8b92e59a13fcc5f
---
## When a document needs approval

An administrator decides, per document type and company, whether
documents need approval and by whom (Approval Configuration). Rules can
depend on the amount, and a document can need several approvers one after
another. When a rule applies, **Submit** sends the document for approval
instead of posting it.

## Approving

1. Your pending approvals appear in Home tasks under **Your Pending
   Approvals**.
2. Select one to open the document. Check it, and its attachments.
3. Choose **Approve**, or **Reject** with a reason.

A reason is required to reject. When the last approver approves, the
document is posted (or, for an order or a request, becomes approved for
the next step). Where a follow-up team is set in Approval Configuration
(for example Procurement for approved requisitions), the document appears
in that team's Home tasks under **Ready for You to Act On**.

## Rejected documents

A rejected document returns to its submitter, with the reason, under
**Rejected — Needs Your Resubmission**. Correct it and submit it again.

## Following a document

**Approval Tracker** shows where every submitted document is: who has
approved it, who it is waiting for, and since when.

## When an approver is away

From Approval Tracker, an approver can delegate their own pending
approvals, and an administrator can delegate anyone's, to another user who
has access to that screen and company. A reason is required (for example
"On annual leave"); who delegated, to whom and when is recorded.

## Closed months

An approval that would post into a closed month is refused; see
[Working with screens](working-with-screens.html#closed-months).
