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

## The owner's decisions, round 13 (2026-10-12)

| # | Question | Decision |
|---|---|---|
| 148 | Who can read it | **Public and listed by search engines.** No sign-in, no user limit. |
| 149 | Keeping it current | **Enforced by Deploy:** a module with no page, or whose code changed while its page was neither updated nor marked reviewed, stops the deploy. |
| 150 | Pictures | **Text only.** |
| 151 | Order of writing | **The framework and Getting started first, then by area**, one area per PR. |

Consequences:
- Being public and listed, help pages describe the system in general
  terms: made-up examples (company "Example Trading LLC", account codes
  like 1100), never this business's names, accounts, people or figures.
- Hosting publishes `public/help/` and a `public/robots.txt` pointing
  search engines to the help sitemap; the deploy guard allows those and
  still refuses anything else in `public/`.

## As built: step 1, the framework and Getting started (2026-10-12)

- **Sources:** `help/areas.json` (the areas in decision 151's order, each
  with its modules; all 86 registry modules are placed, and `written` marks
  the areas whose pages are done) and `help/pages/<page>.md`, one per
  page, with a header:

  ```
  ---
  title: Expiry / Batch Report
  area: inventory
  modules: [BATCHEXPIRY]          (the screens it covers; several allowed)
  sources: [functions/src/stockReports.js]   (other files it describes)
  summary: one line, shown under the title and in search
  reviewed: 2026-10-12            (set by stamp.js)
  fingerprint: 1a2b3c4d5e6f7a8b   (set by stamp.js)
  ---
  ```

  A module page needs at least "## What it is for" and "## Step by step".
- **Build:** `node tools/help/build.js` writes `public/help/` (home page
  with every area and what is still coming, one page per help page, the
  stylesheet, search, the search index and `sitemap.xml`) and
  `public/robots.txt`. Plain HTML and CSS, light and dark, phone-width,
  print-friendly; no sign-in, no database, nothing from the ERP. Dates on
  the pages are dd/mm/yyyy, written by the build (there is no shell there).
  A small Markdown converter (`tools/help/markdown.js`) escapes all text, so
  a page cannot put HTML or script on the public site.
- **Listed by search engines (148):** `robots.txt` allows `/help/` and
  points to the sitemap; it asks engines to leave the rest of the site (the
  sign-in page and the portal) out of their results.
- **Kept current (149):** `functions/test/unit/help.test.js`, run by the
  Deploy workflow's new **Check help** step before every deploy, refuses:
  a registry module in no area; a module of a written area without a page;
  a page whose fingerprint (its screens, `screens/<ID>.html`, plus its
  `sources`) no longer matches; a link to a missing page or section; and a
  `public/help/` not exactly what the build makes. After changing a module:
  update its page (or confirm it needs no change) and run
  `node tools/help/stamp.js <page>`, which renews the fingerprint and date
  and rebuilds. CLAUDE.md carries the standing rule.
- **In the ERP:** a **Help** button in the top bar (always visible, also
  inside a screen) opens `/help/` in a new tab, or `/help/?m=<MODULE>` from
  a screen, which goes to that screen's page or, while its area is not yet
  written, says so on the help home page. The sign-in card has a "How to
  use the ERP" link.
- **Hosting:** `tools/deploy-hosting.sh` allows `public/robots.txt` and
  flat files in `public/help/` (`.html .css .js .json .xml`), and still
  refuses anything else; `hostingGuards.test.js` and
  `tools/test-deploy-hosting.sh` cover it. Goes live with the Deploy
  workflow's **hosting** task.
- **Pages written:** Getting started (signing in, the menu, Home tasks,
  favourites, the user menu, the automatic sign-out), Working with screens
  (company, dates, drafts and posting, messages, Copy, Print, supporting
  documents, closed months, drilling down) and Approvals.
- **Tests:** `help.test.js` (4) and `help.ui.js` (4): the site as Hosting
  serves it (every area; every link and section; search; `?m=`; robots and
  sitemap) and the shell's Help button. Negative controls: 10, all caught.
- **Next (decision 151):** Finance, then Procurement & Inventory, Sales &
  Retail, HR & Payroll with the Employee Portal guide (linked from the
  portal), Fixed Assets & Production, Administration; one area per PR,
  marked `written` in `help/areas.json` when done.
