# A leaver's clearance, step by step (UX round 2, item 28)

**Status:** built 2026-10-25 (design agreed by the owner, decisions Q278, Q301–Q304) · **Roadmap:** [#19](../ROADMAP.md) ·
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

## Build notes (2026-10-25)

- **Its own module, Clearances** (`CLEARANCE`: access sees the company's
  clearances; manage signs off or reopens any step and starts one by hand;
  setup sets the steps). A step's team member needs only access and can
  sign their own step, so IT or Admin staff never need the Employees
  screen. Adding a module means its deploy is all functions (CLAUDE.md).
- **Switching it off:** a company with no set-up uses the default
  (Finance → IT → HR). One that saves an **empty** list of steps has no
  clearance, and its settlements don't wait.
- **Recovery amounts** post through a deduction pay element chosen in the
  set-up (its account, as any settlement deduction). An amount can't be
  entered until it is chosen.
- A clearance starts when it is first needed (the list, Home, the portal,
  the settlement) for an employee on notice or left, whose final settlement
  is not yet posted. So leavers from before the deploy who are still to be
  settled get one, and long-settled leavers don't.

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

## As built (2026-10-25)

- **Module** `CLEARANCE` (Clearances; access ADMIN, FINANCE_MGR; manage and
  setup ADMIN by default), a later module (off for client groups until
  provided). Menu seed under HR. Screen `screens/CLEARANCE.html`: the list
  per company (open only, waiting for my team), one clearance (its steps,
  checklist, notes, amount to recover, Save, Sign off, Reopen, the history)
  and the set-up.
- **Server** functions/src/clearance.js: `getClearanceSetup`,
  `saveClearanceSetup`, `getClearances`, `getClearance`, `saveClearanceStep`,
  `signClearanceStep`, `reopenClearanceStep`, `getClearanceTasksForUser`.
  Firestore `clearanceSetup/{company}` (Mode, Steps [{StepID, Name,
  TeamUserIDs, Checklist}], RecoveryElementID) and `clearances/{employee}`
  (the steps copied at start, with Items, Notes, RecoverAmount, RecoverNote,
  SignedAt / By; Status Open, Complete or Cancelled; the history).
- **Started** when an employee is saved On notice or Left with a leaving
  date (hrEmployees.js), and whenever it is needed (the list, the portal,
  the settlement) for a leaver whose settlement is not posted. Active again:
  a clearance nobody signed goes; one with a signature is kept, Cancelled.
- **The rules:** in order, a step opens once the ones before are signed. A
  step's team (or manage) works on it, and a step with no team is
  manage's. An amount to recover needs a note and the set-up's deduction
  element. Reopening needs manage and a reason, and is refused once the
  settlement is posted.
- **The settlement** (payrollSettlement.js): `submitSettlement` refuses
  until the clearance is complete ("Complete … clearance first
  (Clearances): still open: …"). Each amount to recover is a deduction
  line, Key `Clearance:<step>`, through the element, that HR may override
  with a reason as any line.
- **Home:** "Clearances Waiting for You" (the shell). **Portal:** essPortal
  `myClearance`, and on Home the leaver's card "Your clearance before
  leaving", each step's state and its unticked items, never the notes, the
  team or the amounts.
- **Data Reset:** `clearances` is its own category (Transactions);
  `clearanceSetup` goes with HR Setup.
- **Tests:** clearance emulator suite (3): the default steps, the start on
  notice, the order, the team and manage, the amount and its element, Home,
  the portal's view; the settlement's wait and deduction, reopening, the
  list, active again; all at once and an empty set-up. home UI (one more: Home's block, counted and opened); clearance UI (3):
  the list and signing a step, the set-up, the portal card. The settlement
  suites (payrollSettlement, payrollInterim, eosStatement, emulator and UI)
  set an empty set-up, being about the settlement itself. **Negative
  controls**, each caught then restored: the settlement not waiting, the
  steps not kept in order, the portal card without what is open.
