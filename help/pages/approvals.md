---
title: Approvals
area: start
order: 3
summary: How documents are submitted, approved, rejected and delegated.
sources: [functions/src/approvals.js, functions/src/homeTasks.js]
reviewed: 2026-10-30
fingerprint: d09a7f519395f916
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

### On a phone

On a phone, selecting a pending approval opens an **approval card**
instead of the full screen: the document's number, date, party and
amount, its lines in short, who submitted it, and each level's decision so
far. **Approve** and **Reject** (with a reason) there do exactly what they
do on the document's screen, with the same rights and levels. **Open the
full document** shows everything else, such as attachments. A few kinds of
approval (a Job Order line, a reimbursement claim, an absence) need more
than approve or reject; their card offers the full document only. See
[On a phone](getting-started.html#on-a-phone).

## Rejected documents

A rejected document returns to its submitter, with the reason, under
**Rejected — Needs Your Resubmission**. Correct it and submit it again.
It leaves your tasks once it is submitted again, or posted (a corrected
document that no longer needs approval posts at once).

If it will not be submitted again, choose **Close** on it. It leaves your
tasks, and the rejection stays on record, marked "Closed, not
resubmitted"; the document itself is not changed. Its submitter or an
Admin can close it (an Admin from [Approval Tracker](approval-tracker.html)).

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
