# HR: Payroll

Status: **design agreed** (the owner's decisions 2026-10-04, below); **steps 0 to 4b built and tested** (see As built); step 5 (provisions and final settlement) next.

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

### The owner's decisions for step 4b (2026-10-04)

| # | Question | Decision |
|---|---|---|
| 24 | Paying out | **Posted from Payroll:** "Pay out" on the loan posts Dr the loan type's receivable / Cr a bank or cash account, on a date. |
| 25 | Approval | **Through Approval Configuration:** "Loan / advance", the amount is the loan; with none set up, it's approved on submit. |
| 26 | Salary short of the instalment | **Deduct what the net allows:** the net never goes below 0 because of a loan; the rest is recovered later (the term extends). |
| 27 | Changes once running | **All three:** skip a month; change the instalment from a month; record an early repayment received (Dr bank or cash / Cr the loan). |

The loans have their own screen and module, **Loans & Advances**
(`PAYROLLLOAN`: access, draft, pay), so their rights are set apart from
the payroll runs'.

## As built: step 4b, advances and loans (2026-10-04)

**Loan types** (Payroll Setup → Loans):
- a name;
- recovered at once (an advance) or in instalments (a loan);
- a receivable: an asset account, the group's shared one with a company
  override, like the pay elements;
- names are unique.

**Loans & Advances** (new module and screen `PAYROLLLOAN`: access, draft,
pay):
- **a draft:** employee, type, amount, instalment (an advance's is the
  amount), the month recovery starts, note. It shows in My Drafts;
- **submit:** numbered LN-0001…, then through Approval Configuration →
  "Loan / advance (the amount is the loan)" (decision 25). With none set
  up, it's approved at once. A rejection returns it to draft with the
  reason;
- **pay out** (the "pay" right, decision 24): a date and a cash or bank
  account; journal PayrollLoan (prefix PLN), Dr the type's receivable /
  Cr the account. Then it's "Running";
- **the balance:** the amount less its recoveries in posted runs and its
  repayments. At 0 it shows "Repaid";
- **the schedule** (decision 27):
  - months skipped;
  - a new instalment from a month (loans only);
  - a month a posted run already recovered can't change;
- **an early repayment** (the "pay" right): a date, an amount up to the
  balance, a cash or bank account; Dr the account / Cr the receivable;
- **reversing the payout:** only before anything is recovered or repaid.
  It goes back to "Approved".

**In the payroll run:**
- each running loan whose recovery has started, and isn't skipped that
  month, is recovered;
- the amount is the instalment in force (an advance: its balance), at
  most the balance;
- loans are taken oldest first, and **never past the net pay**
  (decision 26). Any shortfall is warned and recovered later;
- the line reads "Loan recovery: Personal loan LN-0001", with "500.00;
  balance after 2,500.00";
- posting credits the loan type's receivable for the company;
- reversing a run gives the recovery back;
- the payslip shows each running loan's balance after the month;
- the employee record's pay card lists the running loans and their
  balances.

**Fixed on the way:**
- Home's My Drafts matches drafts by username, but payroll runs stored the
  user ID, so draft runs never showed there (since step 3);
- the run now records its last updater by username, with a description.
- the regression caught a race in the new loans line on the Employees pay
  card: it read the open employee after the pay had loaded, so a record
  left meanwhile (a new employee form) raised an error. It now uses the
  employee the pay was asked for.

**Behind it:**
- `payrollLoans.js`: the loan types and loans callables, `loansDue`,
  `recoveriesOf`;
- `payrollCalc.loanBalance` and `loanDue`, and `computeEmployee`'s loan
  lines;
- `payrollPost`: the loan receivable, and the payslip balances;
- approval entry `PAYROLLLOAN` (storage `payrollLoans`) and Home drafts.

**Tests:**
- `payrollCalc.test.js` (11);
- the `payrollLoans` suite (5);
- `payrollLoans.ui.js` (3);
- negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-4b`, after `payroll-4`, with the
   screens.
2. Link a menu node to "Loans & Advances".
3. Set its rights in Roles & Permissions.
4. Add the loan types in Payroll Setup → Loans.
5. If loans need approval: Approval Configuration → "Loan / advance".

**Next:** step 5, gratuity and leave-salary provisions, and the final
settlement.

## Step 5 design: provisions and final settlement (proposed 2026-10-05)

### The owner's points (2026-10-05)

1. "Option for the equation to add gratuity, by default current UAE rule:
   up to 364 days no gratuity, 1 year to 5 years 21 days basic salary per
   year, 5–24 years 30 days basic salary per year. Also, company have
   option to start provision from day one or once completed 1 year."
2. "Leave salary by default on basic, but flexible to update the equation
   on total salary. Also annual leave may vary by company or employee,
   like fixed 30 days (or any) including holidays, or a working days
   basis."
3. "Also need option to add more liabilities and accruals like flight,
   children education, accommodation, etc., and the logic fixed or based
   on salary."

### Payroll Setup → Provisions (new tab)

**End-of-service gratuity** (a formula per company, the UAE rule to
start):
- the base: the basic (default), or the gross ("in gross" elements);
- **slabs** by completed years of service: from year, to year, days of
  pay per year. The UAE start: under 1 year, none; years 1–5, 21 days a
  year; after 5, 30 days a year. Rows can be added and changed;
- a day's pay: base × 12 ÷ 365 (as the Labour Ministry) or the company's
  daily rate (question 28);
- an optional cap: the total at most N years' base (UAE: 2);
- service: from the joining date, less unpaid and absent days;
- **when the provision starts** (owner point 1): from day one, or once
  the first year is complete (then it catches up on that year at once);
- the accounts: expense (by cost center) and provision (a liability).

**Leave salary** (per company):
- the base: the basic (default) or the gross (owner point 2);
- a leave day's value: the company's daily rate, or a working-day rate
  (question 30);
- the days come from the employee's annual leave balance (the Leave
  Register's accruals), so the entitlement (30 calendar days, 22 working
  days, …) is set where leave is: by grade and service, with a per-
  employee override (question 31);
- the accounts: expense and provision.

**Other accruals** (owner point 3), as many as needed, e.g. flight
ticket, children's education, accommodation. Each has:
- a name, and who is eligible (question 32);
- the amount: a fixed amount a year, or a % of the basic or the gross;
- the expense and provision (liability) accounts;
- whether an unused balance is paid at leaving or lapses.

### Each month, with the posted run (decision 8)

- each employee's liability at the month's end is worked out again:
  - gratuity: service to date by the slabs, at the current base;
  - leave salary: the leave balance × the day's value;
  - each accrual: its share for the month added;
- the change from what is already provided is posted with the run's
  journal: Dr the expense by cost center / Cr the provision (a decrease
  reverses);
- the run shows each employee's provisions; a reversed run takes them
  back.

### Final settlement (an employee leaving)

When an employee leaves (Status Left and a leaving date), the
settlement shows:
- the last month's pay (the run, as today);
- gratuity at the leaving date;
- unused annual leave paid out (the balance × the day's value);
- unpaid accruals marked "paid at leaving";
- notice pay: in lieu either way;
- other additions or deductions (with a note);
- the loans still owed;
- the net.

Posting: Dr each provision (what is provided), the expense for any
difference / Cr the loans' receivables and Salaries Payable; then paid
as runs are (question 34).

### Open questions for step 5

28. **Gratuity details:** a day's pay as basic × 12 ÷ 365 with the total
    capped at 2 years' basic, as UAE law? Or the company's daily rate
    with no cap? (Both stay changeable per company.)
29. **Leaving reasons:** no reduction for resigning, as the 2022 UAE law?
    Or a configurable reduction by reason and years (the old rule:
    resignation under 3 years ⅓, 3–5 years ⅔)?
30. **A leave day's value:** the company's daily rate (÷ 30, ÷ the
    month's days, × 12 ÷ 365)? Or a working-day rate (÷ the month's
    working days)?
31. **Annual leave per employee:** add a per-employee override of the
    yearly days (and calendar or working days), on top of the grade and
    service rules? Or keep the rules only?
32. **Who gets an accrual (flight, education…):** by grade level, with a
    per-employee override? Or each employee assigned individually?
33. **Using an accrual:** paid by a claim from Payroll (Dr the provision
    / Cr bank or cash)? Or paid with the salary as a run input? Or both?
34. **The final settlement:** its own document (approval, posting,
    payment), apart from the last payroll run? Or added to the last run?
35. **Build order:** provisions first (5a) and the final settlement next
    (5b)? Or both in one step?

### The owner's decisions for step 5 (2026-10-05)

| # | Question | Decision |
|---|---|---|
| 28 | Gratuity details | **UAE:** a day's pay is the base × 12 ÷ 365, and the total is capped at 2 years' base. Both stay changeable per company. |
| 29 | Leaving reasons | **No reduction** (2022 UAE law). Dismissal for cause is set to 0 by hand in the settlement. |
| 30 | A leave day's value | **The company's daily rate** (÷ 30, ÷ the month's days, × 12 ÷ 365), on the basic or the gross. |
| 31 | Annual leave per employee | **A per-employee override** of the yearly days (and calendar or working days), on top of the grade and service rules. |
| 32 | Who gets an accrual | **By grade level, with a per-employee override** (exclude, or their own amount). |
| 33 | Using an accrual | **Both:** a claim from Payroll (Dr the provision / Cr bank or cash), or paid with the salary as a run line. HR chooses each time. |
| 34 | The final settlement | **Its own document:** approval, posting and payment. The last month's salary stays in the normal run. |
| 35 | Build order | **5a provisions, then 5b final settlement**, each with its own PR. |

**Added in 5a (not asked, needed at go-live):** each employee's
**opening provisions** (gratuity, leave salary, each accrual), as at a
month, through the Master Data Import. The amounts are already in the GL
from the opening balances, so they post nothing; the first run provides
only the change from them.


## As built: step 5a, provisions (2026-10-05)

**An employee's own annual leave** (decision 31; Employees → the leave
card → "Own entitlement", the Leave "post" right):
- per leave type that uses a balance: the days a year (empty: back to the
  grade and service rules) and how its days count (calendar, holidays
  included, or working days; empty: as the leave type), with a reason;
- it replaces the grade rules from the start of the accrual, and is
  recorded in the employee's history; the leave card shows it.

**Payroll Setup → Provisions** (the "write" right):
- **per company, gratuity** (owner point 1, decisions 28-29):
  - on the basic (default) or the gross;
  - slabs of days a year by completed years; the UAE start: none under 1
    year, 21 days for years 0-5, 30 days after 5 (rows can be changed
    and added; overlaps are refused);
  - a day's pay: base × 12 ÷ 365 (default) or the company's daily rate;
  - a cap in years' base (default 2; empty: none);
  - **the provision starts** once the first year is done (it catches up
    on that year then; default) or from day one;
  - service: from joining, less unpaid leave days;
  - the expense and provision (liability) accounts;
- **per company, leave salary** (owner point 2, decision 30): on the
  basic (default) or the gross; the accounts;
- **accruals** (owner point 3, decision 32), as many as needed (air
  ticket, children's education, accommodation…):
  - a name and a code (unique, not a pay element's);
  - a fixed amount a year, or a % of the basic or the gross;
  - **by grade level** (rows without overlap);
  - **employee exceptions:** excluded, or their own amount (or %);
  - the group's expense and provision accounts, with a company override;
  - whether an unused balance is paid at leaving (for 5b) or lapses;
  - in use or not.

**Opening provisions** (Master Data Import → "Opening provisions",
Payroll Setup "write"): Employee, Provision (Gratuity, Leave salary, or
an accrual's code or name), Amount, Provided To (a date). They post
nothing: the amounts are already in the GL from the opening balances.

**In the run** (decision 8), each employee's provisions are worked out
on the month's last day (or the leaving date):
- **gratuity:** the liability by the slabs at the current base, less what
  is provided (openings and posted runs). The first run after an opening
  provides only the change;
- **leave salary:** the annual leave days due (available + booked) × the
  company's daily rate, less what is provided;
- **each accrual:** its yearly amount ÷ 12, pro rata by the days employed
  in the month;
- a decrease is negative (e.g. leave taken, or an over-provided opening);
- the payslip panel shows them ("the company's cost, not paid now"),
  with how each was worked out, the liability and what was provided
  before.

**Posting** (with the run's journal): each provision's change, Dr the
expense by cost center / Cr the provision; a decrease the other way.
Reversing the run takes them back. A run that has provisions but no
accounts set is refused ("Set the GL accounts in Payroll Setup first").

**Using an accrual** (decision 33), both ways:
- **with the salary:** a run input with the accrual's code (e.g. FLIGHT,
  300) adds an earning "Air ticket (from the provision)", paid with the
  salary and in the bank file, posted Dr the provision (not an expense);
- **a claim** (Payroll → Provisions → "Record a claim", the Payroll "pay"
  right): employee, accrual, date, amount, a cash or bank account, a
  note. Journal PayrollProvision (prefix PPR), Dr the provision / Cr the
  account. A claim can be reversed with a reason.

**Payroll → Provisions** (Payroll access): per company, each employee's
balance by provision (openings + posted runs − claims − payouts), with
totals, "Copy to Excel", and the claims list.

**Behind it:**
- `payrollCalc`: `GRATUITY_DEFAULT`, `LEAVE_SALARY_DEFAULT`,
  `gratuityFor`, `leaveSalaryFor`, `accrualShareFor`; the
  `AccrualPayout` line source;
- `payrollProvisions.js` (new): the settings, accrual types, openings,
  `providedBefore`, balances and claims;
- `payrollRun` (the provisions on each slip), `payrollPost` (their
  journal lines and the payout's), `payrollFiles` (the payout is paid);
- `hrLeave`: `setLeaveEntitlement`, and the override in the accrual and
  the day count;
- `masterImport`: the `PROVOPEN` sheet.

**Tests:**
- `payrollCalc.test.js` (13);
- the `payrollProvisions` suite (5), and `hrLeave` (8: the override);
- `payrollProvisions.ui.js` (4);
- negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-5a`, after `payroll-4b`, with the
   screens.
2. Add the GL accounts (gratuity, leave salary and each accrual: expense
   and provision) if not there.
3. Payroll Setup → Provisions: per company, turn on gratuity and leave
   salary, check the formula, choose the accounts; add the accruals.
4. Import the opening provisions (Master Data Import), as at the month
   before the first run.
5. Set any employee's own annual leave on their leave card.

**Next:** step 5b, the final settlement (its own document, decision 34).

## Step 5b design: the final settlement (proposed 2026-10-05)

Decided already: its own document, with approval, posting and payment;
the last month's salary stays in the normal run (decision 34); no
reduction of gratuity for the leaving reason, and dismissal for cause is
set to 0 by hand (decision 29).

### When

- An employee "On notice" or "Left" with a leaving date can have a
  settlement drafted (Payroll → Final settlements, the "draft" right);
  one per employee (a reversed one can be redone).
- It is **submitted only once the run for the leaving month is posted**:
  that run pays the last days and brings the provisions up to the
  leaving date, so what is provided is final.

### What it shows (worked out on the leaving date, each line explained)

| Line | Worked out | Editable |
|---|---|---|
| Gratuity | Payroll Setup's rule for the company, at the base on the leaving date; service less unpaid days; a settlement never counts the first year early ("from day one" only affects the provision) | yes, with a reason (e.g. 0 for dismissal) |
| Leave salary | the annual leave balance on the leaving date × a day at the company's daily rate, on the leave-salary base (basic or gross) | yes, with a reason |
| Accruals "paid at leaving" | each one's balance provided (openings + runs − claims − payouts) | yes, with a reason |
| Notice pay | question 36 | — |
| Other additions / deductions | typed lines with a note (e.g. a bonus due, a damaged asset) | — |
| Loans and advances | each running loan's balance, deducted | — |
| **Net** | additions − deductions | — |

### Posting (the "post" right, after approval)

One journal, voucher FinalSettlement (prefix FS), dated the leaving date:
- each provision: Dr what was provided; the difference between that and
  what is paid goes to its expense (a shortfall Dr, an excess Cr back);
- accruals that lapse: their balance is taken back (Dr provision / Cr
  expense);
- notice pay and other additions: Dr their expense (cost center);
  deductions: Cr their account;
- loans: Cr each loan type's receivable (the loan becomes "Repaid");
- the net: Cr Salaries Payable (or, if the employee owes money, question
  38).

Reversal (the "post" right) undoes the journal while it is unpaid.

### Payment (the "pay" right): question 39

### Open questions for step 5b

36. **Notice pay:** days typed by HR × the company's daily rate on the
    gross, either paid to the employee (notice not worked) or deducted
    (short notice)? Or a notice period on the employee record, worked
    out automatically? Or just an amount typed?
37. **Unused leave and a negative balance:** pay the unused annual leave
    on the leave-salary base (as the provision), and **deduct** a
    negative balance (leave taken in advance)? Or never deduct?
38. **Loans and a negative net:** deduct every loan's balance; if the net
    goes negative, the settlement shows what the employee owes (left on
    "Recoverable from employees")? Or deduct loans only up to the net,
    leaving the rest on the loan?
39. **Payment:** as a payroll run's payment (the bank file from Payroll
    Setup's formats, or a cash or bank account; mark paid; reverse)? Or a
    simpler one-step payment from a cash or bank account?

### The owner's decisions for step 5b (2026-10-05)

| # | Question | Decision |
|---|---|---|
| 36 | Notice pay | **Days typed by HR × the company's daily rate on the gross**, paid to the employee (notice not worked) or deducted (short notice). |
| 37 | Unused leave, a negative balance | **Pay the unused days** on the leave-salary base, and **deduct a negative balance** at the same daily rate. |
| 38 | Loans, a negative net | **Deduct every loan's balance.** If the net goes negative, the settlement shows what the employee owes, left on "Recoverable from employees". |
| 39 | Payment | **As a payroll run's payment:** the bank file from Payroll Setup's formats, or a cash or bank account; mark paid; reverse the payment. |

## As built: step 5b, the final settlement (2026-10-05)

**Final Settlements** (new module and screen `PAYROLLFS`: access, draft,
post, pay; like Loans & Advances, so its approvals and drafts open it):
- **one per employee** on notice or who has left, with a leaving date on
  their record ("New final settlement" lists them);
- **worked out on the leaving date** (and again each time a draft is
  opened or saved, until it is submitted):
  - **gratuity:** the company's rule (Payroll Setup → Provisions), on the
    basic or gross in force that day; service less unpaid days; never
    reduced for the reason (decision 29); a settlement never counts the
    first year early;
  - **leave salary:** the annual leave balance that day × the company's
    daily rate, on the leave-salary base; a **negative balance is
    deducted** (decision 37);
  - **accruals paid at leaving:** their balance provided; the others
    **lapse** (shown, and their provision taken back);
  - **notice pay:** days × the gross daily rate, paid (notice not worked)
    or deducted (short notice), posted to a pay element HR chooses
    (decision 36);
  - **other additions and deductions:** a pay element, an amount, a note;
  - **every running loan's balance**, deducted (decision 38);
  - **the net**; if negative, the employee owes it;
- **an amount changed by hand** (gratuity, leave salary, an accrual):
  with a reason, e.g. 0 for dismissal; the line shows what was worked out;
- **submit** (the "draft" right): only once the leaving month's payroll
  run is posted (the screen says so until then). It is numbered FS-0001…
  and goes through Approval Configuration → "Final settlement (the amount
  is the net)"; with none set up it is approved at once. A rejection
  returns it to draft;
- **posted** on the final approval: journal FinalSettlement (prefix FS),
  dated the leaving date:
  - each provision: Dr what was provided; the difference between that and
    what is paid to its expense (cost center), a shortfall Dr, an excess Cr;
  - a lapsed accrual: Dr its provision / Cr its expense;
  - notice pay and other lines: their elements' accounts;
  - loans: Cr each loan type's receivable; the loan shows the recovery
    and becomes "Repaid";
  - the net: Cr Salaries Payable, or Dr Recoverable from employees when
    the employee owes it;
- **paid** (the "pay" right, decision 39): the bank file from Payroll
  Setup's formats (when the employee has an IBAN), then Mark paid from a
  cash or bank account (journal PayrollPayment, PAYP: Dr Salaries Payable
  / Cr the account), with a reversal. Nothing is paid when the employee
  owes the company;
- **reversed** (the "post" right): only once its payment is reversed. A
  mirror journal; the loans' recoveries undone; back to a draft (to
  correct or delete).

**What waits for a settlement** (once submitted, until it is reversed):
- claims against the employee's accruals, and their reversal;
- the employee's loan payouts and repayments;
- reversing a payroll run of the leaving month or later;
- a posted settlement uses up what was provided: the employee's
  provisions balance (Payroll → Provisions) is then 0, and a leaver with
  nothing left drops off it.

**Behind it:**
- `payrollSettlement.js` (new): the calculation (`compute`), the journal
  (`glLinesFor`), the callables;
- `payrollProvisions.providedBefore` takes posted settlements off; the
  claim guard;
- `payrollLoans`: the guard;
- `payrollPost.reversePayrollRun`: the guard;
- registries:
  - module `PAYROLLFS`;
  - its menu node;
  - approval entry `PAYROLLFS` (storage `payrollSettlements`);
  - Home drafts;
  - voucher `FinalSettlement` (FS).

**Tests:**
- the `payrollSettlement` suite (4);
- `payrollSettlement.ui.js` (4);
- negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-5b`, after `payroll-5a`, with the
   screens.
2. Link a menu node to "Final Settlements".
3. Set its rights in Roles & Permissions.
4. If settlements need approval: Approval Configuration → "Final
   settlement".
5. Add pay elements for notice pay (an earning, and a deduction for short
   notice) with their GL accounts, if not there.

**Payroll (steps 0–5) is complete.**

## Step 5c design: interim payroll (proposed 2026-10-06)

### The owner's request (2026-10-06)

> There should be an option to run interim payroll too, batch-wise. Only
> two payments go through it: the final settlement and Loans & Advances.
> Neither waits for the month-end payroll. The final settlement means all
> the payments (salary, gratuity, leave salary, etc.) and the deductions.
> The payment file must be generated too.

What this changes from step 5b:
- **Today** a settlement is submitted only once the leaving month's run
  is posted. That run pays the last days, and a leave month is locked only
  after it ends. Someone leaving on 10 October is paid in November at the
  earliest, in two payments (the October run, then the settlement).
- **A loan or advance** is paid out one at a time from a cash or bank
  account, with no bank file.

### 1. The final settlement carries the last salary

The settlement gets a **Salary** section, worked out by the run's own
calculation (`payrollCalc.computeEmployee`) for the leaving month,
from the 1st (or the joining date) to the leaving date:
- the pay elements in force, pro-rated as the run does;
- the employee's approved leave not yet paid by a posted run (unpaid
  leave, absences, and leave dated in a locked month and entered late);
- the leaving month's variable inputs (overtime, allowances, deductions),
  entered on the settlement as the run's inputs are;
- what an earlier posted run carried forward (a net shortfall), and
  arrears from a pay change back-dated into a posted month;
- **not** the month's loan instalment: the settlement already deducts
  every loan's whole balance (decision 38).

**Earlier months not yet paid** (decision 41): when the employee is on no
posted run for a month before the leaving month (e.g. leaving on 10
October with September's run not yet posted), the settlement lists that
month with a choice, **Pay in this settlement** (ticked at first) or leave
it to that month's run. Paying it here keeps one payment and can stop the
net going negative when the loans are deducted. A month left to its run
must be posted before the settlement is submitted. A month paid here is
worked out the same way (its leave, its inputs) and left off its run.

The other lines stay as built: gratuity, leave salary, accruals, notice
pay, other additions and deductions, loans, the net.

**The provisions need nothing new.** Without the leaving month's run,
what was provided stops at the last posted run. The settlement already
posts the difference between what it pays and what was provided to the
expense.

**The month-end run leaves the employee out** once their settlement is
submitted: the run for the leaving month shows them under "Paid by final
settlement FS-…", with no slip. It doesn't recover their loan instalment,
and it posts no provision for them.

**When the leaving month's run is already posted with the employee on it**
(e.g. leaving on the 31st, after payroll), the settlement has no Salary
section, as today.

**Checks:**
- **Submitting:**
  - submitted on or after the leaving date (decision 40);
  - each earlier month not paid in the settlement (decision 41) has its
    run posted with the employee on it;
  - none of the employee's leave dated up to the leaving date is Draft or
    Pending: decide it first (as the month lock);
  - the leaving month's run, if it is submitted or posted without having
    left them out: the settlement is then refused until that run is
    reversed or recalculated.
- **Once submitted:**
  - leave can't be entered or changed for the employee up to the leaving
    date;
  - a Draft run of the leaving month is recalculated without them, and a
    run can't be submitted with a slip for them.
- **Reversing the settlement** (back to a draft) puts them back on the
  leaving month's run at its next calculation.

**Posting:** the salary lines post as the run's do:
- each earning Dr its element's expense account (cost center);
- each deduction Cr its element's account;
- the net is still Cr Salaries Payable, or Dr Recoverable when the
  employee owes it.

### 2. Interim payroll: a batch of payments between runs

A new view in **Payroll → Interim payroll**. Each **batch** is for one
company and has:
- a number, IP-0001…;
- a payment date and a note;
- its **items**, chosen from what is waiting to be paid:
  - **final settlements:** posted, not paid, with a net more than 0;
  - **loans and advances:** approved, not yet paid out.

It goes through these stages:
- **Draft:** add or remove items. An item is in one batch at a time.
- **Submitted / Approved:** decision 43, below.
- **Payment file:** one bank file for the whole batch, from Payroll
  Setup's formats (as a run's). Each row is the employee's net
  (settlement) or the loan amount. Employees without an IBAN are listed,
  to be paid by cash or cheque.
- **Mark paid:** from a cash or bank account, on the payment date. Each
  item gets its own journal, with the batch number as the reference:
  - a settlement: PayrollPayment (PAYP), Dr Salaries Payable / Cr the
    account, as today;
  - a loan: PayrollLoan (PLN), Dr the receivable / Cr the account, as
    today's payout.

  The batch is then **Paid**. Each settlement shows it is paid, and each
  loan becomes Active (recovered by later runs, as today). If one item's
  journal fails (a closed period, say), the ones already written are
  reversed and nothing is paid.
- **Reverse the payment** (with a reason): every item's journal is
  reversed. Settlements go back to unpaid, loans to Approved (only while
  nothing is recovered from them yet), and the batch to Draft, to change,
  submit again or delete.

While an item is in a batch, it is paid or reversed only through the
batch. Its own Pay / Pay out button says which batch holds it.

**Approval** (decision 43): submitting a batch starts its own approval,
Approval Configuration → "Interim payroll (the amount is the batch
total)". With none set up it is approved at once. A rejection returns it
to a draft. The payment file and Mark paid come after the approval.
Reversing the payment returns the batch to a draft, to be submitted again.

Its own module and screen, **Interim Payroll** (`PAYROLLIP`: access,
draft, pay), as Loans & Advances and Final Settlements have, so its
approvals and drafts open it: "draft" makes, changes and submits a batch;
"pay" downloads the file, marks it paid and reverses the payment.

### Open questions for step 5c

40. **When can a settlement be submitted?**
    - From the leaving date (recommended): the salary is known to the
      last day.
    - Or any time once the leaving date is set, e.g. to pay on the last
      working day before it.
41. **The months before the leaving month:**
    - Require their runs to be posted (recommended): runs are normally
      posted by month end, and it keeps one place paying each month.
    - Or let the settlement also pay a whole earlier month whose run isn't
      posted yet.
42. **Paying one item on its own:**
    - Keep each settlement's Pay and each loan's Pay out as well as the
      batch (recommended), for a single urgent payment.
    - Or pay only through a batch.
43. **Approving a batch:**
    - No approval of its own (recommended): every item in it is already
      approved (settlements and loans each have their approval).
    - Or a batch approval through Approval Configuration, before it can
      be paid.

### The owner's decisions for step 5c (2026-10-06)

| # | Question | Decision |
|---|---|---|
| 40 | When a settlement is submitted | **From the leaving date.** It can be drafted before. |
| 41 | Earlier months not yet paid | **An option on the settlement, month by month: pay it in the settlement or not**, "to avoid any negative net salary in the final settlement". A month not paid there waits for its own run to be posted. |
| 42 | Paying one item on its own | **Keep both:** each settlement's Pay and each loan's Pay out stay, besides the batch. An item in a batch is paid only through the batch. |
| 43 | Approving a batch | **A batch approval**, through Approval Configuration, before the batch is paid. |

## As built: step 5c, interim payroll (2026-10-06)

**The final settlement pays the salary** (Final Settlements):
- **its months:** each month no posted run has paid the employee, from
  the month after the last posted run with them on it to the leaving
  month. If they are on no posted run, the months start at the company's
  first run (before it, pay was outside this system), or at the leaving
  month when the company has no runs; never before joining;
- **the Salary section** shows each month, the company's run for it (not
  made, draft, waiting for approval, approved, posted; "without them" if
  they are not on it) and what the settlement pays for it;
- **the leaving month is always paid here.** An earlier month is paid here
  too unless HR unticks it, which leaves it to its run (decision 41). Only
  the earliest months can be left to their runs: once a month is paid
  here, every later one is too;
- **each month is worked out by the run's own calculation:**
  - the pay in force, prorated to the leaving date;
  - the leave not yet paid by a posted run. The leaving month also takes
    leave entered after its lock, paid in a later month;
  - the month's inputs: overtime hours or amounts, a bonus, one-offs.
    These are entered on the settlement ("Salary inputs"), against the
    run's variable elements;
  - the first month takes a shortfall carried forward by the last posted
    run, and arrears for a pay change back-dated into a posted month;
  - no loan instalment: every loan's whole balance is deducted, as before;
- **an accrual paid at leaving** (e.g. an air ticket) adds its share of
  the months paid here (the run would have provided it);
- **gratuity and leave salary need nothing new:** they are worked out on
  the leaving date, and the difference to what the runs provided goes to
  the expense, as before;
- **posting:** each salary line goes to its element's account (by the
  employee's cost center), a shortfall brought forward to Recoverable from
  employees, and the net to Salaries Payable, as before;
- **when the leaving month's run is posted with the employee on it**
  (e.g. leaving on the 31st after payroll), there is no salary section,
  as in 5b.

**Submitting a settlement** (checked again on submit):
- from the leaving date (decision 40); a draft can be made earlier, and
  the screen says when it can be submitted;
- none of the employee's leave up to the leaving date is Draft or
  Pending;
- every month left to its run is posted with the employee on it;
- no run past its draft has the employee on it for a month the
  settlement pays. Once that run is posted the settlement no longer pays
  the month; or it is rejected and recalculated without them.

**Once a settlement is submitted** (until it is reversed):
- **the run of a month it pays** leaves the employee out at its next
  calculation. It shows them under "Paid by final settlement, not on
  this run". A draft run calculated before must be recalculated: its
  submit is refused while it has a slip for them;
- **the employee's leave stays as it is:** no new leave, edits,
  submits, approvals, cancellations or returns.

**Interim Payroll** (new module and screen `PAYROLLIP`: access, draft,
pay):
- **a batch** has one company, a payment date (not before a leaver's
  leaving date), a note, and its items, ticked from what is waiting:
  - posted final settlements with a net to pay, not yet paid;
  - approved loans and advances, not yet paid out.

  It is numbered IP-0001… on its first save;
- **an item is in one batch at a time.** It shows on its settlement or
  loan ("In interim payroll IP-…: it is paid there"). Its own Pay / Pay
  out, its payment's reversal, and a settlement's reversal are refused
  while it is in a batch (decision 42: both ways stay). Deleting a draft
  frees its items;
- **submitted** (the "draft" right) through Approval Configuration →
  "Interim payroll (the amount is the batch total)" (decision 43). With
  none set up it is approved at once; a rejection returns it to a draft.
  The items are checked again: still payable, the amounts as they are
  now;
- **approved, then paid** (the "pay" right):
  - **the bank file:** one file for the batch, from Payroll Setup's
    formats. Each row is the employee's net or the loan amount. Those
    without an IBAN are listed to pay by cash or cheque;
  - **Mark paid** from a cash or bank account, on the payment date. Each
    item gets its own journal, with the batch number as the reference
    and `PayrollInterimID`:
    - a settlement: PayrollPayment (PAYP), Dr Salaries Payable / Cr the
      account;
    - a loan: PayrollLoan (PLN), Dr its receivable / Cr the account. The
      loan becomes Active and is recovered by the runs, as before;
  - **all or nothing:** if one journal fails, those written before it are
    reversed, the batch stays approved, and the message says why;
- **reversing the payment** (with a reason) reverses every journal. It is
  refused if a loan has been recovered or repaid since. Settlements go
  back to unpaid, loans to Approved, and the batch to a draft, to change,
  submit again or delete.

**Behind it:**
- `payrollInterim.js` (new);
- `payrollRun.js`:
  - `extrasFor` (the carry forward and arrears, shared with the run);
  - `settledIn` (who a settlement pays in a month);
  - `unpaidMonths`;
  - `salaryFor` (a settlement's months, by `computeEmployee`);
- `payrollSettlement.js`:
  - the salary months, inputs and accrual share in `compute`;
  - the checks before submitting;
  - `pay` / `unpay`, shared with the batch;
- `payrollLoans.js`: `payOut` / `reversePayout`, shared with the batch;
- `payrollPost.js`: the run's submit check;
- `hrLeave.js`: leave frozen after a settlement;
- registries:
  - module `PAYROLLIP`;
  - its menu node;
  - approval entry `PAYROLLIP` (storage `payrollInterim`);
  - Home drafts (dated by the payment date);
- screens:
  - `PAYROLLFS`: the Salary section and inputs; the batch note;
  - `PAYROLLIP` (new);
  - `PAYROLLLOAN`: the batch note;
  - `PAYROLL`: "Paid by final settlement".

**Tests:**
- the `payrollInterim` suite (4);
- the `payrollSettlement` suite (4), updated: a draft with no run pays
  the leaving month's salary;
- `payrollInterim.ui.js` (3);
- `payrollSettlement.ui.js` (4), updated;
- negative controls (see the PR).

**To go live:**
1. Deploy "functions set" `payroll-5c` with the screens (after
   `payroll-5b`). No Hosting change.
2. Link a menu node to "Interim Payroll".
3. Set its rights in Roles & Permissions (draft to prepare and submit,
   pay to pay and reverse).
4. If batches need approval: Approval Configuration → "Interim payroll".

## Step 6 design: the owner's points of 2026-10-06 (proposed)

### The owner's points

> 1. A sick leave medical certificate can be optional: the approver
>    decides whether to accept the leave without it. Also highlight what
>    the approver accepted without a certificate attached.
> 2. In Payroll Setup, rename the "Payroll" tab, e.g. Payroll accounting or
>    Payroll mapping.
> 3. Unpaid leave deduction in the GL, an option for each company: reduce
>    the elements pro rata, or a separate unpaid leave ledger in setup.
> 4. Every payroll posting's TXN ref in the GL is STK (for stock); use the
>    finance one (TXN). Also the link from the GL doesn't work.
> 5. Payroll payment can be part cash or from different banks, so a
>    "prepayment" step is needed before payment.

### 1. The supporting document (Leave Register; docs/modules/HR_LEAVE.md)

Today a leave type's "document required after N days" (Sick Leave: after
1 day) blocks submitting until a file is attached.

Proposed (question 44):
- a missing document no longer blocks submitting. The leave shows
  "No supporting document attached";
- **the approver decides:**
  - their approval panel says the document is missing;
  - approving asks them to confirm that they accept it without the
    document;
  - the leave records "Accepted without document" (who, when);
- **with no approval set up**, the same confirmation is asked of the
  person submitting;
- **highlighted** until a document is attached:
  - an amber "No document" badge in the Leave Register list and on the
    leave;
  - a filter "Accepted without document";
  - a column in Leave Reports → Register;
- attaching the file later clears the highlight. The record of who
  accepted it stays in the history.

### 2. The tab's name

"Payroll" in Payroll Setup becomes **"Payroll Accounting"** (question 45):
each company's daily rate, Salaries Payable, Recoverable, and each pay
element's GL account. Labels only; nothing moves.

### 3. Unpaid leave in the GL: per company (Payroll Accounting)

A new company setting, **"Leave deductions in the GL"**:
- **Separate ledger** (as today): each leave deduction (unpaid leave,
  absence, reduced-pay leave) is credited to its own system element's
  account;
- **Pro rata on the elements:** the deduction reduces the expense of the
  earnings it was worked out from. A day's rate is made up of those
  elements (e.g. basic 200 + housing 100 a day). An unpaid day credits
  basic's account 200 and housing's 100, so salary expense shows what
  was actually earned. The payslip still shows the deduction on its own
  line; only the journal changes.

Which deductions it covers is question 46. The journal keeps clubbing by
account and cost center, as now.

### 4. The GL reference and the link from the GL (a fix)

**The reference:** payroll journals (run, payment, loan payout and
repayment, accrual claim, final settlement and their reversals) get their
reference from the stock sequence (STK-…), since they are written through
the shared stock posting path. They will take the finance sequence
(TXN-…, the same lifetime counter as JV and CBT). Entries already posted
keep their STK reference: an audit reference is never rewritten.

**The link:** the GL report opens an entry in the module its voucher type
belongs to. Payroll voucher types aren't in that map, so it sends them to
Journal Vouchers. That screen lists only JVs and says the entry can't be
found. Fix:
- the map (a documented patch in `tools/legacy-port/patches.js`) gets:
  Payroll → Payroll, PayrollPayment → Payroll, PayrollLoan → Loans &
  Advances, PayrollProvision → Payroll, FinalSettlement → Final
  Settlements;
- each of those screens opens the document behind the journal: the run,
  the settlement, the loan, or the interim batch. A payment journal goes
  to the settlement or batch it paid when it isn't a run's.

The same gap affects Fixed Assets, PDC, Recurring Journals and Opening
Balances journals (also STK, also sent to Journal Vouchers). They are
outside this request: noted for a later fix.

### 5. Preparing the payment (Payroll → a run's payment, and Interim Payroll)

Today a posted run is paid in one go:
- one bank file for those with an IBAN;
- one Mark paid from one cash or bank account, a single journal.

Proposed: **a payment plan** before paying (question 47):
- **each employee's way** is listed, defaulted from their record: by bank
  file if they have an IBAN, else cash. It can be changed per employee:
  - bank file (from one of the company's bank accounts);
  - cash (a cash account);
  - cheque or bank transfer (a bank account);
- **the plan groups them by account** and shows each group's count and
  total;
- **each group is paid on its own:**
  - its bank file, for a bank-file group;
  - Mark paid with its own date, reference and journal: Dr Salaries
    Payable / Cr that account;
- **the run is paid** once every group is. Each group's payment can be
  reversed on its own;
- **Interim Payroll** batches take the same plan.

### Open questions for step 6

44. **The document:** never block; the approver accepts it without the
    document, with a confirmation, and it's highlighted until attached
    (recommended)? Or a per-leave-type choice between "required" (as
    today) and "optional, approver decides"?
45. **The tab's name:** "Payroll Accounting" (recommended) or "Payroll
    Mapping"?
46. **Pro rata covers:** every leave deduction (unpaid leave, absence,
    reduced-pay leave; recommended), or unpaid leave only?
47. **The payment plan:** each employee paid one way, groups paid
    separately (recommended)? Or also splitting one employee's net
    between two ways (e.g. part cash, part bank)?
