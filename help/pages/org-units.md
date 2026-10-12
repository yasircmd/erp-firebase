---
title: Organizational Units
area: admin
order: 2
modules: [ORGUNITS]
sources: [functions/src/companies.js]
summary: Maintain divisions, branches, warehouses, racks, cost centers, and profit centers used by ERP workflows.
reviewed: 2026-10-12
fingerprint: f4c5bc49cc455273
---
## What it is for

**Organizational Units** maintains reusable operating and reporting dimensions: Divisions, Branches, Warehouses, Racks, Cost Centers, and Profit Centers. A Cost Center is commonly used as the department for employee/payroll assignment, but there is no separate Department unit type.

Units can be shared across companies or restricted to one company. Parent links build a hierarchy; Racks are the exception with a required Warehouse parent.

## Before you start

- The unit codes, names, types, parent relationships, and company ownership are agreed.
- Company-specific units are assigned to a company; leave Company blank only when the unit is intentionally shared.
- Reporting, approval, employee, warehouse, and asset owners agree which dimensions they will select.

## Step by step

1. Open **Organizational Units**. Search by code/name and use the type or status filter to review existing units.
2. Add an item and choose its type, unique code, name, optional parent, company scope, and Active status.
3. For a Rack, select a Warehouse as its parent. Other unit types may be arranged under an appropriate parent; do not create a parent cycle.
4. Save, then confirm the unit appears in the correct type-specific picker. Check company scope before assigning a warehouse or employee dimension.
5. Edit a unit to correct its details. Deactivate rather than delete a unit that should no longer be selected. Reassign/deactivate active child units before deactivating their parent.

## Rights

ORGUNITS **access** allows viewing; **write** allows creating, editing, deactivating, and reactivating units. Company access is checked when assigning a company-specific unit.

## Questions and mistakes

- **Unit missing from a picker:** check its type, Active status, company scope, and the module's company access.
- **Rack cannot be saved:** it must have an existing Warehouse parent.
- **Parent cannot be deactivated:** first deactivate or reassign all active child units.
- **Parent relationship is refused:** the parent must exist, cannot be the unit itself, and cannot be one of its descendants.
- **Code is rejected as duplicate:** codes are unique across the Organizational Units list, not only within a single type.
- **Company-specific warehouse is not available:** the unit is restricted to its company; confirm the user and transaction are operating in that company.

Organizational Units do not post to the general ledger. They supply dimensions and locations used by other modules.

## Related pages

[Company Master](company-master.html) · [HR Setup](hr-setup.html) · [Employee Master](employees.html) · [Approvals](approvals.html)
