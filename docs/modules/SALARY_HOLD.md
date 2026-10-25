# Stop salary: holding an employee's salary (UX round 2, item 29)

**Status:** proposed, questions Q299–Q300 open · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 4 · **Builds on:**
[HR_PAYROLL.md](HR_PAYROLL.md) (payment, step 4; final settlement, step 5b)

## Decided (owner, 2026-10-25, Q279)

**Computed, payment held.** The run computes a held employee's salary as
usual, so the expense and Salaries Payable are booked in the month. Only
the **payment** leaves them out until the hold is released.

## Proposed

- **A hold on the employee** (Employees → the employee → Pay, "Hold
  salary"):
  - from a payroll month, until a month or open-ended;
  - a reason (required);
  - who placed it and when.
  - **Release** ends it (with a note). The history keeps every hold.
- **The run:** computed as always. The payslip and the run's list show
  **Payment held** on that employee.
- **Payment** (Payroll → pay):
  - A held employee is left out of the bank file and out of Mark paid.
  - They are listed apart as "Held: <reason>", with their net.
  - The run shows "Paid, except held (1)" rather than Paid.
  - The run's existing part payments already allow this (each payment
    names its employees).
- **On release:**
  - The held salaries stay owed on Salaries Payable, run by run.
  - Each run with a held line shows them as due again, and they are paid
    from that run's payment screen as any part payment.
  - Home shows the Payroll role "Held salaries released, waiting to be paid".
- **Final settlement:** a hold also holds the settlement's payment (Q300).
- **Reports:** a "Held salaries" list per company (employee, months,
  amount owed, reason).

## Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q299 | Who may place and release a hold, and must it be approved? | Users with Payroll's **post** right; no approval step (the hold delays a payment, it books nothing). Each hold and release is in the employee's history. |
| Q300 | Does the employee see it in the Employee Portal? **(a)** The payslip shows "Payment on hold", with no reason. **(b)** It shows nothing until paid. | **(a)**: the employee knows why the money hasn't arrived; HR gives the reason in person. |

## Build plan (after the answers)

1. Server: holds on the employee (place / release, history); the payment
   and the bank file leaving held lines out; the run's "except held" state;
   the settlement's payment; the list.
2. Screens: Employees (Hold / Release), Payroll's payment (the held list),
   the payslip mark, the portal (per Q300).
3. Tests, negative controls, Help, What's new.
