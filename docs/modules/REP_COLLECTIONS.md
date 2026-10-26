# A sales rep's collections, balance and receipts (UX round 2, items 30 and 31)

**Status:** built 2026-10-26 (design agreed by the owner 2026-10-25, decisions Q294–Q298; Q309–Q310 2026-10-26) · **Roadmap:** [#19](../ROADMAP.md) ·
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

## Proposed (as first written; the decisions below change the hand-over and the clearing account)

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

## The owner's decisions (2026-10-25)

| # | Decision |
|---|---|
| Q294 | A cheque is posted at once as a **PDC Received**, marked "with the rep" until handed over; the rep's cheques on hand are those PDCs. |
| Q295 | **Reps work like customers** ("we will have to develop a module"): the rep is a party in the ledger, with one **Rep Cash Clearing** control account; each cash collection is an open item on the rep (Dr Rep Cash Clearing, tagged with the rep · Cr the customer). The cashier hands over with an ordinary **Cash Receipt** in Cash & Bank: chooses the rep and matches the rep's receipts (or an amount on account), Dr main cash · Cr Rep Cash Clearing. The rep's balance in the portal drops by itself. There is no separate hand-over step in the portal. This replaces the per-rep cash account above. |
| Q296 | The rep may pick the customer's open invoices (oldest first offered); otherwise it is on account. |
| Q297 | Only the office cancels a receipt (a reversal with a reason); the number stays, marked cancelled. |
| Q298 | The receipt number uses a short code set per rep (e.g. RR-AK-000001), defaulting to the employee number. |
| Q309 (2026-10-26) | The receipt prefix is **RC** (RC-AK-000001), not RR: RR already numbers Retail Sales returns (RR-26-01-000001). |
| Q310 (2026-10-26) | Cancelling a rep's receipt needs **Cash & Bank's post right** (a rep receipt is a cash receipt, reversed by the same people). |

So, as agreed: a **Sales Rep** party type beside Vendor and Customer
(partyLedger.js): its control account (Rep Cash Clearing, per company, in
Sales Invoice Configuration), its open items (the rep's receipts), its
statement, and Cash & Bank's party picker taking a rep. A rep's PDCs "with
the rep" are handed over by ticking them in PDC Received ("received from
the rep"), which moves no money.

## The questions as asked

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

## As built (2026-10-26)

- **The rep as a party** (functions/src/partyLedger.js, `PARTY_TYPES.SalesRep`):
  its records are built by `salesRep.repParties` from `salesReps/{employee}`
  (RepCode, the employee's name, company) and `salesRepSettings/{company}`
  (ClearingAccountID, the company's Rep Cash Clearing account, the same for
  every rep of the company). No invoices: its open items are its receipts'
  New Refs. Cash & Bank, JV, the allocation and the re-match work on it as on
  a vendor or customer (`getPartyAccounts`, `getPartyOpenItems`); a line on
  Rep Cash Clearing without a rep is refused ("… is the Rep Cash Clearing
  account — select the Sales rep …"). The vendor/customer messages are
  unchanged. The party statement and aging stay Vendor / Customer only.
- **Set-up** (Sales Invoice Configuration → Sales reps):
  `saveSalesRepSettings` (the clearing account: postable, the company's, not
  cash or bank, not a vendor's or customer's control account; it can't change
  while a rep still holds cash on it); `saveSalesRep` takes `repCode` (1–12
  letters or digits, the employee number without its dash by default; a
  code used once is the rep's for good, `salesRepCodes/{code}`, so no receipt
  number can repeat). The rep's old CashAccountID is no longer used.
- **A collection** (essPortal `salesCollect` → `salesRep.collect`, under the
  global lock): the rep's next number, `salesRepCounters/{employee}`,
  RC-<code>-000001 (Q298, Q309), for cash and cheques alike.
  - Cash: one posted entry, VoucherType `RepReceipt` (glWriting, numbered
    with the receipt's own number, never by Numbering, which doesn't list
    it): Dr Rep Cash Clearing (SalesRep, a New Ref) · Cr the customer
    (Against the invoices picked, the rest a New Ref, Q296).
  - Cheque: `pdc.postPdcForRep`, a PDC Received posted at once with no
    approval, WithRep, RepEmployeeID, RepName, RepReceiptNumber (Q294); its
    photo on the PDC as before.
  - The receipt, `repReceipts/{number}` (Firestore), written in the same
    batch as the posting: customer, amount, method, cheque, what it settles,
    the rep. A customer invoiced in a foreign currency is refused (the
    office records its receipts).
- **The cashier** (Q295): an ordinary Cash Receipt, a line on Rep Cash
  Clearing tagged with the rep, allocated against the rep's receipts. The
  receipt's status is derived: *With the rep*, *Part handed over*, *Handed
  over* (its New Ref's outstanding); a cheque *With the rep* until
  `receivePdcsFromRep` (PDC Received's post right; no money moves), then the
  PDC's own state. Clearing or bouncing a cheque still with the rep is
  refused.
- **Cancelling** (`cancelRepReceipt`, Cash & Bank's post right, Q297, Q310):
  cash, a reversal numbered RC-…-C, refused once the cashier has taken any of
  it ("reverse that Cash Receipt first"); a cheque, the PDC cancelled
  (`pdc.cancelPdcFor`, Pending only). The receipt keeps its number, marked
  Cancelled with the reason.
- **The portal** (public/ess.html): Sales → *I hold* (cash and cheques),
  *My receipts* (`salesCollections`), the collection form with the
  customer's open invoices oldest first (`salesInvoices`), and the receipt
  (`salesReceipt`) with **Share** (Web Share API with the PDF file; a
  download where there is no share sheet) and **Download PDF**. The PDF is
  one A5 page written by hand in the page (Helvetica, WinAnsi), no library;
  the amount in words from eosStatement's `amountInWords`.
- **The office**: Sales reps shows each rep's code, cash and cheques held,
  their receipts (`getRepReceipts`) and Cancel. PDC Received marks a rep's
  cheque *with <rep>* and has **Received from the rep** (one or the ticked
  ones); Clear and Bounced appear once received.
- **Removed**: decision 232's drafts (`savePdcDraftForRep`,
  `saveCbtDraftForRep`) and journal.js's portal-rep path past the draft
  right. Drafts saved before the deploy stay drafts for the office.
- **Data Reset**: *Sales Rep Receipts* (repReceipts, the reps' counters), a
  transaction category that Employees and Customers wait for;
  salesRepCodes with Employees; salesRepSettings with Numbering & Settings.
- **Tests**: repCollections emulator suite (6): the set-up rules, cash
  settling a picked invoice and the rest on account, the cashier's Cash
  Receipt matching part then all, a cheque with the rep through to cleared,
  cancelling (rights, cash taken, a cheque), the portal's and the office's
  views. salesRep emulator suite updated (collections no longer drafts);
  Data Reset counts. salesRepPortal UI (8): the set-up, the collection and
  its PDF (checked as a real PDF: pypdf strict and pdftotext read it), what
  the rep holds, PDC Received's hand-over, the office's receipts and Cancel,
  the cashier's Cash Receipt choosing the rep. **Negative controls**, each
  caught then restored: a cheque with the rep cleared; the picked invoices
  not settled; cash the cashier took cancelled; the PDF without what it
  pays; Clear offered for a cheque with the rep.
- **Deploy set** `ux2-rep-collections`: every function (glWriting.js), four
  new; --screens; then Hosting.
