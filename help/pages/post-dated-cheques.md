---
title: Post-dated Cheques (PDC Received and Issued)
area: finance
order: 8
modules: [PDCRECEIVED, PDCISSUED]
sources: [functions/src/pdc.js]
summary: Cheques dated in the future: received from customers or issued to vendors, then cleared, bounced or cancelled.
reviewed: 2026-10-12
fingerprint: ed58f1a9eede9abb
---
## What it is for

A post-dated cheque (PDC) settles invoices on the day you receive or issue
it, but the money only moves on the cheque date. These screens keep the
cheque in a clearing account until then.

- **PDC Received**: cheques from customers.
- **PDC Issued**: cheques you give vendors.

## Before you start

- In **Company Master**, the company's **PDC Received Clearing** and
  **PDC Issued Clearing** accounts.
- The customer or vendor set up with its receivables / payables account.

## Step by step

### Record a cheque

1. Select **New PDC**.
2. Choose the **Company** and the customer or vendor.
3. Enter the date received or issued, the **Cheque Date**, **Cheque No.**,
   the amount and a description.
   - Received: type the **Drawee Bank** (the customer's bank).
   - Issued: choose **your bank account** it is drawn on.
4. **Allocate** the cheque to the invoices it pays (or **Oldest first**).
   Anything not allocated stays as an advance.
5. If it replaces a bounced cheque, choose it in **Replaces**.
6. **Save Draft**, or **Post** (or submit for approval, where set up).

### Clear it on its date

When the cheque date comes, the cheque appears in Home tasks under
**Post-dated Cheques Due to Clear** and in the **Due to clear** view.
Select **Clear to Bank** with the clearing date (not before the cheque
date); for a received cheque, choose the bank account it was deposited
into. Several cheques can be cleared together with **Clear Selected**.

### If it doesn't go through

- **Bounced**: the bank returned it. Enter the date and reason; the
  invoices it settled are open again.
- **Cancel Cheque**: withdrawn before clearing, same effect.
- **Undo Clearing**: a clearing entered by mistake goes back to Pending.

Bank charges for a bounced cheque are entered separately (a JV or CBT).

## What happens in the books

| Event | PDC Received | PDC Issued |
|---|---|---|
| Post | Dr PDC Received Clearing · Cr the customer | Dr the vendor · Cr PDC Issued Clearing |
| Clear | Dr Bank · Cr PDC Received Clearing | Dr PDC Issued Clearing · Cr Bank |
| Bounce / cancel | The post entry reversed: the party owes again | The same |

The invoices show "Paid (PDC pending)" until the cheque clears. Statements
of account list pending cheques separately.

## Rights

As Cash and Bank Transactions: view, draft, and post (which also covers
clear, bounce, cancel and undo).

## Questions and mistakes

- **Refused as a duplicate**: the same cheque number (and bank, and
  party) is already recorded and not bounced or cancelled.
- **Can't clear before the cheque date.**
- **Can't bounce**: an advance the cheque created has since been used
  against an invoice; undo that first.
