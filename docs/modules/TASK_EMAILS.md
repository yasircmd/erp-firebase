# Task emails: users' tasks sent to their email

Status: **design, decisions Q450-Q456 made 2026-11-08; awaiting the go-ahead.**

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

## Open questions for the owner

None: Q450-Q456 decided. Building waits for the owner's go-ahead; sending
waits for the app password (step 1-2 above), and until then the ERP logs
each email as "not sent: no mail account set" and carries on.
