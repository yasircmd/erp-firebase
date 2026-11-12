---
fingerprint: 367d92447ff09d0d
reviewed: 2026-11-12
title: Correction JV (CJV)
area: finance
order: 4.5
modules: [CJV]
sources: [functions/src/correctionJv.js, functions/src/journal.js, screens/CJV.html]
summary: Move a posted entry's lines to the right account, cost centre, profit centre or project, by a new CJV entry.
---
## What it is for

An entry was posted with the wrong coding: an expense on the wrong account,
a cost on the wrong cost centre, a revenue line without its project. A
**Correction JV** fixes it without touching the entry. It posts a new entry,
numbered **CJV-...**, that takes each chosen line's old coding out and puts
the right coding in, for the same amount.

Only the **account**, **cost centre**, **profit centre** and **project**
change. The amount, the date of the original, its party and its
description stay as they are.

## Before you start

- You need Correction JV's **draft** right to make one and its **post**
  right to post it (Roles and Permissions).
- The entry must be posted and not reversed. Any posted entry can be
  corrected: a JV, a Cash & Bank voucher, an invoice's or a delivery's
  entry, a payroll journal.
- If Approval Configuration has levels for **Correction JV (CJV)**, a CJV
  waits for them before it posts.

## Step by step

1. Open **Correction JV** and choose **New Correction**.
2. Choose the **Company**, type the entry's **voucher number** (as on the GL
   Report, e.g. `JV-01-2026-000012`) and choose **Find**. Its lines appear.
3. Tick each line to correct. Its coding is copied below it: change the
   account, cost centre, profit centre or project.
4. To spread a line over several codings, choose **Split** and give each
   part its amount (for example 60.00 to one cost centre, 40.00 to
   another). The parts must add up to the line: **Parts 100.00 of
   100.00**.
5. The **Date** is the original's by default. Change it if that month is
   closed: the correction must be in an open month, and not after this
   month.
6. **Save** keeps it as a draft; **Post** posts it (or sends it for
   approval).

Each corrected line gives two lines on the CJV: the old coding on the
opposite side, which takes it out, and the new coding (or each part) on the
line's own side. The CJV always balances. From its date, the Trial Balance,
Profit & Loss, the GL Report, Budget vs Actual and the Project Report show
the new coding.

## Lines that are not corrected

A lock beside a line says why it can't be ticked:

- **A customer's, vendor's or sales rep's line.** Its account is the party's
  control account, which must always agree with the party's statement, and
  its party is part of the allocations. A line posted to the **wrong party**
  is fixed with a [Journal Entry](journal-entries.html): credit the wrong
  party and debit the right one.
- **A line on an asset's account** kept by Fixed Assets: use the Fixed Asset
  screens.
- **A line already corrected** by another CJV: correct that CJV instead, or
  reverse it first.

On a line on an **inventory account** or a **tax account**, only the cost
centre, profit centre and project can change: the stock ledger and the tax
reports must still agree with those accounts. Nothing can be moved *to* an
inventory, tax, control or asset account either.

## Reversing

**Reverse** on a posted CJV puts the old coding back (a reversal CJV on the
date you give).

An entry with a correction can't be reversed, by its own screen or as a JV,
until the correction is reversed: otherwise the old coding would be taken
out twice. The message names the CJV: reverse it first, then the entry.

## Printing

**Print** on a posted CJV prints its lines with their coding, the entry it
corrects and its totals.

## Common questions

- **Is the original entry changed?** No. It stays as posted. The CJV is a
  separate entry that names the original it corrects.
- **Can I correct the amount?** No. Reverse the entry and post it again
  with the right amount.
- **The new account refuses my cost centre.** The account's rules in the
  Chart of Accounts decide which cost centres, profit centres and projects
  it takes, as on any entry.
