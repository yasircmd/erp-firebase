# A leaver's clearance, step by step (UX round 2, item 28)

**Status:** design agreed (owner, 2026-10-25, decisions Q301–Q304) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 4 · **Builds on:**
[HR_EMPLOYEES.md](HR_EMPLOYEES.md) (leaving), [HR_PAYROLL.md](HR_PAYROLL.md) (final settlement, step 5b)

## Decided (owner, 2026-10-25, Q278)

**Steps are set up per company, with a default set** (Finance → IT → HR).

## Proposed

- **Set-up** (HR Setup → Clearance), per company:
  - an ordered list of steps;
  - each step has a name, a team (ERP users, as the Employee Requests
    handlers) and a checklist (e.g. IT: laptop, phone, access card, email
    closed; Finance: loans, advances, petty cash, credit card).
  - A company with nothing set uses the default: Finance → IT → HR, with a
    short checklist each.
- **It starts** when the employee goes on notice or a leaving date is set:
  a clearance for that employee, with the company's steps as they are that
  day.
- **Each step:**
  - Its team gets a Home task "Clearance: <employee>, <step>".
  - They tick the checklist, write notes, and may enter an amount to
    recover (e.g. a laptop not returned).
  - **Sign off** completes the step. A step can also be reopened with a
    reason, before the settlement is posted.
- **The journey:** the clearance shows each step, who signed it and when,
  and what is outstanding, on the employee and in a Clearances list
  (open, done; per company).
- **The settlement waits** for the last step (Q303).

## The owner's decisions (2026-10-25)

| # | Decision |
|---|---|
| Q301 | **Both, chosen in the set-up**: per company, the steps run in order or all at once. |
| Q302 | An amount to recover becomes a **deduction line** on the final settlement (naming the step and its note); HR can change it there, with a reason. |
| Q303 | **Submitting the settlement** waits for the clearance; drafting does not. |
| Q304 | The leaver sees their clearance in the Employee Portal, **read only** (each step's state and what is outstanding, no notes). |

## The questions as asked

| # | Question | Recommendation |
|---|---|---|
| Q301 | Do the steps go strictly in order (IT opens only after Finance signs), or all at once with the settlement waiting for every one? | **In order**, as the owner's "journey" (each department sees what the one before found); a company that wants them together can set them up as one step. |
| Q302 | An amount to recover entered by a step (a laptop not returned): added to the final settlement's deductions by itself? | **Yes**, as a deduction line naming the step and its note; HR can still change it in the settlement, with a reason. |
| Q303 | What waits for the clearance: **(a)** submitting the settlement for approval, or **(b)** paying it? | **(a)**: the settlement is drafted at any time (to see the figures), but goes for approval only once the clearance is complete, so the approvers see the final deductions. |
| Q304 | Does the leaver see their clearance in the Employee Portal (each step's state, no notes)? | **Yes**, read only: they see what is still outstanding (e.g. "IT: laptop not returned"). |

## Build plan (after the answers)

1. Server: set-up per company with the default; a clearance started from
   the leaving date; sign off / reopen; Home tasks; the settlement's
   check (and deduction lines, per Q302).
2. Screens: HR Setup → Clearance; the clearance on the employee and the
   Clearances list; the settlement's notice; the portal (per Q304).
3. Tests, negative controls, Help, What's new.
