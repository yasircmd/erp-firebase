---
title: Roles and Permissions
area: admin
order: 4
modules: [ROLES]
sources: [functions/src/roles.js, functions/src/entitlements.js]
summary: Define which roles can open, edit, approve, post or report on each module.
reviewed: 2026-10-19
fingerprint: 8ba2df2acc56cd07
---
## What it is for

**Roles & Permissions** has two connected parts: a list of roles, and a module-capability matrix. Users receive one role in User Management; the matrix controls what that role can do in each module. Company assignment and menu visibility are separate controls.

## Before you start

- Define role responsibilities and least-privilege capabilities before changing the matrix.
- Create the required roles before assigning them to users in [User Management](user-management.html).
- Review the actual capability names for each module; they vary by workflow (for example access, draft, post, pay, report, return, or sensitive).
- The matrix lists the modules your organisation has. Rights you gave for a module it no longer has are kept, and apply again if it has it back.

## Step by step

### Maintain roles

1. Add a role with a unique name and a brief description of its purpose, or edit the existing role.
2. Delete a role only when no user currently has it and another role retains the required administrative write access.

### Maintain module capabilities

1. In **Module Permissions**, read across each module/capability row and role column. A checked box grants that capability to that role.
2. Grant only the actions needed for the role: viewing is different from drafting, submitting/posting, paying, reporting, returning, or viewing sensitive data.
3. Save the matrix once after reviewing the full set of changes. The system prevents removing the last role's write access to Roles & Permissions or User Management.
4. Test with a representative user assigned to the role: confirm both allowed actions and actions that should be denied.

Menu visibility is not a permission grant. Configure the navigation separately in [Tree Management](tree-management.html), and assign companies separately in [User Management](user-management.html).

## What happens in the books

Role and permission changes do not post accounting entries. They change which callable actions the server permits for users assigned to those roles.

## Rights

ROLES write access controls role and permission administration. At least one role must retain write access to both Roles & Permissions and User Management to avoid locking out administrators.

## Questions and mistakes

- **User can see a menu item but cannot open/use it:** check the module capability and company assignment; tree visibility alone is not enough.
- **User cannot see the module in navigation:** check Tree Management role visibility separately from module capabilities.
- **Capability is absent from the matrix:** capabilities are module-specific; use the exact available capability rather than assuming every module has generic read/write/post rights.
- **Role cannot be deleted:** reassign its users first; the last administrative role cannot be removed if it is the only one retaining required write access.
- **A permission change did not affect an already-open screen:** have the user refresh/reopen the module and test the current role assignment.

## Related pages

[User Management](user-management.html) · [Tree Management](tree-management.html) · [Approval Configuration](approval-configuration.html)
