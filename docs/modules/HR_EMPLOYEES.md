# HR: Employee Records

Status: **step 1 built and tested** (2026-10-03; see [As built: step 1](#as-built-step-1-2026-10-03)); steps 2–5 to come. Payroll is a
separate module, designed after this one (docs/modules/HR_PAYROLL.md, to
come).

## The request (owner, 2026-10-03)

"Now we need to build the HR module - two sub module - Employee records and
Payroll. Below are some my ideas for Employee records
1. Except the normal field admin can add flexi columns (date, text and
   amount) and mark as option or compulsory.
2. Employee documents upload - ID, passport, experience and education
   certificates, etc
3. Compensation details - Basic Salary and other Allowances, bonus,
   commission, etc (but the Elements will be created in Payroll Module)
4. Each employee will have a line manager, but can postponed to update it
   later. If a line manager replaced automatically change the record of
   subordinates
5. Each employee will have a grade (use how big corporate use) and
   designation
6. Promotion and increment with approvals, and should keep all history"

## What exists today (from the code)

- **No employee data.** The menu has placeholder nodes under HUMAN CAPITAL
  MANAGEMENT (Personnel Administration, Organizational Management, Payroll
  Accounting, ...), with no modules behind them. Fixed Assets reserved a
  "responsible employee" field for when an employee master exists.
- **Reusable as is:**
  - companies, user access per company, roles and permissions per module;
  - organizational units: Division, Branch, Cost Center, Profit Center
    (there is **no Department** type);
  - the approval engine (Approval Configuration: levels of named approvers,
    scope Global / Company / Division / Branch / Cost Center, amount
    thresholds, Home tasks, Approval Tracker, delegation);
  - document storage in Google Drive (checked uploads, opened only through
    the ERP, never deleted), and the expiry-reminder pattern from Company
    Documents;
  - Master Data Import (paste from Excel, check, import), which can take a
    new "Employees" sheet.
- **ERP users** (User Management) are logins, not employees. An employee
  can be linked to a user later (for approvals by line manager and
  self-service).

## Proposed design

### 1. Masters (set up once, by HR / Admin)

| Master | What it holds | How big companies use it |
|---|---|---|
| **Grades** | Code (e.g. G1–G15, or M1–M4 / E1–E5), name, **level** (for ordering: a promotion goes up), **pay band**: minimum, midpoint, maximum monthly basic (per company or group-wide), active | The grade fixes the band an employee's pay must sit in; designations map to grades |
| **Designations** (job titles) | Title, the grade (or grade range) it normally carries, department, active | "Senior Accountant" is G7–G8 |
| (Departments) | None: the **cost center** is the department (owner decision 3) | |
| **Employee fields** (flexi columns) | Label, type (**date, text or amount**; owner point 1), **compulsory or optional**, section of the form it shows in, order, active | Admin adds them without code; a compulsory field added later shows as "missing" on existing employees until filled |
| **Employee document types** | Passport, Emirates ID, Visa / Residence, Labour card, Education certificate, Experience certificate, Employment contract, Other; Admin adds more; whether it has an expiry date and a number | |

### 2. The employee record

- **Personal:**
  - employee no. (question 1), full name (and name as in passport), photo;
  - gender, date of birth, nationality, marital status;
  - mobile, personal email, address;
  - emergency contact.
- **Employment:**
  - company, date of joining, probation end;
  - employment type (permanent, contract, part-time);
  - status: Active, On notice, Left;
  - leaving date and reason.
- **Organization:** division, branch, cost center (= the department,
  owner decision 3), work location.
- **Job:** designation and grade (both required); line manager (optional,
  owner point 4).
- **Pay out:** bank name and account no. / IBAN, standard fields (needed
  by Payroll; owner, follow-up to decision 11). UAE details (Emirates ID,
  visa, labour card, WPS routing) are flexi fields.
- **Link:** the ERP user (optional).
- **Flexi fields:** the ones Admin defined, compulsory ones checked on save.
- **Tabs on the record:** Overview, Documents, Compensation, History.

### 3. Employee documents (owner point 2)

Like Company Documents:
- each document is a record: type, number, issue and expiry dates;
- the files are kept in the connected Drive under
  `ERP Documents/<company>/Employees/<employee no. – name>/<type>/`;
- the files are checked as for entries (PDF, Word, Excel, images, 10 MB);
- a document is removed into Removed, never deleted.

**Expiry reminders** (passport, visa, Emirates ID, labour card): a Home
task, "Employee documents expiring", from N days before (question 6).

### 4. Compensation (owner point 3)

- The employee's pay is a list of **pay elements** with amounts:
  - Basic, Housing, Transport, other allowances;
  - agreed bonus or commission terms.
- The elements themselves (code, name, earning / deduction, fixed or
  variable, GL account) belong to **Payroll** (question 4 on how to start).
- Every compensation is **effective-dated**: a change never overwrites. It
  adds a new version from a date, so the history is complete. Payroll later
  takes the version in force for each month.
- Basic is checked against the grade's pay band (question 5: warn or
  block).
- Who can see salaries is a **separate permission** (question 7).

### 5. Line manager (owner point 4)

- Optional on the record; can be filled later. Must be an active employee,
  never the person themselves or someone who reports to them (no loops).
- **Replace manager:** choose the outgoing manager and the new one; all
  their direct reports move to the new manager in one step, each record
  noting the change in its history. When a manager leaves (status Left)
  with reports still assigned, the ERP asks for the replacement first.
- An **organization chart** view (who reports to whom) comes for free from
  this.

### 6. Promotions and increments, with approvals (owner point 6)

A new document, **Employee Change** (HR action), numbered, draft → submit →
approve. Types:
- **Promotion:** new grade and / or designation, usually with new pay;
- **Increment:** new pay, same grade (annual or merit), as an amount or
  a %;
- **Transfer:** a new division, branch, cost center or department
  (question 9);
- **Manager change** (one employee). A bulk replacement is the step in
  §5.

How it works:
- **Effective date**: it can be in the past (back-dated), today or
  future.
- **Approval:** through Approval Configuration, as for the other modules
  (question 8 on who approves).
- **On final approval** the change is applied: a new job record and / or a
  new compensation version from the effective date.
- **Rejected:** corrected and resubmitted, as other modules.
- **History** (owner point 6): the employee's History tab shows every
  change: who, what (before → after), effective date, the document number,
  the approvers. Nothing is ever overwritten.
- Grade, designation and pay can then only change through an Employee
  Change (question 10), so the history is always complete.

### 7. Access and privacy

- New modules with their own permissions:
  - **Employee Records:** view / change;
  - **Employee Changes:** draft / submit / approve, as other modules;
  - **HR Setup:** grades, designations, fields, document types.
- Company access as everywhere: users see employees of their companies
  only.
- Salaries, IBAN and documents are sensitive: question 7.
- Every view of salary and every change is logged.

### 8. Screens

- **Employees:**
  - list with search and filters (company, department, grade,
    designation, status, manager);
  - the record with its tabs;
  - **Replace manager**;
  - an **Org chart**.
- **Employee Changes:** list and form (like other documents: drafts,
  approval, Home tasks).
- **HR Setup:** grades (with pay bands), designations, departments,
  employee fields, document types.
- **Home:**
  - "Employee documents expiring";
  - approvals for Employee Changes, through the existing Home tasks.
- **Master Data Import:** an "Employees" sheet to load the existing staff
  from Excel (question 11).

### 9. Build order (each step tested and deployed on its own)

1. HR Setup (grades, designations, departments, fields, document types) and
   the employee record (personal, employment, organization, job, line
   manager, flexi fields), the list and Replace manager.
2. Employee documents with expiry reminders.
3. Pay elements (the first part of Payroll, question 4) and compensation
   with its effective-dated history and pay-band check.
4. Employee Changes (promotion, increment, transfer) with approvals and the
   History tab.
5. Import of existing employees; org chart.

Then Payroll, with its own design.

## Open questions for the owner

1. **Employee number:** automatic per company (e.g. `01-0001` from the
   company code), one series for the whole group (`EMP-0001`), or typed in
   by HR?
2. **Grades:** one grade structure for the group or one per company; pay
   bands per grade (min / mid / max)?
3. **Departments:** add Department as a new organizational unit (usable
   later in reports and approvals too), or use Division as department?
4. **Pay elements:** build the Pay Elements list now (as the first piece of
   Payroll) so compensation can be entered; bonus and commission stored as
   agreed terms (fixed amount or %) or only entered per payroll run?
5. **Pay band:** a basic outside the grade's band: block, or warn and need
   approval?
6. **Document expiry reminder:** how many days ahead (passport / visa
   renewals often need 60–90), and who gets it?
7. **Who sees salaries, IBAN and documents:** a separate "view
   compensation" permission (proposed), or everyone with Employee Records?
8. **Approvers for Employee Changes:** Approval Configuration levels (named
   people, by company / division, thresholds on the increase), or the
   employee's line manager first and then HR / management?
9. **Transfers** (division, branch, cost center, department) through
   Employee Changes with approval too, or edited directly with history?
10. **Direct edits:** grade, designation and pay only through an Employee
    Change (complete history), except when the employee is first created?
11. **Country specifics:** UAE fields (Emirates ID, visa, labour card, WPS
    IBAN / agent) as standard fields, or left to flexi fields?

## The owner's decisions (2026-10-03)

| # | Question | Decision |
|---|---|---|
| 1 | Employee number | **One group series** (`EMP-0001`, ...), the same if the employee moves company |
| 2 | Grades | **One grade ladder for the group; each company sets its own pay band** (min / mid / max basic) per grade |
| 3 | Departments | **The cost center is the department**; no new unit type |
| 4 | Pay elements | **Build the Pay Elements list now**, as the first piece of Payroll (code, name, earning / deduction, fixed or variable); Payroll extends it later |
| 4b | Bonus / commission | **Agreed terms on the record** (amount or %, with history); actual amounts per payroll run |
| 5 | Pay band | **Warn**, and an Employee Change shows "outside band" to its approvers |
| 6 | Document expiry | **60 days ahead** (and once expired), Home task for users who can change employee records |
| 7 | Privacy | **A separate right, "view pay, bank & documents"** (owner, 2026-10-03, revising the first answer): without it a user sees the employee (name, job, manager, contact) but not salary, bank details, sensitive flexi fields or document files |
| 8 | Approvers | **Approval Configuration** levels (named people per company / division / ..., thresholds on the monthly increase) |
| 9–10 | Changes after hiring | **All through an approved Employee Change**: grade, designation, pay and transfers (division, branch, cost center); set directly only when the employee is first created |
| 11 | UAE details | **Flexi fields** (Emirates ID, visa, labour card, WPS routing); **bank name and IBAN stay standard** (follow-up) |
| 12 | Import | **An "Employees" sheet in Master Data Import, with step 1** |
| 13 | Mistakes in job / organization fields | **Keep Correct** (owner, 2026-10-03): HR Setup admins fix a data-entry mistake with a reason, shown in the history as a Correction; real changes go through an Employee Change |

**Build order, as decided:**
1. HR Setup (grades with company pay bands, designations, employee fields,
   document types), the employee record, the list, Replace manager, and the
   Employees import.
2. Employee documents with the 60-day reminder.
3. Pay Elements and compensation (effective-dated, band warning, bonus /
   commission terms).
4. Employee Changes (promotion, increment, transfer, manager change) with
   approvals and the History tab.
5. Org chart.

## As built: step 1 (2026-10-03)

**HR Setup** (new screen, `screens/HRSETUP.html`):
- **Grades:** code, name, level 1–99 (higher is more senior), in use or
  not. Each company has its own pay band (minimum ≤ midpoint ≤ maximum
  monthly basic); a user edits the bands of their own companies only, and
  other companies' bands are kept.
- **Designations:** the grade range they normally carry.
- **Employee fields** (the flexi columns): date, text or amount; compulsory
  or optional; a section (Personal, Employment or Other); an order;
  **sensitive** or not (seen only with the sensitive right). A field's
  type can't change once employees have values in it (add a new field
  instead).
- **Document types** for step 2. The first eight are added on first use:
  Passport, Emirates ID, Visa / Residence, Labour Card (each with a number
  and an expiry), Education and Experience Certificates, Employment
  Contract (expiry), Other.

**Employees** (new screen, `screens/EMPLOYEES.html`):
- **List:** search (no., name, mobile, email) and filters (company,
  department, designation, status; "Current" hides those who left).
  Missing compulsory fields and the number of direct reports show on the
  row.
- **The record:**
  - Personal, Employment, Organization and job, Pay out (bank, IBAN: only
    with the sensitive right), the extra fields in their sections;
  - then the direct reports (each opens) and the history: who, when, what
    changed from → to, with names. Sensitive values show as ••• without
    the right.
- **Numbers:** EMP-0001, EMP-0002, ... for the whole group.
- **Checks:**
  - required fields; real dates; emails;
  - units of the right type in that company;
  - designation and grade in use;
  - a compulsory extra field must be filled; an amount must be a number.
- **Grade outside the designation's range:** saved, with a warning.
- **After creation**, company, designation, grade, division, branch and
  cost center are locked: they change through an Employee Change (step
  4). **Correct** (HR Setup admins) fixes a mistake in them. It asks what
  was wrong, and the history shows it as a Correction with that reason.
- **Line manager:** optional. It can't be the employee themselves, someone
  below them, or someone who has left. An employee with direct reports
  can't be set to Left until they are moved.
- **Replace manager** moves every direct report of one manager to another
  (each history notes it, with the reason). If the new manager was one of
  those reports, they report to the outgoing manager's own manager
  instead. A move that would put someone under their own report is
  refused.
- **The sensitive right:** without it, a user doesn't see bank details or
  sensitive extra fields. If they can change records, saving keeps those
  values as they were.

**Master Data Import → Employees:**
- **Columns:** the standard columns plus one per active extra field
  (compulsory ones required).
- **References:**
  - designation and grade as in HR Setup;
  - departments by cost center code or name;
  - the line manager by employee no. or name, including a row above in
    the same paste.
- **Checks:** the same person twice (same name and date of joining) is an
  issue. Bank columns need the sensitive right.
- **Failure:** a failed import is undone, numbers included.

**Behind it:**
- `functions/src/hrSetup.js` and `functions/src/hrEmployees.js`.
- Firestore: `hrGrades`, `hrDesignations`, `hrFields`, `hrDocumentTypes`,
  `employees`, `employeeHistory`; the RTDB counter `hrCounters/EMP`.
- Modules:
  - `HRSETUP` (access, write): Admin;
  - `EMPLOYEES` (access, write, **sensitive**): access is Admin and
    Finance Manager; write and sensitive are Admin.

**Tests:**
- The `hrEmployees` emulator suite (6) and `hrEmployees.ui.js` (5). The
  light-mode guard now also covers both screens.
- Five negative controls caught:
  - no manager-loop check;
  - job fields saved without a Correction;
  - bank details wiped by a user without the sensitive right;
  - the import accepting bank columns without the right;
  - the screen leaving job fields editable.

**To go live:**
1. Deploy "functions set" `hr-employees-1`, with the screens (or a
   "screens only" run after).
2. In the app:
   - link menu nodes to **HR Setup** and **Employees**;
   - check their rows in Roles & Permissions;
   - set up grades, designations and fields;
   - then add or import the employees.

**Next:** step 2, employee documents with the 60-day reminder.
