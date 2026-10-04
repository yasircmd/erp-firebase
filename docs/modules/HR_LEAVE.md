# HR: Attendance and Leave Register

Status: **design agreed** (owner's decisions 2026-10-03, below); **steps 1–3 built and tested** (see As built); step 4 next. Comes
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

## The owner's decisions for step 3 (2026-10-04)

| # | Question | Decision |
|---|---|---|
| 10 | Unauthorised absences | **HR records them, approval optional:** an Absence entry in the Leave Register, through its own Approval Configuration entry ("Absence"), else final at once. Always unpaid. |
| 11 | Accrual on unpaid days | **Unpaid days don't accrue:** each unpaid day (unpaid leave, the part over the balance, unpaid tiers, absences) reduces that month's accrual pro-rata. |
| 12 | Month lock | **HR locks; Admin can reopen:** per company and month, after the month ends, in order. Refused while leave in that month is a draft or pending. Locking posts that month's accrual at each employee's grade then. Only the latest locked month can be reopened, with a reason, and it is logged. |
| 13 | Year end | **HR runs "Close leave year"** per company after December is locked. It shows each balance, what carries (up to the cap) and what lapses. HR confirms, each lapse is logged, and it runs once a year. |
 (2026-10-03)

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

## As built: step 2, the Leave Register (2026-10-04)

**Leave Register** (new screen `LEAVE`, menu node "Leave Register"):
- **The list:**
  - number, employee, type, dates, days ("4 unpaid", "2 late"), status;
  - filters: search, type, a month, and status: all, open, **on leave
    today**, **return to record**, and each status.
- **A leave:**
  - employee, type, first and last day, half days (types that allow
    them), reason;
  - as it is typed, the server shows:
    - the days;
    - the pay split (e.g. "6 Annual Leave — Basic only; 4 Unpaid (over
      the balance)");
    - the balance on the first day and after;
    - any warnings, including that a document is needed;
    - any rule it breaks.
- **Lifecycle:**
  - Draft → Submit → approval through Approval Configuration ("Leave";
    the amount is the leave's days; scope by the employee's company,
    division, branch, cost center), or approved at once when none is set
    up → Approved;
  - rejected leave is corrected and submitted again;
  - numbers LV-<year>-0001 by the first day's year;
  - Home approval tasks and My Drafts as for other documents;
  - supporting documents below the leave, filed under the company → year
    → Leave Register in Drive.
- **Cancel:** approved leave that hasn't started, with a reason. Its days
  return.
- **The return** (approved leave, once it has started; "HR confirms the
  return" types show as "return to record" after their last day):
  - HR enters the day the employee was back, sees what it will do, and
    confirms;
  - **early:** the days from the return on are dropped and go back to the
    balance;
  - **late:** the working days between the expected return (the next
    working day after the leave) and the actual one are added as **unpaid
    absence** lines.

**The rules each leave is checked against** (when typed, saved, submitted
and approved):
- the dates: after joining, not for someone who has left, at most a
  year;
- a working-days type must start and end on working days;
- the type: in use, for the employee's gender, after probation, whole
  days unless it allows half days, at most N at a time, at most N a year
  (approved and pending leave of that calendar year);
- **no overlap** with another live leave (draft, pending, approved);
- **a pay rule for every day:** else "No leave pay rule for … at grade …,
  day …: set it in HR Setup";
- **a document** (e.g. a medical certificate) attached before submitting,
  when the leave is longer than the type's "document after N days".

**Days and pay:**
- Each leave stores one **line per day it counts**: the date, the
  fraction (half days), the code (the type's, `UNPAID` for days over the
  balance, `ABSENT` for a late return) and the pay.
- **The pay** is the type's leave pay rule for the employee's grade level
  and the day's number in the calendar year for that type, counting
  approved and pending leave before it. So sick leave goes from full to
  half pay across several leaves.
- Duty (business travel) is "paid as working".
- Step 3's month summary and Payroll read these lines.

**The balance** (types that use one), on a date:
- **opening:** imported, on its balance date;
- **plus accrued:** from the day after the opening date (or from joining
  when there is none);
  - each month earns a twelfth of the entitlement row for the employee's
    grade level and completed years of service, pro-rata by the days of
    the month;
- **plus adjustments:** each with a reason;
- **less taken:** approved leave up to the date;
- **less booked:** approved leave after the date, and pending leave.

Leave and adjustments dated on or before the opening date are already in
it.

- **Over the balance (decision 5):** a leave takes what is available on
  its first day, in half days. The rest becomes Unpaid automatically,
  shown before saving and re-checked at submit and at approval.
- **Known simplifications,** for step 3 and Payroll:
  - accrual uses the employee's **current** grade for every month, so a
    promotion re-rates the months before it until step 3 posts the
    months;
  - unpaid leave still accrues;
  - the year-end carry forward and lapse come in step 3;
  - a leave shortened by an early return doesn't renumber the pay days
    of leave approved after it.

**On the employee record:** a **Leave** card (with Leave Register access):
- each balance (opening, accrued, adjusted, taken, booked, available)
  today;
- each other type's days this year (and its yearly limit);
- the employee's leave, each opening in the Leave Register with "Back to
  Employees";
- **New leave**;
- **Adjust a balance** (type, ± days in half days, date, reason; "post"
  right). This is also how a wrong opening balance is corrected.

**Opening balances:** Master Data Import → **Leave Opening Balances**:
- columns: employee, leave type (code or name, a type that uses a
  balance), days (0 or more, half days), balance date;
- one per employee and type; a second is refused ("correct it with an
  adjustment");
- needs the Leave Register "post" right and the employee's company.

**Rights:** module `LEAVE`:
- access: Admin and Finance Manager;
- draft (enter): Admin;
- post (submit, cancel, the return, adjustments, opening balances): Admin.

Approvers need its access.

**Behind it:**
- `functions/src/hrLeave.js` (12 callables).
- Firestore:
  - `leaveRequests` (the leaves, with their lines);
  - `leaveOpenings`;
  - `leaveAdjustments`.
- Counter `hrCounters/LV-<year>`.
- Registered in:
  - approvalRegistry (gateable, storage);
  - homeTasks (My Drafts);
  - attachments (source `LEAVE`);
  - moduleRegistry, treeSeedNodes;
  - masterImport (`LEAVEBAL`).

**Tests:**
- The `hrLeave` suite (7) and `hrLeave.ui.js` (5).
- Eleven negative controls caught:
  - no split over the balance;
  - whole months accrued;
  - day numbers restarting with each leave;
  - pending leave not counted;
  - overlaps allowed;
  - no document needed;
  - no absence for a late return;
  - an early return not giving days back;
  - a started leave cancelled;
  - the screen not showing the days as typed;
  - "return to record" listing returned leave.

**To go live:**
1. Deploy "functions set" `hr-leave-2`, with the screens.
2. In the app:
   - link a menu node to **Leave Register**;
   - check its row in Roles & Permissions;
   - set up its approvals (Approval Configuration → "Leave (the amount
     is the days)");
   - import the opening balances.

**Next:** step 3: absences, the month summary and lock, the year-end carry
forward and lapse.

## As built: step 3, absences, the month close and the year close (2026-10-04)

**Absences (decision 10):**
- A system leave type, **"Absence (unauthorised)"** (code `ABSENT`).
  - It is added once to an existing setup.
  - Its kind is fixed, and no other type can be an absence.
- Entered in the Leave Register like leave: working days, half days.
  - Always unpaid, with no balance and no pay rules.
  - It shows as "Absent, unpaid".
  - A late return's absence reads "Absent (late return), unpaid".
- It is approved through its own Approval Configuration entry, **"Absence,
  unauthorised (the amount is the days)"**, and is final at once when
  that is not set up.
- An absence can be cancelled at any time (recorded in error); leave
  only before it starts.

**Accrual (decision 11):**
- Each month earns its rate less its unpaid days, pro-rata. Unpaid days
  are:
  - unpaid leave;
  - the part over the balance;
  - unpaid tiers (e.g. sick day 46+);
  - absences.
- An unpaid day counts in the month it is paid in, so a back-dated one
  reduces the next open month.

**Pay months (decision 9):**
- When a leave is approved, each line gets the month it is paid in:
  - its own month;
  - or, if that month is locked, the next open month.
- A line taken away after its month was locked (an early return, a
  cancelled absence) is **reversed** in the next open month, as a negative
  line.
- Reversals are pay adjustments only, never days taken.

**The month close (decision 12):** Leave Register → **Month close**, per
company.
- **Lock:**
  - after the month ends, in order: the first lock can be any ended
    month, then only the next one;
  - refused while leave dated up to the month's end is a draft or
    pending ("decide or delete it first");
  - right: "lock".
- **Locking:**
  - takes the **summary for payroll**, per employee:
    - paid leave by type and how it is paid (full, basic, selected
      elements, %);
    - unpaid, absent and duty days;
    - adjustments (days dated in an earlier month or reversed);
    - the accrual;
  - **posts each employee's accrual** for the month at their grade then,
    in Firestore `leaveAccruals`. Balances use the posted figure for a
    locked month, so a later promotion doesn't re-rate it.
- **Reopen:**
  - the latest locked month only, with a reason, logged;
  - its accrual is taken back and posted again when it is re-locked;
  - December stays locked once its year is closed;
  - right: "reopen".
- The summary of an open month shows as it stands.

**The year close (decision 13):** in Month close, per company and year.
- It shows each employee's balance at 31 December (what was earned and
  adjusted, less what was taken), what carries (up to the type's cap) and
  what lapses.
- Once December is locked, "Close the year" records each lapse as an
  adjustment on 31 December (kind Lapse, with the reason).
- Once per company and year (`leaveYearCloses`). Left employees are not
  included.

**Rights:** `LEAVE` gets two more:
- **lock:** lock months, close the year;
- **reopen:** reopen a month.

Both default to Admin.

**Behind it:**
- `functions/src/hrLeaveClose.js` (5 callables).
- Firestore `leaveMonths` (status, history, the locked summary),
  `leaveAccruals`, `leaveYearCloses`.
- `hrLeave.js`: pay months, reversals, absences, and accrual less unpaid
  days or as posted.

**Tests:**
- The `hrLeaveClose` suite (5) and `hrLeaveClose.ui.js` (4).
- The step 1–2 suites and UI tests still pass, updated for the absence
  type.
- Twelve negative controls caught:
  - locking a month not ended;
  - locking out of order;
  - locking over undecided leave;
  - accrual ignoring unpaid days;
  - posted accrual ignored;
  - no reversal after a lock;
  - back-dated lines paid in a locked month;
  - no carry cap;
  - reopening an older month;
  - absences on the leave approval entry;
  - the screen offering Lock on any month;
  - the year close offered before December is locked.

**To go live:**
1. Deploy "functions set" `hr-leave-3`, with the screens.
2. In Roles & Permissions → Leave Register, tick "lock" (HR) and "reopen"
   (Admin).
3. If absences need approval, set up Approval Configuration → "Absence,
   unauthorised".

**Next:** step 4: reports (balances, the register, absences), the Home
blocks (on leave today, returning, overdue returns) and the who-is-away
calendar.

