---
fingerprint: d854aae9b76d9faa
reviewed: 2026-10-25
title: Clearances
area: hr
order: 14
modules: [CLEARANCE]
sources: [functions/src/clearance.js, screens/CLEARANCE.html]
summary: A leaver's clearance, step by step (Finance, IT, HR …), before the final settlement goes for approval.
---
## What it is for

Before an employee leaves, each department clears them: Finance checks
loans and advances, IT collects the laptop and closes the accounts, HR takes
back the documents. **Clearances** tracks those steps for every employee on
notice or who has left, until their final settlement is posted. The
[final settlement](payroll-final-settlement.html) can't be submitted for
approval until every step is signed off.

## Before you start

- **Set-up** (needs the Clearances **setup** right): open Clearances,
  choose the company and select **Set-up**.
  - The steps, in the order they run. Each has its name, its **team** (the
    users who sign it off; they need Clearances access) and its checklist,
    one item a line.
  - Whether the steps run **in order** (IT opens once Finance has signed)
    or **all at once**.
  - The deduction pay element an **amount to recover** posts through (for
    example "Assets not returned"), if steps may enter one.
- A company with no set-up of its own uses Finance → IT → HR, with a short
  checklist each. Saving **no steps at all** switches clearance off for the
  company: its settlements then don't wait for one.
- A change to the set-up applies to clearances started from then on.

## Step by step

### A clearance starts

When an employee is put **On notice** (or marked **Left**) with a leaving
date in [Employees](employees.html), their clearance starts with the
company's steps. It also starts for a leaver whose final settlement is not
yet posted, the first time anyone opens Clearances. If the employee becomes
Active again before anyone signed, the clearance goes.

### Sign off a step

1. The step's team sees it on Home under **Clearances Waiting for You**,
   or opens Clearances (**Waiting for my team**).
2. Open the employee. Tick each item done, and write any notes.
3. If something wasn't returned, enter the **amount to recover** and what
   it is for. For example, 1,500.00 for "laptop not returned".
4. **Save** keeps your work; **Sign off** completes the step. In order, the
   next step then opens for its team.

A step with no team is signed off by users with the Clearances **manage**
right, who may also sign off any step. **Reopen** (manage) takes a signed
step back, with a reason, until the final settlement is posted.

### The final settlement

Once every step is signed off, the clearance is **Complete** and the final
settlement can be submitted. Each amount to recover is already on it as a
deduction line ("Clearance: IT"), which HR can change there with a reason.

## What the employee sees

In the Employee Portal, the leaver's Home shows **Your clearance before
leaving**: each step (done, in progress or waiting) and what is still open
in it (for example "Laptop returned"). They never see the notes or the
amounts.

## Rights

**access** sees the company's clearances and lets a team member sign off
their own step; **manage** signs off any step and reopens; **setup** sets
the steps.

## Related pages

- [Final Settlements](payroll-final-settlement.html)
- [Employees](employees.html)
