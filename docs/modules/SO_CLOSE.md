# Sales Order: delivered quantities, Delivered, Close and Reopen

Reported 2026-11-02 (owner): "in Sales Order, Delivered and Remaining is not
updating after posting a Delivery Note and sales invoice; also no option to
close a SO".

## What was found

- **The figures were right; the screen didn't show them.** A posted
  Delivery Note (and an invoice that delivers stock itself, which posts one)
  updates each order line's `DeliveredQuantity` (salesPosting.planDelivery,
  in the posting's batch), and getSalesOrderEntries returns it. But the
  screen's `openEntry` copied each line into the grid without
  `DeliveredQuantity`, so an opened order showed Delivered 0, Remaining the
  full quantity and "Not Started" whatever was delivered. The omission came
  from the original Apps Script screen (legacy-gas/SALESORDER.html); a real
  bug, fixed. SALESORDER is a hand-maintained screen (modules.json
  handScreens), so it is fixed in screens/SALESORDER.html.
- **Claim** offered to reserve the ordered quantity less what was reserved,
  ignoring what was delivered: it now offers only what is still to deliver,
  and no line actions once the order is no longer reserving.
- **The statuses** were Draft, Reserved, Partially Reserved, Cancelled: a
  fully delivered order stayed "Reserved", and nothing ended what was left.

## Decisions (owner, 2026-11-02)

- **Q379 Close is a short-close:** what is left of the order is no longer
  expected. Its Active reservations are released, status Closed, and no more
  Delivery Notes or invoices can be made from it. What was delivered stays.
- **Q380 Delivered on its own:** when every line is fully delivered the
  status becomes Delivered; a reversed delivery brings it back to Reserved
  or Partially Reserved. Closed is only for short-closing.
- **Q381 Who:** the Sales Order post right (who confirms and cancels), with a
  reason recorded; no approval.
- **Q382 Reopen:** yes, with a reason, by the same right. It returns to
  Partially Reserved (Delivered if everything was delivered); reservations
  are not restored (Claim reserves again).

## As built (2026-11-02)

- **functions/src/salesOrderClose.js** (hand-written): `closeSalesOrder`
  and `reopenSalesOrder` ({ soId, reason }). Under the global lock; close
  writes the order and its released reservations in one batch. The order
  keeps `StatusBeforeClose`, `ClosedAt/By`, `CloseReason`, `ReopenedAt/By`,
  `ReopenReason`, and a `CloseLog` of every close and reopen. A Draft,
  Cancelled, Delivered or already Closed order is refused, with why.
- **reservations.reservationStatusFor** (the status every posting and
  claim/release refreshes): Delivered when every line's delivered quantity
  reaches its ordered quantity; it now also refreshes a Delivered order
  (back to Reserved or Partially Reserved after a reversal). Closed and
  Cancelled are left as they are.
- **salesPosting.planDelivery**, on a reversal: a Delivered order reserves
  the returned quantity again (as a Reserved one did); a Closed one doesn't.
- **Where a Delivered or Closed order no longer appears**, unchanged code:
  every place that takes "Reserved or Partially Reserved" (Delivery Note's
  eligible orders, invoiceable order lines, Claim / Release, credit
  control's open orders, the document links' next steps, production
  allocation). Proforma prints any order but a cancelled one, as before.
  Cancel is unchanged (any order but a cancelled one).
- **screens/SALESORDER.html:** the line copy keeps `DeliveredQuantity`;
  Claim only for what is left; statuses Delivered and Closed (badge, list
  filter); **Close Sales Order** (Reserved or Partially Reserved, post
  right) and **Reopen** (Closed), each asking a reason through appPrompt;
  a Closed order shows when, by whom and why.
- **Tests:** emulator/salesOrderClose (3: Delivered and back on a reversal;
  close, its refusals, no deliveries or invoices, a reversal on a Closed
  order, reopen; only a confirmed order closes), ui/salesOrderClose (2: the
  opened order's Delivered and Remaining, Claim; close and reopen on
  screen). Negative controls, each caught and restored: the line copy
  without DeliveredQuantity (reproduces the reported bug: Delivered 0.00,
  Remaining 6.00, Not Started); no Delivered status; Close not releasing
  the reservations.
- **Results:** full emulator regression 752 passed, 1 failed (essPortal
  "who is away today", date-dependent, fails on main too); unit 222/222; UI
  salesOrderClose 2/2, createNext 7/7, creditControl 4/4,
  directSalesInvoice 4/4, proforma 3/3, stockAvailability 2/2.
- **Deploy:** `so-close` (156: the two new functions and every function
  whose code includes reservations.js or salesPosting.js), with screens,
  then Hosting (the Help).
