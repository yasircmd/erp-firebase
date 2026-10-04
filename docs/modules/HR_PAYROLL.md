# HR: Payroll

Status: **design agreed** (the owner's decisions 2026-10-04, below); **steps 0 to 4 built and tested** (see As built); step 4b (advances and loans) next.

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

**Next:** step 1, payroll setup (built, below).

## As built: step 1, payroll setup (2026-10-04)

**HR Setup → Payroll** (new tab). Users with HR Setup access see it;
the "write" right changes it, for their own companies.

**Per company** (`payrollSettings/{companyId}`):
- **the daily rate** (owner point 1), one of:
  - monthly ÷ 30 (the default);
  - monthly ÷ the month's days (28–31);
  - monthly × 12 ÷ the year's days (365, or 366 in a leap year).

  The row shows a worked example for 5,000 this month (e.g.
  "5,000.00 ÷ 28 = 178.57").
- **Salaries Payable:** an active, postable liability, shared or the
  company's own.
- The payroll approval is set in Approval Configuration when the run is
  built (step 3).

**Per pay element** (stored on the element, `hrPayElements`):
- **its GL account** (owner point 2, decision 3):
  - the group's account: a shared one (no company);
  - a company may use its own account instead (shared or its own);
  - earnings post to expense accounts; a deduction to any postable
    account (a liability, a receivable, ...);
  - the run posts by the employee's cost center, clubbed as inventory
    is (step 3).
- **prorated** (for joiners, leavers and unpaid days): fixed elements
  only. Fixed elements default to Yes; a fixed phone allowance, say, can
  be set to No.
- **in gross** (for leave pay at full salary and overtime on gross):
  earnings only. Fixed earnings default to Yes.
- Editing the element itself (Pay Elements tab) keeps these settings. If
  its kind or nature changes (only while no employee's pay holds it),
  the settings that may no longer fit go back to their defaults: overtime
  when it is no longer a variable earning, "prorated" when the nature
  changes, "in gross" on either change, and the GL accounts when the kind
  changes.

**Overtime elements** (owner point 3, decision 2): any variable earning
can be marked as overtime (Normal OT, Rest-day OT, Holiday OT, ...),
paid either:
- **as an amount**, entered per run; or
- **by hours**, at an hourly rate of:
  - the base: the basic, or the gross (the "in gross" elements);
  - ÷ the days: the company's daily-rate days, or a fixed number (1–31);
  - ÷ the hours a day: the employee's schedule (step 0), or fixed (1–24);
  - × the weightage (above 0, at most 10: 1.25, 1.5, 2, ...).

  The form shows a worked example as the fields change, e.g.
  "8,000.00 (gross) ÷ 30 days ÷ 8 hours × 2 = 66.67 an hour". The
  owner's example (basic ÷ month days ÷ 8 hours × 1.5) is: base Basic,
  days by the company (set to ÷ the month's days), hours fixed at 8,
  weightage 1.5.

Overtime isn't prorated and isn't in the gross.

**Behind it:**
- `payrollCalc.js` (no Firebase, shared with the run to come): the
  divisor, the daily rate, the overtime rate, the account for a company,
  and the example texts.
- `payrollSetup.js`: `getPayrollSetup`, `savePayrollCompany`,
  `savePayElementPayroll`, `previewPayrollFormula`.
- `hrPay.savePayElement` merges, so the payroll settings stay.

**Tests:**
- The `payrollSetup` suite (5) and `payrollSetup.ui.js` (4).
- Negative controls (see the PR).

**To go live:** deploy "functions set" `payroll-1`, with the screens.
Then, in HR Setup → Payroll, choose each company's daily rate and
Salaries Payable, and give each element its GL account. Nothing is
calculated or posted yet: the run is step 2.

**Next:** step 2, the payroll run.

## Step 2 design: the payroll run (proposed 2026-10-04)

**A run** is one per company and month (`payrollRuns`), started by a user
with the Payroll "draft" right (module `PAYROLL`: access, draft; post and
pay come in steps 3–4):
- only for a month whose leave is **locked** (Leave Register → Month
  close), and the run's leave is read from the lines paid in that month,
  so it matches the locked summary;
- it takes each employee of the company on payroll that month (joined by
  its end, not left before its start);
- it is a **draft** in step 2: calculate, enter inputs, recalculate,
  review, delete. Submitting, approval and posting are step 3.

**Each employee's pay**, by element, using the company's daily rate
(÷ 30, ÷ the month's days, or × 12 ÷ 365/366):
- **fixed elements** from the compensation in force; a pay change during
  the month counts each part of the month at its own amounts;
- **part months** (joining or leaving in the month): see question 12;
- **unpaid and absent days:** each prorated element less its daily rate
  × the days;
- **paid leave days**, by the leave pay rule on each day:
  - "Full salary" pays the "in gross" elements; the other prorated
    elements are taken out for those days;
  - "Basic only" pays the basic; the other prorated elements are taken
    out;
  - "Selected elements" pays those elements; the others are taken out;
  - "at x%" pays x% of what is covered;
  - duty days (business travel) are paid as working days;
- **adjustments from earlier months** (leave entered or changed after its
  month was locked): at the rate of the day's own month, with the
  compensation in force on that day;
- no element goes below zero.
- **Inputs for the run**, each against a variable element (question 15),
  entered on screen or pasted from Excel (employee no., element code,
  hours or amount, note):
  - overtime: hours × the element's hourly rate (step 1's formula, with
    the basic and gross in force at the month's end and the hours of the
    employee's schedule then), or an amount;
  - bonus and commission: amounts (the agreed terms are shown alongside);
  - other one-off additions and deductions.
- **Net** = earnings − deductions.

**Review:**
- the register: one row per employee, the elements as columns, totals;
- each employee's payslip on screen, each line with how it was worked
  out (e.g. "Housing 3,000.00 − 2 unpaid days × 100.00");
- warnings: no compensation, a negative net, no IBAN, the basic outside
  the grade's band, leave reopened since the run was calculated.

**Later steps, by design:** back pay (decision 10) and a negative net
carried forward (decision 9) compare with runs already posted, so they
come with posting in step 3; the PDF payslip is step 3 too.

### Open questions for step 2

12. **Part months (joiners and leavers):** with ÷ 30 or × 12 ÷ 365, a
    part month can be worked out two ways, which differ:
    - **deduct the days not employed** from the monthly amount (someone
      in post all month always gets exactly the monthly amount); or
    - **pay the days employed** × the daily rate.
13. **Leave and unpaid days on the payslip:** shown as a reduction of
    each element ("Housing 3,000.00 − 2 days = 2,800.00", and the GL
    expense is the reduced amount), or as separate deduction lines
    ("Unpaid leave −200.00")?
14. **Who sees the run's amounts:** anyone with Payroll access, or only
    those who also have the Employees "sensitive" right?
15. **One-off additions and deductions:** always against a pay element
    (so each has its GL account; e.g. add "Other earning" and "Other
    deduction" elements), or free text with one default account?

### The owner's decisions for step 2 (2026-10-04)

| # | Question | Decision |
|---|---|---|
| 12 | Part months | **Deduct the days not employed** from the monthly amount: someone in post all month always gets exactly the monthly amount. (A pay change during the month works the same way: the days at the old amounts are adjusted from the new.) |
| 13 | Leave on the payslip | **Separate deduction lines:** the elements show their monthly amounts, and the days are deducted on their own lines: "Unpaid leave", "Absence" and "Reduced-pay leave" (basic-only, selected-elements or part-% days). Each line is a system deduction element with its own GL account, set in HR Setup → Payroll. Adjustments from earlier months appear on the same lines (a refund is a negative deduction). |
| 14 | Who sees amounts | **Payroll access is enough.** |
| 15 | One-off additions and deductions | **Always against a pay element** (with a note), so each has its GL account. |

Part months and a pay change during the month still change the element
itself (a "not employed" deduction would read oddly): only leave and
absence are separate lines.

## As built: step 2, the payroll run (2026-10-04)

**Payroll** (new screen and module `PAYROLL`: access, draft). Payroll
access shows the runs and their amounts (decision 14); draft makes and
changes them; for the user's own companies.

**A run** is one per company and month (`payrollRuns/{company}_{month}`,
each employee's payslip in `slips`):
- it can be made only once the month's leave is locked;
- it takes every employee of the company on payroll in the month (joined
  by its end, not left before its start);
- in this step it stays a draft: inputs, recalculate, review, delete.

**Each employee's pay** (`payrollCalc.computeEmployee`), at the
company's daily rate (step 1):
- **fixed elements** at the amounts in force on the last day employed in
  the month;
- **part months** (decision 12): the days before joining or after
  leaving are deducted (e.g. 6,000 − 14 days × 200 = 3,200 for someone
  joining on 15 July at ÷ 30). Someone in post all month always gets the
  monthly amount;
- **a pay change during the month:** the days at the earlier amounts are
  adjusted from the new (e.g. "15 days at 5,000.00: − 500.00");
- elements not prorated (step 1) are paid in full;
- **leave** (decision 13), on three system deduction lines, each worked
  out from the prorated earnings in force on the day:
  - "Unpaid leave": unpaid days (and the unpaid part of a leave over its
    balance);
  - "Absence": absent days (absences and late returns);
  - "Reduced-pay leave": what a day's pay rule doesn't pay. "Full salary"
    pays the "in gross" elements, "Basic only" the basic, and "Selected
    elements" those elements, each at the rule's %;
  - duty days are paid as working days;
  - **adjustments from earlier months** (leave entered or cancelled after
    its month was locked) are worked out at that month's daily rate and
    the pay in force that day. A cancelled day is given back as a
    negative deduction;
  - this month's leave never takes more than the month's prorated pay;
- **inputs for the run** (decision 15), each against a variable pay
  element, typed or pasted from Excel (employee no., element code, hours
  or amount, note):
  - overtime by the hour at the element's rate. The basic and gross are
    those in force at the month's end, and the hours a day those of the
    employee's schedule. The rate is shown to the cent and the hours
    multiply that;
  - bonus, commission and one-offs as amounts;
- **net** = earnings − deductions.

**Warnings:**
- no pay in force;
- a negative net (carrying it forward, decision 9, comes with posting in
  step 3);
- no bank account / IBAN;
- the basic outside the grade's band;
- the leave reopened, or locked again, since the run was worked out. A
  run can't be recalculated while its month's leave is open.

**The screen:**
- the runs;
- a new run (company and month);
- the register: one row per employee, a column per element, totals, and
  Copy to Excel;
- each payslip, with how each line was worked out ("1 day × 300.00",
  "6,000.00 a month − 14 days before joining × 200.00");
- the agreed bonus and commission terms;
- the inputs grid, with Paste from Excel. Lines not on the run are
  reported.

**System deductions:**
- "Unpaid leave", "Absence" and "Reduced-pay leave" are pay elements
  marked System (codes UNPAIDLV, ABSENCE, REDUCEDLV);
- they're created on first use, and their codes are reserved;
- they show only in HR Setup → Payroll, to set their GL account;
- they're not in Pay Elements, compensation or the run's inputs.

**Behind it:**
- `payrollCalc.js`: `computeEmployee` (no Firebase).
- `payrollRun.js`: `getPayrollRuns`, `createPayrollRun`, `getPayrollRun`,
  `savePayrollInputs`, `recalculatePayrollRun`, `deletePayrollRun`.
- `hrPay.allElements` (with the system ones) and `elements` (without).
- `workCalendar.hoursOn`.

**Tests:**
- `payrollCalc.test.js`, unit (8);
- the `payrollRun` suite (6);
- `payrollRun.ui.js` (4);
- 19 negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-2`, with the screens.
2. Link a menu node to "Payroll", and check its row in Roles &
   Permissions (Admin: access and draft; Finance Manager: access).
3. In HR Setup → Payroll, give the three system deductions their GL
   account.

**Next:** step 3, approval, posting to the GL (clubbed, by cost center),
the PDF payslip, reversal; with it, back pay (decision 10) and a negative
net carried forward (decision 9).

## Step 3 design: approval, posting, payslips, reversal (proposed 2026-10-04)

**Approval** (decision 11):
- a draft run is submitted by a user with the Payroll "draft" right;
- it then goes through Approval Configuration (entry "Payroll"; the
  amount is the run's net total). Approvers open the run from Home and
  see the register;
- with no approval set up, a submitted run is approved at once;
- a rejected run goes back to draft, with the reason.

**Posting**, one journal per run, voucher type "Payroll" (prefix PAY),
through the same path as every module, so lines are **clubbed**:
- Dr each earning's account (the element's, or the company's
  override), **by the employee's cost center**;
- Cr each deduction's account. Fixed deductions, the leave deductions
  and the one-off deductions are credited by cost center when the
  account needs one, else as one line;
- Cr Salaries Payable: the run's net;
- an element with no GL account (or a company with no Salaries Payable)
  stops the posting, with the list to set in HR Setup → Payroll.

**Back pay** (decision 10): a pay change (or a Correction) effective in a
month already posted is paid automatically in the next run. Each posted
month from the change is worked out again with the pay now in force,
fixed elements and the leave deductions alike. The difference by element
is an "Arrears" line ("Basic: Jun-2026 +500.00"), shown apart on the
payslip, posted to the element's own account. Inputs (overtime, bonus)
are not reworked.

**A negative net** (decision 9): paid as 0. The shortfall is a
"Brought forward" deduction in the employee's next run. In the GL it sits
in a new company setting, "Recoverable from employees" (an asset
account), until recovered.

**The leave month** of a submitted or posted run can't be reopened.
Leave entered later is paid in the next open month as an adjustment, as
today.

**Payslips:** printed from the run, one employee or all, one per page,
through the browser's print (Save as PDF). They show the company, the
employee (no., name, designation, cost center, bank and IBAN with the
middle masked), the month, earnings, deductions, arrears, net and the
payment date. Dates are dd/mm/yyyy.

**Reversal** (the "post" right): a posted run that isn't paid can be
reversed. A mirror journal is posted, and any amounts carried forward are
taken back.

**Rights:** module PAYROLL gains "post": reverse a run (approval is by
Approval Configuration).

### Open questions for step 3

16. **When is an approved run posted to the GL?** Automatically on its
    final approval, or by a separate "Post" by a user with the post
    right?
17. **The journal's date:** the last day of the payroll month, or the
    day it is posted?
18. **After a reversal:** the run goes back to draft (correct it and
    submit again), or it stays "Reversed" and a new run is made for the
    month?
19. **Payslip content:** the month only, or also each employee's leave
    balances and the year-to-date totals?

### The owner's decisions for step 3 (2026-10-04)

| # | Question | Decision |
|---|---|---|
| 16 | When an approved run posts | **Automatically on its final approval** (or on submitting, when no approval is set up). |
| 17 | The journal's date | **The last day of the payroll month.** |
| 18 | After a reversal | **The run goes back to draft**, with its inputs: correct, recalculate, submit again. |
| 19 | Payslip content | **The month, plus each leave balance at the month's end and the year-to-date totals** from the posted runs. |

So "post" (the new Payroll right) is needed only to reverse. Only the
company's latest posted run can be reversed, since a later run may have
recovered amounts this one carried forward.

## As built: step 3, approval, posting, payslips, reversal (2026-10-04)

**Submit** (Payroll "draft"):
- the run's leave must still be as calculated; recalculate first if it
  changed;
- every GL account is checked first. A missing one (an element, a
  system deduction, Salaries Payable, or Recoverable from employees when
  needed) is listed, to set in HR Setup → Payroll;
- the run then goes through Approval Configuration → "Payroll run (the
  amount is the net pay)" (decision 11). It shows on the approvers' Home
  and opens the run;
- an approver can reject it, with a reason. It goes back to draft and
  shows the reason;
- **the final approval posts it at once** (decision 16). With no approval
  set up, submitting does. The approver posts on behalf of the
  submitter, if the approver doesn't have the company;
- if posting fails at that point (e.g. an account was removed after the
  submit), the run stays "Approved, waiting to post" with the error. A
  user with the "post" right posts it once the problem is fixed.

**The journal**, voucher type Payroll (prefix PAY):
- one per run, dated **the payroll month's last day** (decision 17);
- it goes through the common path, so lines are clubbed by account,
  side, cost center and description:
  - Dr each earning's account (the element's, or the company's
    override), **by the employee's cost center**;
  - Cr each deduction's account (the fixed deductions, the leave
    deductions, the one-offs). It's split by cost center when the account
    needs one (expense), else one line;
  - arrears go to the element's own account;
  - Cr Salaries Payable: the net pay;
  - Dr Recoverable from employees: a net shortfall (decision 9). Next
    month's "Brought forward" line credits it back.

**A negative net** (decision 9):
- it is paid as 0, and the slip keeps the shortfall (CarryForward);
- the employee's next run deducts it as "Brought forward" ("Net
  shortfall from Jul-2026"). If that one is short too, it carries again.

**Back pay** (decision 10). Each posted month of the company is worked
out again for an employee whose pay changed after it was posted (a
version created later and effective in or before that month). This
covers an approved Employee Change or a Correction:
- the fixed elements and the leave deductions are recomputed, with the
  pay now in force;
- the difference from what was paid for that month (its slip, and
  arrears already paid for it) is one "arrears" line per element. For
  example, "Basic Salary arrears: Jul-2026: paid 6,000.00, now 6,600.00",
  and "Unpaid leave arrears" when a day's rate changed;
- inputs (overtime, bonus) aren't recomputed;
- arrears may be negative (a cut).

**The leave month** of a submitted, approved or posted run can't be
reopened. Leave entered later is paid in the next month, as before.

**Reversal** (Payroll "post", new right):
- with a reason, the company's latest posted run only. A later run may
  have recovered a shortfall this one carried;
- a mirror journal on the same date;
- the run goes back to draft with its inputs (decision 18): correct,
  recalculate, submit again;
- a run marked paid (step 4) can't be reversed.

**Payslips** (decision 19), printed from the run (all, or one), one per
page, through the browser's print (Save as PDF). Each shows:
- the company and the month ("not final" until posted);
- the employee: no., name, designation, cost center, joining date, bank
  and IBAN with the middle masked;
- the earnings and deductions with how each was worked out, including
  arrears and brought forward, and the net pay;
- the year to date: this run plus the year's earlier posted runs;
- each leave balance at the month's end.

**The screen** also shows:
- the status and the state ("Posted: journal PAY-…", "Rejected: …",
  "Approved, but not posted: …");
- the approval levels, with Approve and Reject for the approver;
- Post and Reverse, for the post right;
- the run's history.

**HR Setup → Payroll** gains each company's **Recoverable from
employees**, an asset account.

**Behind it:**
- `payrollPost.js`: `submitPayrollRun`, `decidePayrollApproval`,
  `postPayrollRun`, `reversePayrollRun`, `getPayrollPayslips`, and
  `glLinesFor`;
- `payrollCalc.arrearsFor`, and the run's `extra` lines;
- `payrollRun.calculate`: brought forward and back pay;
- `hrLeaveClose.reopenLeaveMonth`: the payroll check;
- approval registry entry `PAYROLL` (storage `payrollRuns`); Home
  drafts; voucher prefix `Payroll: PAY`.

**Tests:**
- `payrollCalc.test.js` (10);
- the `payrollPost` suite (5);
- `payrollPost.ui.js` (4);
- negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-3`, with the screens.
2. In HR Setup → Payroll, set each company's Recoverable from employees.
3. If runs need approval: Approval Configuration → "Payroll run".
4. Roles & Permissions: Payroll "post", for those who may reverse runs.

**Next:** step 4, payment: the WPS SIF file and the bank list, marking
the run paid (Dr Salaries Payable / Cr bank), advances and loans. The
owner's WPS details are needed: employer ID, bank routing code, and
ideally a sample SIF.

## Step 4 design: Payroll Setup, payment files, payment (proposed 2026-10-04)

### The owner's request (2026-10-04)

"WPS SIF can not fix a standard one, bank and each company might vary.
So, better make a new module only for payroll setup including this WPS
config, and also move the existing two — "Pay Elements" and "Payroll" —
to the new module."

### A new module: Payroll Setup (`PAYROLLSETUP`: access, write)

- **Moved from HR Setup:**
  - the **Pay Elements** tab;
  - the **Payroll** tab: the daily rate and accounts per company, and
    each element's GL account, prorating, gross and overtime.
- **New: Payment Files**, each company's bank file formats (below).
- Changing them needs the new module's "write" right instead of HR
  Setup's. HR Setup keeps grades, designations, employee fields,
  document types, leave types, the working calendar and the work
  schedules. Correcting an employee's pay stays an HR Setup admin right.

### Payment file formats: built per company and bank, not fixed

A format describes one file the bank takes:
- name, company and bank;
- the file type: delimited (comma, tab, `|`, …) or fixed width; the file
  extension (`.SIF`, `.csv`, `.txt`) and the name pattern (e.g.
  `{EmployerID}{yyMMdd}{HHmmss}.SIF`);
- up to three records, each an ordered list of fields:
  - a **header** (once, at the start), optional;
  - the **employee** record (one per employee paid by bank);
  - a **trailer** (once, at the end), optional;
- each field is either a fixed text, or a value from the payroll,
  formatted:
  - **employee:** no., name, WPS person ID, bank routing code,
    IBAN / account no.;
  - **pay:** net pay; the fixed part; the variable part (overtime, bonus,
    commission, one-offs and arrears); days in the period; unpaid days;
  - **the run:** month, period start and end, payment date, file
    creation date and time;
  - **totals:** the number of employees, the total paid;
  - **the format's own values:** employer ID, bank code, currency,
    reference;
  - **formatting:** a date pattern (`yyyy-MM-dd`, `ddMMyyyy`, `MMyyyy`,
    …), decimals, width with left/right padding (fixed width), upper
    case;
- a **UAE WPS SIF** starter (the EDR employee record and the SCR
  trailer, as the Central Bank's layout), which each company copies and
  adjusts to its bank's version;
- a **preview** from a posted run before saving.

### Payment (Payroll, the "pay" right)

From a posted run:
- the **payment date** and the **bank account** paid from (a bank or
  cash account in the GL);
- **the file** in the chosen format, for the employees paid by bank (with
  an IBAN). The others are listed to be paid by cash or cheque;
- **the bank list** (no., name, bank, IBAN, amount), printed or copied
  to Excel;
- **Mark paid** posts Dr Salaries Payable / Cr the bank account, dated
  the payment date. The run shows "Paid", can't be reversed while paid,
  and the payment can be reversed (with a reason).

### Advances and loans (decision 7)

Proposed as step 4b, after payment (see question 23):
- a loan or advance per employee: amount, instalment, the month
  recovery starts, the receivable account;
- each run deducts the instalment ("Loan recovery", credited to the
  loan's account) until it's repaid;
- the balance shows on the employee and the payslip.

### Open questions for step 4

20. **The employee's WPS data:** add "WPS person ID" (the labour card's
    personal number) and "bank routing code" to the employee record, as
    sensitive fields beside the IBAN? Or keep them as HR Setup custom
    fields?
21. **Paying a run:** mark the whole run paid at once, or each employee
    separately (some later)?
22. **Employees without a bank account:** paid in the same payment, by
    cash or cheque from another account, or left out to be paid
    separately?
23. **Advances and loans:** build them now with payment, or as their own
    step (4b) right after?

### The owner's decisions for step 4 (2026-10-04)

| # | Question | Decision |
|---|---|---|
| 20 | The employee's WPS data | **Two new sensitive fields on the employee record**, beside Bank and IBAN: "WPS person ID" and "Bank routing code" (also in the Employees import). |
| 21 | Paying a run | **The whole run at once:** one payment date, one journal. |
| 22 | Employees without a bank account | **In the same payment, by cash or cheque:** listed apart and credited to a cash/cheque account chosen when paying, in the same journal. |
| 23 | Advances and loans | **Their own step, 4b, right after payment.** |

## As built: step 4, Payroll Setup, payment files, payment (2026-10-04)

**Payroll Setup** (new module and screen `PAYROLLSETUP`: access, write),
at the owner's request:
- **Pay Elements** and **Payroll** moved here from HR Setup, unchanged.
  Earlier sections that say "HR Setup → Payroll" now mean Payroll Setup →
  Payroll;
- changing them needs Payroll Setup's "write"; HR Setup's no longer
  does;
- HR Setup and Employees still read the elements (leave pay rules,
  compensation);
- correcting an employee's pay stays an HR Setup admin right.

**Payment Files** (Payroll Setup tab), each company's bank files, since
the WPS SIF differs by bank and company:
- a format has:
  - a company, name and bank;
  - delimited (comma, semicolon, pipe or tab) or fixed width;
  - an extension, a file name pattern (`{EMPLOYER}{CREATED:yyMMddHHmmss}`)
    and line endings;
  - its own values: employer ID, bank code, currency, reference;
  - a header, an employee record and a trailer;
- each record is an ordered list of fields, added, moved up or removed.
  A field holds:
  - a fixed text;
  - an employee's no., name, WPS person ID, bank routing code, IBAN or
    bank;
  - the net pay, its fixed part and its variable part (the inputs and
    arrears, never above the net);
  - the days in the period, or the unpaid and absent days;
  - the month, period start and end, payment date, or the file's
    creation date and time (UAE time);
  - the count or the total;
  - the format's own values;
- each field has a date pattern, decimals, width and padding (fixed
  width), and upper case;
- **New from the UAE WPS SIF:** the EDR employee record and the SCR
  trailer, filled in, to match to the bank's specification;
- **Preview** on any run of the company, before saving. The file shows
  exactly as it will be written, dates included;
- one name per company.

**The employee record** gains **WPS person ID** and **Bank routing
code** (decision 20):
- sensitive, letters and digits;
- also in the Employees import.

**Payment** (Payroll, new "pay" right), on a posted run:
- **the payees:** each with net pay above 0, paid by bank if they have
  an IBAN, else by cash or cheque (decision 22). Anyone paid by bank who
  lacks a WPS person ID or routing code is flagged;
- **Download the file** in one of the company's formats, for those paid
  by bank. It's saved by the browser and noted in the run's history;
- **Copy the bank list** to Excel;
- **Mark paid** (decision 21), for the whole run:
  - one journal, voucher PayrollPayment (prefix PAYP), on the payment
    date (not before the payroll month);
  - Dr Salaries Payable;
  - Cr the bank account (codes 11…) for those paid by bank;
  - Cr the chosen cash or bank account (codes 10… or 11…) for the others;
- **Reverse the payment**, with a reason: a mirror journal, and the run
  is unpaid again;
- a paid run can't be reversed until its payment is.

**Behind it:**
- `payrollFiles.js` (no Firebase): `buildFile`, `cleanFormat`,
  `employeeValues`, `WPS_SIF`;
- `payrollPayment.js`: `getPaymentFormats`, `savePaymentFormat`,
  `deletePaymentFormat`, `previewPaymentFile`, `getPayrollPayment`,
  `downloadPaymentFile`, `markPayrollPaid`, `reversePayrollPayment`;
- `computeEmployee` keeps each slip's `UnpaidDays`;
- `hrPay`'s rights are now Payroll Setup's.

**Tests:**
- `payrollFiles.test.js` (5) and `payrollCalc.test.js` (10);
- the `payrollPayment` suite (4), and `payrollSetup` (6, with the rights
  move);
- `payrollPayment.ui.js` (3);
- the payroll, HR and Employees UI tests moved to Payroll Setup;
- negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-4`, with the screens.
2. Link a menu node to "Payroll Setup".
3. In Roles & Permissions:
   - Payroll Setup's access and write, to those who set up payroll;
   - Payroll "pay", to those who pay runs.
4. In Payroll Setup → Payment Files, each company's bank file.
5. On the employees, the WPS person ID and bank routing code.

**Next:** step 4b, advances and loans (decision 7); then step 5,
provisions and final settlement.

## Step 4b design: advances and loans (proposed 2026-10-04)

Decision 7: in Payroll; amount, instalment, the month recovery starts, the
GL account; each run deducts the instalment until it is repaid; the
balance shows on the employee.

**Loan types** (Payroll Setup → Loans, a new tab): e.g. Salary advance,
Personal loan, Car loan. Each has:
- a name;
- a receivable account (an asset), the group's with a company override,
  like the pay elements;
- whether it's an advance (recovered in one month) or a loan (in
  instalments).

**A loan or advance** (Payroll → Loans, module PAYROLL; numbered LN-0001):
- the employee, the type, the amount, the instalment, the first month of
  recovery, and a note;
- an advance is recovered whole in its first month;
- its status: Draft → (approval) → Active (once paid out) → Repaid;
- its balance is the amount less the recoveries in posted runs, and any
  repayment received.

**Recovery in the run:**
- each active loan whose recovery has started adds a system deduction
  line, "Loan recovery: <type> LN-0001", for the instalment or the
  balance if less;
- it is credited to the loan's receivable account;
- reversing a run gives the recovery back, since the balance counts
  posted runs only;
- the payslip shows each loan's balance after the month.

**Final settlement** (step 5) deducts what's left.

### Open questions for step 4b

24. **Paying out a loan or advance:** posted from Payroll (Dr the loan's
    receivable / Cr a bank or cash account, on a date)? Or added to the
    employee's next salary? Or paid through Cash & Bank, with Payroll
    only tracking it?
25. **Approval:** through Approval Configuration ("Loan / advance", the
    amount is the loan), or none?
26. **When the month's salary can't cover the instalment:** deduct only
    what the net allows and recover the rest later (the term extends)?
    Or deduct it in full, with the shortfall carried as today?
27. **Changes after it starts:** may HR skip a month, change the
    instalment, or record an early repayment (cash or bank received)?
