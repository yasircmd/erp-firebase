# Several cheques in one PDC entry (UX round 2, item 25)

**Status:** design agreed (owner, 2026-10-24, decisions Q290–Q292) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 3 · **Builds on:** [PDC.md](PDC.md)

## Purpose

A customer often hands over a set of post-dated cheques at once (say twelve
monthly cheques for a contract), and a vendor is paid the same way. Today
each cheque is its own PDC document, entered one by one, with the same
party, company and invoices typed each time.

## What it does

A PDC Received / Issued entry gets **cheque lines**: cheque number, cheque
date, amount, and the bank (drawee bank, free text, on Received; our bank
account on Issued). One party, one company, one receipt / issue date for
the whole entry, entered, approved and posted once.

Each cheque keeps its own life, exactly as a PDC does today (PDC.md):
pending until its date, then cleared to the bank, bounced, cancelled or
replaced, **each on its own**. The entry's status reads from its cheques
(e.g. "3 of 12 cleared"). The SOA and the PDC reports list each cheque.

An entry with one cheque is today's PDC. Existing PDCs stay as they are
(each becomes an entry of one cheque; nothing to migrate in their GL).

## Decisions (owner, 2026-10-24)

- **Q290:** **one GL entry per cheque**, numbered from the entry, so
  clearing, bouncing or cancelling a cheque touches only its own entry,
  as today.
- **Q291:** the entry's total is **allocated against invoices once**, and
  the cheques settle them in cheque-date order (the earliest cheque the
  oldest invoice); a bounce reopens exactly what its cheque settled.
- **Q292:** **one PDC number** for the entry; each cheque (and its GL
  entry) is that number with -01, -02 …
