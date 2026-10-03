# HR: Attendance and Leave Register

Status: **design agreed** (owner's decisions 2026-10-03, below); **step 1 built and tested** (see As built); step 2 next. Comes
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

## The owner's decisions (2026-10-03)

| # | Question | Decision |
|---|---|---|
| 1 | Attendance depth | **Leave plus unauthorised absences only.** Everyone else is assumed present. There is no daily time or monthly sheet for now. |
| 2 | Approval | **Through Approval Configuration**, like Employee Change: levels per company and so on, or switched off. HR saves and submits, and approvers act from Home. |
| 3 | Leave year and accrual | **Calendar year (Jan–Dec), accrued monthly**, for example 30 days a year = 2.5 days a month, pro-rata for joiners. |
| 4 | Carry forward | **Up to a cap per leave type; the excess lapses.** The lapse is logged. |
| 5 | Over the balance | **The excess is split off as Unpaid automatically.** The screen shows it before saving. There are no negative balances. |
| 6 | Scope of rules | **One set for the group**, for entitlements and leave pay rules (by grade level). There are no company overrides. |
| 7 | Resumption | **Confirmed for marked types.** Each leave type has "confirm return" (seeded on Annual and Maternity). A late return becomes unpaid absence once HR confirms it, and overdue returns are a Home task. |
| 8 | Weekends and holidays inside a leave | **Set per leave type.** Seeded: Annual counts working days; Sick, Maternity and Unpaid count calendar days. |
| 9 | Back-dated into a locked month | **Carried to the next open month as an adjustment.** A payroll already run never changes. |

**What changes in the design:**
- **Attendance (section 3) is Absences only.** There is no `ATTENDANCE`
  module. Absences are part of the Leave Register, under `LEAVE` rights.
- **Entitlements and pay rules have no company column.** The working
  calendar stays per company, because weekends and holidays really
  differ.
- **Build order, as decided:**
  1. Setup:
     - leave types;
     - working calendar per company;
     - entitlement policies (accrued monthly, carry-forward cap);
     - leave pay rules (grade-level and day bands, validated).
  2. Leave Register:
     - entry, day count, balance with the automatic Unpaid split, and the
       pay split;
     - approval through Approval Configuration, cancel, and the
       confirmed return;
     - opening balances (import sheet);
     - the balance card on the employee.
  3. Absences, and the month summary and lock: back-dated entries go to
     the next open month as adjustments, and the year-end carry forward
     and lapse.
  4. Reports (balances, register, absences), the Home blocks (on leave
     today, returning, overdue returns), and the who-is-away calendar.

  Then Payroll, with its own design.

## As built: step 1, the setup (2026-10-03)

HR Setup has two new tabs. The rights are HR Setup's: read with HR Setup
or Employees access, changed with HR Setup write.

**Leave Types:**
- **The nine to start**, a start only, all editable:

  | Type | Settings | Entitlement | Pay |
  |---|---|---|---|
  | Annual | balance, working days, half days, after probation, HR confirms the return | 30 days a year, carry up to 30 | Full salary |
  | Sick | calendar days, up to 90 a year, document after 1 day | — | days 1–15 full; 16–45 at 50%; 46+ unpaid |
  | Unpaid | calendar days | — | unpaid |
  | Maternity | women, calendar days, up to 60 at a time, HR confirms the return | — | days 1–45 full; 46+ at 50% |
  | Paternity | men, working days, 5 a year | — | full |
  | Business Travel | **Duty**, paid as working | — | no rules |
  | Hajj | after probation, up to 30 at a time | — | unpaid |
  | Compassionate | up to 5 at a time | — | full |
  | Study | working days, 10 a year | — | full |

- **Settings per type:**
  - Leave or Duty, uses a balance;
  - working or calendar days, half days;
  - who it is for (everyone, women, men), after probation only;
  - most days a year, most days at a time, a document needed after N days;
  - HR confirms the return;
  - in use.

  Duty never uses a balance.

- **Entitlement** (types that use a balance):
  - rows of grade levels × completed years of service → days a year, in
    half days;
  - the most days carried into the next year (required; 0 is none).

- **Leave pay rules** (every Leave type):
  - rows of grade levels × day band (the 1st, 2nd, … day of that type in
    the leave year; "to" blank for no end);
  - paid as Full salary (every fixed earning), Basic only, Selected
    elements (fixed earnings only), or Unpaid, at a %. Unpaid is always 0%.

- **The checks:**
  - **overlapping rows are refused**, so a grade level and a day (or
    service year) match one row only;
  - **gaps are warned against the real grades** (for example "G5 (level
    5): no rule for days 16–20"), on the type and as "(n to check)" in
    the list. A gap is allowed, but leave in it can't be paid until
    fixed.

- **The list** shows each type's entitlement and pay in words, for
  example "Levels 1–4: Basic only" and "All grades, days 16–45: Full
  salary at 50%".

**Working Calendar,** per company and year:
- the weekend days, Saturday and Sunday to start;
- the public holidays, as rows with a first day, an optional last day
  (up to 15 days) and a name. Overlaps are refused, other years are kept,
  and "Copy last year's" adds last year's holidays on the same dates to
  adjust;
- "Working days in <year>: n".

Changed only for the user's own companies.

**Behind it:**
- `functions/src/hrLeaveSetup.js` (6 callables):
  - Firestore `hrLeaveTypes` (with the entitlement and pay rules on each
    type) and `hrWorkCalendars` (one per company);
  - `loadLeaveSetup`, `calendar` and `workingDays` for step 2.
- `functions/src/workCalendar.js`: the day count (working or calendar
  days, skipping weekends and holidays), free of Firebase so the Leave
  Register and the tests share it.

**Tests:**
- The `hrLeaveSetup` suite (4) and `hrLeaveSetup.ui.js` (5).
- Nine negative controls caught:
  - overlapping entitlement rows saved;
  - gaps not warned;
  - Duty with a balance;
  - holidays counted as working days;
  - another company's calendar;
  - a variable element paid during leave;
  - Unpaid at a %;
  - the screen copying last year's holidays without moving the year;
  - the screen dropping the ticked elements.

**To go live:**
1. Deploy "functions set" `hr-leave-1`, with the screens.
2. In HR Setup, set:
   - the pay rules and entitlements by grade level;
   - each company's weekend and this year's holidays.

**Next:** step 2, the Leave Register.

