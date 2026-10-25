---
title: Post-dated Cheques (PDC Received and Issued)
area: finance
order: 8
modules: [PDCRECEIVED, PDCISSUED]
sources: [functions/src/pdc.js]
summary: Cheques dated in the future: received from customers or issued to vendors, then cleared, bounced or cancelled.
reviewed: 2026-10-25
fingerprint: be33dd9a9660658f
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

### Record a cheque, or a set of cheques

1. Select **New PDC**.
2. Choose the **Company** and the customer or vendor.
3. Enter the date received or issued and a description.
   - Issued: choose **your bank account** the cheques are drawn on.
4. Under **Cheques**, enter each cheque's **Cheque No.**, **Cheque Date**
   and amount.
   - Received: type the **Drawee Bank** (the customer's bank) for each.
   - **Add cheque** adds a line.
   - **Monthly series** adds more cheques after the last one, a month
     apart, with the next numbers and the same amount and bank. For
     example, cheque 000101 dated 31/01/2026 with two more gives 000102 on
     28/02/2026 and 000103 on 31/03/2026. Change any line afterwards.
5. **Allocate** the total to the invoices it pays (or **Oldest first**).
   Anything not allocated stays as an advance. With several cheques, the
   earliest cheque settles the oldest invoice, and so on.
5. If it replaces a bounced cheque, choose it in **Replaces**.
6. **Save Draft**, or **Post** (or submit for approval, where set up).

### Each cheque after posting

A set of cheques is posted as one entry with one number. Each cheque gets
that number with -01, -02 … (the earliest cheque first) and its own GL
entry. From then on each cheque is cleared, bounced or cancelled on its own.

Open any of them to see the whole entry: every cheque with its status (for
example "1 of 3 cleared"); select another to work on it. **Print** gives one
receipt for the entry, listing all its cheques.

### Clear it on its date

When the cheque date comes, the cheque appears in Home tasks under
**Post-dated Cheques Due to Clear** and in the **Due to clear** view.
If a **Treasury** team is set for the company in
[Approval Configuration](approval-configuration.html), only the team sees it
on Home, and a few days before its date (3 to start); a cheque not yet due
shows its date in amber, an overdue one in red.
Select **Clear to Bank** with the clearing date (not before the cheque
date); for a received cheque, choose the bank account it was deposited
into. Several cheques can be cleared together with **Clear Selected**.

### If it doesn't go through

- **Bounced**: the bank returned it. Enter the date and reason; the
  invoices it settled are open again (only what this cheque settled, for
  one of a set).
- **Cancel Cheque**: withdrawn before clearing, same effect.
- **Undo Clearing**: a clearing entered by mistake goes back to Pending.

Bank charges for a bounced cheque are entered separately (a JV or CBT).


From an invoice's **Linked documents**, **Create next** opens a new one here already started for the invoice's open amount. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

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
- **"… is invoiced in USD: enter the cheque's USD amount too"**: the
  party is in a foreign currency. Enter the cheque's **Amount** (what the
  bank pays) and its **USD amount**: the cheque settles bills in USD, and a
  difference from their rates posts as an exchange gain or loss. A bounce
  or cancellation undoes both.
- **A draft made by "Portal: …"** is a cheque a sales rep collected in the
  Employee Portal, with its photo in the supporting documents
  ([Sales reps](sales-rep-portal.html)): check it and post it.
