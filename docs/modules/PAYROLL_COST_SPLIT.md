# Payroll: a cost centre for one run, and one employee's cost split by % (UX Tier 3, I)

Status: **design agreed** (owner, 2026-10-16: the recommendations, questions 173–178; UX_TIER3.md round 15).
From the UX testing of 2026-10-14 (docs/modules/UX_TIER3.md, wave 2, I).

## Today

- Each payslip takes the employee record's **one** cost centre (the
  department, HR_EMPLOYEES.md decision 3) when the run is calculated. It
  changes only through an approved Employee Change, a transfer (decisions
  9–10).
- A run posts one entry (payrollPost.js). Every line on an expense,
  revenue or cost-of-sales account (earnings, deductions, the monthly
  gratuity, leave salary and accrual provisions) carries the slip's cost
  centre. Balance-sheet lines (net pay to Salaries Payable, loans, the
  provisions' credit side) carry none. Lines are combined by account, cost
  centre and element.
- The final settlement and one-off payroll inputs follow the same rule.
- HR_PAYROLL.md decision 4: the lines carry the employee's cost centre
  only, with no profit centre.

**Found while checking (a bug, fixed with this item):** the printed payslip
shows the employee's *current* cost centre, not the slip's. After a
transfer, an old payslip shows a cost centre it didn't post to. It should
print the slip's own.

## Proposal

### 1. A different cost centre for one run

On a **draft** run, Payroll lists each employee's cost centre and lets it be
changed for **this run only**, with a reason. The employee record stays as
it is. The change is kept when the run is recalculated (today a
recalculation re-reads the employee). It shows on the payslip, in the run's
GL impact and in the log.

For a permanent change, the transfer (Employee Change) is still the way.

### 2. One employee's cost split across cost centres by %

The employee record gets an optional **cost split**: cost centres with %,
adding up to 100%. Like the cost centre itself, it is set or changed
through an approved Employee Change. Each expense line of the employee's
payslip is then shared across the split; a rounding remainder goes to the
largest share, so the lines still add up to the cent. Balance-sheet lines
stay single. The payslip shows the split under the cost centre. A
one-run split can also be entered on a draft run, as in 1.

The employee's **main** cost centre (the first, or the largest share) stays
the one that decides approvals and the reports that group employees by
department.

## Questions for the owner

- **173.** Who may change a cost centre for one run: whoever may draft the
  payroll run (recommended), or only HR / a separate right?
- **174.** A split by %: on the employee record (applies every month until
  changed; recommended), per run only, or both?
- **175.** Should the split also apply to the **final settlement** (gratuity,
  leave salary, notice pay) and to the provisions' expense? Recommended:
  yes, to every expense line of the employee, so the cost lands where the
  salary does.
- **176.** The split changes the employee's cost, through an Employee
  Change with approval, as a transfer does? Recommended: yes (HR_EMPLOYEES
  decision 10), so it is reviewed and dated.
- **177.** The department for approvals and reports, with a split: the
  employee's **main** cost centre (the one chosen as main, recommended), or
  the largest share?
- **178.** This changes HR_PAYROLL.md decision 4 ("the employee's cost
  centre only"). Agreed, still with **no profit centre** on payroll lines?

## The owner's decisions (2026-10-16)

The recommendations, 173–178: whoever may draft the run changes a cost
centre for one run (with a reason); the split is on the employee record,
through an approved Employee Change, and applies to every expense line
(salary, provisions, final settlement); approvals and reports use the
chosen **main** cost centre; HR_PAYROLL.md decision 4 changes accordingly,
still with no profit centre. The payslip prints the slip's own cost centre
(the bug found).
