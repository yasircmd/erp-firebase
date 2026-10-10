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
- **Lockout:** repeated wrong passwords are slowed and then blocked for a
  while by Firebase Auth itself (its built-in protection; see Step 1
  design), rather than a lock of our own.
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

## The owner's decisions, round 2 (2026-10-10)

| # | Question | Decision |
|---|---|---|
| 92 | Default-password rule | **The owner's own rule:** the first 4 letters of the employee's name, in lowercase, plus the last 4 digits of the Employee Code. E.g. Ali Hassan, EMP-0007 → `alih0007`. Details: spaces and punctuation are skipped (so "Al Ain" gives `alai`); a name of fewer than 4 letters is used whole; letters only, accents removed; a code with fewer than 4 digits gives all its digits. |
| 93 | Paying a reimbursement | **With the next payroll**: an Earnings & Deductions entry made on approval (the category's expense account), shown on the payslip. |
| 94 | Approving a reimbursement | **The line manager in the portal, then Approval Configuration** ("Reimbursement", by amount), as for leave. |
| 95 | Who gets an account | **HR enables it** in Employees (one, several or all active); until then no account exists. |

## Build plan

1. **Step 1, the portal and sign-in:**
   - accounts (enable, the default password, the forced change, reset,
     disable);
   - the portal page;
   - Home;
   - leave: apply with the live day count, track, cancel, balances, and
     the line manager's Team requests;
   - payslips: view and download as PDF;
   - My Portal from the ERP.
2. **Step 2, payroll queries:** raise, reply and track in the portal; the
   ERP's Employee Requests screen.
3. **Step 3, reimbursements:**
   - the categories;
   - claims with bills (camera or files);
   - manager, then Approval Configuration;
   - the E&D entry for the next payroll;
   - leave documents uploaded from the portal too.

## Step 1 design (agreed parts, technical)

- **Accounts:**
  - A Firebase Auth user per enabled employee, with a hidden email made
    from the Employee Code (`emp-0007@ess.invalid`). The portal turns the
    typed code into that email, so sign-in is Firebase Auth's own,
    including its built-in throttling of repeated wrong passwords.
  - The account has **no ERP profile**, so every ERP function refuses it.
  - Records: `essAccounts/{employeeId}` = { Uid, Enabled, MustChange,
    EnabledAt/By, ResetAt/By, LastSignIn, PasswordChangedAt }, and
    `essUids/{uid}` → employeeId.
- **Who is asking:** every portal function works out the employee from
  the signed-in user:
  - a portal account (enabled, the employee not Left), or
  - an ERP user linked to the employee (`UserUID`, decision 89).

  A portal account whose password is still the default may only change
  it.
- **Password change:** at least 8 characters, not the default, not
  containing the Employee Code. Changed by the server, which clears
  MustChange.
- **Leave:** the Leave Register's own rules (`evaluate`).
  - **With a line manager:** a new status, **PendingManager** ("With
    manager"). The manager approves or rejects in the portal's Team
    requests. On approval it continues exactly as Submit does today:
    Approval Configuration if set up, else approved.
  - **Without a line manager:** Submit directly.
  - The Leave Register shows "With manager" and leaves those alone.
- **Payslips:** the posted runs with a slip for the employee, from the
  same payslip builder as the ERP's.
- **Hosting:** `public/ess.html`; tools/deploy-hosting.sh allows it (and
  checks its config for REPLACE_ME too).

## As built — step 1 (2026-10-10)

**HR → Employees** (the new right **Employees → "portal"**, default Admin;
on the live system tick it in Roles & Permissions for the HR roles):
- A **Portal** column in the list: On, "On · not started" (still on the
  given password), Off, or —.
- **Portal access** (header button): acts on the employees listed (use
  the search and filters to pick one, several or all): **Switch on** for
  those without access, **Print welcome slips** for those not yet signed
  in with their own password.
- In the record, an **Employee Portal** section: the state, last sign-in
  and password change; **Switch on**, **Welcome slip**, **Reset password**
  (back to the default, changed again at the next sign-in), **Switch off**
  (signed out at once, refused after).
- **Welcome slips**: the portal's address, the Employee Code and the
  default password, three to an A4 page, printed alone.
- Switching on refuses an employee who left, one without a code, a
  default under 6 characters (Firebase's minimum: a name with no English
  letters and a code with few digits), and a code whose sign-in clashes
  with another employee's. Switching an account back on keeps its
  password.

**The portal**, `/ess.html` (phone first: a bottom tab bar on phones, a
side menu from tablet width; light and dark; dates dd/mm/yyyy, months
Sep-2026; in-page dialogs, no browser popups):
- **Sign in** with the Employee Code and password. Wrong ones: "Wrong
  Employee Code or password."; repeated tries are slowed by Firebase
  Auth; switched off: "Your portal access is switched off. Please contact
  HR."
- **First sign-in:** nothing opens until the password is changed (8+
  characters, not the given one, not containing the code; the rules tick
  as typed).
- **Home:** greeting, Annual leave left (with pending days), the last net
  pay, shortcuts, team requests waiting, open requests.
- **Leave:**
  - *Apply*: the types of kind Leave for the employee's gender; dates
    with the browser's calendar; half days where the type allows; the
    days, balance before → after, the pay summary, warnings (unpaid
    part) and a document note counted live by the Leave Register's own
    rules; who it goes to.
  - *My leave*: every request with its status (With manager, With HR,
    Approved, Rejected with the reason, Cancelled, Withdrawn) and its
    timeline. **Withdraw** a request not yet approved (with the manager
    or with HR: the approval is withdrawn too); **Cancel** approved leave
    that hasn't started (with a reason; the days come back).
  - *Balances*: earned so far, brought forward, taken, booked (approved,
    ahead), pending approval, available; for types without a balance, the
    days used this year.
- **Pay:** one card per posted month (net, earnings, deductions, Paid /
  Not yet paid); **View payslip** shows the ERP's payslip (the same
  builder); **Download PDF** prints it alone, the file named "Payslip
  Aug-2026 EMP-0001".
- **Team** (only for someone with direct reports): the reports' requests
  waiting, each with the balance before → after, warnings, a missing
  document and what happens next; **Approve** / **Reject** (the reason is
  required and shown to the employee); recently decided. A badge counts
  what is waiting.
- **Me:** the record's main details, change password (portal accounts),
  light / dark, sign out — or **Back to the ERP** for an ERP user.

**Leave flow** (decision 90):
- With a line manager: the leave is numbered at once (LV-…) and is
  **PendingManager** ("With manager"): it counts against the balance and
  blocks overlaps like a pending leave. The manager approves → exactly as
  Submit: Approval Configuration ("With HR") if set up, else approved;
  the approval's "submitted by" is the employee. The manager is the
  employee's *current* line manager, so Replace manager moves waiting
  requests too.
- Without one: submitted at once.
- A type expecting a document (e.g. sick leave over 1 day): the approver
  decides as in the Leave Register (decision 44); with nobody to decide
  (no manager, no Approval Configuration) the portal refuses it and
  points to HR, who enter it in the Leave Register. Uploading documents
  from the portal is step 3.
- The Leave Register shows "With manager" and "Withdrawn" (new filter
  options) and leaves those alone; the month lock and a final settlement
  name leave still with a manager among the undecided.

**ERP users** (decision 89): the ERP shows **My Portal** (beside Tasks and
in the user menu) to a user linked to an employee (Employees → ERP user);
it opens the portal with no second sign-in. One who isn't linked is told
to ask HR.

**Server:** functions/src/essPortal.js, two callables (two functions to
deploy, rather than one per action):
- `essPortal` — the portal's calls (`action`: me, changePassword, home,
  leaveForm, previewLeave, applyLeave, leaves, cancelLeave, balances,
  team, decideLeave, payslips, payslip; `link` for the shell);
- `manageEssAccounts` — HR (`action`: list, enable, disable, reset,
  slips).
- Records: `essAccounts/{employeeId}` (Uid, Email, Enabled, MustChange,
  EnabledAt/By, ResetAt, LastSignIn, PasswordChangedAt) and
  `essUids/{uid}`. A portal account is a Firebase Auth user
  `<code>@ess.invalid` with no ERP profile, so every ERP function refuses
  it.
- Shared with the Leave Register: `submitCore`, `cancelCore` (hrLeave.js),
  and the payslip builder `payslipsOf` (payrollPost.js).

**Tests:** `essPortal.emulator.test.js` (7: accounts and sign-in through
the Auth emulator, switch off / on / reset, a leaver; leave with a manager
then as Submit or to Approval Configuration; without a manager; withdraw
and cancel; ERP users; the month lock; payslips), `test/unit/essPortal.test.js`
(4: the password rule, the email shared with the page, the new password,
dates as the ERP's), `test/ui/essPortal.ui.js` (7, on a 390 px phone and a
desktop). The page is also in the no-popups and date-format guards. Where
the Tailwind CDN is unreachable, the UI check takes the styles from
`ESS_TAILWIND_CSS` (built with `tailwindcss` from public/ess.html,
`darkMode: 'class'`).

**Deploy:** `tools/deploy-sets/employee-portal.txt` with `--screens`
(EMPLOYEES, LEAVE), then **Hosting** (index.html: My Portal; ess.html: the
portal). In the app: tick Employees → "portal" for the HR roles, link
employees to their line managers (and ERP users), switch the portal on and
hand out the slips.
