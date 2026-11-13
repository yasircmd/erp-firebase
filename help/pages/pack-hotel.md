---
fingerprint: cf48ef4e2b4422d3
reviewed: 2026-11-12
title: Hotel pack
area: packs
order: 2
modules: []
sources: [functions/src/packs/hotel.js]
summary: Rooms on a housekeeping board, bookings on a calendar with no double booking, Room Invoices at check-out, restaurant table orders.
---
## What it is for

The **Hotel** [pack](packs.html) runs a small hotel's rooms and restaurant in
the ERP. Its screens are in the **Hotel** folder.

| Screen | What it holds |
|---|---|
| **Rooms** | Each room: type (Single, Double, Twin, Suite), floor, rate per night and housekeeping state. Its **Board** shows each room as free, booked or occupied today, or as set by hand (Cleaning, Out of order). |
| **Bookings** | A guest in a room from **Arrival** to **Departure**. *Nights* and *Room charges* (nights × rate) are worked out. Its **Calendar** shows the bookings by room. |
| **Room Invoices** | The guests' invoices: a Customer Invoice under its own name and numbers (for example HRINV-26-000001), with the room and the nights. |
| **Table orders** | A restaurant table's order: the items, quantities and prices. |

## Step by step

1. Add your **Rooms** with their type and rate.
2. **New** booking: the guest, the room, the arrival and departure dates and
   the rate. A room already booked or occupied for any of those nights is
   refused, with the booking that holds it.
3. Move the booking on: **Checked in**, then **Checked out**. *Cancelled*
   frees the room.
4. On a checked-out booking, **Room Invoice** (To the books) makes the
   guest's invoice for the room charges, as a draft to check and post.
5. A **table order** is **Served**, then **Bill the guest** makes a customer
   invoice with its items, taken out of the kitchen store.

## Before you start

- The Bookings and Table orders **Setup**: the sales type and the room
  revenue account (Pack setup lists them).
- Your tourism, municipality or service charges are **tax components** in
  [Tax Configuration](tax-configuration.html), on the room revenue's tax code.
- Walk-in guests: make one customer for them (for example *Walk-in guest*).

## Reports

The pack adds *Nights by room type*, *Room charges by room* and *Room
Invoices against other sales* to your [MIS reports](mis-report-builder.html).
