---
fingerprint: 987e8bd0f91ba8ec
reviewed: 2026-11-14
title: Sales reps in the Employee Portal
area: sales
order: 20
sources: [functions/src/salesRep.js, public/ess.html, functions/src/crm.js, functions/src/quotations.js]
summary: Sales reps see their customers, send orders, collect cash and cheques with a receipt at once, see what they hold, and keep their leads, pipeline, activities and quotes, from the Employee Portal on their phone.
---
## What it is for

A sales rep uses the **Employee Portal** on their phone. Its **Sales** tab
shows the rep's customers with each one's balance, overdue amount and credit left (or that it is on credit hold, from [Credit Control](credit-control.html)), and
lets the rep send an **order** and **collect** a payment. An order is a
draft the office confirms. A collection is **final at once**: the customer
gets its receipt straight away, and the rep holds the cash or the cheque
until they hand it to the office.

## Before you start

- The rep is an employee with portal access (Employees → portal), and has
  a cost center on their employee record.
- In [Sales Invoice Configuration](sales-invoice-setup.html#sales-reps) →
  **Sales reps**, the office chooses the company's **Rep Cash Clearing**
  account and adds the rep with their **code** (in their receipt numbers).
  A **Sales manager** sees all the company's customers.
- Each of the rep's customers names them as **Sales Rep** in
  [Customer Master](customer-master.html#sales-rep).
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

## Leads, pipeline, activities and quotes

The chips at the top of the Sales tab, **Customers**, **Leads**,
**Pipeline**, **Activities** and **Quotes**, are the rep's own part of the
[CRM](crm.html). What a rep adds is theirs; a **Sales manager** sees the
company's. The office sees them all in CRM and Quotations.

- **Leads:** **New lead** with the organisation or name, a phone or an
  email, and where it came from. If it looks like another lead or a
  customer, the portal says which; **Save anyway** keeps it. A lead has
  **New opportunity**, **New quote** and **Disqualify**. Converting a lead
  to a customer is done by the office (CRM → **Convert to Customer**).
- **Pipeline:** the rep's open opportunities by stage, with the total and
  weighted value. Change a card's stage to move it; **Lost** asks why.
  **Quote** starts a quote for it.
- **Activities:** the rep's open calls, visits and tasks by due date,
  overdue ones in amber. **Done** asks what came of it and offers to
  schedule the next one a week later.
- **Quotes:** **New quote** for one of the rep's customers or leads. Choose
  the items: the price is the price list's and can't be changed, but the
  rep can give a **discount** on each line. **Save the quote**, then
  **Submit**: where the company approves quotations, it waits for approval
  in the office; otherwise it is approved at once. **Share** sends the
  quote as a PDF (**Download PDF** saves it). When the customer accepts an
  approved quote, choose the warehouse and **send the order**: a draft
  Sales Order at the quote's prices goes to the office to confirm. A quote
  for a lead is ordered once the office has made the lead a customer.
  **Revise** offers an approved, rejected or expired quote again.

See [Quotations](quotation.html) for the statuses and the rules.

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
- Prices come from the price list only; the rep can't change them (on a
  quote, the rep can give a discount).
- A customer invoiced in a foreign currency is not collected from the
  portal: the office records its receipts.
- For example: Sam Seller (code SS) collects 350.00 in cash from *Corner
  Shop*, ticking their invoice of 300.00; 50.00 goes on account. The
  receipt RC-SS-000001 is shared by WhatsApp; Sam holds 350.00 until the
  cashier takes it.
