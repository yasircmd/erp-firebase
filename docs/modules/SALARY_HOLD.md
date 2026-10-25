# Stop salary: holding an employee's salary (UX round 2, item 29)

**Status:** design agreed (owner, 2026-10-25, decisions Q299–Q300) · **Roadmap:** [#19](../ROADMAP.md) ·
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
