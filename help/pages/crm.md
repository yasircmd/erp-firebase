---
fingerprint: 0b932a5e877f5bc6
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
**Opportunities**, **Activities** and, for a CRM Manager, **Setup**.

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
changes **Setup**. Sales reps can own records too.

## Leads

1. Select **New Lead**, and fill in the organisation or the contact's
   name, and a phone or an email.
2. Choose where the lead came from (**Source**) and select **Save**.

If the phone, email or name matches another lead or an existing customer,
the screen says which, so you do not enter the same business twice. You
can still save it.

From a lead:

- **New Opportunity** and **New Activity** start one for this lead.
- **Disqualify** closes a lead that will not buy; say why.
- **Convert to Customer** makes it a customer when it buys. The customer
  form is filled from the lead; choose the **Classification** and the
  **Trade Receivables account** (as in Customer Master, with the same
  rules) and select **Save customer and convert**. The lead's open
  opportunities and activities move to the new customer.

## Opportunities

An opportunity is for a lead or a customer, with its **Expected value**
and **Expected close** date. It starts at the first stage.

- **Board** shows a column per stage with the number of opportunities and
  their value. Drag a card to another column to move it to that stage.
- **List** shows them as a table.
- The line above shows the **total** and the **weighted** value (each
  value times its stage's win probability).
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

## Setup

A CRM Manager sets, for each company:

- the **stages**, in order, each with its win probability (**Won** and
  **Lost** always follow);
- the **lost reasons**, **lead sources** and **activity types**;
- how many days a **quotation** stays valid (used by Quotations, coming
  next).

Until Setup is saved, the defaults apply: New 10 %, Qualified 25 %,
Proposal 50 %, Negotiation 75 %.

## Common messages

- **"That lead is not yours."** Someone else owns it; ask a CRM Manager.
- **"Only a CRM Manager can give a record to someone else."** You can only
  own new records yourself.
- **"Choose why it was lost."** Pick a reason from the list.
