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

Procurement is the buying flow from a need to a paid supplier bill. In the
ERP, it covers the vendor setup, the approval path, the purchase order,
receiving the goods, matching the supplier invoice and recording a return if
something is wrong.

The pattern is simple: a request gets checked, a purchase order is raised,
the warehouse receives the goods, the supplier bill is matched, and the
accounting and stock records are updated in the same flow.

## Before you start

- Make sure each company has the needed accounts in the
  [Chart of Accounts](chart-of-accounts.html): cash or bank, the stock
  accounts, and the trade payables account used for vendor balances.
- Check the vendor master is complete in **Vendor Master** (name, address,
  tax details, payment terms and any account setup the company uses).
- Review the approval setup in [Approvals](approvals.html): requisitions,
  purchase orders and returns often need approval before they are posted or
  released.
- If the company buys stock, the items must already exist in Item Master and
  their stock accounts and units must be set correctly.
- Check the company is not in a closed month; once the month closes, no new
  purchase movement can be posted with a date in it.

## Step by step

### 1. Set the company rules

Open **Procurement Setup** and confirm the standard buying rules for that
company. This is the place for the default settings that the rest of the
process follows:

- which purchase and receiving controls are active;
- how orders are matched to suppliers and delivery rules;
- any account defaults or other company-level purchase settings.

This keeps the same flow for every PO and GRN, instead of re-entering the
same setup every time.

### 2. Create or maintain a vendor

Open **Vendor Master** and keep the supplier record current. The supplier's
record is reused throughout the process on requisitions, POs, GRNs and
vendor invoices.

Typical details include:

- vendor name, address and contact information;
- tax or registration numbers;
- company and branch assignments;
- trade account and supplier terms;
- any supplier-specific setup the ERP expects.

A missing or wrong vendor setup will stop a purchase from matching to the
supplier correctly later.

### 3. Raise a requisition

Use **Purchase Requisition** or **Inventory Purchase Requisition** when a
team needs stock or a service.

A requisition usually holds:

1. the company and date;
2. the requested item or service;
3. the quantity and any expected delivery date;
4. the person requesting it and the approver if the workflow requires it;
5. notes, attachments or remarks.

A requisition remains a draft until it is submitted. Once approved, it can
be turned into a purchase order.

### 4. Issue the purchase order

Open **Purchase Order** and either start from a requisition or enter the
supplier and items directly.

Before submitting:

- confirm the supplier, company and warehouse;
- check the item quantities and unit prices;
- confirm the preferred delivery date and any cost center or branch detail;
- check the total for the order.

Once approved, the order becomes the contract to receive against. Approved
orders can later be closed, cancelled or partially received depending on the
actual delivery.

### 5. Receive the goods

Open **Goods Receipt Note (GRN)** to record what was actually received from
the supplier.

A good GRN usually includes:

- the company and the supplier;
- the PO it is receiving against;
- the items and quantities received;
- the warehouse or storage location;
- any freight, services or non-stock lines if the company uses them.

When the GRN is posted, the system updates the stock ledger and keeps the
receipt tied to the purchase. This is the point where the ERP starts to
track the actual stock and cost basis in the books.

### 6. Match the supplier bill

Open **Vendor Invoice** to match the supplier bill to the received GRNs.
The ERP checks the supplier, the company and the quantities and amounts
against the verified receipt. It then posts the entries to the supplier's
payables.

This is the stage where the supplier amount is recognised in the business's
accounts; without a matching invoice, a GRN is not yet the final financial
settlement.

### 7. Record a return if needed

Use **Purchase Return / Debit Note** when goods are returned, damaged,
incorrect or no longer wanted.

A return is usually based on the original invoice or the GRN lines. The user
enters the return quantity, the reason and the source document, and the ERP
reverses the stock and the supplier adjustment. The return remains tied to
its source so the system can tell what was already received, what was
returned and what remains open.

## What happens in the books

- A **requisition** does not post to the books; it is an approval and
  request document only.
- A **purchase order** is a commitment to buy; it does not create stock or a
  journal entry until the goods are received.
- A **GRN** records the stock receipt and updates the stock ledger and the
  stock value as the receipt is posted.
- A **vendor invoice** posts the supplier balance into the payables ledger and
  clears the matched GRN or purchase value as the bill is recognised.
- A **purchase return** reverses the stock and supplier impact for the return
  quantity, and may create a variance if the return value differs from the
  original cost.
- A closed month or a period lock stops new posting in that month. The system
  instructs the user to choose a different date or ask for the period to be
  reopened.

## Good to know

- A purchase is not complete at the PO stage. The important step is the
  actual receipt and then the invoice match.
- The ERP keeps the **source** documents linked: a return points back to its
  invoice or GRN lines, and a vendor invoice can only be matched to valid,
  posted receipts from the correct supplier and company.
- If an approval workflow is set up, a PO or requisition is kept as a draft
  until it is approved; the approver sees it in Home tasks or the approval
  queue.
- The procurement flow is designed to keep the stock value, the supplier
  balance and the accounting entry all in step. If one piece is missing, the
  system refuses the next posting step.

## Rights

Typical rights are set in Roles & Permissions, and can vary by company and
role:

- **Access** to open a procurement screen;
- **Draft** to create or edit a requisition, PO or return;
- **Post** to finalise a GRN, invoice or return;
- **Approval** to approve a requisition or purchase order when the workflow
  requires it.

The actual setup is configured by your ERP administrator.

## Questions and mistakes

- If the ERP says the month is closed, the transaction date is in a month
  that can no longer accept journals or stock entries.
- If a GRN does not match a PO or supplier, check the company, vendor,
  warehouse and the approved order. The system will not accept a mismatch.
- If the return is refused, check that the original invoice or GRN lines are
  valid, not already fully returned, and not reversed.
- If nothing is showing in the supplier bill list, the goods may not have
  been received, or the bill may not have been opened for the same company and
  supplier.

## Related pages

- [Inventory](inventory.html)
- [Chart of Accounts](chart-of-accounts.html)
- [Approvals](approvals.html)
- [Working with screens](working-with-screens.html)
