---
fingerprint: c5b79d95bb0db6b0
reviewed: 2026-11-12
title: Packs
area: packs
order: 1
modules: [PACKSETUP]
sources: [functions/src/builtPacks.js, screens/PACKSETUP.html]
summary: A set of modules for your kind of business, switched on together with a menu folder, starter reports and a setup checklist.
---
## What it is for

A **pack** is a set of [built modules](built-modules.html) for a kind of
business, which your ERP provider switches on for you in one step:

- [Hotel](pack-hotel.html): rooms, bookings, Room Invoices, table orders;
- [Subscriptions](pack-subscriptions.html): plans and subscriptions billed in
  one run;
- [Real estate](pack-real-estate.html): properties, units, leases, rent;
- [Investments](pack-investments.html): investments, their purchases, sales,
  income and revaluations;
- [Construction](pack-construction.html): contracts, bills of quantities,
  progress claims, retention, subcontracts, site reports.

When a pack is switched on, you get:

- a **menu folder** with its screens, the first one *Pack setup*, visible to
  Admin only until you give other roles their rights;
- each of its modules' **rights** for Admin only;
- its **starter reports** in the first Admin's
  [MIS reports](mis-reports.html), and their charts on that Admin's
  [MIS Dashboard](mis-dashboard.html);
- its **setup checklist** in Pack setup.

Your provider keeps the pack up to date: a new version adds what is new (a
screen, a report), and never puts back what you changed or removed in your
menu. A pack never posts to the accounts itself: its documents make Customer
Invoices, Vendor Invoices and Journal Entries, which go through their own
checks. A pack adds no tax: you add the tax components your business needs
in [Tax Configuration](tax-configuration.html).

## Before you start

- **Pack setup** access (Admin has it).
- The pack switched on for your company by your provider.

## Step by step

1. Open **Pack setup** in the pack's menu folder. Each pack shows its
   checklist and how many steps are done.
2. Work through the steps:
   - **Setup**: the accounts and sales type a module uses, in that module's
     **Setup** tab. Ticked by itself once every action of the module has
     what it needs in a company.
   - **Rights**: give your other roles their rights to the pack's modules in
     [Roles & Permissions](roles.html), and show them the
     menu folder in [Tree Management](tree-management.html). Ticked by
     itself once a role other than Admin may open one of them.
   - **Tax** and **To do**: tick them yourself when done.
3. **Add to my reports** puts the pack's starter reports in your own MIS
   reports, if you are not the Admin who got them.

## Questions and mistakes

- **I can't see the pack's screens.** They are Admin's until you give a role
  its rights, and show the folder to the role in Tree Management.
- **A Setup step stays unticked.** One of the module's actions still lacks an
  account or a sales type in its Setup tab.
- **I removed a screen from the folder and it came back.** It doesn't: a new
  version of the pack only adds screens it has never given you.
- **A pack was switched off.** Its screens close; its records stay, and
  come back if it is switched on again.
