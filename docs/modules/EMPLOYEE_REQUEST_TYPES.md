# Employee requests of any type (UX round 2, item 27)

**Status:** proposed, questions Q305–Q308 open · **Roadmap:** [#19](../ROADMAP.md) ·
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

## Questions for the owner

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
