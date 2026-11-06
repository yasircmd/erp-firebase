---
fingerprint: d9d66fda41e7a3c3
reviewed: 2026-11-06
title: CRM
area: crm
order: 1
modules: [CRM]
sources: [functions/src/crm.js, screens/CRM.html]
summary: Leads, opportunities through their stages, and the activities that follow them up, with Convert to Customer.
---
## What it is for

CRM keeps track of the people and businesses you are trying to sell to,
before and after they become customers:

- a **lead** is someone who is not a customer yet;
- an **opportunity** is a possible sale, to a lead or a customer, moving
  through **stages** until it is **Won** or **Lost**;
- an **activity** is a call, meeting, email, visit or task with a due date.

Choose the company at the top. The screen has the tabs **Leads**,
**Opportunities**, **Activities**, **Reports** and, for a CRM Manager,
**Setup**.

## Step by step

1. A CRM Manager checks **Setup** once: the stages, lost reasons, lead
   sources and activity types.
2. In **Leads**, add the lead with **New Lead**.
3. From the lead, add an opportunity (**New Opportunity**) and the next
   call or visit (**New Activity**).
4. Move the opportunity along the stages on the **Board** as it advances.
5. When it buys: **Won** on the opportunity, and **Convert to Customer** on
   the lead. When it does not: **Lost**, with the reason.

## Who sees what

Each lead, opportunity and activity has an **owner**. You see the ones you
own. A **CRM Manager** (a right given in Roles) sees every record of their
companies, can give a record to someone else (change its **Owner**) and
changes **Setup**. Sales reps can own records too: they keep their own
leads, opportunities and activities from their phone (see
[Sales reps in the Employee Portal](sales-rep-portal.html#leads-pipeline-activities-and-quotes)).
A rep's records are the rep's; the CRM Manager sees and reassigns them here.

## Leads

1. Select **New Lead**, and fill in the organisation or the contact's
   name, and a phone or an email.
2. Choose where the lead came from (**Source**) and select **Save**.

If the phone, email or name matches another lead or an existing customer,
the screen says which, so you do not enter the same business twice. You
can still save it.

From a lead:

- **New Opportunity**, **New Activity** and **New Quotation** start one for
  this lead.
- **Disqualify** closes a lead that will not buy; say why.
- **Convert to Customer** makes it a customer when it buys. The customer
  form is filled from the lead; choose the **Classification** and the
  **Trade Receivables account** (as in Customer Master, with the same
  rules) and select **Save customer and convert**. The lead's open
  opportunities, activities and quotations move to the new customer.

## Opportunities

An opportunity is for a lead or a customer, with its **Expected value**
and **Expected close** date. It starts at the first stage.

- **Board** shows a column per stage with the number of opportunities and
  their value. Drag a card to another column to move it to that stage.
- **List** shows them as a table.
- The line above shows the **total** and the **weighted** value (each
  value times its stage's win probability).
- **New Quotation** makes a [quotation](quotation.html) for it.
- **Won** closes it as won. **Lost** asks why, from the list of reasons.
  A won or lost opportunity cannot be changed.

## Activities

An activity is about a lead, an opportunity or a customer, with a type, a
subject and a due date (and a time if you like).

- Activities due today, or overdue, appear in your **Home** tasks; overdue
  ones in amber. Select one to open it.
- **Done** asks what came of it, and offers to schedule the next one
  (a week later, by default).
- **Cancel Activity** closes one that will not happen.

## Reports

**Reports** shows four reports for the company. Choose the period with
**From** and **To** (the start of the year to today, at first) and select
**Show**.

- **Pipeline:** the opportunities open today, by stage, by owner and by
  expected close month, each with its total and weighted value, and the
  list of the open opportunities. The period does not apply.
- **Win / loss:** the opportunities won or lost in the period, by month and
  by owner, with the **win rate** (won out of won and lost), and the lost
  ones by reason.
- **Activities:** by owner and type, those done in the period, those open
  and, of those, the overdue ones.
- **Lead sources:** the leads created in the period, by source, how many
  became customers (**Conversion**), and the value of their won
  opportunities.

Values are in the **base currency** (Currency Configuration's default), at
the latest rate in Currency Configuration → Rates. Each opportunity in the
list also shows its own currency and value. A currency with no rate is
named above the reports; its values show in their own currency and are
left out of the totals until a rate is entered.

You see the reports for the records you own. A CRM Manager sees every
owner's, and can choose one with **Owner**. **Copy to Excel** on each
report copies it, with its headings, to paste into a spreadsheet.

Example: an open opportunity of USD 100 at Proposal (50 %), with a rate of
3.6725, counts as AED 367.25 in the pipeline and AED 183.63 weighted.

## Importing leads

Many leads at once (from a trade fair list, say) go in through
[Master Data Import](master-import.html#special-cases): choose **CRM Leads**.
Each row is checked as **New Lead** checks it, and a row that matches a
lead or a customer is left out unless you tick **Import matches too**.

## Setup

A CRM Manager sets, for each company:

- the **stages**, in order, each with its win probability (**Won** and
  **Lost** always follow);
- the **lost reasons**, **lead sources** and **activity types**;
- how many days a **quotation** stays valid (see [Quotations](quotation.html)).

Until Setup is saved, the defaults apply: New 10 %, Qualified 25 %,
Proposal 50 %, Negotiation 75 %.

## Common messages

- **"That lead is not yours."** Someone else owns it; ask a CRM Manager.
- **"Only a CRM Manager can give a record to someone else."** You can only
  own new records yourself.
- **"Choose why it was lost."** Pick a reason from the list.
