# Help: how to use the ERP (design, 2026-10-12)

**Owner, 2026-10-12:** "Now we need to develop one important area — Help,
which gives users the idea how to use the ERP. It is educational material,
so I prefer to make it free to all without any user limit; also check the
possibility to access it publicly. It should be updated based on any
updates we do in the ERP."

## Today

- No help exists. Users learn the screens from colleagues; the only
  written material is the developer docs in `docs/` (design decisions,
  not instructions).
- **No user limit exists anywhere:** the ERP has no licence or seat
  count. "Free to all" therefore means: no sign-in, no access right, no
  role needed to read help.
- **Public access is possible.** Firebase Hosting already serves
  `public/` to anyone on the internet (that is how the sign-in page and
  the Employee Portal load). Help pages placed there are public at
  `https://<the ERP's site>/help/`. Two existing rules have to make room:
  - `tools/deploy-hosting.sh` refuses any file in `public/` besides
    `index.html` and `ess.html` (owner, 2026-09-26: module **screens**
    stay behind the access check). Help is not a screen and holds no data,
    so the guard would allow `public/help/` and only that, and still refuse
    everything else.
  - Security rules stay deny-all; help needs no database at all.
- **Size:** 86 modules in the registry, about 46 on the menu, plus the
  Employee Portal.

## Proposed

### What a user sees

- **A Help site** at `/help/`: a home page by area (Getting started,
  Finance, Procurement, Inventory, Sales, Retail, Production, Fixed
  Assets, HR & Payroll, Employee Portal, Administration), a search box,
  and one page per module.
- **A module page** has the same shape every time:
  1. What it is for (two or three lines);
  2. Before you start (the setup it needs, with links: accounts in Company
     Master, a menu node, the rights);
  3. Step by step (the common tasks, numbered);
  4. What happens in the books (the GL entry and stock effect, where
     there is one);
  5. Rights (which right allows what);
  6. Questions and mistakes (the refusals users meet, e.g. "the month is
     closed", and what to do);
  7. Related pages.
- **Getting started:** signing in, the menu, Home tasks, dates
  (dd/mm/yyyy), Copy to Excel, Print, approvals, the period lock.
- **From inside the ERP:** a **Help** button in the top bar opens the
  page for the screen in use (a new tab); on Home, the help home page.
  The Employee Portal gets its own short guide, linked from the portal.
- Plain pages that print well and work on a phone; no sign-in, nothing
  read from the database.

### How it is written and published

- The text lives in the repository as one Markdown file per module,
  `help/<MODULE>.md`, plus the general pages. A build step turns them into
  `public/help/*.html` (the same look as the ERP) with a search index;
  Hosting publishes them (the Deploy workflow's "hosting" task).
- Help is written by me (Claude) from the code and the design docs, in
  plain words, and reviewed by you. It is English (Arabic can be added
  later as a second language, if wanted).

### Keeping it current (question 149)

The owner asks that help follow every change. Proposed: the Deploy
workflow's checks (as the date-format and popup checks do today) refuse a
deploy when

- a module in the registry (with a menu node) has no help page; or
- a module's screen or server code changed since its help page was last
  reviewed: each page records a fingerprint of its module's files; when
  they change, the page must be updated, or marked "reviewed, nothing to
  change" (`node tools/help/stamp.js MODULE`), which renews the
  fingerprint.

And a standing convention in CLAUDE.md: a change to a module includes its
help page, in the same PR.

## Open questions (round 13)

148. **Who can read it.**
     - **Public, but hidden from search engines** — anyone with the link
       reads it; Google does not list it (`noindex`) — recommended: free to
       all, without advertising how your company's system is set up;
     - public and listed by search engines (useful if the ERP is offered
       to others);
     - signed-in ERP users only.
149. **Keeping it current.**
     - **Enforced:** the Deploy workflow refuses a deploy when a module has
       no page, or its code changed and the page was not updated or marked
       reviewed — recommended (help cannot fall behind);
     - a check that every module has a page, plus the convention only;
     - the convention only.
150. **Pictures.**
     - **Screenshots taken automatically** from the test system with
       made-up demo data, retaken on every update — recommended: they stay
       current and never show real company data;
     - text only;
     - screenshots added by hand.
151. **Order of writing** (about 47 pages; one area per PR).
     - **The framework and Getting started first, then by area:** Finance,
       Procurement & Inventory, Sales & Retail, HR & Payroll with the
       Portal, Fixed Assets & Production, Administration — recommended;
       the enforced check (149) counts only the areas already written
       until the last one is done;
     - another order (please name it);
     - everything in one PR (slower to review).
