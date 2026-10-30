---
title: Purchase Order
area: procurement
order: 5
modules: [PURCHASEORDER]
sources: [functions/src/grn.js, functions/src/salesTax.js]
summary: Issue the approved order to the supplier and keep the commitment, delivery and receiving status aligned.
reviewed: 2026-10-30
fingerprint: 924c13cf167b138d
---
## What it is for

**Purchase Order** is the supplier commitment that follows an approved requisition or a direct vendor request. It formalises the quantity, price and delivery plan for the goods or service.

## Before you start

- The supplier has a valid vendor record.
- The item and quantity are approved.
- The order date and delivery target are known.

## Step by step

1. Open **Purchase Order** and choose the company.
2. Select the supplier and the items or services to order.
3. Confirm the quantity, prices, delivery date and warehouse.
4. Submit it. If configured, it goes for approval before the order is active.
5. Track the order until receipt or closure.


## Estimated tax

For a company with a [Tax Configuration](tax-configuration.html), the
grid shows below its total the **Estimated tax** and the **Total with tax**:
what the invoice will charge, by each item's tax code at its rate on the
order date and, under India GST, CGST + SGST or IGST by the vendor's
state. It is an estimate: nothing is posted, and the invoice works out the
tax again when it is made. Each line's components are rounded as the
invoice rounds them.
An item without a tax code is named in place of the estimate: give it one
in [Item Master](item-master.html).

From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## What happens in the books

A purchase order itself is usually a commitment document, not a stock or ledger entry. The real accounting effect happens when the goods are received and the invoice is posted.

## Rights

Users need access and draft rights to create orders, and approval rights if approval is enabled.

## Questions and mistakes

- If quantities or suppliers do not line up, check the approved requisition or vendor record.
- If the order cannot be completed, the company or item configuration may not be valid for the selected supplier.
