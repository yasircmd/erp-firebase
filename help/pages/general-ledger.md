---
title: General Ledger Report (Ledger and Listing)
area: finance
order: 11
modules: [GLREPORT]
sources: [functions/src/glViews.js]
summary: Every line posted to an account, with its opening, running and closing balance; or a plain listing across several accounts.
reviewed: 2026-10-16
fingerprint: 7110871578ac3409
---
## What it is for

The General Ledger shows what was posted to an account and why. It has
two views:

- **Ledger**: one account over a period, with opening balance, every line,
  running balance and closing balance;
- **Listing (several accounts)**: the lines of any accounts you pick, by
  date, without balances, with debit and credit totals.

## Step by step

### Ledger

1. Open **General Ledger Reports (GL)**, keep **Ledger** selected.
2. Choose the **Company**, the **Account**, **From** and **To**.
3. If needed, narrow by **Division**, **Branch**, **Cost Center** or
   **Profit Center**.
4. Tick **Include Draft entries** to see drafts as well (marked DRAFT;
   their figures may still change).
5. Select **Run Report**.

### Listing

1. Select **Listing (several accounts)**.
2. Pick an account and select **Add** (or press Enter); repeat for more.
   A header account brings in every account beneath it. Remove one with
   its ×.
3. Choose the dates and filters, and run it.

### From a line to its source

- Select the **Txn Ref** to see the whole journal (**GL Impact**): every
  line with account, cost center, debit and credit. From there,
  **Copy to Excel** or **Open source document** (the invoice, payment,
  cheque… that posted it).
- Select the **Voucher No.** to open the source document directly.

**Copy Table** and **Print** follow the view on screen.

## Good to know

- **Project** filters the lines by project; **No project** shows those
  without one (see also the [Project Report](project-report.html)).

- The **Ledger** of a cash or bank account in a foreign currency (for
  example USD) shows a **Balance (USD)** column beside the balance, and
  each line's USD amount under its debit or credit.

- Reports such as the [Trial Balance](trial-balance.html) open the
  General Ledger for an account when you select it; **Back** returns.
- A listing shows at most 20,000 lines; narrow the dates or accounts if
  asked.
