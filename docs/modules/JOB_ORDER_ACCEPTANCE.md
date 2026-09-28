# Job Order acceptance through Approval Configuration

Status: **design, awaiting the owner's go-ahead** (2026-09-28).

## The problem

A Sales-triggered Job Order line waits in **Pending Acceptance** until
Production accepts it, but nobody is told. The Home screen's tasks cover
approvals, rejections, PDCs due and recurring journals, not Job Orders.
And **Approval Configuration's "Job Order Request" entry does nothing
today**: Job Order Request is listed there and approvers can be set, but
submitting a batch never consults it. That was also true in Apps Script.

## Owner's decisions (2026-09-28)

1. **Who sees and acts:** the users set for Job Order Request in Approval
   Configuration, for the batch's scope (company, division, branch or cost
   center, as configured). Only they can Accept, Request Amendment or
   Accept Stop; everyone else sees the line read-only.
2. **Levels in order:** level 1 accepts, then level 2, and so on. The line
   becomes Accepted only after the last level.
3. **Not configured** (no entry, or disabled) for that scope: works as
   today, with no Home task. Anyone with Job Order "post" permission can
   accept.
4. **Amendment Requested** appears in the submitter's Home tasks.

## Design

Each Sales-triggered line gets its own approval record, the same kind every
other gated document uses, so the existing Home machinery does the rest.

- **Submit:** for each line that becomes Pending Acceptance, if Job Order
  Request is configured for the batch's scope, an approval record starts.
  - The line stores its `ApprovalInstanceID`.
  - The current level's approver sees it under **Pending approvals** in
    Home.
  - Production-direct lines start Open, as today, with no approval.
- **Accept:** records the current level's approval. After the last level
  the line becomes **Accepted**, as today. Before then it stays Pending
  Acceptance, showing which level it's waiting on.
- **Request Amendment:** at any level, ends the chain as a rejection with
  the note. The line becomes **Amendment Requested**, and it appears under
  **Rejected** in the submitter's Home tasks.
- **Revise and Resubmit** (Sales): starts a fresh chain from level 1.
  **Withdraw** ends it.
- **Stop Requested:** Accept Stop follows the same approvers, in order.
  The line becomes **Stopped** after the last level.
- **Home task click** opens the Job Order screen on that line's batch.
  Today the screen ignores the task and shows the list, as Purchase
  Requisition and IPR did before their fix.
- **Thresholds:** a Job Order has no amount, so it counts as 0, as
  Purchase Requisition does. Only levels with a 0 threshold apply. Set 0
  on the levels meant for Job Orders.
- **Lines already Pending Acceptance when this goes live** keep today's
  behaviour: no chain, and anyone with "post" can accept. Only lines
  submitted afterwards use the approvers.

## What changes in the code

- **Server:** the Job Order functions are generated from Code.gs, so the
  changes are documented patches in `tools/legacy-port/patches.js`. They
  cover submit, accept, request amendment, revise, withdraw, stop and
  accept stop.
- **Registry:** approval storage for Job Order Request points at the
  line, not the batch (`jobOrderLines`), so the Home tasks can check that
  the approval is still the line's current one.
- **Screen:** `screens/JOBORDERREQUEST.html` becomes hand-maintained.
  - The buttons show only to the current level's approver.
  - It says which level a line is waiting on.
  - It opens the entry from a Home task.
- **Tests:** an emulator suite for the flows above, including levels in
  order, amendment, resubmit, stop, not configured and permissions, plus a
  browser check that the task opens the right line. Each has a negative
  control.

## Deploy

Functions, then screens: the Deploy workflow's "functions set, then
screens" with a new `job-order-acceptance` deploy set.
