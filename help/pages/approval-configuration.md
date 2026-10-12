---
title: Approval Configuration
area: admin
order: 6
modules: [APPROVALCONFIG]
sources: [functions/src/approvals.js]
summary: Set the approval rules by module, level and company so documents flow to the right approvers.
reviewed: 2026-10-12
fingerprint: d729186580d6f004
---
## What it is for

**Approval Configuration** defines who may approve which transaction type and how many approval levels are required before a document becomes active.

## Before you start

- The business approval policy and levels are agreed.
- The approvers and roles are already configured.

## Step by step

1. Open **Approval Configuration**.
2. Select the module and document type.
3. Set the approval route, required approvers and policy conditions.
4. Save and test the flow with a sample transaction.

## What happens in the books

The configuration controls approval workflow and does not post accounting entries by itself.

## Rights

Admin and approver setup roles normally manage this screen.

## Questions and mistakes

- If tasks do not route correctly, recheck the module mapping and the approver roles configured for the company.
