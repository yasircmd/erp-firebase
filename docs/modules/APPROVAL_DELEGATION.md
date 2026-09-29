# Approval delegation

Status: **design, awaiting the owner's agreement** (2026-09-29).

## The request (owner, 2026-09-29)

"In Approval Tracker, an option to delegate, in case the approver is
absent."

## Owner's decisions (2026-09-29)

1. **Who can delegate:**
   - Admin users, any pending approval;
   - an approver, their own pending approvals.
2. **To whom:** any active user who has access to that module and to the
   document's company, so the new approver can open and review it.
3. **At once:**
   - one pending approval; or
   - every pending approval currently waiting on a given approver (e.g.
     someone on leave).
4. **A reason is required** (e.g. "On annual leave"). It is recorded
   with who delegated, from whom, to whom and when.

## How it works today

- **The approver list:** when a document goes for approval, its approval
  record copies the approver of each required level from Approval
  Configuration.
- **What reads that list:**
  - the approve / reject check;
  - Home's "Pending Your Approval";
  - the approval banners in the screens;
  - the Approval Tracker's approver filter.

## Design

- **What delegation does:** it changes the approver of one undecided
  level of a pending approval. Everything that reads the approver then
  follows automatically:
  - the new approver sees it in Home and can approve or reject;
  - the old approver no longer can.
  - Nothing else about the approval changes: levels, amounts, thresholds,
    or the order of Job Order levels.
- **The history:** each delegation is kept on the approval, in its record
  and in the Tracker's detail:
  - who delegated;
  - from and to;
  - when, and the reason.
  - The decision itself later shows the new approver as usual.

### In the Approval Tracker

- **One approval:** on a pending approval, each undecided level shows a
  **Delegate** button:
  - Admins see it on every such level;
  - an approver sees it on their own levels.
  - It opens a small in-app form: new approver (a list of eligible
    users), and the reason.
- **All of an approver's:** a **Delegate all pending…** button, for
  Admins and for an approver on their own:
  - choose the absent approver (Admins; an approver is always
    themselves), the new approver, and the reason;
  - every pending approval currently waiting on that person moves;
  - a summary shows how many moved, and which (if any) couldn't, and why.

### Rules (proposed — please confirm)

1. **Only pending approvals, only undecided levels.** A level that has
   already been approved or rejected can't be delegated.
2. **Not to the same person,** and not to someone who already approves
   (or has approved) another level of the same document. Otherwise one
   person would sign two levels and the second check would be lost. In
   a bulk delegation, such approvals are skipped and listed.
3. **The new approver must be active and able to open the document:**
   module access, plus the document's company.
4. **The document's creator can receive it,** as today when the creator
   is a configured approver. The decision is marked "self-approved" as
   now.
5. **Approval Configuration is not changed.** Delegation moves approvals
   that are already waiting. Documents submitted later still go to the
   configured approver. For a long absence, change the approver in
   Approval Configuration, or delegate again.
6. **An approver needs Approval Tracker access** to delegate their own
   approvals, as for opening the Tracker today.

## What changes in the code

- **Shared logic:** a new `delegateApprovalLevel` in
  `functions/src/approvals.js`, with the checks above and the history
  entry.
- **Callables:** two new ones, `delegateApproval` (one level) and
  `delegateApprovalsOf` (all of an approver's), plus a list of eligible
  users for the picker.
- **The Tracker:** its generated screen and detail gain the Delegate
  controls and the history. It becomes hand-maintained, like Approval
  Configuration did.
- **Deploy:** a functions set, then screens.

## Tests (planned)

- **Emulator:**
  - an Admin delegating any level, and an approver their own; an approver
    trying someone else's is refused;
  - the new approver can decide, and the old one no longer can;
  - Home tasks follow the delegation;
  - the history is recorded, and a missing reason is refused;
  - refused: a decided level, a non-pending approval, the same person,
    someone already on another level, an inactive user, and a user
    without module or company access;
  - bulk delegation: moves all eligible approvals, skips and lists the
    others;
  - a Job Order level, which is decided in order.
- **UI:** delegating from the Tracker, and the history shown.
- **Negative controls** for each rule.
