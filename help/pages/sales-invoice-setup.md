---
title: Sales Invoice Setup
area: sales
order: 2
modules: [SALESINVOICESETUP]
sources: [functions/src/retailSales.js, functions/src/invoiceStock.js, functions/src/eInvoicing.js, functions/src/eInvoiceDocument.js]
summary: Set the default rules and accounts used when customer sales are invoiced and posted.
reviewed: 2026-10-16
fingerprint: b906a40e5c74cbc5
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

**Invoices may deliver stock directly** (per company, off unless you switch it on): choose the company, tick it and **Save**. Then a [Customer Invoice](customer-invoice.html) can have item lines and deliver them itself when posted. Off, stock leaves only with a [Delivery Note](delivery-note.html).

## What happens in the books

This setup does not create an entry by itself. It determines how the ERP posts customer sales and related receivables and tax entries later in the workflow.

## E-invoicing (UAE)

Under **E-invoicing (UAE)**, choose the company, tick **E-invoicing on**
and give the date it starts. From that date each posted Customer Invoice,
and each Sales Return (as a credit note), to a customer with a TRN gets its
e-invoice in the UAE format (PINT AE), checked for what it needs. The
invoice shows **Ready to send**, **Not ready** (with what is missing) or
**Not e-invoiced** (a customer without a TRN), and its XML can be
downloaded. Sending goes through your Accredited Service Provider (ASP)
once one is chosen and connected; until then nothing is sent. The company
needs its 15-digit TRN in Company Master (Tax numbers).

## Rights

Normally restricted to finance support or admin-level setup roles.

## Questions and mistakes

- If invoices do not post as expected, recheck the account determination, sales type and company defaults.
- A missing output tax or receivables account is a common cause of failed invoice posting.
