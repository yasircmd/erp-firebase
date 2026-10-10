# Employee Self-Service Portal (design, 2026-10-10)

## The owner's request (2026-10-10)

> A new module accessible to all employees, including those who are not
> ERP users, with a user-friendly, creative and intuitive interface where
> employees can:
> - apply for leave and track the status of their requests;
> - view and download their payslips;
> - view their annual leave balances and related details;
> - raise queries or complaints about payroll discrepancies (excess
>   deductions, incorrect salary);
> - submit bills and supporting documents for reimbursement;
> - track the status of their queries and reimbursement requests;
> - existing ERP users need no separate login.
>
> **Login:** Employee Code and a default password provided by the system;
> on the first login the employee must change it.
>
> **Design:** modern, responsive (desktop, tablet, mobile), visually
> appealing, easy to navigate, simple enough for someone with no ERP
> experience.

## Today (from the code)

- **ERP sign-in:** Firebase Auth (email and password) plus a profile in
  `users/{uid}`. Every ERP function checks that profile (`requireUser`).
  An employee without an ERP account has nowhere to sign in.
- **Employees** (HR → Employees) carry a line manager (`ManagerID`, another
  employee) and an optional link to an ERP user (`UserUID`).
- **Leave** (Leave Register):
  - entered by HR (`saveLeave`, `submitLeave`);
  - checked and priced by `evaluate` (days, balance, unpaid split,
    documents);
  - approval through Approval Configuration (approvers are ERP users);
  - balances from `getLeaveBalances`.
- **Payslips:** built by `getPayrollPayslips` for a posted run (the month,
  leave balances, year to date, IBAN masked).
- **Attachments:** the Document Storage adapter (Google Drive connected)
  stores files per document, used by 27 screens.
- **Nothing exists yet** for payroll queries or reimbursement claims.

## Proposed

### 1. The portal: one page for every employee

- A separate page on the same site, **`/ess.html`**, built for phones
  first. Like the ERP shell (public/index.html), it holds **no data**:
  everything comes through Cloud Functions that check who is asking.
  tools/deploy-hosting.sh allows this one extra page.
- **Look:** a clean card layout with large touch targets and a bottom
  tab bar on phones (Home, Leave, Pay, Requests, Me); a side menu on
  desktop.
  - **Home:** a greeting, "Annual leave left: 18.5 days", the last
    payslip's net pay, and open requests with their status.
  - **Guided forms:** one question at a time where it helps, e.g. the
    leave dates on a calendar with the days counted live and the balance
    shown before submitting.
  - **Status timelines:** Submitted → With manager → Approved, with dates
    and who acted.
  - Light and dark mode; dates dd/mm/yyyy, like the ERP.
- **English only** for now; Arabic (right-to-left) can follow later.

### 2. Sign-in and accounts

- **Employee Code + password.** Behind the scenes, each employee who is
  enabled for the portal gets a Firebase Auth account of their own (e.g.
  `emp-0007@ess.local`; never seen by them), with **no ERP profile**. ERP
  functions refuse it, so a portal account can never reach the ERP.
- **HR enables the portal per employee** (or all at once) in HR →
  Employees. The system then gives a **default password** (question 88).
- **First sign-in:** the portal asks for a new password (at least 8
  characters, not the default, not the Employee Code). Nothing else opens
  until it is changed.
- **Forgot password:** HR resets it in Employees; a new default is given
  and must again be changed at the next sign-in.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes.
- **Employees who left** are signed out and refused.
- **ERP users** (question 89).

### 3. Leave

- **Apply:** type (the active types), dates (half days where the type
  allows), reason, and a document if the type needs one. Before
  submitting, it shows the days, the balance after, and any unpaid part.
  These come from the Leave Register's own checks (`evaluate`), so the
  rules are identical.
- **Approval** (question 90). Status and timeline: Draft, With manager,
  With HR, Approved, Rejected (with the reason), Cancelled.
- **Cancel** a request not yet approved, or approved leave that hasn't
  started (as the Leave Register allows).
- **Balances:** each leave type that uses a balance shows: entitlement,
  taken, booked (approved but future), pending, and available. Annual
  leave also shows the carry-forward and its expiry where set up.
- **History:** every leave with its number, dates, days and status.

### 4. Payslips

- One card per posted month, the latest first: net pay, earnings,
  deductions, and Paid / Not yet paid.
- **Open** shows the full payslip (the same content as the ERP's,
  `getPayrollPayslips`); **Download** saves it as a PDF.
- Only posted runs; never a draft or another employee's.

### 5. Payroll queries

- **Raise:** the month (picked from their payslips), a category
  (Deduction, Missing earning, Overtime, Leave pay, Other), the line(s)
  concerned, a description, and attachments.
- **Handling (question 91):** a new ERP screen, **Employee Requests**,
  where HR / Payroll see them, reply, and set the status: New → In
  progress → Resolved / Rejected. The employee sees every reply and can
  answer back; a resolved query can be reopened within 14 days.
- The fix itself (an E&D entry, a correction) is done in Payroll as
  today; the query records the outcome.

### 6. Reimbursement claims

- **Claim:** a category (set up by HR: Travel, Fuel, Medical, Phone,
  Other; each with its expense account, an optional monthly limit, and
  whether a receipt is required), the date, amount, description and the
  bills (photos or PDFs, several per claim, taken with the phone camera
  if wanted).
- **Approval and payment:** question 92 (round 2).
- **Status timeline:** Submitted → Approved / Rejected (reason) → Paid
  (with the payroll month or the payment voucher).

### 7. On the ERP side

- **HR → Employees:**
  - "Portal access": enable or disable, reset password, last sign-in;
  - **"Print welcome slips"**: the Employee Code, the default password and
    the portal link, one per page or several per A4, to hand out.
- **Employee Requests** (new ERP screen): queries and claims, filtered by
  type, status, company and employee.
- **Rights:** Employee Requests (`access`, `handle`), and a right to manage
  portal accounts in Employees.

## Open questions (round 1)

88. **The default password.**
    - Generated by the system per employee (random, 8 characters, easy to
      read: no 0/O or 1/l). HR sees it once, on the welcome slip or when
      resetting — recommended (safe: nobody can guess another
      employee's);
    - or one rule for everyone, e.g. the Employee Code plus the last 4
      digits of their ID (easy, but anyone knowing a colleague's ID can
      sign in as them until the password is changed).
89. **ERP users who are also employees.**
    - They open **My Portal** from the ERP (a menu item and a Home card)
      with no second sign-in, because their ERP user is linked to their
      employee record. They can also sign in to the portal with their
      Employee Code from a phone — recommended;
    - or ERP users also use only the portal sign-in.
90. **Who approves leave applied in the portal.**
    - **The line manager in the portal** (the employee's manager sees
      "Team requests" and approves or rejects), **then** Approval
      Configuration as today if it is set up for Leave; without a line
      manager, straight to Approval Configuration — recommended;
    - or Approval Configuration only (ERP approvers), as leave entered by
      HR today.
91. **Payroll queries.**
    - Handled in the ERP's new **Employee Requests** screen by those with
      its "handle" right; replies and status shown to the employee;
      reopen within 14 days — recommended;
    - or simply emailed to HR, with the status set by hand.

## The owner's decisions, round 1 (2026-10-10)

| # | Question | Decision |
|---|---|---|
| 88 | Default password | **One rule for everyone** (the rule itself: question 92). Because a rule-based default can be guessed by someone who knows the inputs, the forced change on first sign-in and the lockout matter more; question 95 adds the third guard. |
| 89 | ERP users | **My Portal inside the ERP** (menu item and Home card, no second sign-in, through the employee's linked ERP user); they can also sign in to the portal with their Employee Code. |
| 90 | Leave approval | **The line manager in the portal, then Approval Configuration** as today if set up for Leave; with no line manager, straight to Approval Configuration. |
| 91 | Payroll queries | **The ERP's new Employee Requests screen** (a "handle" right): replies and status shown to the employee, who can answer and reopen within 14 days. |

## Open questions (round 2)

92. **The default-password rule** (the same for everyone):
    - **Employee Code + date of birth (ddmmyyyy)**, e.g. `EMP0007-15081990`:
      the employee already knows it, so no slip is needed. An employee
      without a date of birth can't sign in until HR enters it —
      recommended;
    - or a **word HR sets + the code**, e.g. `Welcome@EMP0007`: HR
      announces the word once;
    - or the **last 4 digits of the mobile + the code**.
93. **How an approved reimbursement is paid.**
    - **With the next payroll**: an Earnings & Deductions entry is made on
      approval (the category's expense account), so it shows on the
      payslip and is paid with the salary — recommended;
    - or **by Finance**: a payable to the employee, settled with a Cash &
      Bank payment;
    - or chosen per category.
94. **Who approves a reimbursement.**
    - **The line manager in the portal, then Approval Configuration**
      ("Reimbursement", by amount), as for leave — recommended;
    - or Approval Configuration only;
    - or HR in Employee Requests.
95. **Who gets a portal account.**
    - **HR enables it** in Employees (one, several, or all active):
      until then the account doesn't exist, so a guessable default can't
      be used before HR switches it on — recommended;
    - or **every active employee** automatically.
