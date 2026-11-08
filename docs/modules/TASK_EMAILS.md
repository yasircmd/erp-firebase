# Task emails: users' tasks sent to their email

Status: **built 2026-11-08** (decisions Q450-Q456; the owner's go-ahead the same day). See *As built* below: it differs from the proposal on four points, each said there.

## The request (owner, 2026-11-08)

"For the email, also need to add task notifications to users email. Does
firebase create email ID?"

Firebase does not create mailboxes or send mail of its own (its only mail is
Authentication's own: password reset and the like, from
noreply@<project>.firebaseapp.com). The ERP already knows each user's email
(their sign-in, `users/{uid}.email`) and each employee's (`WorkEmail`,
`PersonalEmail` on the employee record). What it needs is a sending account;
the owner chose Google Workspace.

## The owner's decisions (2026-11-08)

| # | Question | Decision |
|---|---|---|
| Q450 | The mail service | **Google Workspace:** the ERP sends from a Workspace address (for example notifications@<domain>) through Google's SMTP relay, its password (an app password) a Google Secret Manager secret, never in the code. |
| Q451 | When a user is emailed | **The user's own choice of three:** each task as it reaches them; approvals at once and the rest in a morning summary; or a morning summary only. |
| Q452 | Which tasks | **Approvals waiting for me; my rejected items; reminders and due items** (follow-ups, PDCs due, recurring journals due, documents expiring, CRM activities due); **HR tasks** (leave to approve, clearance steps); and **Employee Portal request updates** (an employee's request approved, rejected or done). |
| Q453 | Turning them off | **Each user, in their user menu ("Email settings"):** on by default, the timing above, or off. |
| Q454 | The sending address | **An existing mailbox** of the Workspace domain (the owner's choice of which), not a new one. |
| Q455 | The summary's time | **Each user chooses it** (in half-hour steps, in the corporate's time zone). |
| Q456 | The summary's days | **Each user chooses the days** (any of Monday to Sunday). |

## The proposal

### What is sent

- **At once** (the timing allows): the task that just reached the user, with
  what it is (for example *Purchase Order PO-26-01-000012, 4,250.00, waiting
  for your approval*), and a link that opens the ERP at that document.
- **The morning summary:** one email listing every open task of the user, by
  kind, as Home's Tasks shows them, each with its link. None when there is
  nothing.
- **Employee Portal:** an employee whose request (leave, a claim, a document
  request…) changes status gets one email at once, to their work email (else
  personal), with a link to the portal. Employees choose in the portal
  (on / off).

No figures beyond the document's number, party and amount, and no
attachments: the email says what is waiting; the ERP shows it after sign-in.

### How it works

- **The sender:** `taskMail.js`, the one place that sends (nodemailer over
  Google's SMTP relay, smtp-relay.gmail.com, with the Workspace account's app
  password from Secret Manager). Every email is also written to Firestore
  `mailLog` (to, subject, kind, sent or failed, when) for the Developer and
  Support screens; a failure never stops the posting or approval that caused
  it.
- **At once:** the places that already create a task (an approval reaching a
  level, a rejection, a portal request's status) call `taskMail.notify(...)`
  after their own write succeeds. It reads the user's setting and sends only
  if the timing says "at once".
- **The summary:** a scheduled function every half hour, for every Active
  corporate (runInCorporate), finds the users whose own summary time and day
  it is (in the corporate's time zone, Asia/Dubai by default), gathers each
  one's tasks with the same readers Home uses (getPendingApprovalsForUser and
  the other "…ForUser" readers) and sends one email per user; each user's
  summary is marked sent for the day, so a retried run never sends it twice.
- **The setting:** `userEmailSettings/{uid}` `{ Timing: 'instant' |
  'approvals-instant' | 'daily' | 'off', SummaryTime: 'HH:MM' (half hours),
  SummaryDays: ['Mon', …] }`, by default approvals at once, the summary at
  07:00 Monday to Friday (Q455-Q456).
- **Rights:** none new: a user is only ever emailed their own tasks, which
  the existing readers already limit.

### What the owner sets up once (not code)

1. The **existing mailbox** that sends (Q454): with 2-step verification on,
   create an **app password** for it (Google Account → Security → App
   passwords). Replies to task emails then arrive in that mailbox; the
   emails say "do not reply" and link to the ERP.
2. The app password as a Secret Manager secret, **TASK_MAIL_PASSWORD**, in each
   corporate project that should send (`firebase functions:secrets:set`); the
   sending address as **TASK_MAIL_FROM**.
3. Daily Workspace sending limits apply (about 2,000 per user a day; the
   relay up to 10,000): ample for task emails.

### Build plan (after the design is agreed)

1. `taskMail.js` (send, the log, the setting) and the user menu's Email
   settings; unit and emulator tests (a fake transport in tests: no mail is
   sent).
2. "At once": approvals, rejections, portal request updates.
3. The morning summary (a scheduled function per corporate).
4. Help (a page in Getting started, the Employee Portal's page), What's new,
   docs, the deploy set (the touched functions, the new scheduled one, the
   secrets).

## As built (2026-11-08)

**Different from the proposal above**, for reasons found while building:

1. **"At once" is within about 5 minutes, not immediate.** Functions run in
   the firm's project and reach each client corporate's data through
   runInCorporate; a Firestore trigger cannot watch the client projects.
   So the places that create a task put an email in their corporate's
   Firestore `mailQueue`, and **one scheduled function, `sweepTaskMail`**
   (every 5 minutes), serves every corporate: Corporate 100, then each
   Active one in the directory (`corporates.activeCorporates`). One mailbox
   sends for all of them (the secret is the firm's).
2. **One secret, `TASK_MAIL_ACCOUNT`**, holds the sending address and its app
   password ("address app-password"), in the firm's project only, not one
   per corporate. Sent through `smtp.gmail.com:465` with that account (the
   SMTP relay `smtp-relay.gmail.com` needs a Workspace admin's relay set-up
   besides; the app password needs none). The value `none` means no
   account: every email is logged "not sent: no mail account set".
3. **The link opens the ERP, not the document.** The ERP has no address for
   one document yet, so an email links to https://erp1-8f4cd.web.app/ and
   says to open the task from Tasks. A portal email links to its page
   (`ess.html#requests/view/<id>`, `#leave/history`). A link to the
   document itself is a later step if wanted.
4. **No party name** in an approval email: an approval record holds the
   document's number and amount, not its party; reading each module's
   document for it was not worth the cost. The email gives the document,
   the amount and the level.

**Who is told what.**
- *Approvals.* Every module's approvals, the ported ones too, are written
  through `approvalStore.js`, which now tells `taskMail.approvalChanged`
  of each write (`docStore.js` `afterWrite`): the approvers who have the
  task now but did not before are queued. As Home shows it, a document's
  every undecided level's approver has it from the start (so all are
  emailed when it is sent); a Job Order request goes level by level (the
  next level when one approves); a delegated level's new approver. A
  rejection is queued once, to its submitter (CreatedBy). Before sending,
  the sweep checks the task is still open (the level undecided, the
  rejection still the status), so a decision undone (e.g. Leave's rollback
  when approving fails) or made within the 5 minutes sends nothing.
- *Employee Portal (Q452).* `employeeRequests.js`: HR's reply (not an
  internal note), resolved, rejected; the line manager's decision on a loan
  or a request type. `hrLeave.js` / `essPortal.js`: the leave approved
  (finally, or with no approval needed) or rejected (by an approver or the
  line manager). To the employee's WorkEmail, else PersonalEmail, unless
  they switched it off: the portal's Me page, **Email me my requests'
  updates** (`employeeEmailSettings/{EmployeeID}` { Off }). Claims decided
  by their approvers and loans' own stages are not emailed (not asked for
  precisely; easy to add to the same helper).
- *Timing (Q451)*: 'instant' approvals and rejections at once;
  'approvals-instant' (the default) approvals at once; 'daily' none at once;
  'off' nothing. **Every choice but Off also gets the summary**, on the
  days chosen; with no day ticked, no summary.
- *The summary (Q455-Q456)*: when the user's time comes on one of their
  days (Asia/Dubai; within the hour after, if a run was late), gathered by
  Home's own readers, each with the user's own rights, through
  `callable.js`'s new `.inCorporate` (the handler, run in the caller's
  corporate): approvals, rejected items, follow-ups, PDCs due, recurring
  JVs due, CRM activities due, company and employee documents expiring,
  employee requests waiting, clearance steps, leave returns to record. At
  most 50 lines a kind ("and n more"). None when nothing is open. Sent once
  a day: `mailSummaries/{uid}_{date}` is created before sending, so an
  overlapping or retried run never sends it twice (a failed send is
  logged, not retried that day). Five users at a time (many share 07:00);
  the run may take up to 9 minutes, and a user it did not reach is taken by
  the next run, within the hour.
- *The log*: `mailLog` { To, Uid / EmployeeID, Kind, Subject, Result
  ('sent', 'failed', 'not sent: no mail account set', 'not sent: no email
  address'), Error, At }. A failure never stops the posting, approval or
  request that caused it (queuing never throws).
- *Dates* in an email read dd/mm/yyyy (owner, 2026-09-29).
- *Security*: `sweepTaskMail` is not a callable; `tools/deploy-lib.sh`
  never grants it the public invoker (`NO_PUBLIC_INVOKER`;
  tools/test-deploy-lib.sh checks). The settings callables touch only the
  caller's own setting. The stores are Data Reset's "never offered" kind
  (unit/dataResetCoverage).

**Files.** `functions/src/taskMail.js` (new); `docStore.js` (afterWrite),
`approvalStore.js`, `callable.js` (.inCorporate), `corporates.js`
(activeCorporates), `employeeRequests.js`, `hrLeave.js`, `essPortal.js`;
`public/index.html` (user menu, EMAIL SETTINGS), `public/ess.html` (Me);
`functions/package.json` (nodemailer 6.9.16).

**Tests.** unit/taskMail (the setting, timing, clock, summary due, the email
text, the secret, who an approval's write tells); emulator/taskMail (the
settings callables; a JV's approvers emailed by their timing; a decided
task not sent; a rejection to its submitter; no account and no address
logged; a delegation; the summary at its time and day, once a day, none
when nothing is open; a portal rejection to the work email and the
portal's off); ui/home (Email settings), ui/essPortal (the Me page's
switch); test-deploy-lib (no public invoker). Negative controls, each
caught then restored: the rejection told on every write (unit); the
send-time check removed (emulator); the summary's once-a-day record
removed (emulator); `NO_PUBLIC_INVOKER` emptied (test-deploy-lib); and,
during the build, the hook placed in approvals.js only: the ported
modules' (and the JV's) decisions were missed, which the emulator suite
caught and which moved the hook to the store.

### Setting it up (the owner, once, before the deploy)

In Cloud Shell, project erp1-8f4cd:

1. The APIs: `gcloud services enable cloudscheduler.googleapis.com
   secretmanager.googleapis.com --project=erp1-8f4cd`.
2. The deploy's service account (the one behind `GCP_SA_KEY`; skip if you
   deploy from Cloud Shell as an Owner) needs **Cloud Scheduler Admin** and
   **Secret Manager Admin**, to create the 5-minute schedule and to let the
   function read the secret:
   `for R in roles/cloudscheduler.admin roles/secretmanager.admin; do gcloud projects add-iam-policy-binding erp1-8f4cd --member=serviceAccount:<its email> --role=$R; done`
3. The secret, so the deploy can go ahead: `printf none | firebase
   functions:secrets:set TASK_MAIL_ACCOUNT --project erp1-8f4cd --data-file=-`
   (or `--force` and type `none`).
4. When the mailbox is ready (Q454): on the chosen existing mailbox, turn
   on 2-Step Verification, then Google Account → Security → App passwords →
   create one ("ERP"). Set the secret to the address, a space, and the
   16-letter password: `printf 'tasks@yourdomain.com abcdefghijklmnop' |
   firebase functions:secrets:set TASK_MAIL_ACCOUNT --project erp1-8f4cd
   --data-file=-`, then redeploy **sweepTaskMail** alone (Deploy workflow, "functions set",
   set `task-mail-sender`) so it picks up the new version. If the Workspace admin has turned off app
   passwords, they turn them back on for that mailbox's group.

Then check `mailLog` (Firestore, Corporate 100) after the first approval:
"sent", or why not.

## Open questions for the owner

None. Later, if wanted: a link to the document itself; claims' and loans'
own stages emailed; scheduled emailed MIS reports (MIS.md Q434) on the same
sender.

