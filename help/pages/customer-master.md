---
title: Customer Master
area: sales
order: 1
modules: [CUSTOMERMASTER]
sources: [functions/src/partyLedger.js, functions/src/customerPhone.js]
summary: Keep each customer record complete so sales orders, delivery notes and customer invoices can be raised correctly.
reviewed: 2026-10-16
fingerprint: 8799c66f46993929
---
## What it is for

**Customer Master** stores the customer record used by the sales workflow. It provides the identity, credit and contact details needed for sales orders, invoices and customer statements.

## Before you start

- The company and customer account rules are already configured.
- The sales type and credit terms are known.
- The customer has the address, tax and contact details required for billing.

## Step by step

1. Open **Customer Master** and choose the company.
2. Add or update the customer's basic details.
3. Complete the sales and credit information needed for invoicing and statements.
4. Save the record and test it in a sales order or invoice.

## A customer in a foreign currency

Set **Default Currency** to the customer's currency (for example USD) and
its invoices, payments and statement are in it, at the rates in
[Currency Configuration](currencies.html). Leave it on the company default
for a local customer. Once the customer has invoices or payments, its currency
can't change: create a new customer for another currency.

## What happens in the books

The customer master is a setup record, not a journal by itself. It provides the identity and account references used in trade receivables and sales processing.

## Rights

Usually a sales or master-data role can maintain customers; full setup rights stay with admin or finance support.

## Questions and mistakes

- If a customer does not appear in sales screens, check that the record is saved for the right company.
- **"The mobile number … is already … 's"**: each customer of a company has their own phone (mobile) number, so the Retail Sales counter can find them by it. The number is compared on its digits, so 050 123 4567 and +971 50 123 4567 are the same. Use the existing customer, or correct the number. Customers saved with the same number before this rule keep saving while their number doesn't change.
- If the balance or statement does not match expectation, verify the customer account and sales type setup.
