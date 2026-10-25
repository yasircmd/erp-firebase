---
title: Purchase Order
area: procurement
order: 5
modules: [PURCHASEORDER]
sources: [functions/src/grn.js]
summary: Issue the approved order to the supplier and keep the commitment, delivery and receiving status aligned.
reviewed: 2026-10-25
fingerprint: 1c6348b35f14c57f
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


From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## What happens in the books

A purchase order itself is usually a commitment document, not a stock or ledger entry. The real accounting effect happens when the goods are received and the invoice is posted.

## Rights

Users need access and draft rights to create orders, and approval rights if approval is enabled.

## Questions and mistakes

- If quantities or suppliers do not line up, check the approved requisition or vendor record.
- If the order cannot be completed, the company or item configuration may not be valid for the selected supplier.
