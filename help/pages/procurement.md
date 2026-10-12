---
title: Procurement
area: procurement
order: 1
modules: [PROCUREMENTSETUP, VENDORMASTER, PURCHASEREQUISITION, INVENTORYPURCHASEREQUISITION, PURCHASEORDER, GRN, VENDORINVOICE, PURCHASERETURN]
sources: [functions/src/grn.js, functions/src/purchaseReturn.js, functions/src/stockMovement.js, functions/src/stockReports.js]
summary: Set vendor and buying defaults, raise requisitions and orders, receive stock, match invoices, and post returns.
reviewed: 2026-10-12
fingerprint: 51f1a595f03cc175
---
## What it is for

The Procurement area handles the buying flow from a request to a final
supplier payment. It covers a vendor master, the buying rules for a company,
requisitions, purchase orders, goods receipt, vendor invoice processing and
purchase returns.

## Before you start

- Make sure each company has its cash, stock and payables accounts in the
  [Chart of Accounts](chart-of-accounts.html).
- Set up the vendor details in Vendor Master (or the vendor data import if
  the company uses a bulk load).
- Review the approval setup in [Approvals](approvals.html): requisitions,
  purchase orders and purchase returns can all need approval before they are
  posted or released.
- If a company uses stock, its item master and stock accounts must be ready
  before any purchase is received.

## Step by step

### 1. Set the company rules

Open **Procurement Setup** and define the defaults for the company:

- which purchasing and receiving steps are in use;
- the supplier categories or rules that should be checked on a purchase;
- any default account or cost settings the system uses when a purchase line
  is created.

The company can then operate the same buying process every time without
changing the same details manually.

### 2. Create and maintain vendors

Open **Vendor Master** to maintain a supplier's record. Keep the basic
information current: company name, tax details, bank and contact details,
trade account and terms. The ERP then uses this data on requisitions,
orders, receipts and invoices.

### 3. Raise a requisition

Use **Purchase Requisition** or **Inventory Purchase Requisition** when a
department or warehouse needs stock or a service. Enter:

1. the company and date;
2. the item or service detail and quantity;
3. the requestor and the approver if the workflow requires it;
4. any notes or attachments.

A requisition remains a draft until it is submitted. Once approved, it can
be turned into a purchase order.

### 4. Create a purchase order

Open **Purchase Order** and choose a requisition or enter the vendor and
items directly. Confirm the order totals, delivery date, warehouse and cost
center, then submit it for approval.

Approved orders can be closed or cancelled, and the user can track whether
items were received in full or left pending.

### 5. Receive the goods

Open **Goods Receipt Note (GRN)**. Choose the approved purchase order,
then receive each item to the required warehouse. The system updates the
stock ledger and records the GRN against the supplier's purchase.

A GRN can also record freight or other non-stock lines, as long as the
company's GRN clearing account is set.

### 6. Match the vendor invoice

Open **Vendor Invoice** to match the invoice to one or more received GRNs.
The system checks quantity, amount and the supplier, then posts the
apportionment and the accounting entry. This is the point where the vendor's
amount flows into the payables ledger.

### 7. Return stock to the supplier

Use **Purchase Return / Debit Note** when goods are defective, damaged or
not as ordered. Select the original invoice or GRN lines, enter the return
quantity and reason, and post the return. The stock is reversed and the
supplier's return is tracked as a debit note.

## What happens in the books

- A GRN posts a stock receipt and updates inventory cost; the stock is
  entered in the stock ledger with the batch and movement details where
  relevant.
- A Vendor Invoice posts the supplier balance into accounts payable and
  clears the GRN against the vendor invoice as matched.
- A Purchase Return reverses the receipt and may create a variance entry if
  the original stock value differs from the return value.
- A closed month or a lock on the period stops further posting or reversal,
  so the books stay in balance.

## Rights

Typical rights are set in Roles & Permissions:

- **Access** to view a procurement screen;
- **Draft** to create or edit purchase documents;
- **Post** to finalise receipts, bills and returns;
- **Approval** for requisitions or orders as required by the company.

The actual rights are configured by your ERP administrator for each user.

## Questions and mistakes

- If the system says a document is closed or a period is locked, the month
  or transaction is no longer open for changes. Open the period or ask an
  administrator to handle the exception.
- If a GRN does not match an approved PO or vendor, check that the vendor,
  company and warehouse are the same and that the order was actually
  approved.
- A return can only be posted against valid source lines. If a line is
  already fully returned or the invoice has been reversed, the system blocks
  it.

## Related pages

- [Inventory](inventory.html)
- [Chart of Accounts](chart-of-accounts.html)
- [Working with screens](working-with-screens.html)
