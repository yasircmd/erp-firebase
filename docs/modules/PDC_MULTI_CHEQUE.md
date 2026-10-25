# Several cheques in one PDC entry (UX round 2, item 25)

**Status:** built 2026-10-25 (design agreed by the owner 2026-10-24, decisions Q290–Q292) · **Roadmap:** [#19](../ROADMAP.md) ·
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

## As built (2026-10-25)

**Store.** Still one record per cheque in `pdcCheques` (jobStore.js), so
everything that reads cheques (the SOA's pending PDCs, Home's cheques due,
the aging reports, period closing, the invoice lists' "PDC pending",
clearing, bounce, cancel, undo) works unchanged. An unposted entry is one
record with its lines in `Cheques` (number, date, amount, the foreign
amount for a foreign party, the drawee bank on Received), kept in
cheque-date order, and its top-level fields from the earliest cheque, with
`Amount` the entry's total. Posting turns it into one record per cheque:
the entry's own record becomes cheque 1, the others are `{id}-02`, `-03` …,
and each carries `EntryID` (the entry's record), `EntryNumber`,
`ChequeIndex` and `ChequeCount`. A PDC from before has no `EntryID`: it is
an entry of its own.

**Posting** (pdc.js `commitPdcPosting`, under the global lock, as before):
- The entry's allocations are checked once, on its total (Party Payments'
  own check); then shared among the cheques in cheque-date order, the
  earliest taking the oldest open item (`splitAllocations`, by the order
  `listOpenItems` gives); what is left of a cheque is its own New Ref, so
  the New Ref of an entry falls to its latest cheques. Each cheque's share
  is checked again as its own party line.
- One number for the entry (the PDC Received / Issued sequence, taken
  once); each cheque and its GL entry is that number with -01, -02 …
  (`NumberAs`, new in `buildStockGlEntry`). **An entry of one cheque keeps
  the plain number**, as every PDC so far.
- Every GL entry and every cheque record in one batch: `postStock` takes a
  list of GL entries (Q290). A bounce or cancellation still reverses only
  its own cheque's entry, so it reopens exactly what that cheque settled
  (Q291).
- Approval, where set up, is for the entry and its total: one request,
  and approving posts every cheque.

**Checks.** Each cheque needs its number, date, amount (and on Received
the drawee bank, and for a foreign party its foreign amount), named
"Cheque 2: …" in an entry of several. A cheque entered twice in an entry is
refused, and every line is checked against every cheque already recorded
(drafts' lines included). An entry takes at most 60 cheques (a batch is at
most 500 writes).

**PDC Issued: one bank account for the entry** (our call, 2026-10-25: one
entry's cheques come from one cheque book). An entry of cheques from two
accounts is entered as two entries. Say if lines should each have their
own account.

**Screens** (PDCRECEIVED.html, the template; PDCISSUED.html built from it):
- The entry's **Cheques** lines: **Add cheque** (the same drawee bank as
  the line before), **Monthly series** (more cheques after the last, a
  month apart: the next numbers, kept within the month, so 31 Jan gives
  28/29 Feb and 31 Mar; the same amount and bank), the total, and the rate
  note for a foreign party.
- The list stays one row per cheque (so **Due to clear** and **Clear
  Selected** are as before); a draft of several shows "3 cheques".
- A posted cheque opens with its whole entry: every cheque with its
  status and number, "1 of 3 cleared · 2 pending", the open one marked,
  another a click away; the actions act on the open cheque. The
  allocations shown are that cheque's share.
- **Print** gives one receipt / voucher for the entry, under its number,
  listing every cheque and what the entry settles.
- Supporting documents belong to the entry (its first record's id).
- Create next (LINKED_FLOWS.md) fills the entry's first cheque.

**Tests:** pdcMultiCheque emulator suite (3): the received entry (numbers,
records, the split by date, one GL entry each, the number sequence, an
entry of one, clearing and bouncing one cheque, the SOA, the list); issued
(one bank account, an invoice across two cheques, cancelling one); the
checks and approval. The pdc suite (6) unchanged and passing. pdc UI (10):
the old checks on the new lines, and an entry of three (the series, the
entry view, switching cheques, the receipt). createNext (7) and
multiCurrency (12) UI on the new lines. **Negative controls**, each caught,
then restored: the allocations not sorted by invoice date, the cheques not
sorted by date (both in the emulator suite); the series' month-end, the entry view
showing only the open cheque. Found while testing: a new entry's
duplicate check saw only its first cheque (fixed before commit).
