---
fingerprint: 0a46032998e5ea91
reviewed: 2026-10-26
title: Sales reps in the Employee Portal
area: sales
order: 20
sources: [functions/src/salesRep.js, public/ess.html]
summary: Sales reps see their customers, send orders, collect cash and cheques with a receipt at once, and see what they hold, from the Employee Portal on their phone.
---
## What it is for

A sales rep uses the **Employee Portal** on their phone. Its **Sales** tab
shows the rep's customers with each one's balance and overdue amount, and
lets the rep send an **order** and **collect** a payment. An order is a
draft the office confirms. A collection is **final at once**: the customer
gets its receipt straight away, and the rep holds the cash or the cheque
until they hand it to the office.

## Before you start

- The rep is an employee with portal access (Employees → portal), and has
  a cost center on their employee record.
- In [Sales Invoice Configuration](sales-invoice-setup.html#sales-reps) →
  **Sales reps**, the office chooses the company's **Rep Cash Clearing**
  account, adds the rep with their **code** (in their receipt numbers) and
  their customers. A **Sales manager** sees all the company's customers.
- The customers have a price list (Price Listing, by their classification).

## Step by step

1. Open the portal and the **Sales** tab.
2. **New order** on a customer: choose items (at the customer's price list
   price; the stock free to sell is shown), quantities and the warehouse,
   then **Send the order to the office**. It is a draft Sales Order the
   office confirms; the stock is reserved then.
3. **Collect** on a customer: choose **Cash** or **Cheque** and the amount.
   A cheque takes its number, date, bank and a photo.
4. **What it pays**: the customer's open invoices are listed, the oldest
   first. Tick the ones the payment settles (the amount fills in, up to
   what each invoice owes); what is left goes **on account**, for the
   office to match later.
5. **Record and give the receipt**. The receipt opens: its number, the
   customer, the amount in figures and words, cash or the cheque, and the
   invoices it pays. **Share** sends it as a PDF through the phone's own
   share sheet (WhatsApp, email …); **Download PDF** saves it.
6. **I hold**, at the top of the Sales tab, shows the cash and the cheques
   the rep still holds. **My receipts** lists every receipt with what it is
   now, and opens one to share it again.

## Your receipts and what you hold

- Each rep numbers their own receipts, **RC-<code>-000001**, then 000002
  and so on, cash and cheques together. A number is never used twice.
- **Cash** stays on the rep until the cashier takes it: they enter a Cash
  Receipt in [Cash & Bank](cash-and-bank.html#cash-from-a-sales-rep),
  choose the rep and match the rep's receipts. The receipt then shows
  **Handed over** (or **Part handed over**), and **I hold** drops by itself.
- A **cheque** is a post-dated cheque at once, **with the rep** until the
  office ticks it received from the rep in
  [PDC Received](post-dated-cheques.html#cheques-a-sales-rep-collected).
  It then shows **Handed over**, later **Cleared** (or **Bounced**).
- A wrong receipt (a wrong amount or customer) is cancelled by the office
  only, with the reason: it shows **Cancelled**, and the rep gives a new
  receipt.

## What happens in the books

- Cash: Dr Rep Cash Clearing (against the rep) · Cr the customer, at once.
  The cashier's Cash Receipt then moves it: Dr Cash · Cr Rep Cash Clearing.
- A cheque: Dr PDC Received Clearing · Cr the customer, at once, as any
  PDC Received; it clears to the bank on its date.
- Either way the customer owes less from the moment the receipt is given.

## Good to know

- The portal needs a connection: nothing is kept on the phone.
- Prices come from the price list only; the rep can't change them.
- A customer invoiced in a foreign currency is not collected from the
  portal: the office records its receipts.
- For example: Sam Seller (code SS) collects 350.00 in cash from *Corner
  Shop*, ticking their invoice of 300.00; 50.00 goes on account. The
  receipt RC-SS-000001 is shared by WhatsApp; Sam holds 350.00 until the
  cashier takes it.
