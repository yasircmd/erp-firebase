---
title: User Management
area: admin
order: 3
modules: [USERMGMT]
sources: [functions/src/roles.js, functions/src/session.js]
summary: Set up ERP users, assign roles and control which screens they can access and post.
reviewed: 2026-10-24
fingerprint: 146bb833f453b24e
---
## What it is for

**User Management** maintains ERP login accounts and their profile: username, name, email, role, Active/Inactive status, and assigned companies. The role determines module capabilities; company assignment limits which company data the user can access.

## Before you start

- The user's identity, username, email, role, account status, and company assignments are confirmed.
- Roles and their module rights are configured in [Roles & Permissions](roles.html).
- Assign only the companies the user needs. Leaving Assigned Companies empty denies access to company-scoped finance and reporting data.

## Step by step

1. Open User Management and search/filter by username, email/name, role, or Active/Inactive status.
   A user linked to an employee who is leaving shows **Leaving: access until** a date under the status, or **Access ended** once it has passed: from then on they can't sign in. The date is set from the employee record (Employees), where HR can extend it.
   **Last Login** shows when each user last signed in, in your local time. **Never** means they have not signed in since the column started being recorded (October 2026). Reopening the ERP in a tab where you are still signed in does not count as a new sign-in.
2. To add a user, click **Add New User** and enter username, email, full name, role, status, password (minimum six characters), and one or more assigned companies. Review the company list carefully before saving. The username is also the user's **user ID** for signing in, so no two users may share it (capitals don't count: "Kim" and "kim" are the same).
3. To edit a user, update full name, role, status, and company assignments. Username/email are not edited from the existing-user form; coordinate account identity changes through the approved identity process.
4. Test access using the assigned role and company. Menu visibility comes from Tree Management, while actual read/draft/post capabilities come from Roles & Permissions.
5. To remove ERP access, use Remove Access. This removes the ERP profile/access; it does not delete the user's Firebase Authentication account.

## What happens in the books

User Management does not post accounting entries. It controls login/profile data; role capabilities, company assignment, and menu visibility are enforced separately by the ERP.

## Rights

USERMGMT access/write rights control user administration. Limit these rights to trusted administrators. Changing someone's role or company assignment can immediately change their data visibility and available actions.

## Questions and mistakes

- **User sees no menu item:** check the role's visibility on the node and all menu ancestors in Tree Management.
- **Menu appears but access is denied:** check the module capability and company assignment in Roles & Permissions/User Management.
- **User has no company data:** assign the needed company; an empty assignment does not provide company-scoped finance/report access.
- **User cannot be edited:** the username is fixed on the existing-user form; use the approved identity-management process rather than creating a duplicate casually.
- **Remove Access did not disable Google sign-in:** the Firebase Auth account remains; the ERP profile/access is what this action removes.

## Related pages

[Roles & Permissions](roles.html) · [Tree Management](tree-management.html) · [Company Master](company-master.html)
