# HR: Attendance and Leave Register

Status: **design, waiting for the owner's decisions** (2026-10-03). Comes
before Payroll (docs/modules/HR_PAYROLL.md, to come), which reads its
results.

## The request (owner, 2026-10-03)

1. For now the HR executive records each employee's leave. Later an
   employee app lets employees apply for leave themselves.
2. Leave types: Unpaid, Annual, Sick, Maternity, Business travel, etc.,
   with the option to add more.
3. Pay during leave depends on the leave type **and the grade**: for
   example, annual leave at a low grade may pay only the basic, while a
   top grade gets the full salary. This must be configurable.

## What exists today (from the code)

- **Employees** (docs/modules/HR_EMPLOYEES.md, live), with:
  - company, join date, status, gender, line manager;
  - the link to an ERP user (`UserUID`), which is the hook for
    self-service later.
- **Grades:** one ladder for the group, with a level from 1 to 99.
  Higher is more senior.
- **Pay elements:** Basic, Housing, Transport, Other (fixed), and Bonus,
  Commission (variable). Each employee's compensation is effective-dated,
  so "basic only" or "full salary" on a given date can be worked out.
- **Reusable as is:**
  - the approval engine;
  - Home tasks;
  - supporting documents (for example, a sick certificate on a leave
    entry);
  - Master Data Import, for opening balances;
  - the expiry-reminder pattern.
- **Missing:**
  - a working calendar: no weekends per company and no public holidays;
  - anything about time or absence.

## What the request leaves open (the missing parts)

A leave register that payroll can trust needs these too:

1. **Working calendar:** the weekend days of each company and its
   public holidays. Without them, "5 days of annual leave" can't be
   counted.
2. **Entitlement:**
   - how many days each employee earns, by grade and/or years of service;
   - when they are credited (monthly or yearly);
   - the leave year.
3. **Carry forward and expiry:** unused days at the year end are capped,
   lapse, or are encashed.
4. **Opening balances:** each employee's balance on the go-live date,
   imported from Excel.
5. **Eligibility rules per leave type:**
   - gender (Maternity, Paternity);
   - after probation only;
   - maximum days per year or per instance;
   - a document required (a sick certificate after N days);
   - whether it uses a balance (Annual) or not (Business travel, Unpaid).
6. **Tiered pay inside one leave type:** UAE sick leave pays the first 15
   days in full, the next 30 at half pay, and the next 45 unpaid,
   counted per year. A single "paid / unpaid" setting can't express
   that, so the pay rule needs day bands.
7. **Half days**, and whether weekends and holidays inside a leave count
   (usually not for annual leave, usually yes for maternity and sick).
8. **Return from leave (resumption):** the actual return date. A late
   return becomes absence (unpaid) and an early return gives days back.
9. **Absence without leave:** recorded so payroll deducts it. This is
   the "attendance" half.
10. **Overlaps and edits:** no two leaves on the same day. An approved
    leave is cancelled or shortened with a reason, never silently edited,
    and the balance follows.
11. **What payroll receives:** for each employee and month, the days
    paid at full rate, the days paid at basic, the days paid at a %, and
    the unpaid days. The register states these days and the payroll
    module prices them.
12. **Visibility:**
    - who is on leave today or this week (Home);
    - overdue returns;
    - balance and register reports with Excel export.
13. **Later, noted now so the design allows them:**
    - self-service apply, with approval by the line manager;
    - leave salary paid in advance;
    - air-ticket entitlement;
    - unpaid days reducing end-of-service gratuity service.

## Proposed design

### 1. Setup (HR Setup gets new tabs)

- **Leave Types.** Seeded with:
  - Annual, Sick, Unpaid, Maternity, Paternity, Business Travel, Hajj,
    Compassionate, Study;
  - each with Code, Name and Active.

  Admins add more. Each type has these settings:
  - **Uses a balance:** yes or no;
  - **Counts:** working days or calendar days;
  - **Half days allowed;**
  - **Gender:** any, female, or male;
  - **After probation only;**
  - **Maximum days:** per year and per instance (blank means none);
  - **Document required after N days;**
  - **Kind:** "Leave" or "Duty". Business travel is Duty: the employee is
    paid as working and it is not an absence.

- **Working Calendar** per company:
  - the weekend days (for example Sat and Sun, or Fri only);
  - public holidays by date, entered per year and copied from the last
    year as a start.

- **Entitlement Policies** per leave type that uses a balance:
  - rows for "grade level from–to" and "service years from–to", giving
    days per year (for example: levels 1–4, 22 days; level 5 and above,
    30 days; after 5 years, plus 2);
  - accrual: monthly or yearly;
  - carry-forward cap and what happens to the excess.

- **Leave Pay Rules** per leave type, a small table:
  - **grade level from–to**;
  - **day band**: days of this type used in the leave year, from–to,
    for tiers such as sick leave;
  - **pay**: one of Full salary (all fixed earnings), Basic only,
    Selected elements (ticked from Pay Elements), or Unpaid;
  - **%**: 100, 50, and so on.

  Examples:
  - Annual, levels 1–4: Basic only, 100%. Annual, level 5 and above:
    Full salary, 100%.
  - Sick, days 1–15: Full, 100%. Days 16–45: Full, 50%. Days 46–90:
    Unpaid.

  The screen checks that bands don't overlap and that every grade is
  covered.

### 2. Leave Register (new screen `LEAVE`, HR records it)

- **New leave:**
  - employee, type, from and to, half day at the start or end, reason,
    and documents;
  - the screen shows:
    - the days it counts (working or calendar, minus holidays);
    - the balance before and after;
    - the pay split (for example, "3 days full, 2 days at 50%");
    - any rule it breaks.
- **Lifecycle:** Draft → Submit → (approval, if configured) → Approved →
  Taken / Resumed. Approved leave can be:
  - cancelled with a reason, returning the days;
  - shortened by an early return, returning the unused days;
  - extended through a new entry.
- **Resumption:**
  - HR confirms the actual return date for leave of the configured types;
  - a late return creates an unpaid absence for the days in between, after
    HR confirms it.
- **Balances:** computed from the opening balance, plus accruals, minus
  approved leave, plus or minus adjustments (each with a reason). A
  balance card on the employee record and in the register.
- **Opening balances:** a "Leave balances" sheet in Master Data Import,
  with employee number, leave type, days, and as-of date.

### 3. Attendance (depth to be decided, question 1)

At least, **Absences**:
- unauthorised absence days per employee, entered by HR;
- they are unpaid and show in the register and the payroll summary.

Optionally, per the owner's answer:
- a monthly attendance sheet (days worked, overtime hours);
- daily time in and out with a biometric import.

### 4. Month close for payroll

**Attendance Month** per company:
- HR reviews the month's summary for each employee: paid full, at basic,
  at %, unpaid, absent, and overtime if kept;
- HR then **locks** it;
- payroll reads only locked months;
- a leave entry back-dated into a locked month is refused, or goes to
  the next month as an adjustment (question 9).

### 5. Screens and Home

- **HR Setup** gets new tabs:
  - Leave Types;
  - Working Calendar;
  - Entitlements;
  - Leave Pay Rules.
- **Leave Register:**
  - the list, with filters for company, type, status and month;
  - the entry;
  - a month calendar view of who is away.
- **The Employees record** gets:
  - a Leave tab with balances and history;
  - a link to new leave.
- **Reports:**
  - Leave Balances, as on a date;
  - the Leave Register by period;
  - Absences;
  - all with Excel export.
- **Home:**
  - On leave today and returning this week;
  - Overdue returns;
  - Leave waiting for approval, through the existing approval tasks.

### 6. Rights

- New modules:
  - `LEAVE` (access, draft, post);
  - `ATTENDANCE` (access, write, lock), if attendance goes beyond
    absences.
- Leave Setup sits under HR Setup's rights.
- Leave pay amounts are sensitive. They show only with the Employees
  sensitive right. Days and types are not sensitive.

### 7. Build order (each step tested and deployed on its own)

1. Setup:
   - leave types;
   - working calendar;
   - entitlement policies;
   - leave pay rules (with the validation).
2. Leave Register:
   - entry, day count, balance and pay split;
   - approval, cancel, resumption;
   - the opening-balances import;
   - the balance card on the employee.
3. Absences, and attendance per the owner's answer.
4. Month summary and lock (the payroll hand-off).
5. Reports and Home blocks, plus the who-is-away calendar.

Then Payroll, with its own design.

## Open questions for the owner

1. **Attendance depth:**
   - (a) leave plus unauthorised absences only, everyone else assumed
     present;
   - (b) also a monthly sheet (days worked, overtime hours);
   - (c) daily time in and out, with a biometric import later.
2. **Approval of leave entered by HR:**
   - recorded directly;
   - through Approval Configuration (like Employee Change);
   - or the line manager first, then HR.
3. **Leave year and accrual:**
   - calendar year or the employee's joining anniversary;
   - monthly accrual (for example 2.5 days a month) or the full year
     credited at the start.
4. **Carry forward:**
   - up to a cap, with the rest lapsing;
   - all carried;
   - or up to a cap, with the rest encashed in payroll.
5. **Over the balance:**
   - block it;
   - warn and allow a negative balance;
   - or split the excess automatically into Unpaid.
6. **Leave pay rules and entitlements:**
   - one set for the group (by grade level);
   - or a company can override.
7. **Resumption:** must HR confirm the return for every annual leave,
   with a late return becoming unpaid absence, or only when needed?
8. **Weekends and holidays inside a leave:**
   - set per leave type (proposed: annual counts working days, sick and
     maternity count calendar days);
   - or the same for all.
9. **Back-dated leave after the month is locked:** refuse it, or carry
   it to the next month as an adjustment (proposed)?

Left to the Payroll design: the daily rate for unpaid days (/30,
/calendar days, /working days), leave salary in advance, encashment
amounts, and air tickets.
