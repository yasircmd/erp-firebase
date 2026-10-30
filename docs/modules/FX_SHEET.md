# Exchange rates from a Google Sheet (UX round 2, item 35)

Status: **built** (2026-10-30; deploy set `ux2-fx-sheet`). Decided (owner): Q281 (2026-10-26) the sheet's
rates apply **only after someone confirms**; Q329-Q331 (2026-10-30) below.

## What the owner asked

Exchange rates without a paid API: a Google Sheet using GOOGLEFINANCE,
published to the web, read by the ERP.

## Today

Rates are typed in Currency Configuration → Rates (MULTI_CURRENCY.md,
decisions 211-218): `exchangeRates/{CODE}/{pushId} { EffectiveDate, Rate,
Note, By, ByName, At }`, 1 foreign unit = Rate base units, only ever added
(a correction is a new rate). The right **rates** enters them.

## Proposed

- **The sheet.** Two columns, a heading row and one row per currency:
  `Code` (USD) and `Rate` (1 USD in the base currency), for example
  `=GOOGLEFINANCE("CURRENCY:USDAED")`. Help gives a template to copy. The
  sheet is published to the web as CSV (File → Share → Publish to web →
  CSV), which gives a link anyone can read but no one can edit.
- **Where its link is kept.** In Currency Configuration, a **Rates from a
  sheet** box: the published CSV link, saved with the **write** right.
  Only a Google Sheets published link (`https://docs.google.com/spreadsheets/
  …/pub?…output=csv`) is accepted, so the server never fetches any other
  address.
- **Getting the rates.** **Get rates from the sheet** (the **rates** right)
  reads the CSV and shows, for each active currency of Currency
  Configuration:
  - the sheet's rate;
  - the last rate entered and its date;
  - the change in %.

  A currency the sheet lacks, a rate that isn't a number above 0, or a code
  that isn't a currency here is said and left out.
- **Confirming (Q281).**
  - The user chooses the date the rates take effect (today by default) and
    ticks the rates to apply.
  - **Apply** adds each as an ordinary rate, its Note "From the sheet", by
    that user. A document then takes it like any typed rate. Nothing
    applies without this step.
  - A rate that moved more than 5% from the last one is marked (Q331).
- **No new right**, no new data shape: an applied rate is an
  `exchangeRates` entry as today. Help: the Currency Configuration page.
- **Network.** Cloud Functions reach docs.google.com directly; no key, no
  API. GOOGLEFINANCE's rates can be delayed up to 20 minutes and are
  indicative, which is why a person confirms (Q281).

## The owner's decisions (2026-10-30)

| # | Decision |
|---|---|
| Q329 | The sheet is read **when someone clicks** Get rates from the sheet; no scheduled job. |
| Q330 | **One sheet of the firm's for every corporate**, its link set in the Developer screen. The sheet has a Base column, so each corporate takes the rows of its own base currency. |
| Q331 | A rate more than 5% from the last one is **marked and left unticked**: it applies only if ticked on purpose. |

## The questions as asked

| # | Question | Recommendation |
|---|---|---|
| Q329 | When the sheet is read: **(a)** when someone clicks **Get rates from the sheet** in Currency Configuration, or **(b)** every morning automatically, the rates then waiting on Home as a task to confirm? | **(a)**: a person confirms anyway (Q281), so a daily read saves one click but adds a scheduled job across every corporate, and rates that wait unconfirmed for days. (b) can follow if the click is missed in practice. |
| Q330 | Whose sheet: **(a)** each corporate's own, its link in its Currency Configuration, or **(b)** one sheet of the firm's for every corporate, set in the Developer screen? | **(a)**: each corporate has its own base currency and currencies; one shared sheet would need every pair for every client. |
| Q331 | A sheet rate more than 5% away from the last rate entered: **(a)** marked and left unticked, so it applies only if ticked on purpose, or **(b)** refused? | **(a)**: large moves are rare but real (a devaluation); refusing would force typing it by hand. |

## As built (2026-10-30)

Q330 changed the design above in two ways:

- **The sheet's columns** are **Currency, Base, Rate**: one row per pair any
  client uses, e.g. `USD | AED | =GOOGLEFINANCE("CURRENCY:USDAED")` and
  `USD | INR | =GOOGLEFINANCE("CURRENCY:USDINR")`.
- **Its link** is the firm's: `firmSettings/fxSheet { Url, UpdatedAt,
  UpdatedBy }` in the firm's own Firestore (firebaseAdmin.firm, like the
  directory). It is set on the Developer screen's Groups page
  (`saveDeveloperFxSheet`, Developer write; `getDeveloperCorporates`
  returns it). unit/corporateContext now allows fxSheet.js to reach the
  firm's project, for that link only.

**functions/src/fxSheet.js:**

- `urlProblem`: only `https://docs.google.com/spreadsheets/d/e/…/pub?…
  output=csv` is accepted, so no other address is ever fetched. On the
  emulator, the suites' local server is allowed too.
- `parse`, the CSV:
  - a first row with no number in it is the heading row, and must name
    Currency, Base and Rate (in any order); without one, that order;
  - quoted cells are read, and a comma only as a thousands separator. A
    comma decimal ("4,8") is refused, never read as 48;
  - three-letter codes; rates rounded to 6 decimals;
  - #N/A or "Loading…" is said, not used.
- `getSheetRates` (CURRENCYCONFIG `rates`): the base currency's rows,
  beside each active currency's last rate, with the change %. A move over
  5% is `Big` (Q331). A currency missing from the sheet, or a sheet code
  that isn't an active currency here, is listed.
- `applySheetRates({ effectiveDate, rates })` (`rates`):
  - reads the sheet again and applies the chosen codes at the sheet's
    value, which must still equal the one shown, else it is refused as
    changed;
  - one RTDB update, all or none;
  - each an ordinary `exchangeRates` entry, Note "From the sheet".

**Currency Configuration** (SCREEN_EDITS): the Rates from the sheet box
(shown with the `rates` right): Get, the table (big moves amber and
unticked), the date the rates take effect, Apply.

**Tests:** unit/fxSheet (2), emulator/fxSheet (3), ui/fxSheet (2).
Negative controls, each caught and restored:
- a big move ticked by default;
- Apply trusting the browser's rate instead of the sheet's.

