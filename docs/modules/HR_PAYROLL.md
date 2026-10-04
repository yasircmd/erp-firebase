# HR: Payroll

Status: **design agreed** (the owner's decisions 2026-10-04, below); **step 0 built and tested** (see As built); step 1 next.

It builds on Employee Records (docs/modules/HR_EMPLOYEES.md) and the
Attendance and Leave Register (docs/modules/HR_LEAVE.md), and is the last
HR module planned.

## The request (owner, 2026-10-04)

1. **Daily rate, per company, one of three methods:**
   - monthly ÷ 30;
   - monthly ÷ the month's actual days (28, 29, 30 or 31);
   - monthly × 12 ÷ 365 (366 in a leap year).
2. **GL:**
   - each pay element is linked to a GL account;
   - the cost center comes from the employee;
   - GL lines are clubbed as for inventory (one line per account, cost
     center, profit center and description; docs/modules/LINE_CLUBBING.md).
3. **Overtime:**
   - either a fixed amount;
   - or worked out from hours, with the calculation configurable: e.g.
     basic ÷ days in the month ÷ 8 hours, × a weightage such as 1.5 or 2.
4. **Work schedules:** the weekend isn't the same for everyone.
   - Some employees work six days.
   - The weekend can be any day.

   The working calendar must allow this.

## What exists today (from the code)

- **Employees:**
  - company, grade, cost center (the department), division and branch,
    join and leaving dates, status;
  - bank name and IBAN (sensitive).
- **Pay elements:** code, name, earning or deduction, fixed (monthly) or
  variable, one of them the Basic. **They have no GL accounts yet.**
- **Compensation:**
  - effective-dated monthly amounts per fixed element;
  - agreed bonus and commission terms;
  - changes through approved Employee Changes.
- **Leave:**
  - each locked month's summary per employee: paid leave by how it is
    paid (full, basic only, selected elements, at a %), and unpaid,
    absent and duty days;
  - adjustments from earlier locked months;
  - every day line, with its pay month.
- **Working calendar:** one weekend per **company**, plus public holidays.
- **GL:**
  - every system posting goes through `buildStockGlEntry`, which clubs
    lines;
  - accounts are per company or shared;
  - lines carry a cost center and a profit center;
  - the approval engine and Home tasks are reusable.

## Proposed design

### 1. Work schedules (owner point 4), before Payroll

- **Work Schedules**, a new tab in HR Setup. Each schedule has:
  - a name;
  - the weekend days (any days, e.g. Friday only for a six-day week);
  - the hours in a working day (8 to start; overtime uses them).
- **Each company has a default schedule.** Today's company weekend
  becomes it.
- **An employee can be given another schedule** on the record, through an
  Employee Change. Public holidays stay per company.
- **Everything that counts working days uses the employee's schedule:**
  - leave days;
  - late-return absences;
  - the "working days" daily-rate base, if chosen;
  - overtime's hours per day.

  This changes the Leave Register (step 0 below). Leave already saved
  keeps its days.

### 2. Payroll setup

- **Per company:**
  - **the daily-rate method** (owner point 1): ÷ 30, ÷ the month's days,
    or × 12 ÷ 365/366;
  - the **Salaries Payable** account;
  - the payroll approval (Approval Configuration).
- **Per pay element:**
  - **the GL account** (owner point 2): an expense for earnings, a
    liability or receivable for deductions (e.g. loan recovery,
    pension);
  - whether it is **prorated** for joiners, leavers and unpaid days
    (basic and allowances are; a fixed phone allowance may not be);
  - whether it counts in "**gross**" for leave pay and overtime.
- **Overtime elements** (owner point 3), as many as needed: Normal OT,
  Rest-day OT, Holiday OT, ... Each is either:
  - **Fixed amount**, entered per run;
  - **Hours** × a rate, where the rate is (the base: Basic, or the
    gross of ticked elements) ÷ (the days: by the company's daily-rate
    method, or a fixed number) ÷ (hours per day: from the employee's
    schedule, or fixed) × **the weightage** (e.g. 1.25, 1.5, 2).

  The screen shows the formula and an example.

### 3. The payroll run (per company and month)

- **Create:**
  - for a month whose leave is locked;
  - takes every employee in the company on payroll that month (joined
    by its end, not left before its start).
- **For each employee:**
  - **fixed earnings and deductions** from the compensation in force,
    prorated by the daily-rate method:
    - for days before joining or after leaving;
    - for unpaid and absent days (from the leave summary);
  - **paid leave:**
    - "basic only" days take out the other prorated elements for those
      days;
    - "at 50%" days take out half of the covered elements;
    - full days change nothing;
    - duty days are paid as working;
  - **adjustments** from earlier locked leave months (late entries,
    reversals), at that month's rate;
  - **inputs for the run:** overtime hours or amounts, bonus and
    commission amounts (against the agreed terms), and one-off additions
    or deductions, each with a reason. These are entered on screen or
    pasted from Excel;
  - **net** = earnings − deductions.
- **Review:**
  - a payroll register: one row per employee, with elements as columns;
  - each employee's payslip;
  - warnings: a negative net, no IBAN, a missing compensation, a band
    breach;
  - the run can be recalculated until it is submitted.
- **Approval:** Submit → Approval Configuration (the amount is the net
  total) → Approved.
- **Post:** one journal per run, through the same posting path as every
  other module, so **lines are clubbed**:
  - Dr each earning's expense account, **by the employee's cost center**
    (and profit center);
  - Cr each deduction's account;
  - Cr Salaries Payable (the net).
  - The leave month's summaries are marked "paid" by this run.
- **Payslips:** printable (PDF) per employee, or all; dates in dd/mm/yyyy.
- **Payment:**
  - **WPS SIF file** for the bank (UAE Wage Protection System), and/or
    a bank transfer list;
  - "mark paid" posts Dr Salaries Payable / Cr the bank (or a cheque or
    cash for those without bank accounts).
- **Reverse:** a posted, unpaid run can be reversed (the GL is reversed)
  and run again.

### 4. What the request leaves open (the missing parts)

1. **Back pay (arrears):** a pay change approved after its effective
   month was paid. The difference is paid in the next run.
2. **Salary advances and loans:** given once, recovered in instalments
   through a deduction element.
3. **End-of-service gratuity (UAE):**
   - a monthly provision (Dr expense / Cr provision, by cost center);
   - the settlement when an employee leaves: 21 days' basic per year
     for the first five years, 30 days after; unpaid days don't count.
4. **Leave salary provision:** the annual leave liability accrued
   monthly, at each employee's daily rate × days accrued.
5. **Final settlement:** for someone leaving, the last month's salary,
   gratuity, unused annual leave paid out, notice pay, less loans still
   owed.
6. **Negative net:** what happens when deductions exceed earnings.
7. **Rights and privacy:**
   - module `PAYROLL` (access, draft, post, pay);
   - amounts are seen only with the Employees "sensitive" right or by the
     run's approvers (as Employee Changes).
8. **Reports:**
   - the payroll register;
   - element totals;
   - cost by cost center;
   - the bank/WPS list;
   - gratuity and leave-salary liability.

### 5. Build order (each step tested and deployed on its own)

0. **Work schedules:** the HR Setup tab, a default per company,
   employees' schedules, and the Leave Register counting by them.
1. **Payroll setup:**
   - the daily-rate method per company;
   - element GL accounts, prorating and "in gross";
   - overtime elements and formulas;
   - the payable account.
2. **The payroll run:**
   - calculation from compensation, leave and inputs;
   - review, recalculation and payslips on screen.
3. **Approval, posting to GL (clubbed), payslip print, reversal.**
4. **Payment:** the WPS SIF and bank list, mark paid (GL), advances and
   loans.
5. **Gratuity and leave-salary provisions; final settlement.**

## Open questions for the owner

1. **Work schedules:** can an employee's schedule change over time
   (effective-dated), or is one current schedule enough?
2. **Daily rate:** one method per company for everything (unpaid days,
   joiners, leavers, leave pay, overtime), or may overtime use its own
   divisor?
3. **Overtime hours:** entered by HR per run (with paste from Excel), or
   also from a timesheet?
4. **GL accounts:** one mapping for the group (using shared accounts), or
   each company maps its own accounts?
5. **Profit center on payroll lines:** from the employee's cost center's
   default, from their division or branch, or none?
6. **Payment:** a WPS SIF file needed (which bank / agent), a bank
   transfer list, or both?
7. **Advances and loans:** in this module now (step 4), or later?
8. **Gratuity and leave-salary provisions:** posted monthly, or only
   worked out at settlement?
9. **Negative net:** carry the excess deduction to the next month, or
   block the run until fixed?
10. **Back pay:** worked out automatically in the next run, or entered by
    hand as a one-off?
11. **Payroll approval:** through Approval Configuration (the amount is
    the net total), as other documents?

## The owner's decisions (2026-10-04)

| # | Question | Decision |
|---|---|---|
| 1 | Work schedules | **Effective-dated:** a schedule change has a from-date (through an Employee Change). Past leave and payroll keep the old weekend; later ones use the new. |
| 2 | Daily rate | **One method per company; overtime may override:** the company's method (÷30, ÷ month days, ×12÷365/366) is used for unpaid days, joiners and leavers, and leave pay. An overtime element may use a fixed divisor instead. |
| 3 | GL mapping | **One mapping for the group; a company may override:** each element maps once (e.g. to a shared account), and a company with its own accounts sets those that differ. |
| 4 | Profit center | **None:** payroll lines carry the employee's cost center only. |
| 5 | Overtime input | **HR enters it per run, or pastes it from Excel** (employee no., overtime type, hours or amount). There is no daily timesheet. |
| 6 | Payment | **The WPS SIF file and a bank list;** then "mark paid" posts the payment. |
| 7 | Advances and loans | **In Payroll now (step 4):** amount, instalment, start month, GL account. Each run deducts the instalment until it is repaid, and the balance shows on the employee. |
| 8 | Provisions | **Monthly:** each posted run also posts the month's gratuity and leave-salary provisions (by cost center), and settlement uses them. |
| 9 | Negative net | **The excess carries to the next month:** net is paid as 0, the uncovered deduction carries to the next run, and a warning is shown. |
| 10 | Back pay | **Automatic in the next run:** the difference for months already paid, by element, is paid as "Arrears", shown separately on the payslip. |
| 11 | Approval | **Through Approval Configuration:** the amount is the run's net total, and approvers see the register. |

**What changes in the design:** the build order stays as proposed. Step 5
(provisions and final settlement) posts provisions with each run from the
start, so step 3's posting is built to add them in step 5 without
changing the run.

## As built: step 0, work schedules (2026-10-04)

**HR Setup → Work Schedules** (new tab), for employees whose weekend or
hours differ from their company's:
- each schedule has a name, the weekend days (up to three, any days) and
  the hours in a working day (1–24, in quarter hours);
- names are unique;
- once employees work a schedule its weekend can't change (leave already
  counted by it). Add a new schedule and move them to it from a date. Its
  hours can change.

**The company's own schedule** is its Working Calendar:
- the weekend, as before;
- **hours in a working day**, new, 8 to start.

Holidays stay per company.

**An employee's schedule** (`ScheduleID`; empty means the company's):
- **set on the record** when the employee is created, or in the
  Employees import ("Work Schedule" column, by name);
- after creation, like the grade, it changes only through:
  - **an Employee Change (Transfer):** a Transfer may now change only
    the work schedule, from its effective date;
  - **Correct** (HR Setup admins, with a reason): this fixes the schedule
    in force now.
- **kept by date** on the record (`Schedules`: from-date and schedule).
  - The record shows them ("from 01/01/2025: Six-day · from 01/04/2026:
    Company working calendar").
  - A Transfer's new schedule counts from its effective date as soon as
    it is approved, so leave booked ahead is counted by it.

**Leave counts by it** (decision 1):
- working days in a leave, its first and last day, and a late return's
  absent days all use the weekend of the schedule **in force on each
  day**, with the company's holidays;
- a leave across a schedule change counts each side by its own weekend;
- leave already saved keeps its days.

**Who is away** (Leave Reports) shades each employee's own days off.

**Behind it:**
- `hrSetup.js`: `saveHrWorkSchedule`, and the schedules in the setup.
- `hrEmployees.js`: the field and its dated list.
- `hrChanges.js`: Transfer.
- `hrLeaveSetup.calendarFor(employee)`, and `workCalendar.weekendOn`.
- `masterImport.js`: the column.

**Tests:**
- The `hrSchedules` suite (4) and `hrSchedules.ui.js` (3).
- Nine negative controls (see the PR).
- The browser-dialog guard also caught a quote in Leave Reports' note.
- The regression found a race on the Employees record, from Employee
  Records step 2 onwards: the Leave card, pay and documents wrote to the
  screen after the user had already moved on (e.g. to Employee Change),
  which raised an error in the browser. Each now checks that the screen is
  still open.

**To go live:**
1. Deploy "functions set" `payroll-0`, with the screens.
2. In HR Setup → Work Schedules, add schedules for those who differ, and
   give them to the staff concerned (Employee Change, Transfer, from a
   date).

**Next:** step 1, payroll setup.

