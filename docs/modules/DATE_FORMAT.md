# Dates: dd/mm/yyyy everywhere, periods Sep-2026

Status: **live** 2026-09-29 (PR #41; Deploy runs #37 and #38).

## The request (owner, 2026-09-29)

"All date format should be dd/mm/yyyy or dd-mm-yyyy, in future also."

## Owner's decisions (2026-09-29)

1. **dd/mm/yyyy**, e.g. 29/09/2026.
2. **Date entry fields keep the browser's date picker.** Its display
   follows each user's computer setting (a US-set computer shows
   mm/dd/yyyy), since a web page can't change it. Only dates the app
   *shows* change.
3. **Tables copied to Excel** carry dates as dd/mm/yyyy, as on screen.
4. **Months / periods show as Sep-2026** (they were 2026-09).

## How it works

- **Storage is unchanged:** dates are still stored and sent as
  yyyy-mm-dd, and periods as yyyy-mm. Nothing on the server changes.
- **One rule in the app shell** (`public/index.html`, the `DATE FORMAT`
  block) formats every date as it appears, on every page, present and
  future:
  - lists, reports, statements and prints;
  - Home tasks;
  - in-app messages, including those from the server ("Period Sep-2026 is
    closed");
  - dropdown labels.
- **What becomes what:**
  - 2026-09-29 becomes 29/09/2026;
  - a timestamp becomes 29/09/2026 14:05;
  - 2026-09 becomes Sep-2026.
- **Left alone:**
  - codes that contain a date, e.g. INV-2026-09-001 or REF-2026-09-29;
  - anything typed into a field, and date entry fields;
  - a question asking you to type a date as yyyy-mm-dd.
- **Excel copies:** "Copy Table" and its copy box carry dd/mm/yyyy.
- **Times:** screens that showed a time their own way now use the shell's
  `isoLocalDateTime`:
  - the Approval Tracker, which showed US style "Sep 29, 2026, 02:05 PM";
    it is a generated screen, changed through a documented edit in
    `tools/legacy-port/generate.js` (SCREEN_EDITS);
  - Home's "saved …" note on drafts.
- **An exception**, if ever needed: an element with class `keep-iso`
  shows the stored form.

## In future

- **A screen writes dates as yyyy-mm-dd** and the shell formats them. It
  never formats them itself (toLocaleDateString, Intl.DateTimeFormat …).
- **`functions/test/unit/dateFormat.test.js` refuses own date formatting**
  in any screen or the shell. The Deploy workflow runs it before every
  deploy ("Check date format").
- **CLAUDE.md has the rule.**

## Known limits

- **Search boxes** still match the stored form: typing 2026-09 finds
  September entries, while 09/2026 doesn't.
- **Paste from Excel** into a grid's date column (e.g. batch expiry)
  still expects yyyy-mm-dd, as before.

## Tests

- **`dateFormat.test.js` (5):**
  - the rule: dates, periods and times;
  - codes, numbers and invalid dates left alone;
  - `isoLocalDateTime`;
  - the shell wiring;
  - no screen formats dates its own way.
- **`dateFormat.ui.js` (2):**
  - the JV list shows 10/09/2026 and "Accrual for Aug-2026", while the
    entry's date field keeps 2026-09-10;
  - messages, an Excel copy and the copy box read dd/mm/yyyy, a
    yyyy-mm-dd question keeps its default, and `keep-iso` opts out.
- **Negative controls, each caught:**
  - the page not formatted;
  - Excel copy not formatted;
  - every question formatted;
  - `keep-iso` ignored;
  - periods not formatted;
  - codes not protected;
  - a screen formatting its own dates.

## To go live

1. Deploy → **"hosting"** (the shell).
2. Deploy → **"screens only"** (the Approval Tracker).
