# A sales rep's collections, balance and receipts (UX round 2, items 30 and 31)

**Status:** proposed, questions Q294–Q298 open · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 4 · **Builds on:**
[SALES_REP_PORTAL.md](SALES_REP_PORTAL.md) (decisions 230–236), [PDC.md](PDC.md)

## What the owner asked (2026-10-25)

- **Item 30:** the rep sees their own balance: the cash they hold, and the
  cheques (PDCs) on hand too.
- **Item 31:** the rep shares the **final** receipt as soon as they have
  collected the cash or the cheque from the customer. From then on, the
  rep is responsible for it until they hand it over to the cashier. Until
  then it sits on **the rep's clearing account**. Each rep has their own
  unique serial of receipt numbers.
- The receipt is shared through the phone's own Share (WhatsApp, email …),
  as a PDF made on the phone.

## What changes from today

Today (decision 232) a collection is a **draft** that the office posts: a
Cash Receipt to the rep's cash account, or a PDC Received. The customer
gets nothing until then. The owner's answer reverses this: **the
collection is final when the rep records it.**

## Proposed

**The rep's clearing account.** Each rep has one account of their own,
which can't be the main cash or another rep's (Sales Invoice
Configuration → Sales reps). The rep can't collect cash without one.

**A collection, recorded in the portal, is posted at once** (the office no
longer posts it):

| Collected | Entry | The customer |
|---|---|---|
| Cash | Dr the rep's clearing account · Cr the customer (tagged) | owes less at once |
| Cheque | see Q294 | owes less at once |

- **Receipt number:** the rep's own series, e.g. `RR-<rep code>-000001`
  (Numbering, a new type "Rep Receipt" whose format includes the rep's
  code). It is unique per rep and never reused, and a cancelled receipt
  keeps its number.
- **The receipt (item 31):** a PDF made on the phone, with the company,
  the receipt number, date and time, the customer, the amount in figures
  and words, cash or the cheque's details, what it settles (or "on
  account"), and the rep's name. It is offered by the phone's **Share**
  (with **Download** as a fallback), and can be re-shared later from My
  collections.

**Hand-over to the cashier.** The rep picks what they are handing over
(cash, an amount; cheques, ticked) → **Hand over** → the cashier
**confirms** it in the ERP (see Q295):
- Cash: Dr main cash (the cashier's account) · Cr the rep's clearing account.
- Cheques: they move from "with the rep" to the office (see Q294).

**The rep's balance (item 30)**, in the portal under Sales → My
collections, and for the office per rep:
- cash collected, handed over (confirmed), waiting for the cashier, on hand;
- the cheques on hand, each with its customer, number, date and amount.

The office sees every rep's balance (Sales reps), and Home shows a
cashier's hand-overs waiting for confirmation.

## Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q294 | A cheque the rep collects: **(a)** it is posted at once as a PDC Received (Dr PDC Received Clearing · Cr the customer), shown as "with the rep" until handed over; no GL entry at hand-over, just the cheque marked received in the office. Or **(b)** it goes on the rep's clearing account too (Dr rep clearing · Cr the customer), and at hand-over becomes a PDC (Dr PDC clearing · Cr rep clearing). | **(a)**: the PDC's own life (clearing on its date, a bounce reopening the invoices) starts the day it is collected, and the clearing account holds only cash. The rep's "cheques on hand" is the list of their PDCs not yet handed over. |
| Q295 | Hand-over: **(a)** the rep records it and the cashier confirms it (the entry posts on confirmation; a short count is refused, and the cashier enters what they actually received). Or **(b)** the rep's record posts it alone. | **(a)**: two signatures for cash changing hands. |
| Q296 | What the collection settles: **(a)** the rep may pick the customer's open invoices (oldest first offered), else it stays "on account" (a New Ref) for the office to match. Or **(b)** always on account; the office matches. | **(a)**: the receipt then names the invoices, which customers expect. |
| Q297 | A wrong receipt (wrong amount or customer): **(a)** only the office cancels it (a reversal, with a reason), and the rep issues a new one; the cancelled number stays in the series, marked cancelled. Or **(b)** the rep may cancel their own within the same day, before any hand-over. | **(a)**: a receipt the customer holds should not vanish from the phone that issued it. |
| Q298 | The rep code in the receipt number: **(a)** the rep's employee number (e.g. RR-EMP0042-000001). Or **(b)** a short code set per rep in Sales reps (e.g. RR-AK-000001). | **(b)**, with the employee number as its default. |

## Build plan (after the answers)

1. Server: the rep's clearing account rule; collections posted (cash and
   cheque per Q294), the rep series (Numbering), hand-over and
   confirmation, the balance; the office's cancel.
2. Portal: My collections (balance, cheques on hand, receipts),
   Hand over, the receipt PDF and Share.
3. ERP: Sales reps (the clearing account, the code, balances), the
   cashier's confirmation screen and its Home task.
4. Tests (emulator and UI, negative controls), Help, What's new.
