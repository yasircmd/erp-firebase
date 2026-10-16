---
title: Sales Invoice Setup
area: sales
order: 2
modules: [SALESINVOICESETUP]
sources: [functions/src/retailSales.js]
summary: Set the default rules and accounts used when customer sales are invoiced and posted.
reviewed: 2026-10-16
fingerprint: 248b713dda8f3548
---
## What it is for

**Sales Invoice Setup** defines the company defaults for sales document processing. It keeps the invoicing rules consistent across the sales process and the trade receivables posting.

## Before you start

- The company and its general ledger accounts are set up.
- Tax, discount and output-tax treatment are known.
- The sales team knows which sales types, return accounts and defaults are used.

## Step by step

1. Open **Sales Invoice Setup** and choose the company.
2. Review each default that affects invoices, credit notes and tax treatment.
3. Confirm the sales type defaults and account links.
4. Save and test with a small sales order or invoice.

## What happens in the books

This setup does not create an entry by itself. It determines how the ERP posts customer sales and related receivables and tax entries later in the workflow.

## Rights

Normally restricted to finance support or admin-level setup roles.

## Questions and mistakes

- If invoices do not post as expected, recheck the account determination, sales type and company defaults.
- A missing output tax or receivables account is a common cause of failed invoice posting.
