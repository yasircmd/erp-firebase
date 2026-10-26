# Employee requests of any type (UX round 2, item 27)

**Status:** built 2026-10-26 (design agreed by the owner 2026-10-25, decisions Q277, Q305–Q308) · **Roadmap:** [#19](../ROADMAP.md) ·
**Plan:** [UX_ROUND2.md](UX_ROUND2.md) wave 4 · **Builds on:**
[EMPLOYEE_PORTAL.md](EMPLOYEE_PORTAL.md) (Employee Requests, steps 2–3)

## What the owner asked

Requests for anything: IT support, HR support, a salary certificate, an
experience certificate …, each with its own fields, a token number and
tracking like the Approval Tracker.

**Decided (owner, 2026-10-25, Q277): certificates are uploaded by HR.**
The ERP tracks the request; HR prepares the certificate outside and
attaches it, and the employee downloads it.

## Today

Employee Requests (module `EMPREQUESTS`) already handles three fixed
kinds from the portal:
- payroll queries (PQ);
- advance and loan requests (LR);
- reimbursement claims.

It has handlers per company and category, replies and internal notes,
files, resolve / reject / reopen, and Home tasks. Leave has its own flow
(HR_LEAVE.md).

## Proposed

- **Request types**, set up by HR (Employee Requests → Types):
  - a name (e.g. "Salary certificate", "IT support");
  - a short description shown to the employee;
  - the fields to fill: short text, long text, number, date, a choice
    from a list, yes/no, and files; each required or optional;
  - an optional "answer within N days" (Q307);
  - the route (Q305);
  - "a document is the answer" (certificates): resolving then needs a file.
  - The type can be switched off; requests already raised keep it.
- **Handlers:** the existing Handlers tab, by company and type (the
  company default for the rest).
- **In the portal:** Requests → **New request** lists the types (the
  three existing kinds stay as they are). The employee fills the type's
  fields and sends. My requests shows every request with its **token**
  and its stage.
- **The token:** one number per request from Numbering, e.g.
  `RQ-2026-0001` (Q306). It is quoted to HR and shown on every screen.
- **Tracking**, like the Approval Tracker: each request's timeline. That
  is: sent, with the line manager (if routed), with HR (who has it), in
  progress, answered (resolved, with the document if any) or rejected
  (with the reason), and reopened. Each stage has its date and who acted.
  The employee and the handlers see the same timeline, never the internal
  notes.
- **In the ERP:** the Employee Requests list and request view take the new
  types as they take queries today: the type's fields, replies, internal
  notes, files, Resolve (an outcome; the file for a document type),
  Reject, Reassign.

## The owner's decisions (2026-10-25)

| # | Decision |
|---|---|
| Q305 | Per type: straight to its handler, or through the line manager first. |
| Q306 | One token series for every new type, **RQ-2026-0001** (Numbering). |
| Q307 | An optional "answer within N days" per type, shown overdue (red) to the handler and on Home; nothing is blocked. |
| Q308 | A type is seen by every employee of the companies it is set for. |

## The questions as asked

| # | Question | Recommendation |
|---|---|---|
| Q305 | The route of a type: **(a)** straight to its handler, or through the line manager first, chosen per type. **(b)** Also through Approval Configuration's levels. | **(a)**: most requests (a certificate, IT help) need a handler, not approvers; the line manager step covers the ones that need consent. |
| Q306 | The token: **(a)** one series for every new type (RQ-2026-0001), or **(b)** a prefix per type (SC- for salary certificate …). | **(a)**: one sequence, set in Numbering like the others; the type is shown beside it. |
| Q307 | "Answer within N days": shown overdue (in red) to the handler and on Home once passed? | **Yes**, optional per type; nothing is blocked, it is only shown. |
| Q308 | Which employees see a type: **(a)** every employee of the companies it is set for, or **(b)** also limited to departments or grades. | **(a)** for now; limiting by department can follow. |

## Build plan (after the answers)

1. Server: types (fields, route, document answer, days) per company; the
   portal's new request with its fields validated; the RQ token; the
   timeline; handlers by type; resolve needing a file for a document type.
2. Screens: Employee Requests → Types; the request view's fields and
   timeline; the portal's New request and the timeline.
3. Tests, negative controls, Help, What's new.

## As built (2026-10-26)

- **Types** in Firestore `employeeRequestTypes` (functions/src/requestTypes.js):
  Name (unique, ignoring case, and not one of the portal's own request
  names), Description, Fields [{Key, Label, Kind, Required, Options}] (up to
  20; kinds text, longtext, number, date, choice with 2–30 options, yesno,
  file), Route (Handler or Manager), AnswerDays (1–365 or none),
  DocumentAnswer, CompanyIDs (none: every company, Q308), Active. Set up in
  Employee Requests → **Types** with the module's setup right
  (employeeRequests actions `types`, `saveType`). Data Reset clears them
  with Payroll Setup.
- **A request of a type** is an `employeeRequests` record of Type `Custom`:
  Category and TypeName are the type's name (so the Handlers tab names its
  handler), Answers [{Key, Label, Kind, Value}] checked against the fields
  (required, number, date, a choice from its list; files are uploaded after
  it is raised, as for any request), numbered from one series `hr:RQ`,
  RQ-2026-0001 (Q306). Statuses: WithManager (With the line manager), New
  (Sent to HR), InProgress, Resolved (Done), Rejected, Withdrawn.
- **The route** (Q305): through the line manager, it waits in the
  manager's Team (essPortal `team().requests`, `decideTeamRequest`: approve,
  or reject with a reason the employee sees) and counts in Team's badge; an
  employee with no line manager goes straight to HR. The history reads
  Sent → With the line manager → Approved by the line manager → Sent to HR.
- **Due and overdue** (Q307): DueDate = the type's days from the day it
  reaches HR. The list and the request show Answer by and overdue; Home's
  task reads "New request · overdue". Shown, never blocking.
- **A document answer** (Q277): Resolve is refused ("Attach the document…")
  until a file uploaded by someone other than the employee is attached;
  the employee downloads it from the request.
- **Otherwise as a query:** replies, internal notes, files, Resolve,
  Reject, reassign; the employee withdraws one with a reason while it is
  open and reopens it within 14 days (the query's `reopenQuery` action).
- **The portal:** Requests → **Other** (#requests/other, then the type's
  form at #requests/other/<type>), the type's answers and "HR answers by"
  in the request's view, Team's "Other requests". No Home tile: the Home
  grid keeps its three (claim, query, loan).
- **Tests:** requestTypes emulator suite (3): the types and their checks,
  per company; a request straight to the handler, numbered, resolved and
  reopened; through the line manager, the due date, overdue on Home and in
  the list, the document answer, the manager's rejection, no manager.
  requestTypes UI (4): the Types tab, the portal's form, Team's approval,
  HR's view and the document check. **Negative controls**, each caught then
  restored: the document check removed, the required-field check removed
  (emulator); Team's approve button broken, the due date dropped from HR's
  view (UI).
- **Found on the way:** the portal UI suites' sign-in helper raced the
  page's 50 ms focus on the Employee Code: a Corporate ID typed before it
  landed in the code field, the browser refused the empty form silently,
  and every later step failed. This was the "random" essPortal / essClaims
  / essRequests failures. The helpers now refill until the three fields
  hold (essPortal, essClaims, essRequests, corporateSignIn).
- **Deploy set** `ux2-requests` (with --screens, then Hosting).
