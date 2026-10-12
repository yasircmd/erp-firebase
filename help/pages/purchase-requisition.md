---
title: Purchase Requisition
area: procurement
order: 3
modules: [PURCHASEREQUISITION]
sources: [functions/src/partyLedger.js]
summary: Ask for a purchase before the order is raised, with approval and tracking for the requested item or service.
reviewed: 2026-10-12
fingerprint: 8b624994bdb58466
---
## What it is for

**Purchase Requisition** is the request for stock or a service before a vendor order is issued. It creates a formal record and allows approval before purchasing begins.

## Before you start

- The company, vendor and item setup are in place.
- The approval workflow is configured for requisitions.
- The requestor knows the quantity, description and date needed.

## Step by step

1. Open **Purchase Requisition** and choose the company.
2. Enter the request header and the requested lines.
3. Add the quantities, units and descriptions needed.
4. Submit the requisition. Where approval is configured, it goes to the approver.
5. Once approved, create the purchase order from the approved request.

## What happens in the books

A requisition does not post to the general ledger. It is a control and approval document, not an accounting entry.

## Rights

Users need approval and draft rights for the requisition workflow, and approvers need the approval role for the module.

## Questions and mistakes

- The requisition can be rejected or returned for correction.
- If the item is not available for selection, check the item master and the company assignment.
