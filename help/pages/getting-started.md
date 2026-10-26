---
title: Getting started
area: start
order: 1
summary: Signing in, the menu, Home tasks, favourites, and signing out.
sources: [public/index.html, public/ess.html]
reviewed: 2026-10-26
fingerprint: 406f689372a7e0e3
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

## Signing out, and the automatic sign-out

Use **Log Out** in the user menu when you finish, especially on a shared
computer. After **10 minutes** without activity the ERP warns you, and signs
you out 30 seconds later unless you select **Stay Signed In**. Anything not
saved is lost, so save drafts as you go.

## Next

- [Working with screens](working-with-screens.html): dates, drafts and
  posting, Copy to Excel, printing, supporting documents, closed months.
- [Approvals](approvals.html).
