---
title: Roles and Permissions
area: admin
order: 4
modules: [ROLES]
sources: [functions/src/roles.js]
summary: Define which roles can open, edit, approve, post or report on each module.
reviewed: 2026-10-12
fingerprint: 593299661ff1e0db
---
## What it is for

**Roles and Permissions** controls the ERP’s security model. Each role determines what a user may open, change, approve or post.

## Before you start

- The company roles and business responsibilities are agreed.
- The menu structure and module list are known.

## Step by step

1. Open **Roles and Permissions**.
2. Select the role to maintain.
3. Assign the rights needed for each module, including read, write, approve and post appropriate actions.
4. Save and test the role against a user assigned to it.

## What happens in the books

This screen does not post accounting entries. It governs access and acts as the ERP’s security layer.

## Rights

Only admin users with role-maintenance access should change permission rules.

## Questions and mistakes

- If a user is blocked from a module, review the assigned role and the specific module rights for that role.
