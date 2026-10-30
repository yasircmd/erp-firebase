---
title: Sales Invoice Setup
area: sales
order: 2
modules: [SALESINVOICESETUP]
sources: [functions/src/retailSales.js, functions/src/invoiceStock.js, functions/src/eInvoicing.js, functions/src/eInvoiceDocument.js, functions/src/eInvoiceIndia.js, functions/src/salesRep.js]
summary: Set the default rules and accounts used when customer sales are invoiced and posted.
reviewed: 2026-10-30
fingerprint: 4d479357d26fbefe
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

**Default tax code** (a Sales Type, optional): where the company has a
[Tax Configuration](tax-configuration.html), the tax code of the Sales Type's
direct lines on a [Customer Invoice](customer-invoice.html), and of its
items that have no code of their own (for example SR, or GST18).

## What happens in the books

This setup does not create an entry by itself. It determines how the ERP posts customer sales and related receivables and tax entries later in the workflow.

## E-invoicing (UAE)

An invoice taxed by line carries each line's VAT category (S, Z, E, O, AE)
and rate, with a subtotal per category, in its e-invoice.

Under **E-invoicing (UAE)**, choose the company, tick **E-invoicing on**
and give the date it starts. From that date each posted Customer Invoice,
and each Sales Return (as a credit note), to a customer with a TRN gets its
e-invoice in the UAE format (PINT AE), checked for what it needs. The
invoice shows **Ready to send**, **Not ready** (with what is missing) or
**Not e-invoiced** (a customer without a TRN), and its XML can be
downloaded. Sending goes through your Accredited Service Provider (ASP)
once one is chosen and connected; until then nothing is sent. The company
needs its 15-digit TRN in Company Master (Tax numbers).

**India GST.** A company under India GST in
[Tax Configuration](tax-configuration.html) uses the same switch. Its
e-invoice is the IRP's JSON (schema 1.1), built for each posted invoice and
credit note to a registered business, an SEZ or a customer abroad. A
consumer or an unregistered buyer is **Not e-invoiced**. It needs:

- the company's GSTIN (Company Master → Tax numbers, type GSTIN), address,
  city and PIN code;
- the customer's GSTIN, address, city and PIN code (Customer Master);
- an HSN or SAC code on every item (Item Master).

**Download JSON (IRP)** gives the file. The IRN and the signed QR code come
from the IRP through a GSP once one is chosen and connected; until then
nothing is reported.

## Sales reps

Under **Sales reps**, choose the company.

- **Rep Cash Clearing account**: the account the reps' cash waits on until
  the cashier takes it (a postable account of the company; not a cash or
  bank account, nor a vendor's or customer's control account). Choose it
  before the reps collect cash. It can't change while a rep still holds
  cash on it.
- **Add a sales rep**: the employee, their **code** (letters and digits,
  e.g. AK; the employee number if left blank), whether they are a **Sales
  manager** (sees every customer), and their customers (each customer has
  one rep). The code is in their receipt numbers, RC-AK-000001, and stays
  theirs: no other rep can take it.

The rep then works from the Employee Portal: see
[Sales reps in the Employee Portal](sales-rep-portal.html). Their orders
come in as draft Sales Orders to confirm. Their collections are final at
once, each with its receipt.

The list shows what each rep holds: **Cash held** (not yet taken by the
cashier) and **Cheques held** (not yet received from the rep).
**Receipts** lists a rep's receipts with what each is now: *With the rep*,
*Part handed over*, *Handed over*, *Cleared*, *Bounced* or *Cancelled*.

**Cancel** (with Cash & Bank's post right) cancels a wrong receipt, with
the reason: it is reversed, and the customer owes it again. Its number
stays, marked cancelled. Cash the cashier has already taken can't be
cancelled until that Cash Receipt is reversed, and a cheque only while it
is pending.

## Rights

Normally restricted to finance support or admin-level setup roles.

## Questions and mistakes

- If invoices do not post as expected, recheck the account determination, sales type and company defaults.
- A missing output tax or receivables account is a common cause of failed invoice posting.
