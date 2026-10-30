# Exchange rates from a Google Sheet (UX round 2, item 35)

Status: **proposed** (2026-10-30). Q281 decided (owner, 2026-10-26): the
sheet's rates apply **only after someone confirms**. Q329-Q331 open.

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

## Open questions (the owner's)

| # | Question | Recommendation |
|---|---|---|
| Q329 | When the sheet is read: **(a)** when someone clicks **Get rates from the sheet** in Currency Configuration, or **(b)** every morning automatically, the rates then waiting on Home as a task to confirm? | **(a)**: a person confirms anyway (Q281), so a daily read saves one click but adds a scheduled job across every corporate, and rates that wait unconfirmed for days. (b) can follow if the click is missed in practice. |
| Q330 | Whose sheet: **(a)** each corporate's own, its link in its Currency Configuration, or **(b)** one sheet of the firm's for every corporate, set in the Developer screen? | **(a)**: each corporate has its own base currency and currencies; one shared sheet would need every pair for every client. |
| Q331 | A sheet rate more than 5% away from the last rate entered: **(a)** marked and left unticked, so it applies only if ticked on purpose, or **(b)** refused? | **(a)**: large moves are rare but real (a devaluation); refusing would force typing it by hand. |
