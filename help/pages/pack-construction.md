---
fingerprint: cabc10946bb414f5
reviewed: 2026-11-12
title: Construction pack
area: packs
order: 6
modules: []
sources: [functions/src/packs/construction.js]
summary: Contracts with their bill of quantities, progress claims with retention and advance recovery, retention releases, subcontracts and their claims, site reports.
---
## What it is for

The **Construction** [pack](packs.html) runs contracts on your
[projects](org-units.html), from the bill of quantities to the monthly claims.
Its screens are in the **Construction** folder.

| Screen | What it holds |
|---|---|
| **Contracts** | A contract with a customer on a project: its value, retention % and advance recovery %. |
| **Bill of quantities** | Each BOQ item of a contract: its section, unit, quantity and rate; *Amount* is worked out. |
| **Progress claims** | A month's claim: for each BOQ item the quantity done **to date** and its rate. |
| **Advances billed** | An advance billed to the customer. |
| **Retention releases** | Retention released to be paid. |
| **Subcontracts** | Work given to a subcontractor on a project. |
| **Subcontractor claims** | A subcontractor's claim, its retention held. |
| **Site reports** | The day on site: workers, hours (*Man-hours* worked out), equipment, progress and issues. |

## How a progress claim is worked out

For each line: **Value to date** = quantity to date × rate; **Claimed
before** = what the contract's earlier claims claimed for the same BOQ item
(a cancelled claim not counted); **This claim** = value to date − claimed
before. Then for the claim:

- **This claim** = its lines' *This claim*, plus any **variations**;
- **Retention held** = retention % of this claim;
- **Advance recovered** = advance recovery % of this claim;
- **Net due** = this claim − retention − advance recovered;
- **Claimed before** and **Claimed to date** for the whole contract.

A claim is worked out when it is saved. If an earlier claim is changed, save
the later ones again.

## To the books

A customer invoice can't have a line below zero, so a **Certified** claim
goes to the accounts in three steps, from its **To the books** panel:

1. **Invoice the claim**: a customer invoice for *This claim*, on the
   contract's project.
2. **Hold retention**: a journal moving the retention from the customer to
   *Retention receivable*.
3. **Recover advance**: a journal moving the advance recovered from the
   customer to *Advances received*.

The customer then owes the net due, as the claim shows. **Advances billed**
puts an advance on the customer, and **Retention releases** moves retention
back to the customer when it is due. A **Subcontractor claim** makes the
subcontractor's vendor invoice on the project, then a journal holding its
retention.

## Before you start

- Each contract's project in [Projects](org-units.html).
- The **Setup** of Progress claims, Advances billed, Retention releases and
  Subcontractor claims: the sales type and accounts (Pack setup lists them).
- Your contract revenue's and subcontract costs' tax codes in
  [Tax Configuration](tax-configuration.html).

## Reports

The pack adds *Claimed by contract*, *Retention held by customer*, *Work done
by BOQ item*, *Subcontractor claims by project* and *Man-hours by project* to
your [MIS reports](mis-report-builder.html).
