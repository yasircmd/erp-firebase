---
fingerprint: e3b0c44298fc1c14
reviewed: 2026-10-30
title: What's new
area: start
order: 3
summary: The latest changes to the ERP, newest first, with a link to each screen's page.
sources: []
---
The latest changes, newest first. Each links to the page that explains the
screen.

## 30/10/2026

- **Tax Reports.** The new [Tax Reports](tax-reports.html) screen works
  out a company's tax for a period from its posted documents: the tax
  summary, UAE VAT 201, and India's GSTR-1 (the GST offline tool's sheets)
  and GSTR-3B. Each figure opens its documents, and each table copies to
  Excel. Documents posted with one tax % before line tax are listed apart.
  India's B2CL limit is set in [Tax Configuration](tax-configuration.html).

- **Retail Sales, asset sales and orders taxed by code.** For a company
  with a Tax Configuration, [Retail Sales](retail-sales.html) takes each
  line's tax out of its price by the item's code, posts each component to
  its account and prints it on the receipt; returns give back each line's
  share. An asset sale in [Fixed Asset Retirement](fixed-asset-retirement.html)
  takes a tax code. [Sales Orders](sales-order.html), their Proforma
  Invoices and [Purchase Orders](purchase-order.html) show the estimated
  tax and the total with tax.

- **Vendor Invoices taxed line by line.** For a company with a Tax
  Configuration, each [Vendor Invoice](vendor-invoice.html) line takes its
  tax code from its item, or from its account's new default code in the
  [Chart of Accounts](chart-of-accounts.html), with GST from the vendor's
  state. The part of the tax a code lets you reclaim goes to the input
  accounts. The rest is cost: the line's own account, or the goods' cost in
  stock. Reverse charge posts the tax both ways.
  [Purchase Returns](purchase-return.html) take back their share. Changing a
  line's code needs the new **change tax code** right.
## 26/10/2026

- **Invoices taxed line by line.** For a company with a Tax Configuration,
  each [Customer Invoice](customer-invoice.html) line now takes its tax code
  from its item or Sales Type, at the rate on the invoice date: standard,
  zero-rated and exempt lines on one invoice, GST as CGST + SGST or IGST by
  the place of supply, and prices that include tax from a
  [price list](price-listing.html) marked so. Each component posts to its
  own account and prints with its rate; [Sales Returns](sales-return.html)
  take back their share. Changing a line's code needs the new **change tax
  code** right.

- **India's e-invoice, ready.** Under India GST, each posted invoice and
  credit note to a registered business, an SEZ or a customer abroad gets
  its e-invoice as the IRP's JSON, checked for what it needs (GSTINs,
  addresses and PIN codes, HSN codes) and downloadable from the invoice. See
  [Sales Invoice Configuration](sales-invoice-setup.html). Customers and
  vendors gain a [City and PIN code](customer-master.html).

- **Tax Configuration, for VAT, GST or a tax of your own.** Each company
  now sets its sales tax in [Tax Configuration](tax-configuration.html):
  UAE VAT or India GST ready-made, or its own, with each component's
  accounts and its tax codes rated by date. Items take a tax code and HSN /
  SAC; customers and vendors a registration type, state or emirate, and a
  checked GSTIN or TRN. Invoices start using it in the next release.

- **Sales reps' receipts, final at once.** A rep's collection in the
  Employee Portal now gives the customer its receipt straight away,
  numbered from the rep's own series (RC-AK-000001), shared as a PDF from
  the phone. The rep picks the invoices it pays, and sees the cash and
  cheques they hold. The cashier takes the cash with a Cash Receipt that
  chooses the rep; the office ticks the cheques received from the rep. See
  [Sales reps](sales-rep-portal.html), set up in
  [Sales Invoice Configuration](sales-invoice-setup.html#sales-reps).

## 25/10/2026

- **Request types of your own.** In [Employee Requests](employee-requests.html#request-types)
  HR sets up the requests employees raise from the portal: a salary
  certificate, IT support … each with its own form, straight to its
  handler or through the line manager first, an optional time to answer
  (overdue shown), and a document as the answer. Employees find them under
  **Requests → Other**; numbered RQ-.
- **Leaver clearance.** The new [Clearances](clearances.html) screen takes
  each leaver through the company's steps (Finance, IT, HR by default),
  each signed off by its team, with a checklist and any amount to recover.
  The final settlement goes for approval once every step is signed; the
  leaver follows it in the Employee Portal.
- **Hold a salary.** Payroll's new **Salary holds** tab stops an
  employee's salary from a month: the payslip shows a Stop Salary
  deduction and the amount waits on a Salary held account (set it in
  Payroll Setup). Released, it is paid with the next run. See
  [Payroll](payroll-run.html#hold-an-employee-s-salary).
- **Several post-dated cheques in one entry.** Enter a customer's or
  vendor's set of cheques at once, with a **Monthly series** for a run of
  monthly cheques. They post under one number, -01, -02 …, and each then
  clears or bounces by itself. See
  [Post-dated Cheques](post-dated-cheques.html#record-a-cheque-or-a-set-of-cheques).
- **Create next, and linked documents.** From a Sales Order, Delivery Note,
  invoice, requisition, Purchase Order or Goods Receipt, **Create next**
  starts the next document already filled in, and **Linked documents**
  lists the documents before and after it, each opened from its number.
  See [Working with screens](working-with-screens.html#linked-documents-and-create-next).

## 24/10/2026

- **Your own item codes.** Give an item a User code in
  [Item Master](item-master.html#your-own-item-code): it shows in place of
  the item code everywhere, and you can type it wherever you enter an item.
- **What reserved stock is for.** In [Stock Availability](stock-availability.html),
  select a Reserved quantity to see the Sales Orders reserving it, and open
  one from there.
- **New Ref shown in Allocate.** When matching a payment to bills, and in
  Re-match, the part left over shows as its own **New Ref** line, and
  **All as New Ref** makes the whole line an advance. See
  [Paying and allocating](payments-and-allocation.html#fixing-a-wrong-pick-re-match).
- **Proforma Invoice from a Sales Order.** Print a saved Sales Order as a
  Proforma Invoice with its own PI number, the same on every reprint; a
  draft prints marked DRAFT. See [Sales Order](sales-order.html#proforma-invoice).
- **Choose your companies at the top.** With more than one company, the
  button after the title chooses which of them the screens offer; with one
  chosen, they fill it in for you. Your choice is kept for the next sign-in.
  See [Getting started](getting-started.html#choosing-your-companies).
- **Sign in with your user ID.** On the sign-in page, enter your email or
  your user ID (your Username in User Management). Usernames are now
  unique in your organisation. See [Getting started](getting-started.html#signing-in).
- **Default favourites per role.** In [Roles & Permissions](roles.html),
  the star on a role sets up to 5 favourites for its users who haven't
  chosen their own. Nobody's own favourites are changed.
- **Light or dark, everywhere you sign in.** Your choice of Light mode or
  Dark mode now goes with you to every computer. The ERP starts in light
  mode until you choose. See [Getting started](getting-started.html#the-user-menu).
- **The menu by keyboard.** **F2** goes to Search modules, the arrow keys
  move through the menu, **Enter** opens a screen, and **F1** opens Help.
  See [Getting started](getting-started.html#the-menu).

- **Data Reset covers every module.** It can now clear HR and payroll
  (employees, leave, payroll runs and payslips, settlements, loans,
  requests), Sales and Purchase Orders, Job Orders, vendors, customers,
  price lists, supporting documents, and a new **Setup** group. It refuses
  to clear a master still in use, and says what uses it. Clearing
  employees also removes their Employee Portal sign-ins. Clearing
  supporting documents moves their files to the storage's trash. See
  [Data Reset](data-reset.html).
- **Leaving Reasons are in HR Setup.** The list moved from Payroll Setup to
  [HR Setup](hr-setup.html#leaving-reasons), with the same reasons. Who may
  change it is now the HR Setup right. Employees choose from it as before.
- **An export invoice prints in the customer's currency only.** A Customer
  Invoice in a foreign currency with no VAT no longer shows the rate and
  amounts in the default currency on its print. With VAT, they still show.
  See [Customer Invoice](customer-invoice.html#a-customer-in-a-foreign-currency).
- **Chart of Accounts: a renumbered account's old code is in its
  details.** The list no longer shows "formerly …" under it; open the
  account (Edit) to see its former codes and until when. See
  [Chart of Accounts](chart-of-accounts.html).
- **More room on wide screens.** [Employees](employees.html) and
  [Sales Order](sales-order.html) use the width of a wide monitor, and the
  Sales Order's item names have more space. Other screens keep the usual
  width.
- **Production Entry opens complete.** An entry opened while the screen
  was still loading showed its items as "not found" and its Job Order as
  not linked. It now waits for the lists, and a posted entry's Job Order
  shows by its number even once it is complete. See
  [Production Entry](production.html).
- **No error after going Back while a screen loads.** Leaving a screen
  (for example PDC Received or PDC Issued) before it has finished loading,
  by Back or by opening another module, no longer shows an error message.
  See [Working with screens](working-with-screens.html).
- **Rejected documents leave your tasks when they should.** A rejected
  document that you correct and post without approval (for example at a
  lower amount) no longer stays under Rejected in your Home tasks.
- **Close a rejection you will not resubmit.** Choose **Close** on it in
  your Home tasks; an Admin can also close one in Approval Tracker. The
  rejection stays on record as "Closed, not resubmitted". See
  [Approvals](approvals.html#rejected-documents).

## 23/10/2026

- **Your company's name on Home without a reload.** When a company is
  assigned to you, the title above the menu shows it as soon as you come
  back to Home. See [Getting started](getting-started.html#the-menu).
- **A menu folder can no longer be linked to a module.** In
  [Tree Management](tree-management.html), an item either opens a screen or
  holds sub-items, and a top-level item (an area of the menu) never opens a
  screen. A folder linked to a module by mistake now stays in the menu,
  with everything under it, so it can be put right.

## 22/10/2026

- **Support.** Your Admin can send an issue (a bug, a question or a change
  you need) to the ERP's support team from [Support](support.html), with
  up to 5 screenshots or files, and follow their answers there. What you
  send is shared with the support team: the screen asks you to confirm it
  each time.

## 19/10/2026

- **The Corporate ID field starts empty.** On the [sign-in page](getting-started.html),
  Forgot Password and the Employee Portal, type your Corporate ID; your
  browser can save it and offer it next time.
- **Sign in by Corporate ID.** The [sign-in page](getting-started.html)
  now uses the Corporate ID to choose which organisation's ERP you sign in
  to. **Forgot Password** and the **Employee Portal** ask for the
  Corporate ID too. Nothing else changes when you sign in.

## 18/10/2026

- **Production and cheques post all at once.** Posting a [Production Entry](production.html)
  now updates its Job Order lines and reserves what it made for their
  Sales Orders in the same step, and posting, clearing, bouncing or
  cancelling a [post-dated cheque](post-dated-cheques.html) writes its GL entry and the cheque
  together. If anything stops the posting, nothing of it is saved.
- **Goods receipts and vendor invoices post all at once.** Posting a
  [GRN](goods-receipt-note.html) now updates the quantities received on its Purchase
  Orders in the same step, and posting a
  [Vendor Invoice](vendor-invoice.html) marks its GRNs in the same step. If
  anything stops the posting, nothing of it is saved, so you can correct it
  and post again.

## 17/10/2026

- **Renumbering an account updates the stock documents too.** When you
  renumber an account in the [Chart of Accounts](chart-of-accounts.html),
  GRNs, issues, deliveries, returns and the other stock documents now show
  its new code as well, like every other document.
- **Deliveries and customer invoices post all at once.** Posting a
  [Delivery Note](delivery-note.html) now updates its Sales Orders and
  reservations in the same step, and posting a
  [Customer Invoice](customer-invoice.html) marks its deliveries in the
  same step. If anything stops the posting, nothing of it is saved, so you
  can correct it and post again.

## 16/10/2026

- **Sales reps in the Employee Portal.** A **Sales** tab for employees the
  office makes sales reps (Sales Invoice Configuration → Sales reps): their
  customers with balances, orders at the price list sent to the office as
  draft Sales Orders, and cash or cheque collections recorded for the
  office to post. See [Sales reps in the Employee Portal](sales-rep-portal.html).
- **E-invoicing, ready.** Switch it on per company in
  [Sales Invoice Configuration](sales-invoice-setup.html), from a date: each
  posted Customer Invoice and Sales Return to a customer with a TRN gets
  its UAE e-invoice (PINT AE), checked, with its status and the XML to
  download. It is sent once your Accredited Service Provider is chosen and
  connected; nothing is sent before.
- **Projects, and which accounts need a cost center.** A **Project** is
  a new kind of Organizational Unit, with a customer and dates; a Closed
  one takes no new postings. Journal and Cash and Bank lines take a
  project, and an invoice's project goes on all its lines. In the Chart of
  Accounts each heading (and any account) says whether its lines need a
  cost center, profit center and project: Required, Optional or Not used.
  Nothing changes until you set it: expenses still need a cost center. The
  new [Project Report](project-report.html) shows each project's income,
  costs and result; the GL Report, Trial Balance and P&L filter by project.
  See [Organizational Units](org-units.html) and
  [Chart of Accounts](chart-of-accounts.html).
- **Vendors and customers in a foreign currency.** A vendor or customer
  whose Default Currency is, say, USD is invoiced, paid and given its
  statement in USD. Enter rates by date in **Currency Configuration →
  Rates** (1 USD = 3.6725 AED from a date until the next rate) and choose
  each company's **Exchange Gain / Loss** account. Customer and Vendor
  Invoices take the rate on their date (another rate needs a reason);
  in **Cash and Bank** you enter the USD amount beside the amount, and a
  difference from the bills' rates posts as an exchange gain or loss.
  Statements and aging show USD with the AED beside it. For now: USD
  invoices take direct lines (and item lines for customers), not GRNs or
  separate Delivery Notes. Journal Entries and Post-dated Cheques take
  the USD amount too, and Opening Balances take open documents in USD
  with their rate. A bank account can be in USD (Chart of Accounts →
  Currency): its vouchers are in USD and its ledger shows the USD
  balance. A printed USD invoice shows the VAT and the total in AED. See [Currency Configuration](currencies.html),
  [Customer Invoice](customer-invoice.html), [Vendor Invoice](vendor-invoice.html),
  [Cash and Bank](cash-and-bank.html) and [Statements of account](statements-of-account.html).
- **Item categories of your own.** Besides the five, add a category
  such as Spare Parts with **New category…** in the item form. It has its
  own code prefix (SP-000001) and behaves like one of the five for BOMs
  and production. It can be shared or belong to one company, and can have
  its own sub-categories. See [Item Master](item-master.html).
- **Chart of Accounts: classes, groups and renumbering.** Codes now have
  a level each: a class per type (100000 Assets), groups under it (110000
  Cash) and the accounts under a group (110001). An account can no longer
  sit straight under a class. Cash and bank accounts are the ones under a
  group marked **Cash** or **Bank**, not those with a certain code.
  **Renumber** gives a used account another code in its own group, and
  every entry and document follows. See
  [Chart of Accounts](chart-of-accounts.html).
- **Search any long list.** Choosing an account, item, customer, vendor
  or a line's party now opens a searchable list. Type any part of the code
  or name ("trad" finds *Beta Trading*), choose with the arrow keys and
  Enter, and find your recent choices at the top. On a phone it fills the
  screen. See [Working with screens](working-with-screens.html).
- **End-of-service statement.** A final settlement now prints an
  End-of-Service Settlement Statement for the employee (**Print
  statement**). It shows the service, the gratuity worked out by slab,
  entitlements, deductions and the net, in figures and in words. It is
  marked DRAFT until posted. Once the settlement is paid, the employee also
  finds it in the Employee Portal under **My payslips**. See
  [Final Settlement](payroll-final-settlement.html).
- **Sell from stock on the invoice.** Where a company switches it on
  (Sales Invoice Configuration → **Invoices may deliver stock directly**), a
  Customer Invoice can have **item lines**, typed or brought in **From Sales
  Order**. When it is posted, the invoice delivers them itself: a Delivery
  Note is made for them, the stock leaves at its cost and the order counts
  them as delivered. **Print delivery slip** prints the items without
  prices. See [Customer Invoice](customer-invoice.html).
- **Payroll: share an employee's cost across cost centers.** A Transfer in
  Employee Change can now set a **cost split** by % (for example 60% / 40%).
  Every payroll expense of the employee is then shared that way. In a draft
  payroll run you can also change one employee's cost center (or split) for
  **this run only**, with a reason. The payslip now shows the cost center
  it posted to, even after a later transfer. See
  [Employee Change](employee-change.html) and [Payroll Run](payroll-run.html).
- **Paste lines from Excel** into Purchase Requisition, Inventory Purchase
  Requisition and Sales Order: **Copy Table** gives the columns (also on
  an empty grid), **Paste from Excel** adds the rows. A row that isn't
  right stops the paste and is named. On a Sales Order the price list's
  price is used where the item has one. See
  [Purchase Requisition](purchase-requisition.html),
  [Inventory Purchase Requisition](inventory-purchase-requisition.html) and
  [Sales Order](sales-order.html).
- **Fix a payment's matching without reversing it.** A posted payment or
  receipt that settles the wrong bill: open it and select **Re-match
  references**, choose again, and give the reason. The books don't
  change, and it works in a closed month. It needs the new **rematch**
  right. See [Paying and allocating](payments-and-allocation.html).
- **Month-end checklist:** a new check for **deliveries posted but not
  invoiced**; your own **accounts that must be zero** at month end
  (clearing accounts); and your own **steps to tick** before closing. See
  [Period Closing](period-closing.html).
- **Retail counter: find a customer** by code, name or mobile number; an
  unknown mobile can become a new customer there. A mobile number now
  belongs to one customer of a company, also in Customer Master. See
  [Retail Sales](retail-sales.html) and [Customer Master](customer-master.html).
- **Shareholders in Company Master**, with their % of the issued shares,
  their history and a printed company profile. They are seen with a new
  right, **shareholders**. See [Company Master](company-master.html).
- **Tasks on Home:** a posted delivery stays a task for the **Invoicing**
  team (or its maker) until it is invoiced; post-dated cheques coming due
  go to the **Treasury** team, 3 days before the cheque date (changeable).
  Both are set in Approval Configuration. See
  [Approval Configuration](approval-configuration.html).
- **Lists: choose how many rows a page holds.** Journal entries, cash and
  bank, GRNs, purchase orders and the other document lists have **Rows**
  beside the count: 25, 50 or 100. Your choice is remembered in this
  browser for every list. See [Working with screens](working-with-screens.html).
- **Leaving reasons.** Payroll Setup has a new **Leaving Reasons** tab
  (Resignation, Termination or Other), with common reasons to start and
  room for your own. An employee on notice or who has left must have one,
  with an optional note. See [Payroll Setup](payroll-setup.html) and
  [Employee Master](employees.html).
- **A leaver's sign-in ends on its own.** Someone leaving keeps the ERP and
  the Employee Portal until their final settlement is paid, and never more
  than 30 days after their last working day. HR can extend it, keep it, or
  go back to the rule, from the employee record. User Management shows
  "Leaving: access until …" or "Access ended". See
  [Employee Master](employees.html) and [User Management](user-management.html).
- **Employee Portal queries.** An employee can now withdraw a payroll query
  (giving a reason) or mark it resolved, at any time while it is open. See
  [Employee Requests](employee-requests.html).
- **Locations.** Organizational Units has a new type, **Location** (an
  office, a site, a yard), shared by all companies or of one. Choose it on
  the employee record and on the fixed asset record; an asset's location
  can change at any time. See [Organizational Units](org-units.html) and
  [Fixed Asset Master](fixed-asset-master.html).
- **Item sub-categories by company.** A sub-category can now be shared by
  all companies or belong to one. Item Master shows the shared ones and
  the item's company's, and **New…** beside Sub-Category opens Item
  Sub-Category to add one. See [Item Sub-Category](item-sub-category.html).
- **One print style.** Printed documents (invoices, vouchers, orders,
  delivery notes and the like) now have a light, rounded frame and light
  lines between the cells. Payslips keep their own layout.

## 14/10/2026

- **User Management: two fixes.** Adding a new user straight after editing
  another one no longer saves over the edited user. **Last Login** now
  shows when each user last signed in, in your local time. See
  [User Management](user-management.html).
- **Retail Sales:** the **Items** total is now the number of units on the
  sale; with a discount, the amount before it shows as **Subtotal**. See
  [Retail Sales](retail-sales.html).
- **Chart of Accounts** opens on Active accounts; choose All Statuses to see
  retired ones. See [Chart of Accounts](chart-of-accounts.html).
- **Approval Tracker** can be filtered by status: Pending, Approved or
  Rejected. See [Approval Tracker](approval-tracker.html).
- **Inventory Aging:** click an item code to open it in the Stock Ledger.
  See [Inventory Aging](inventory-aging.html).
- **Company Master** lists companies in code order. See
  [Company Master](company-master.html).
- **Help** has a **Light mode / Dark mode** button, and the ERP's Help button
  no longer appears on prints. See [Getting started](getting-started.html).
