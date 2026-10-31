---
title: Getting started
area: start
order: 1
summary: Signing in, the menu, Home tasks, favourites, and signing out.
sources: [public/index.html, public/ess.html]
reviewed: 2026-10-31
fingerprint: ad13ab6db0d02068
---
## Signing in

1. Open the ERP's address in your browser (Chrome, Edge, Safari or Firefox).
2. On **Sign In**, enter:
   - **Corporate ID**: your organisation's ID, given by your administrator;
   - **Email or user ID** and **Password**: your own ERP account. The user
     ID is your Username in User Management; your email works as before.
3. Select **Sign In**. You arrive at the menu (the *Module Hierarchy*).

The Corporate ID decides which organisation's ERP you sign in to. The
field starts empty; your browser can save it with your sign-in and offer
it next time. The **Employee Portal** asks for the same Corporate ID, then
your Employee Code and password.

If two users were given the same user ID before user IDs had to be
unique, they sign in with their email until one is renamed.

If the ERP says your account is inactive or not configured, ask your
administrator: an account must be active and assigned to at least one
company and role.

### Forgot your password?

On the sign-in page, open **Forgot Password**, enter your Corporate ID and
email address and select **Send Reset Link**. A link to set a new password arrives by email.
The link works once and for an hour: if it has expired, ask for a new one the same way.
Once signed in, you can change your password at any time from the user menu
(your name, top right) → **Change Password**.

## The menu

The menu is a tree of areas (Finance, Procurement, Inventory and so on).
You see only the screens your role allows.

The title above the menu names your company: your only company, or else
the main one (reference code 01) of the companies you are assigned. When a
company is assigned to you, it shows as soon as you come back to Home.

### Choosing your companies

With more than one company, the button after the title (**All companies**
at first) chooses which of them you work in. Tick the companies and select
**Apply**:

- The screens offer only the companies you chose in their company lists,
  and with one chosen they fill it in for you, as for a user with only one
  company. The title then names it.
- It's a filter, not a change of what you may do: every company is still
  yours, and **Select all** brings them all back. A document already saved
  for another company still shows its company.
- Your choice is kept for the next time you sign in, on any computer.

For example, an accountant assigned *Example Trading* and *Example
Services* who works on Example Services all week chooses it alone, and no
longer picks the company on each entry.

- Select an area to open it; select a screen to start working in it.
- **Search modules** (top bar): type part of a screen's name to filter the
  menu. **Enter** opens the screen when only one matches; **Esc** clears the
  search.
- The double-arrow button expands or collapses the whole tree.
- **Without the mouse:** **F2** goes to Search modules. **↓** moves to the
  first row shown, and **↑ ↓** move through the menu. **→** opens an area or
  folder and **←** closes it. **Enter** opens a screen. **Tab** reaches the
  same rows, each outlined when it has the focus.
- Inside a screen, **Back to Hierarchy** returns to the menu. If you have
  unsaved changes, the ERP asks before leaving.

### Favourites

Put the screens you use most at the top of the menu: user menu →
**Configure Favourites**, select the star next to each screen you want,
then **Done**. Until you choose your own, you see your role's defaults, if
your administrator has set some ([Roles & Permissions](roles.html)).

## Home tasks

The **Tasks** button (top bar) shows what is waiting for you, with a count.
Select a line to open that document. What you may see, depending on your
role:

| Block | What it means |
|---|---|
| Your Pending Approvals | Documents waiting for your approval. |
| Rejected — Needs Your Resubmission | Your documents an approver rejected, with the reason. Correct and submit again, or **Close** one you will not resubmit ([Approvals](approvals.html#rejected-documents)). |
| Ready for You to Act On | Approved documents your team follows up (for example, raising the purchase order for an approved requisition). The teams are set in Approval Configuration. |
| My Drafts — Not Yet Submitted or Posted | Documents you saved as drafts. |
| Post-dated Cheques Due to Clear | Cheques whose date has come. |
| Recurring Journal Entries Due to Post | Recurring entries whose date has come. |
| Company / Employee Documents Expiring | Licences, contracts or employee documents near or past expiry. |
| Employee Requests Waiting for You | Employees' queries, loan requests, claims and requests of the types HR sets up, to handle (an overdue one says so). |
| Clearances Waiting for You | A leaver's clearance step for your team to sign off ([Clearances](clearances.html)). |

How approvals work is explained in [Approvals](approvals.html).

## The user menu

Select your name (top right) for:

- **My Portal**: your own leave, payslips and requests, when your ERP user
  is linked to an employee record;
- **Light mode / Dark mode**: your choice is kept with you, on every
  computer you sign in on. The ERP starts in light mode until you choose;
- **Configure Favourites**;
- **Refresh**: reloads the menu (after an administrator changed it or your
  rights);
- **Change Password**;
- **Log Out**.

## Help

The **Help** button (top bar), or **F1**, opens this help in a new tab.
Inside a screen, it opens that screen's page directly. Help uses the ERP's light or dark
theme; its **Light mode** / **Dark mode** button switches both.

**Back to the ERP** (top of every Help page) closes Help and returns you
to the ERP where you were; in the installed app, where Help has no back
button of its own, this is the way back. On a phone, each page starts
with its own text; **All pages** jumps to the list of every page, below.

## Signing out, and the automatic sign-out

Use **Log Out** in the user menu when you finish, especially on a shared
computer. After **10 minutes** without activity the ERP warns you, and signs
you out 30 seconds later unless you select **Stay Signed In**. Anything not
saved is lost, so save drafts as you go.

## Installing the app

The ERP and the Employee Portal can each be installed as an app, with its
own icon (**ERP** and **Employee Portal**) and its own window.

- **On a computer** (Chrome or Edge): open the ERP, then click the
  **Install** icon at the right of the address bar.
- **On an Android phone**: open the page in Chrome, then use the menu (⋮) →
  **Add to Home screen** or **Install app**.
- **On an iPhone or iPad**: open the page in Safari, then use **Share** →
  **Add to Home Screen**.

Once installed, the app opens quickly: its pages and styles are kept on
the device, and a newer version is fetched each time you open it. You
still sign in as usual. Everything you open or save goes to the server,
so the app needs a connection: without one it says *You're offline*, and
nothing is saved.

## On a phone

The ERP works on a phone for looking things up and approving; data entry
is for a computer.

- **Home** fits the phone's screen: the menu, the search and your tasks.
- **Approvals** open as a compact card, where you approve or reject
  ([Approvals](approvals.html#on-a-phone)).
- **These reports fit the phone's screen**:
  - [Trial Balance](trial-balance.html) and the aging reports
    ([Customer and Vendor Aging](aging-reports.html),
    [Inventory Aging](inventory-aging.html)) keep their first column fixed;
    swipe the table sideways for the other figures;
  - [Stock Availability](stock-availability.html) and the
    [statements of account](statements-of-account.html) show each row as a
    card, each figure with its heading.

  Their filters wrap to the phone's width. Copy to Excel and Print are
  better done on a computer.
- **Every other screen** opens at a computer's width, as before: pinch to
  zoom. A notice says *This screen is best on a computer*; close it with ×
  and it stays closed until you close the ERP's tab or app.

Nothing changes on a computer or a tablet.

## Next

- [Working with screens](working-with-screens.html): dates, drafts and
  posting, Copy to Excel, printing, supporting documents, closed months.
- [Approvals](approvals.html).
