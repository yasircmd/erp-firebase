---
title: Customer Master
area: sales
order: 1
modules: [CUSTOMERMASTER]
sources: [functions/src/partyLedger.js, functions/src/customerPhone.js]
summary: Keep each customer record complete so sales orders, delivery notes and customer invoices can be raised correctly.
reviewed: 2026-10-26
fingerprint: e5676144a90a231a
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

## Tax registration

Beside the **Tax Registration No.** (a UAE TRN, an Indian GSTIN …), choose the
customer's **tax registration type** (registered, unregistered, composition,
SEZ, overseas, consumer) and its **state / emirate**. In India the state
decides the place of supply: within the company's own state GST is charged
as CGST and SGST, otherwise as IGST (see
[Tax Configuration](tax-configuration.html)). A registered party in India
needs its GSTIN, which is checked: its first two digits must be the state
chosen, and its last character must agree with the rest. A UAE TRN of a
registered party is 15 digits starting 100.

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
