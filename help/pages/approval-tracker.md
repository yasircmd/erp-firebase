---
title: Approval Tracker
area: admin
order: 7
modules: [APPROVALTRACKER]
sources: [functions/src/approvals.js]
summary: Track each approval request, see who acted and follow the current status of a document.
reviewed: 2026-10-12
fingerprint: c39226bcddaf0c35
---
## What it is for

**Approval Tracker** shows the approval history for documents in the ERP. It lets users and administrators see where the document is, whether it was approved or rejected, and who acted.

## Before you start

- A document has already entered an approval flow.
- The approval configuration is active for that module.

## Step by step

1. Open **Approval Tracker**.
2. Filter by document type, status or employee.
3. Review the current approval step and the history of actions taken.
4. Use the view to follow up with approvers or request revisions.

## What happens in the books

This is a tracking view only. It reads the approval data and does not post entries itself.

## Rights

Most roles can view their own workflow status; admin roles often see the full history.

## Questions and mistakes

- If a document appears stuck, check whether the approver was assigned to the correct approval level.
