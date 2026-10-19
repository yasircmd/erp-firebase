---
title: Tree Management
area: admin
order: 5
modules: [TREEMGMT]
sources: [functions/src/tree.js, functions/src/entitlements.js]
summary: Build the menu tree and link each module to the right company, role and section.
reviewed: 2026-10-19
fingerprint: e5871f36b0288169
---
## What it is for

**Tree Management** builds the hierarchical navigation menu. Each node has display text, a parent, an optional linked module, an order, and a list of roles allowed to see it. A reference node can organize the menu without opening a screen.

## Before you start

- The intended menu hierarchy and labels are agreed.
- Modules are registered and their permissions are configured in Roles & Permissions.
- Identify which roles should see each menu node. Menu visibility does not itself grant a module capability.
- The modules offered are the ones your organisation has. A module it does not have is left out of the menu, even if a node still links it.

## Step by step

1. Open Tree Management and review the existing hierarchy. Add a top-level item or add a child beneath the intended parent.
2. Set the node text, optional parent, optional linked module, and allowed roles. Use a node without a linked module for a heading/reference item.
3. Drag a node above or below another node to reorder it; dropping on another node can also move it under that node's parent. Save the move and confirm the final hierarchy.
4. Edit the node if its label, parent, module link, or allowed roles change. Check parent visibility: a child is visible only when it and every ancestor allow the user's role.
5. Delete a node only after its child nodes are removed or reassigned. Test the menu as representative roles after any structural change.

## What happens in the books

Tree changes update navigation configuration only; they do not post to the ledger or grant accounting rights. Module actions are still controlled independently by Roles & Permissions and company assignment.

## Rights

TREEMGMT access/write rights control who can view and edit the menu tree. Restrict changes to administrative users; role checkboxes control visibility, not permission to post data.

## Questions and mistakes

- **Node is visible but screen access is denied:** configure the module's access capability separately in Roles & Permissions.
- **Child is missing for a role:** check the Allowed Roles on the node and every ancestor.
- **Node appears but opens no module:** it may be a reference node with no linked module; edit the module link if it should launch a screen.
- **Cannot move/delete a node:** ensure it is not being placed under itself/its descendant and remove or reassign its children first.

## Related pages

[Roles and Permissions](roles.html) · [User Management](user-management.html) · [Getting Started](getting-started.html)
