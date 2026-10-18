---
title: Procurement Setup
area: procurement
order: 1
modules: [PROCUREMENTSETUP]
sources: [functions/src/grn.js]
summary: Set the company buying defaults that govern requisitions, orders and receiving.
reviewed: 2026-10-18
fingerprint: 8920afecf15a4081
---
## What it is for

**Procurement Setup** defines the standard company buying rules. It keeps the same defaults across all purchases, so requisitions, orders and receipts follow the same purchasing controls.

## Before you start

- The company is already created and the relevant accounts exist in the Chart of Accounts.
- The purchasing team has agreed which approvals and controls the company uses.
- The item and supplier setup is ready before the workflow is released to users.

## Step by step

1. Open **Procurement Setup** and select the company.
2. Review the default approval and receiving rules used for the company.
3. Confirm the purchase defaults that should apply to new requisitions and orders.
4. Save the setup and test a simple requisition or order to confirm the rules are active.

## What happens in the books

Procurement Setup does not post entries by itself. It determines the defaults the ERP uses when the actual requisition, purchase order, GRN and invoice are created.

## Rights

This screen is normally restricted to the ERP administrator or the procurement setup role.

## Questions and mistakes

- If the expected rules are not showing, the company or role setup may be incomplete.
- If the flow is blocked at the next step, check whether the setup was saved and the company is selected correctly.
