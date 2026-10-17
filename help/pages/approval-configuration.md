---
title: Approval Configuration
area: admin
order: 6
modules: [APPROVALCONFIG]
sources: [functions/src/approvals.js, functions/src/followUps.js, functions/src/approvalRegistry.js]
summary: Set the approval rules by module, level and company so documents flow to the right approvers.
reviewed: 2026-10-17
fingerprint: fdcb1bbfe89bf17e
---
## What it is for

**Approval Configuration** controls transaction approvals by module, scope, and amount. It also configures follow-up teams for selected workflows. Approval is not enabled merely because a module has levels: both the module setting and applicable saved levels determine whether a document is gated.

## Before you start

- The business has agreed which document types need approval, the amount thresholds, approval scopes, and named approvers.
- Users, company assignments, and organizational units are configured and active.
- The relevant module is available and its documents identify the scope and amount used by the approval check.

## Step by step

### Configure approval

1. Open **Approval Configuration** and choose the module/document type from the list.
2. Set **Enabled**, choose a scope, and choose the gate type:
	- **Global** uses one rule for the whole system.
	- **Company**, **Division**, **Branch**, or **Cost Center** stores separate rules at that scope.
	- **Threshold** applies a level when the document amount is at or above that level's threshold. Every qualifying level is required. Two levels with the same threshold, such as zero, are both required for every amount.
	- **Flat** is a required approval without amount thresholds.
3. Select the scope record (skip this picker for Global). Add one or more levels and assign the specific approver user for each. Save the module settings and level records.
4. Configure the required scope values consistently. A Company-scoped module needs levels saved for each company that should use approval; changing the scope type does not create the levels for you.
5. For a module with a **Follow-up Team** panel, select the users for that scope and save separately. Follow-up tasks are not approval levels: everyone selected receives the Home task, and the first person to act clears it for the group. The teams are:
   - **Production** (Sales Job Orders) and **Procurement** (Purchase and Inventory Purchase Requisitions);
   - **Invoicing** (Delivery Note): a posted delivery stays in the team's tasks until a posted customer invoice includes it; with no team for its scope, the user who made the delivery gets the task;
   - **Treasury** (PDC Received and PDC Issued): a pending cheque appears in the team's Home tasks a number of days before its date (**Days before the cheque date**, 3 to start, one setting for every company and both screens). Once a team is set for a scope, only the team sees those cheques; with no team, everyone who may post PDCs sees them from the cheque date.
6. Test with a draft transaction below and above the intended threshold, and confirm the right approver sees the task. Also test the no-approval case if some scopes intentionally have no levels.

## What happens in the books

Configuration changes do not post to the general ledger. When a transaction is submitted, the module resolves its scope and amount, snapshots the required levels into an approval instance, and waits for every applicable approval. The transaction module performs the posting only after its own approval rules are satisfied. A module enabled with no applicable levels is not gated.

## Rights

APPROVALCONFIG access/write rights control viewing and maintaining configuration. The named approvers need the relevant module/document access and company scope to review their tasks. Follow-up team members need access to the relevant task workflow; assigning a person here does not grant module rights.

## Questions and mistakes

- **Document bypasses approval:** confirm Enabled is on and levels exist for the document's actual scope key. Enabled without levels does not gate.
- **More people are required than expected:** each level whose threshold is at or below the document amount applies; repeated thresholds make levels apply together.
- **No level applies:** check the document amount, threshold values, scope type, and whether levels were saved for the selected company/unit.
- **Approver cannot act:** confirm the level names that exact active user, and that they can access the document's module and company.
- **Follow-up users do not see tasks:** confirm the module supports a follow-up team, the correct scope's team was saved, and the selected users can access the workflow. Follow-up is separate from approval.
- **Approval setting appears to change an in-flight document:** already-submitted documents use the approval instance captured at submission; test configuration with a new draft.

## Related pages

[Approval Tracker](approval-tracker.html) · [Approvals](approvals.html) · [Roles and Permissions](roles.html) · [Organisation Units](org-units.html)
