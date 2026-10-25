# Stop salary: holding an employee's salary (UX round 2, item 29)

**Status:** built 2026-10-25 (design agreed by the owner, decisions Q279, Q299–Q300) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 4 · **Builds on:**
[HR_PAYROLL.md](HR_PAYROLL.md) (payment, step 4; final settlement, step 5b)

## Agreed design (owner, 2026-10-25, Q279, Q299, Q300)

- **A hold on the employee** (Employees → the employee → Pay, "Hold
  salary"): from a payroll month, until a month or open-ended, a reason;
  placed and released by users with Payroll's **post** right, no approval;
  every hold and release in the employee's history.
- **The run computes the salary as usual**, and a held employee's payslip
  gets a **Stop Salary** deduction equal to the net, so the net is zero.
  The payslip is otherwise normal, and the employee sees it in the portal.
- **Posting:** the Stop Salary deduction is credited to **Salary held** (a
  new Payroll Setup → Payroll Accounting account, required once a hold
  exists), not to Salaries Payable; so the expense is in the month and
  the money owed sits on Salary held.
- **Payment:** nothing to pay for that employee (net zero); the bank file
  leaves them out as any zero net.
- **Release:** the total held for the employee is added to **the next
  payroll run** as a **Salary released** earning, debited to Salary held
  at that run's posting, and paid with that run.
- **Final settlement:** a held amount not yet released is added to the
  settlement (as Salary released), so a leaver is never left with money on
  Salary held.
- **Report:** Salary held per employee (months held, amount, reason,
  released in which run).

## The owner's decisions (2026-10-25)

| # | Decision |
|---|---|
| Q299 | Users with Payroll's **post** right place and release a hold, with a reason; no approval. |
| Q300 | **The payslip is normal, with a "Stop Salary" deduction** that brings the net to zero; the amount goes to a **Salary held** account (a new Payroll Setup → Payroll Accounting account). The employee sees that payslip in the portal. |
| (release) | **On release, the held amount is added to the next payroll run** as an earning ("Salary released"), taken back from Salary held, and paid with that run. |

## The questions as asked

| # | Question | Recommendation |
|---|---|---|
| Q299 | Who may place and release a hold, and must it be approved? | Users with Payroll's **post** right; no approval step (the hold delays a payment, it books nothing). Each hold and release is in the employee's history. |
| Q300 | Does the employee see it in the Employee Portal? **(a)** The payslip shows "Payment on hold", with no reason. **(b)** It shows nothing until paid. | **(a)**: the employee knows why the money hasn't arrived; HR gives the reason in person. |

## Build plan (after the answers)

1. Server: holds on the employee (place / release, history); the Stop
   Salary deduction and the Salary released earning in the run; the
   posting to Salary held; the settlement; the report.
2. Screens: Employees (Hold / Release), Payroll Setup's Salary held
   account, the payslip lines, the report.
3. Tests, negative controls, Help, What's new.

## As built (2026-10-25)

- **Holds:** functions/src/salaryHold.js, Firestore `salaryHolds`
  (EmployeeID, CompanyID, FromMonth, UntilMonth, Reason, Status Active /
  Released, ReleasedFromMonth, ReleaseNote, who and when). Callables
  `getSalaryHolds` (a company's holds, each with what is held now, the
  employees for the picker, the first month without a posted run),
  `placeSalaryHold`, `releaseSalaryHold`, all needing Payroll's **post**
  right (Q299). A hold starts, and a release takes effect, only in a month
  after the latest posted run. Two holds may not overlap. A hold is refused
  until the company has a Salary held account. Each hold and release goes
  into `employeeHistory`.
- **What is held is never stored:** it is the Stop Salary lines of the
  posted runs less the Salary released lines (`heldFrom`), so a reversed
  run gives its amount back by itself.
- **The run** (payrollRun.js → payrollCalc.computeEmployee): in a held
  month, a **Stop Salary** deduction (STOPSAL, Source `Hold`) equal to the
  net, after loan recovery (a negative net is not held). Its text is
  "salary held from yyyy-mm", with no reason (the reason is a warning in the
  run, for HR). Not held but with something still held: a **Salary
  released** earning (SALREL, Source `HoldRelease`) for all of it, after the
  loans, so a loan instalment never takes it.
- **Posting** (payrollPost.js): both lines go to the company's **Salary
  held** account (Payroll Setup → Payroll Accounting, `HeldAccountID`, a
  liability that is not Salaries Payable). Credited when held, debited when
  released. A save from a screen that doesn't send the field keeps it.
- **Final settlement** (payrollSettlement.js): what is still held is a
  **Salary released** line (Key `HeldSalary`), debited to Salary held.
- **Screens:** Payroll → **Salary holds** tab (for the company chosen in the
  filter): each hold with what is held now, the form to hold, Release
  (asking the month and a note in the app's dialogs). This is on Payroll
  rather than the employee record because the right is Payroll's. Payroll
  Setup: a Salary held column.
- **Data Reset:** `salaryHolds` goes with Payroll Runs & Payslips.
- **Tests:** salaryHold emulator suite (2): the rules for placing a hold;
  two held months posted to Salary held; release, then paid in the next run
  from Salary held; a leaver's settlement. payrollCalc unit (one more):
  Stop Salary after the loans, a negative net, the release out of the
  loans' reach. salaryHold UI (3). payrollSetup suites updated for the new
  field. **Negative controls**, each caught then restored: posting without
  the Salary held rule (the run can't post), the release not taken off what
  is held (the amount never drops to 0), the screen showing 0 held.
