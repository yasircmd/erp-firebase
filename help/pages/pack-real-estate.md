---
fingerprint: ffd2ac3ddad640c7
reviewed: 2026-11-12
title: Real estate pack
area: packs
order: 4
modules: []
sources: [functions/src/packs/realEstate.js]
summary: Properties and units on a let/vacant board, leases with no unit let twice, rent billed in one run as Lease Invoices.
---
## What it is for

The **Real estate** [pack](packs.html) lets units and bills their rent. Its
screens are in the **Real estate** folder.

| Screen | What it holds |
|---|---|
| **Properties** | A building or plot: its address, use and project. |
| **Units** | A property's unit: its type, area and asking rent. Its **Board** shows each unit as let or vacant today, or *Under repair* when set by hand. |
| **Leases** | A tenant's lease of a unit from **Starts** to **Ends**: the rent, how often it is billed and the next rent due. Its **Calendar** shows the leases by unit. |
| **Lease Invoices** | The tenants' rent invoices: a Customer Invoice under its own name and numbers (for example LINV-26-000001), with the unit. |

## Step by step

1. Add your **Properties** and their **Units**.
2. **New** lease, then make it **Active**. A unit already let for any day of
   the lease is refused, with the lease that holds it.
3. On the Leases **Runs** tab, **Propose** the rent due by a date, then **Run
   the ticked**: one Lease Invoice per tenant, as a draft. Each lease's next
   rent date moves on by its period.
4. At the end, make the lease **Ended** (or **Cancelled**): the unit is free.

## Before you start

- The Leases **Setup**: the sales type and the rent revenue account.
- Which rents are taxed (for example commercial rent), in
  [Tax Configuration](tax-configuration.html).

## Reports

The pack adds *Rent roll by property*, *Units by type*, *Leases by end date*
and *Rent billed by tenant* to your [MIS reports](mis-report-builder.html).
