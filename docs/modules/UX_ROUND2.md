# UX round 2: the owner's issues and suggestions (2026-10-24)

Status: **plan agreed** (owner, 2026-10-24, PR #168); wave 1 in progress. 37 items from the owner's own
work in the ERP, studied against the code and earlier decisions, sorted
into five waves. Wave 1 needs almost no decisions and can start at once;
each later wave starts with its open questions answered (decisions 266
onward), then its design, then the build, one PR per item or small group,
each with tests, a negative control, Help and What's new.

**Order:** fixes before features; within features, what saves the most
clicks in daily work first; the large items last, each with its own design
document.

## Wave 1: fixes and small changes (no or one-line decisions)

| # | Module | Item | Finding / plan |
|---|---|---|---|
| 1 | PDC Issued / Received | Going Back while the screen is still loading shows an error | **Built (2026-10-24, Hosting only).** A late answer reached a screen that was gone; its handler failed on the missing elements and the bridge showed that as the error. Fixed for every screen in the shell's rpc bridge: a call made from a screen is answered only while that screen is still open (`__activeModuleToken`); Home's own calls always. And a screen with no initModule of its own no longer re-runs the previous one's. ui/home leaves mid-load by Back and by another module. |
| 2 | Approvals / Home tasks | A rejected transaction stays in Tasks even after it is resubmitted with changes | **Built (2026-10-24, deploy set `ux2-wave1-fixes`).** The cause: corrected to need no approval (e.g. a lower amount), the document posts at once and keeps the old approval's id, which was all Tasks checked. Now the document's status must also still wait for correction (Rejected; Draft for payroll; Amendment Requested for a Job Order line; a Closed PO whose reopening was refused). |
| 3 | Approvals / Home tasks | A rejected item can be closed when no resubmission is wanted | **Built (2026-10-24, `ux2-wave1-fixes`):** Close on the task in Home, and for an Admin in Approval Tracker; the approval record gets Status Closed with ClosedNote / ClosedBy / ClosedAt, its decisions kept, the document untouched. **Decided (Q266, owner 2026-10-24):** the submitter or an Admin may close it. Closing marks it "Closed, not resubmitted" (kept for the audit trail) and removes the task. |
| 4 | Production Entry | Opening an entry sometimes shows item names "not found" and the Job Order not linked | **Built (2026-10-24).** A race: an entry opened before the item list arrived drew its items as "not found" and was never redrawn (and a save then could lose the items); two Job Order list loads answered in either order, the later one dropping the entry's. And a posted entry's Job Order, complete, was never in the eligible list. Now the entry waits for its reference lists, only the latest Job Order load applies, and the entry's own Job Order is shown by number (getProductionEntries carries JobOrderNumber, patch `production-job-order-number`). ui/production slows the item list. |
| 5 | Sales Order | The item name field is too short | **Built (2026-10-24, with 6).** Sales Order is a wide screen, and its Item Name column at least 16rem. Other order and invoice screens can opt in the same way (`data-wide-screen`) if wanted. |
| 6 | Employees | Reduce margins (a wider page) | **Built (2026-10-24).** Every screen sat in the shell's 1152px column (`max-w-6xl`). A screen marked `data-wide-screen` now gets the window's width up to 1792px (`setPageWidth` in public/index.html); Employees and Sales Order are marked; Home and the rest keep the column. |
| 7 | Chart of Accounts | Remove the "formerly …" code under renumbered accounts | **Decided (Q267, owner 2026-10-24):** off the list; kept only in the account's details, so an old code on a printed report can still be traced. |
| 8 | Invoice print (Employee Portal / export) | An export invoice need not show the base currency | **Decided (Q268, owner 2026-10-24):** both prints (the ERP's Customer Invoice and the sales rep's portal invoice). For a foreign-currency invoice, show the base-currency (AED) VAT block only where the law needs it, else hide it. |
| 9 | Data Reset | Payroll and the HR data are missing; check what else | Add the missing categories (employees and their records, payroll runs and payslips, leave, loans and advances, settlements, provisions, employee requests, sales orders / POs / GRNs / DNs if missing), with the same dependency checks. A test that a reset in Corporate 100 leaves a client's data untouched (it runs in its own project since M1; the test proves it). |
| 10 | Payroll Setup → HR Setup | Move Leaving Reasons to HR Setup | Move the tab; the data stays where it is, so nothing is lost. |
| 11 | Developer | Groups and the Support queue on tabs of their own | Tabs: Corporates, Groups, Support queue. |
| 12 | Developer | Is "Update corporates that follow the main tree" still needed? | Since PR #160 every release does it (and gives a corporate with no menu the main tree). The button only does it **now**, without a release. **Decided (Q269, owner 2026-10-24): removed.** The owner's concern (2026-10-24): a click by accident reaches every client. It asks first, keeps each corporate's own layout and who may see each item, and does only what the next release would do; but it would send a half-finished main tree to every client at once. So releases alone do it for every client, and a corporate's own Tree tab (Back to the main tree) still does one corporate now. |

## Wave 2: Home, sign-in and keyboard

| # | Item | Plan / questions |
|---|---|---|
| 13 | F2: find a module; arrow keys to choose | F2 focuses the module search; ↑ ↓ move through the matches, Enter opens. |
| 14 | Tab and Enter to open modules without the mouse | The menu's items reachable by Tab, opened by Enter; a visible focus ring. |
| 15 | F1: Help | F1 opens the Help page of the screen in use (Home: Getting started). |
| 16 | Default 5 favourites per role | **Q270:** set by whom (Admin in Roles & Permissions)? Given to a user who has none yet, or also added to users who have some? Recommendation: per role in Roles, given only to users with no favourites, so nobody's own choice is overwritten. |
| 17 | Sign in with a user ID as well as the email | Firebase signs in by email; the ERP can look the user ID up and sign in with its email. **Q271:** is the user ID the existing "username" (unique per corporate)? |
| 18 | Light / dark remembered with the user, light by default | **Q272:** saved with the user (every device) and light for a new user? Today it is per device. |
| 19 | Choose companies at the top, after the company name; one chosen = the one-company rule; remembered | **Q273:** a filter of the companies a user is assigned (not a change of rights)? Every screen then defaults to the chosen ones, as the one-company rule does today. |
| 20 | Hide details in view-source before login | **Already decided "not planned"** (2026-10-14): the page holds only the public web config; security is the deny-all rules and the functions' checks. Offered again: a review that nothing sensitive is in the page source (minifying would hide nothing real). **Q274:** confirm. |

## Wave 3: sales, purchasing and finance flows

| # | Item | Plan / questions |
|---|---|---|
| 21 | Link the steps: approved SO → DN → invoice → payment, and the like | A "Create next" action on each posted document, opening the next one filled from it (as SO → invoice does since wave 2, H). Purchasing too: PR → PO → GRN → vendor invoice → payment. Its own design: which steps, partial quantities. |
| 22 | Proforma invoice from a Sales Order | A print / PDF of the SO as "Proforma Invoice", no posting. **Q275:** its own numbering, or the SO number? |
| 23 | Re-match: also add a new reference | In Re-match, a line can become a New Ref (e.g. an advance) as well as Against Ref. |
| 24 | Stock Availability: what the reserved quantity is for | The reserved figure links to the Sales Orders reserving it. |
| 25 | Several cheques in one PDC entry, same vendor / customer | One entry with cheque lines (number, date, amount, bank each); each cheque still cleared / bounced on its own. Its own design (how the GL entry is made per cheque). |
| 26 | Item code chosen by the user, apart from the system code and the barcode | A "User code" per item, unique per company, shown and searched everywhere; the system ID stays internal. **Q276:** may the user code replace the system code on prints and lists? |

## Wave 4: Employee Portal, HR and payroll

| # | Item | Plan / questions |
|---|---|---|
| 27 | Employee requests for anything: leave, IT support, HR support, salary certificate, experience certificate…, with flexible fields, a token number and tracking like the Approval Tracker | Request types set up by HR, each with its own fields (text, date, choice, file), handler and approval route; a token number per request; a tracker for the employee and the handlers. Builds on Employee Requests (payroll queries). Its own design. **Q277:** may certificates be produced by the ERP (a template filled from the employee's record), or only uploaded by HR? |
| 28 | A leaver's clearance as a journey: Finance → IT → HR | Steps in order, each signed off by its department, with notes and items returned; the settlement waits for the last step. **Q278:** the steps fixed, or set up per company? |
| 29 | Stop salary: hold an employee's salary | A hold on an employee (from / until, reason); payroll leaves them out (or computes and holds payment). **Q279:** left out of the run, or computed and only not paid? |
| 30 | Sales rep collects cash into an account of their own (not main cash) | Each rep mapped to a cash account; their collections post there; handed over to main cash by a transfer. |
| 31 | Sales rep: a receipt to share with the customer from their app | A receipt (PDF / image) the rep can share (WhatsApp, email) from the portal. |

## Wave 5: larger items, each its own design

| # | Item | Plan / questions |
|---|---|---|
| 32 | Tax per item or line (some items exempt or at another rate) | Today one tax for the invoice. Line-level tax categories (standard, zero-rated, exempt, out of scope), on sales and purchases, in the GL, the VAT return figures and e-invoicing (PINT AE carries tax per line). Large: touches every invoice, return and print. **Recommendation: the most valuable of wave 5**, for VAT accuracy. |
| 33 | A mobile-friendly view | The most used screens first. **Q280:** which screens matter most on a phone? |
| 34 | An offline / installable app that loads faster | An installable web app (PWA): the shell and screens cached, so they open faster. True offline work (saving without a connection) is not proposed: postings must reach the server to be checked. |
| 35 | FX rates from a Google Sheet without an API | Feasible: the sheet uses GOOGLEFINANCE, is published to the web as CSV, and the ERP reads it daily, the rates shown for review before they apply. **Q281:** applied automatically, or only after someone confirms? (GOOGLEFINANCE rates can be delayed; they are indicative.) |
| 36 | A default chart heading for any new corporate | Set up already copies Corporate 100's current headings (decision 261). **Q282:** is something more wanted (done automatically when a corporate is added, or another default set)? |
| 37 | Data Reset in 100 must not clear a client's | Answered in wave 1 (#9): already separate; the test proves it. |

## Open questions, in the order they are needed

Wave 1: Q266–Q269 all decided. Wave 2: Q270–Q274. Wave 3: Q275, Q276.
Wave 4: Q277–Q279. Wave 5: Q280–Q282.
