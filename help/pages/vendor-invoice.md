---
title: Vendor Invoice
area: procurement
order: 7
modules: [VENDORINVOICE]
sources: [functions/src/grn.js, functions/src/partyLedger.js, functions/src/purchaseTax.js]
summary: Match the supplier bill to the received GRNs and post the payable amount to the company books.
reviewed: 2026-10-31
fingerprint: bdd7d37da61d8fa4
---
## What it is for

**Vendor Invoice** records the supplier bill against the received goods or services. It checks the invoice against the GRNs and records the payables impact in the ledger.

## Before you start

- The GRN is posted and the purchase is received.
- The supplier and company match the PO and GRN.
- The invoice amount and quantities are ready for verification.

## Step by step

1. Open **Vendor Invoice** and choose the company.
2. Choose the supplier and the relevant GRNs to match.
3. Review the items, quantities and amounts before posting.
4. Save or post the vendor invoice once the supplier bill is confirmed.
5. Review the payables impact in the ledger.

## Tax by line

Where the company has a [Tax Configuration](tax-configuration.html), the
invoice has no **Tax %**. Each line is taxed by its own **tax code**:

- a GRN's goods take their **item's** code (Item Master);
- a direct line, and a GRN's non-stock line, takes its **account's**
  default code, from the [Chart of Accounts](chart-of-accounts.html);
- the rate is the code's rate on the invoice date, and the discount is
  spread over the lines before tax;
- under India GST, a vendor in the company's own state charges CGST + SGST,
  and one in another state or abroad IGST. The state comes from the
  vendor's **State / emirate** (Vendor Master).

The **Tax** box lists each line: its code, rate, components, the tax, and
the part **reclaimed**. To give a line another code, choose it there. That
needs Vendor Invoice's **change tax code** right (Admin and Finance
Manager by default).

**Tax that can't be reclaimed.** A tax code says how much of its input tax
is recoverable (100 % unless part of it is blocked). Posting debits the part
reclaimed to each component's input account. The rest is part of the cost:

- on a **direct line**, it goes to the line's own account;
- on **goods received**, it is added to their cost in the warehouse they
  came into, which raises their average cost. If none of the goods is left
  in stock there, it goes to the item's consumption account.

**Reverse charge** (a code of that kind): the vendor charges no tax and the
total doesn't include it. The company accounts for the tax itself: it is
credited to the component's output account, and its recoverable part is
reclaimed as input tax, so the two cancel out.

Reversing the invoice reverses all of it, the goods' added cost included.

For example: *Sample Supplies*, in the company's state, bills 10 sheets
received at 20.00 each (GST 18 %) and freight of 100.00 (GST 5 %). CGST and
SGST are 20.50 each and the total is 341.00. With a code that reclaims
nothing, the 36.00 of tax on the sheets goes into their cost instead.

## A vendor in a foreign currency

If the vendor's **Default Currency** (Vendor Master) is not the default
currency, its invoice is in that currency:

- the screen shows **Currency and rate**: the rate on the invoice date,
  from [Currency Configuration](currencies.html);
- you may type another rate, with a reason;
- the total shows in the vendor's currency, with its value in the default
  currency beside it;
- for now such an invoice takes **direct lines only**: GRNs stay in the
  default currency.

The books are in the default currency, at the invoice's rate; each line
keeps its foreign amount too. A reversal uses the invoice's own rate.

## Project

Once the company has projects, the invoice has a **Project** field: every
line the invoice posts carries it, for the
[Project Report](project-report.html).


From a saved document, **Create next** starts the next step and **Linked documents** shows the documents before and after it. See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## The budget

Where the company has a budget for the year and its spending check on, an
invoice's direct lines are checked against it when posted (lines from
goods receipts were counted at the receipt). Over budget, you're told by
how much and can go ahead with a warning, or, with a block, only someone
who may override the budget can, with a reason. See
[Budget](budget.html#the-spending-check).

## What happens in the books

The vendor invoice records the supplier liability and clears the matched purchase value from the receiving side. This is the main point where the purchase becomes a balance in accounts payable.

## Rights

Users need access and post rights for supplier invoice processing; approval may be required in some companies.

## Questions and mistakes

- If the invoice is refused, the supplier, GRN or company may not match.
- **"No exchange rate for USD on or before …"**: enter a rate in Currency Configuration → Rates.
- If the amount does not tie to the GRN, recheck the posted receipt and the supplier bill.
