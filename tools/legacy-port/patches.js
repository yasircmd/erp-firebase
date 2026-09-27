// Documented source patches applied to Code.gs before porting — the ONLY
// place behavior deliberately differs from the Apps Script original.
// Each: { id, why, find, replace } — `find` must match Code.gs exactly
// once (the generator fails loudly otherwise, so a changed original
// can't silently skip a fix). Every migration entry is also listed in
// docs/MIGRATION.md under "Deviations from Code.gs". Entries marked
// NEW DEVELOPMENT (after the migration) are features, not fixes; each is
// recorded in its module's design doc under docs/modules/.
module.exports = [
  {
    id: 'stock-ledger-report-transfers-and-multiline',
    why: 'getStockLedgerReport matched lines on WarehouseID only and took only the FIRST matching line per ' +
      'transaction. A posted Warehouse Movement stores only its Out side (WarehouseID = source, ToWarehouseID = ' +
      'destination), so transfers INTO a warehouse never appeared and the destination\'s closing balance disagreed ' +
      'with the real ledger; and a transaction with two lines for the same item+warehouse was undercounted. Now ' +
      'every matching line counts, and a movement line whose ToWarehouseID is the selected warehouse counts as In.',
    find: `  const relevant = Object.keys(allTx)
    .map(id => Object.assign({ _id: id }, allTx[id]))
    .filter(t => t.Status === 'Posted' && t.Lines && t.Lines.some(l => l.ItemID === itemId && l.WarehouseID === warehouseId))
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));

  let runningQty = 0, runningValue = 0;
  let openingQty = 0, openingValue = 0;
  const rows = [];

  relevant.forEach(tx => {
    const line = tx.Lines.find(l => l.ItemID === itemId && l.WarehouseID === warehouseId);
    if (!line) return;
`,
    replace: `  // [PORT FIX stock-ledger-report-transfers-and-multiline] every line of this
  // item at this warehouse counts (not just the first), and a Warehouse
  // Movement line whose DESTINATION is this warehouse counts as an In.
  const linesHere = t => (t.Lines || []).reduce((acc, l) => {
    if (l.ItemID !== itemId) return acc;
    if (l.WarehouseID === warehouseId) acc.push(l);
    else if (t.TransactionType === 'WarehouseMovement' && l.ToWarehouseID === warehouseId) acc.push(Object.assign({}, l, { Direction: 'In', WarehouseID: warehouseId }));
    return acc;
  }, []);
  const relevant = Object.keys(allTx)
    .map(id => Object.assign({ _id: id }, allTx[id]))
    .filter(t => t.Status === 'Posted' && linesHere(t).length)
    .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));

  let runningQty = 0, runningValue = 0;
  let openingQty = 0, openingValue = 0;
  const rows = [];

  relevant.forEach(tx => linesHere(tx).forEach(line => {
`
  },
  {
    id: 'stock-ledger-report-transfers-and-multiline (close)',
    why: 'Closes the per-line loop opened by the patch above.',
    find: `      LinkedJVID: tx.LinkedJVID || '', SourceModule: STOCK_VOUCHER_TYPE_TO_MODULE[tx.TransactionType] || ''
    });
  });
`,
    replace: `      LinkedJVID: tx.LinkedJVID || '', SourceModule: STOCK_VOUCHER_TYPE_TO_MODULE[tx.TransactionType] || ''
    });
  }));
`
  },
  {
    id: 'material-variance-production-reversal-sign',
    why: 'getMaterialVarianceReport added every Production line as produced output, but a Production REVERSAL is ' +
      'stored as TransactionType Production with Direction Out — so reversing a run doubled both the produced ' +
      'quantity and the expected component consumption instead of cancelling them. Reversal lines now count negatively.',
    find: `      producedByItem[l.ItemID] = Math.round(((producedByItem[l.ItemID] || 0) + (l.Quantity || 0)) * 1e6) / 1e6;`,
    replace: `      // [PORT FIX material-variance-production-reversal-sign] a reversal line (Direction Out) cancels output.
      const producedSign = l.Direction === 'Out' ? -1 : 1;
      producedByItem[l.ItemID] = Math.round(((producedByItem[l.ItemID] || 0) + producedSign * (l.Quantity || 0)) * 1e6) / 1e6;`
  },
  {
    id: 'material-variance-production-reversal-sign (expected)',
    why: 'Same fix for the expected component consumption derived from that production line.',
    find: `        const contribution = (c.Quantity || 0) * scrapMultiplier * (l.Quantity || 0);`,
    replace: `        const contribution = (c.Quantity || 0) * scrapMultiplier * producedSign * (l.Quantity || 0);`
  },
  {
    id: 'gl-report-rollup-all-descendants',
    why: 'getGlReport rolled a header account up over its DIRECT children only. Headers are never postable, so ' +
      'any account under a sub-header was silently left out of the header\'s report — the live chart has 3 ' +
      'sub-headers with 6 postable accounts beneath them. A header now rolls up every descendant account.',
    find: `    ? Object.keys(coaData).filter(id => coaData[id].ParentAccountID === accountId)`,
    replace: `    // [PORT FIX gl-report-rollup-all-descendants] every descendant, not just direct children.
    ? Object.keys(coaData).filter(id => { let p = coaData[id].ParentAccountID, hops = 0; while (p && hops++ < 50) { if (p === accountId) return true; p = coaData[p] && coaData[p].ParentAccountID; } return false; })`
  },
  {
    id: 'cash-flow-category-nearest-ancestor',
    why: 'resolveCashFlowCategory_ looked only at the account and its DIRECT parent, but the chart nests headers ' +
      '(max depth 2 live). An account under a sub-header with no category of its own fell back to Operating even ' +
      'when an ancestor header said Investing/Financing. Now resolves from the nearest categorized ancestor. (No live ' +
      'misclassification today — the one blank live sub-header\'s parent is blank too — but it was one edit away.)',
    find: `  if (account.ParentAccountID && coaData[account.ParentAccountID]) {
    return coaData[account.ParentAccountID].CashFlowCategory || '';
  }
  return '';`,
    replace: `  // [PORT FIX cash-flow-category-nearest-ancestor] walk up to the nearest categorized ancestor.
  let parentId = account.ParentAccountID, hops = 0;
  while (parentId && coaData[parentId] && hops++ < 50) {
    if (coaData[parentId].CashFlowCategory) return coaData[parentId].CashFlowCategory;
    parentId = coaData[parentId].ParentAccountID;
  }
  return '';`
  },
  {
    id: 'physical-count-no-reversal-of-reversal',
    why: 'reversePhysicalCount derives each line\'s direction from its stored Variance, and a reversal entry copies ' +
      'the ORIGINAL lines\' Variance unchanged. The screen offers "Reverse Count" on a reversal entry too, and ' +
      'reversing it re-applied the reversal\'s own direction instead of undoing it: count 10 -> 6, reverse (back to ' +
      '10), reverse the reversal -> 14 instead of 6, with a matching GL entry. Now refused with the same message the ' +
      'invoice and Delivery Note modules already use; to redo the adjustment, post a new count.',
    find: `    if (existing.ReversedByCount) throw new Error('This Physical Count has already been reversed.');`,
    replace: `    if (existing.ReversedByCount) throw new Error('This Physical Count has already been reversed.');
    // [PORT FIX physical-count-no-reversal-of-reversal] a reversal's lines carry the original Variance, so
    // reversing it would re-apply the reversal's direction instead of undoing it.
    if (existing.ReversalOfCount) throw new Error('A reversal entry cannot itself be reversed.');`
  },
  {
    id: 'production-no-reversal-of-reversal',
    why: 'reverseProduction forces every line to Direction Out. A reversal entry is itself a Posted Production ' +
      'transaction, and the screen offers "Reverse" on it, so reversing a reversal took the produced stock out a ' +
      'SECOND time instead of putting it back: 20 -> post 5 -> 25 -> reverse -> 20 -> reverse the reversal -> 15 ' +
      '(should be 25), with a matching GL entry, and a linked Job Order line\'s produced quantity dropped twice. Now ' +
      'refused with the same message as the invoice and Delivery Note modules; to redo it, post a new entry.',
    find: `    if (existing.ReversedByProduction) throw new Error('This Production entry has already been reversed.');`,
    replace: `    if (existing.ReversedByProduction) throw new Error('This Production entry has already been reversed.');
    // [PORT FIX production-no-reversal-of-reversal] reversing forces every line Out, so reversing a
    // reversal would remove the stock a second time instead of restoring it.
    if (existing.ReversalOfProduction) throw new Error('A reversal entry cannot itself be reversed.');`
  },
  {
    id: 'physical-count-store-movement-fields',
    why: 'A posted Physical Count stored only its audit lines (CountedQuantity, Variance), dropping the Direction, ' +
      'Quantity, UnitCost and TotalValue it actually posted, although every stock report reads those fields from ' +
      'posted lines (and the Material Variance code says every consumption type stores Direction). So a count\'s ' +
      'adjustment read as zero while its reversal (which does store them) read in full: Stock Ledger\'s running ' +
      'balance drifted from the real ledger, Material Variance and Production & Consumption missed write-offs and ' +
      'showed reversed counts as negative consumption, and the count list showed every posted count\'s value as 0. ' +
      'Each variance line now also stores what it posted; clean lines are unchanged.',
    find: `  finalizeCommitAttempt_(idToken, pcId, glResult, { Lines: finalLines }, actor);`,
    replace: `  // [PORT FIX physical-count-store-movement-fields] keep what each variance line actually posted, so the
  // stock reports (and the count list's total) read a count like any other posting.
  const postedByLineNo = {};
  adjustmentLines.forEach(a => { postedByLineNo[a.LineNo] = a; });
  const storedLines = finalLines.map(f => {
    const a = postedByLineNo[f.LineNo];
    return a ? Object.assign({}, f, { Direction: a.Direction, Quantity: a.Quantity, UnitCost: a.UnitCost, TotalValue: a.TotalValue }) : f;
  });
  finalizeCommitAttempt_(idToken, pcId, glResult, { Lines: storedLines }, actor);`
    },
  {
    id: 'po-source-requisition-still-open',
    why: 'A requisition is meant to be pulled into ONE PO and is Closed when that PO submits, "so it can never be ' +
      'sourced into a second PO by mistake". But nothing checked it at submit: two draft POs built from the same ' +
      'Submitted requisition (both drafted before either submitted) could BOTH submit, ordering the same goods twice. ' +
      'A draft could likewise be submitted after its requisition was Cancelled, or cite a requisition ID that doesn\'t ' +
      'exist (which also skipped the direct-line item/category check). Submit now refuses unless every source ' +
      'requisition exists, belongs to the PO\'s company, and is still Submitted.',
    find: `    if (existing.Lines.some(l => !(l.UnitPrice > 0))) throw new Error('Every line needs a Unit Price greater than zero.');

    const mergedLines = mergeMatchingPOLines_(existing.Lines);`,
    replace: `    if (existing.Lines.some(l => !(l.UnitPrice > 0))) throw new Error('Every line needs a Unit Price greater than zero.');
    // [PORT FIX po-source-requisition-still-open] a requisition feeds exactly one PO: refuse if another PO
    // (or a cancellation) has already taken it since this draft was saved.
    for (const src of (existing.SourceRequisitions || [])) {
      const req = firebaseDbRequest_((src.RequisitionType === 'PR' ? 'purchaseRequisitions/' : 'inventoryPurchaseRequisitions/') + src.RequisitionID, 'get', null, idToken);
      const label = (src.RequisitionNumber || src.RequisitionID);
      if (!req || req.CompanyID !== existing.CompanyID) throw new Error('Requisition ' + label + ' was not found for this company.');
      if (req.Status !== 'Submitted') throw new Error('Requisition ' + label + ' is ' + req.Status + ' — it may already be on another Purchase Order. Remove its lines and save before submitting.');
    }

    const mergedLines = mergeMatchingPOLines_(existing.Lines);`
  },
  {
    id: 'po-revision-quantity-positive',
    why: 'saveDraftPurchaseOrder refuses a zero, negative or non-numeric quantity ("no legitimate reason" for one), ' +
      'but reviseAndResubmitPurchaseOrder didn\'t check quantity at all. A revision could set a negative quantity, ' +
      'lowering the PO Total that the approval threshold is resolved against (skipping higher approval levels) and ' +
      'storing a negative order line. The revision now applies the same quantity rule as the draft.',
    find: `      const original = existing.Lines.find(orig => orig.LineID === l.LineID);
      const qty = Number(l.Quantity);`,
    replace: `      const original = existing.Lines.find(orig => orig.LineID === l.LineID);
      const qty = Number(l.Quantity);
      // [PORT FIX po-revision-quantity-positive] same rule as saveDraftPurchaseOrder.
      if (!(qty > 0)) throw new Error('Every line needs a quantity greater than zero.');`
  },
  {
    id: 'po-reopen-flag-until-resolved',
    why: 'decidePurchaseOrderReopenApproval cleared ReopenRequested after EVERY decision, including a level-1 ' +
      'approval that leaves a multi-level reopen still pending. The screen picks which decide function to call from ' +
      'that flag, so the next level\'s decision went through decidePurchaseOrderApproval instead, and a rejection ' +
      'there left the PO "Rejected" (editable, re-priceable, and renumbered on resubmit) instead of back to Closed. ' +
      'The flag is now cleared only once the reopen request resolves.',
    find: `    firebaseDbRequest_('purchaseOrders/' + poId, 'patch', { ReopenRequested: false }, idToken);`,
    replace: `    // [PORT FIX po-reopen-flag-until-resolved] keep the flag while later levels still have to decide.
    if (result.status === 'Approved' || result.status === 'Rejected') firebaseDbRequest_('purchaseOrders/' + poId, 'patch', { ReopenRequested: false }, idToken);`
    },
  {
    id: 'delivery-note-recheck-at-post',
    why: 'saveDeliveryNoteDraft caps each line at min(remaining on the SO line, reserved for it), but that is a ' +
      'draft-time snapshot and posting never re-checked it. Two drafts against the same SO line (each within the cap ' +
      'on its own), a draft whose Sales Order was cancelled after saving, or two DN lines pointing at the same SO line ' +
      'all posted anyway: DeliveredQuantity went past OrderedQuantity and the shipment took free stock (or stock ' +
      'reserved for other orders), with COGS booked. Now the cap is re-checked, summed per SO line, against the live ' +
      'SO and reservations when the DN is posted/submitted and again at commit (which also covers approval). The same ' +
      '"never trust the draft-time snapshot" rule Physical Count follows.',
    find: `function commitDeliveryNotePosting_(idToken, user, existing, dnId) {`,
    replace: `// [PORT FIX delivery-note-recheck-at-post] re-applies saveDeliveryNoteDraft's per-line ship cap against the
// LIVE Sales Order and reservations, summed per SO line — the draft-time check can be stale by now.
function assertDeliveryNoteStillShippable_(idToken, dn) {
  const wanted = {};
  const order = [];
  for (const l of (dn.Lines || [])) {
    const key = l.SourceSOID + '|' + l.SourceSOLineID;
    if (!wanted.hasOwnProperty(key)) {
      wanted[key] = { soId: l.SourceSOID, lineId: l.SourceSOLineID, label: l.SourceSONumber || l.SourceSOID, itemCode: l.ItemCode, qty: 0 };
      order.push(key);
    }
    wanted[key].qty += Number(l.Quantity) || 0;
  }
  for (const key of order) {
    const w = wanted[key];
    const so = firebaseDbRequest_('salesOrders/' + w.soId, 'get', null, idToken);
    if (!so || (so.Status !== 'Reserved' && so.Status !== 'Partially Reserved')) {
      throw new Error('Sales Order ' + w.label + ' is no longer available for delivery' + (so ? ' (' + so.Status + ')' : '') + '.');
    }
    const soLine = (so.Lines || []).find(x => x.LineID === w.lineId);
    if (!soLine) throw new Error('Sales Order ' + w.label + ': the line for ' + w.itemCode + ' was not found.');
    const reserved = getReservationsForSource_(idToken, 'SalesOrder', w.soId)
      .filter(r => r.Status === 'Active' && r.SourceLineID === w.lineId)
      .reduce((sum, r) => sum + (Number(r.Quantity) || 0), 0);
    const remaining = Math.max(0, Number(soLine.OrderedQuantity || 0) - Number(soLine.DeliveredQuantity || 0));
    const maxShippable = Math.min(remaining, reserved);
    if (w.qty > maxShippable + 0.000001) {
      throw new Error('Sales Order ' + w.label + ', ' + w.itemCode + ': this Delivery Note ships ' + w.qty + ' but only ' + maxShippable +
        ' can ship now (remaining on order ' + remaining + ', reserved ' + reserved + '). Another delivery or a release may have used it since this draft was saved — adjust the quantities and save again.');
    }
  }
}

function commitDeliveryNotePosting_(idToken, user, existing, dnId) {
  assertDeliveryNoteStillShippable_(idToken, existing);`
  },
  {
    id: 'delivery-note-recheck-at-post (submit)',
    why: 'Same check as above at submission, so a stale DN is refused before an approval instance is started for it.',
    find: `    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a draft or rejected Delivery Note can be posted.');`,
    replace: `    if (existing.Status !== 'Draft' && existing.Status !== 'Rejected') throw new Error('Only a draft or rejected Delivery Note can be posted.');
    // [PORT FIX delivery-note-recheck-at-post]
    assertDeliveryNoteStillShippable_(idToken, existing);`
  },
  {
    id: 'delivery-note-reversal-no-reserve-on-cancelled-so',
    why: 'reverseDeliveryNote re-reserves the returned quantity on the Sales Order whenever the SO still exists. If ' +
      'the SO was cancelled after the delivery (allowed: cancel only refuses an already-Cancelled SO), the reversal ' +
      'created an Active reservation on a Cancelled order, and nothing can ever release it (release and claim need a ' +
      'Reserved/Partially Reserved SO; cancel refuses a Cancelled one) — so that stock stayed unavailable forever. ' +
      'Now it re-reserves only for a Reserved/Partially Reserved SO; otherwise the returned stock is simply free.',
    find: `      const so = firebaseDbRequest_('salesOrders/' + l.SourceSOID, 'get', null, idToken);
      if (so) {`,
    replace: `      const so = firebaseDbRequest_('salesOrders/' + l.SourceSOID, 'get', null, idToken);
      // [PORT FIX delivery-note-reversal-no-reserve-on-cancelled-so] a Cancelled SO's reservation could never be released.
      if (so && (so.Status === 'Reserved' || so.Status === 'Partially Reserved')) {`
    },
  {
    id: 'jv-reverse-only-journal-and-cbt',
    why: 'reverseJournalEntry reverses whatever GL entry ID it is given. The JV and CBT screens only offer it on their ' +
      'own entries, but the callable also accepted the GL side of a stock or invoice posting (GRN, Delivery Note, ' +
      'Vendor/Customer Invoice...) for anyone with that module\'s post right: the GL was reversed while the stock and ' +
      'the source document were not, and the source module\'s own reversal stayed available, reversing the GL a ' +
      'second time. Now refused; those entries are reversed from their own module.',
    find: `    if (existing.ReversedByJV) throw new Error('This entry has already been reversed.');`,
    replace: `    if (existing.ReversedByJV) throw new Error('This entry has already been reversed.');
    // [PORT FIX jv-reverse-only-journal-and-cbt] a stock/invoice entry must be reversed by its own module, which
    // also undoes the stock and the source document.
    if (existing.VoucherType && STOCK_VOUCHER_TYPE_TO_MODULE[existing.VoucherType]) {
      throw new Error('This entry was posted by ' + existing.VoucherType + ' — reverse it from that module, not here.');
    }`
    },
  {
    id: 'vendor-invoice-recheck-grns-at-post',
    why: 'saveVendorInvoiceDraft refuses a GRN already matched to a different invoice, but that is a draft-time check ' +
      'and posting never repeated it. Two drafts built from the same unmatched GRN could both post: the vendor\'s ' +
      'payable was booked twice and GRN Clearing debited twice, with MatchedToInvoiceID overwritten by the second — ' +
      'and reversing either invoice then unmatched the GRN while the other still claimed it. A GRN reversed after the ' +
      'draft was saved was likewise still invoiced. Now every source GRN is re-checked at commit (post and approval): ' +
      'still a Posted, unreversed GRN of this company and vendor, matched to no other invoice.',
    find: `function commitVendorInvoicePosting_(idToken, user, existing, invoiceId) {
  const vendor = firebaseDbRequest_('vendors/' + existing.VendorID, 'get', null, idToken);`,
    replace: `function commitVendorInvoicePosting_(idToken, user, existing, invoiceId) {
  // [PORT FIX vendor-invoice-recheck-grns-at-post] the draft-time GRN checks can be stale by now.
  for (const g of (existing.SourceGRNs || [])) {
    const grn = firebaseDbRequest_('stock/transactions/' + g.GRNID, 'get', null, idToken);
    const label = g.GRNNumber || g.GRNID;
    if (!grn || grn.TransactionType !== 'GRN' || grn.Status !== 'Posted' || grn.ReversedByGRN || grn.ReversalOfGRN) {
      throw new Error('GRN ' + label + ' is no longer a posted, unreversed GRN — remove it from this invoice and save again.');
    }
    if (grn.CompanyID !== existing.CompanyID || grn.VendorID !== existing.VendorID) {
      throw new Error('GRN ' + label + ' does not belong to this invoice\\'s company and vendor.');
    }
    if (grn.MatchedToInvoiceID && grn.MatchedToInvoiceID !== invoiceId) {
      throw new Error('GRN ' + label + ' has already been invoiced on another Vendor Invoice — remove it from this invoice and save again.');
    }
  }
  const vendor = firebaseDbRequest_('vendors/' + existing.VendorID, 'get', null, idToken);`
    },
  {
    id: 'customer-invoice-recheck-dns-at-post',
    why: 'Same gap as Vendor Invoice (deviation #14): the "already matched to a different invoice" check on a source ' +
      'Delivery Note ran only at draft save. Two drafts built from the same delivery could both post, billing the ' +
      'customer twice (AR and revenue doubled). A delivery reversed after the draft was saved (goods came back), or a ' +
      'Delivery Note REVERSAL entry itself (a Posted Delivery Note for the same customer, never excluded), could be ' +
      'invoiced too. Now every source Delivery Note is re-checked at commit (post and approval).',
    find: `function commitCustomerInvoicePosting_(idToken, user, existing, invoiceId) {
  const customer = firebaseDbRequest_('customers/' + existing.CustomerID, 'get', null, idToken);`,
    replace: `function commitCustomerInvoicePosting_(idToken, user, existing, invoiceId) {
  // [PORT FIX customer-invoice-recheck-dns-at-post] the draft-time Delivery Note checks can be stale by now.
  for (const d of (existing.SourceDeliveryNotes || [])) {
    const dn = firebaseDbRequest_('stock/transactions/' + d.DeliveryNoteID, 'get', null, idToken);
    const label = d.DeliveryNoteNumber || d.DeliveryNoteID;
    if (!dn || dn.TransactionType !== 'DeliveryNote' || dn.Status !== 'Posted' || dn.ReversedByDeliveryNoteID || dn.ReversalOfDeliveryNoteID) {
      throw new Error('Delivery Note ' + label + ' is no longer a posted, unreversed delivery — remove it from this invoice and save again.');
    }
    if (dn.CompanyID !== existing.CompanyID || dn.CustomerID !== existing.CustomerID) {
      throw new Error('Delivery Note ' + label + ' does not belong to this invoice\\'s company and customer.');
    }
    if (dn.MatchedToInvoiceID && dn.MatchedToInvoiceID !== invoiceId) {
      throw new Error('Delivery Note ' + label + ' has already been invoiced on another Customer Invoice — remove it from this invoice and save again.');
    }
  }
  const customer = firebaseDbRequest_('customers/' + existing.CustomerID, 'get', null, idToken);`
  },
  {
    id: 'invoice-pickers-skip-reversals',
    why: 'The Vendor and Customer Invoice pickers listed every Posted, unmatched GRN / Delivery Note, including ones ' +
      'already reversed and the reversal entries themselves (stored as Posted documents of the same type). Those can\'t ' +
      'be invoiced any more (the commit re-checks above refuse them), so they are no longer offered.',
    find: `    .filter(g => g.TransactionType === 'GRN' && g.Status === 'Posted' && g.CompanyID === companyId && g.VendorID === vendorId && !g.MatchedToInvoiceID)`,
    replace: `    // [PORT FIX invoice-pickers-skip-reversals] reversed GRNs and reversal entries aren't invoiceable.
    .filter(g => g.TransactionType === 'GRN' && g.Status === 'Posted' && g.CompanyID === companyId && g.VendorID === vendorId && !g.MatchedToInvoiceID && !g.ReversedByGRN && !g.ReversalOfGRN)`
  },
  {
    id: 'invoice-pickers-skip-reversals (customer)',
    why: 'Customer side of the patch above.',
    find: `    .filter(dn => dn.TransactionType === 'DeliveryNote' && dn.Status === 'Posted' && dn.CompanyID === companyId && dn.CustomerID === customerId && !dn.MatchedToInvoiceID)`,
    replace: `    // [PORT FIX invoice-pickers-skip-reversals] reversed deliveries and reversal entries aren't invoiceable.
    .filter(dn => dn.TransactionType === 'DeliveryNote' && dn.Status === 'Posted' && dn.CompanyID === companyId && dn.CustomerID === customerId && !dn.MatchedToInvoiceID && !dn.ReversedByDeliveryNoteID && !dn.ReversalOfDeliveryNoteID)`
  },
  {
    id: 'recalculate-stock-ledger-replay',
    why: 'recalculateStockLedger could destroy the stock ledger. (1) A posted Warehouse Movement stores only its Out ' +
      'lines, so the replay took the stock out of the source and never put it into the destination; a later issue ' +
      'from the destination then failed. (2) It replayed in CreatedAt order, which is when the DRAFT was created, not ' +
      'when it posted, so WAC came out wrong or an issue replayed before the receipt it drew on. (3) It deleted ' +
      'stock/ledger first and committed transaction by transaction, so any failure left the ledger wiped or half ' +
      'rebuilt. (4) It took no lock, so a posting during the rebuild read a half-built ledger. Now: movements replay ' +
      'both sides exactly as their posting did; order is PostedAt (CreatedAt only if missing); the whole replay runs ' +
      'in memory under the global lock and the ledger is replaced in one write only if every transaction replays; ' +
      'Physical Counts posted before deviation #7 (variance lines without Direction) are refused by name rather than ' +
      'silently dropped.',
    find: `    firebaseDbRequest_('stock/ledger', 'delete', null, idToken);

    const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
    const coaData = getCoaData_(idToken);
    const allTx = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};

    const posted = Object.keys(allTx)
      .map(id => Object.assign({ _id: id }, allTx[id]))
      .filter(t => t.Status === 'Posted' && t.Lines && t.Lines.length)
      .sort((a, b) => (a.CreatedAt || '').localeCompare(b.CreatedAt || ''));

    posted.forEach(tx => {
      const lines = tx.Lines.map(l => Object.assign({}, l));
      const movement = computeStockMovement_(idToken, itemsData, coaData, lines);
      commitStockLedgerUpdates_(idToken, movement.ledgerUpdates);
    });

    return { success: true, count: posted.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`,
    replace: `    // [PORT FIX recalculate-stock-ledger-replay] see patches.js. The replay
    // runs in memory under the global lock; stock/ledger is replaced in one
    // write only once every transaction has replayed, so a failure changes
    // nothing.
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
      const coaData = getCoaData_(idToken);
      const allTx = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};

      const posted = Object.keys(allTx)
        .map(id => Object.assign({ _id: id }, allTx[id]))
        .filter(t => t.Status === 'Posted' && t.Lines && t.Lines.length)
        .sort((a, b) => (a.PostedAt || a.CreatedAt || '').localeCompare(b.PostedAt || b.CreatedAt || ''));

      const oldShapeCounts = posted
        .filter(t => t.TransactionType === 'PhysicalCount' && t.Lines.some(l => Number(l.Variance) && !l.Direction))
        .map(t => t.TransactionNumber || t._id);
      if (oldShapeCounts.length) {
        throw new Error('These Physical Counts were posted without their adjustment details and would be left out of the rebuild: ' +
          oldShapeCounts.join(', ') + '. Nothing was changed.');
      }

      const rebuilt = {};
      const readLedger = (itemId, warehouseId) => Object.assign({ Quantity: 0, AvgCost: 0, TotalValue: 0 }, rebuilt[itemId + '|' + warehouseId]);

      posted.forEach(tx => {
        try {
          if (tx.TransactionType === 'WarehouseMovement') {
            // Same two computations as commitWarehouseMovementPosting_, both
            // from the same starting balances: Out at the source, then In at
            // the destination at the Out side's replayed cost.
            const outLines = tx.Lines.map(l => Object.assign({}, l, { Direction: 'Out', WarehouseID: l.FromWarehouseID || l.WarehouseID }));
            const outMovement = computeStockMovement_(idToken, itemsData, coaData, outLines, readLedger);
            const inLines = tx.Lines.map((l, idx) => Object.assign({}, l, { Direction: 'In', WarehouseID: l.ToWarehouseID, UnitCost: outLines[idx].UnitCost }));
            const inMovement = computeStockMovement_(idToken, itemsData, coaData, inLines, readLedger);
            Object.assign(rebuilt, outMovement.ledgerUpdates, inMovement.ledgerUpdates);
            return;
          }
          const lines = tx.Lines.map(l => Object.assign({}, l));
          if (!lines.some(l => l.Direction === 'In' || l.Direction === 'Out')) return; // clean Physical Count
          const movement = computeStockMovement_(idToken, itemsData, coaData, lines, readLedger);
          Object.assign(rebuilt, movement.ledgerUpdates);
        } catch (e) {
          throw new Error((tx.TransactionNumber || tx._id) + ': ' + e.message + ' Nothing was changed.');
        }
      });

      const now = new Date().toISOString();
      const ledgerTree = {};
      Object.keys(rebuilt).forEach(key => {
        const parts = key.split('|');
        const entry = rebuilt[key];
        ledgerTree[parts[0]] = ledgerTree[parts[0]] || {};
        ledgerTree[parts[0]][parts[1]] = { Quantity: entry.Quantity, AvgCost: entry.AvgCost, TotalValue: entry.TotalValue, UpdatedAt: now };
      });
      firebaseDbRequest_('stock/ledger', 'put', ledgerTree, idToken);

      return { success: true, count: posted.length };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}`
  },
  // ---- NEW DEVELOPMENT: Purchase Return (docs/modules/PURCHASE_RETURN.md) ----
  {
    id: 'company-purchase-return-variance-account (read)',
    why: 'NEW DEVELOPMENT. Company Master gains an optional Purchase Return Variance Account: a debit note credits ' +
      'stock at its current average cost while the vendor is debited at the invoice price, and the difference posts here.',
    find: `    const outputTaxAccountId = String(companyData.OutputTaxAccountID || '').trim();`,
    replace: `    const outputTaxAccountId = String(companyData.OutputTaxAccountID || '').trim();
    // [NEW DEVELOPMENT company-purchase-return-variance-account]
    const purchaseReturnVarianceAccountId = String(companyData.PurchaseReturnVarianceAccountID || '').trim();`
  },
  {
    id: 'company-purchase-return-variance-account (validate)',
    why: 'Same checks as the other fixed accounts: active, postable, not restricted to another company.',
    find: `      { id: outputTaxAccountId, label: 'Output Tax Account' }
    ];`,
    replace: `      { id: outputTaxAccountId, label: 'Output Tax Account' },
      { id: purchaseReturnVarianceAccountId, label: 'Purchase Return Variance Account' }
    ];`
  },
  {
    id: 'company-purchase-return-variance-account (store)',
    why: 'Stored on the company record next to the other fixed accounts.',
    find: `      OutputTaxAccountID: outputTaxAccountId,`,
    replace: `      OutputTaxAccountID: outputTaxAccountId,
      PurchaseReturnVarianceAccountID: purchaseReturnVarianceAccountId,`
  },
  {
    id: 'stock-voucher-type-purchase-return',
    why: 'NEW DEVELOPMENT. The Stock Ledger Report links each row to its source module through this map; a Purchase ' +
      'Return row opens the Purchase Return screen.',
    find: `  CustomerInvoice: 'CUSTOMERINVOICE'
};`,
    replace: `  CustomerInvoice: 'CUSTOMERINVOICE',
  PurchaseReturn: 'PURCHASERETURN' // [NEW DEVELOPMENT] docs/modules/PURCHASE_RETURN.md
};`
  },
  // ---- NEW DEVELOPMENT: Sales Return (docs/modules/SALES_RETURN.md) ----
  // ---- NEW DEVELOPMENT: Sales Returns Account per Sales Type (docs/modules/SALES_RETURN.md) ----
  {
    id: 'sales-type-returns-account (read and validate)',
    why: 'NEW DEVELOPMENT. Each Sales Type has its own Sales Returns Account (replacing the single company-level one), ' +
      'because sales under different tax treatments must be returned to different accounts. Required on save, with the ' +
      'same checks as the Revenue account.',
    find: `    if (account.CompanyID && companyId && account.CompanyID !== companyId) throw new Error('Sales Revenue account is restricted to a different company.');
`,
    replace: `    if (account.CompanyID && companyId && account.CompanyID !== companyId) throw new Error('Sales Revenue account is restricted to a different company.');
    // [NEW DEVELOPMENT sales-type-returns-account]
    const salesReturnsAccountId = String(data.SalesReturnsAccountID || '').trim();
    if (!salesReturnsAccountId) throw new Error('Select a Sales Returns account.');
    const returnsAccount = coaData[salesReturnsAccountId];
    if (!returnsAccount || !returnsAccount.IsPostable || returnsAccount.Status !== 'Active') throw new Error('Sales Returns account must be an active, postable account.');
    if (returnsAccount.AccountType !== 'Revenue') throw new Error('Sales Returns account must be a Revenue-type account.');
    if (returnsAccount.CompanyID && companyId && returnsAccount.CompanyID !== companyId) throw new Error('Sales Returns account is restricted to a different company.');
`
  },
  {
    id: 'sales-type-returns-account (store)',
    why: 'Stored on the Sales Type next to its Revenue account.',
    find: `    const fields = { Name: name, GLAccountID: glAccountId, CompanyID: companyId, RestrictedToClassificationID: restrictedToClassificationId, UpdatedAt: now, UpdatedBy: actor };`,
    replace: `    const fields = { Name: name, GLAccountID: glAccountId, SalesReturnsAccountID: salesReturnsAccountId, CompanyID: companyId, RestrictedToClassificationID: restrictedToClassificationId, UpdatedAt: now, UpdatedBy: actor };`
  },
  {
    id: 'stock-voucher-type-sales-return',
    why: 'NEW DEVELOPMENT. Stock Ledger Report rows of a Sales Return open the Sales Return screen.',
    find: `  PurchaseReturn: 'PURCHASERETURN' // [NEW DEVELOPMENT] docs/modules/PURCHASE_RETURN.md
};`,
    replace: `  PurchaseReturn: 'PURCHASERETURN', // [NEW DEVELOPMENT] docs/modules/PURCHASE_RETURN.md
  SalesReturn: 'SALESRETURN' // [NEW DEVELOPMENT] docs/modules/SALES_RETURN.md
};`
  },
  // ---- NEW DEVELOPMENT: PDC Received / PDC Issued (docs/modules/PDC.md) ----
  {
    id: 'company-pdc-clearing-accounts (read)',
    why: 'NEW DEVELOPMENT. Company Master gains the PDC Received and PDC Issued Clearing Accounts: a post-dated ' +
      'cheque sits in its clearing account between receipt/issue and clearing to the bank.',
    find: `    const purchaseReturnVarianceAccountId = String(companyData.PurchaseReturnVarianceAccountID || '').trim();`,
    replace: `    const purchaseReturnVarianceAccountId = String(companyData.PurchaseReturnVarianceAccountID || '').trim();
    // [NEW DEVELOPMENT company-pdc-clearing-accounts]
    const pdcReceivedClearingAccountId = String(companyData.PdcReceivedClearingAccountID || '').trim();
    const pdcIssuedClearingAccountId = String(companyData.PdcIssuedClearingAccountID || '').trim();`
  },
  {
    id: 'company-pdc-clearing-accounts (validate)',
    why: 'Same checks as the other fixed accounts: active, postable, not restricted to another company. PDC posting ' +
      'also refuses a bank account or a party control account (functions/src/pdc.js).',
    find: `      { id: purchaseReturnVarianceAccountId, label: 'Purchase Return Variance Account' }
    ];`,
    replace: `      { id: purchaseReturnVarianceAccountId, label: 'Purchase Return Variance Account' },
      { id: pdcReceivedClearingAccountId, label: 'PDC Received Clearing Account' },
      { id: pdcIssuedClearingAccountId, label: 'PDC Issued Clearing Account' }
    ];`
  },
  {
    id: 'company-pdc-clearing-accounts (store)',
    why: 'Stored on the company record next to the other fixed accounts.',
    find: `      PurchaseReturnVarianceAccountID: purchaseReturnVarianceAccountId,`,
    replace: `      PurchaseReturnVarianceAccountID: purchaseReturnVarianceAccountId,
      PdcReceivedClearingAccountID: pdcReceivedClearingAccountId,
      PdcIssuedClearingAccountID: pdcIssuedClearingAccountId,`
  },
  {
    id: 'data-reset-pdc-cheques (category)',
    why: 'NEW DEVELOPMENT. PDC documents live in their own RTDB path (pdcCheques), so Data Reset needs a category ' +
      'for them, as it has for Vendor and Customer Invoices.',
    find: `  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications',`,
    replace: `  // [NEW DEVELOPMENT data-reset-pdc-cheques] docs/modules/PDC.md
  pdcCheques: { paths: ['pdcCheques'], recordsPath: 'pdcCheques', label: 'PDC Received & Issued', detail: 'Every post-dated cheque record (PDC Received and PDC Issued) — Draft, Pending, Cleared, Bounced and Cancelled alike. Their GL entries are in GL Journal Entries: clear both together.', group: 'transactional' },
  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications',`
  },
  {
    id: 'data-reset-pdc-cheques (summary)',
    why: 'How a PDC record is listed when browsing the category.',
    find: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');`,
    replace: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');
    case 'pdcCheques':
      return (r.TransactionNumber || 'DRAFT') + ' — ' + (r.Direction || '') + ' cheque ' + (r.ChequeNumber || '') + ' dated ' + (r.ChequeDate || '') + ' [' + (r.Status || '') + ']';`
  },
  {
    id: 'data-reset-fixed-assets (category)',
    why: 'NEW DEVELOPMENT. Fixed Assets keep their sub-ledger in Firestore (faAssets, faTransactions, ...) and their ' +
      'set-up in faClasses / faAccountDetermination / faSettings, so Data Reset needs a category for each, as it has for PDC.',
    find: `  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications',`,
    replace: `  // [NEW DEVELOPMENT data-reset-fixed-assets] docs/modules/FIXED_ASSETS.md
  fixedAssets: { paths: ['firestore:faAssets', 'firestore:faTransactions', 'firestore:faPostings', 'firestore:faClearingUse', 'firestore:faRuns', 'firestore:faPeriods', 'firestore:faRunState', 'fa/counters'], recordsPath: 'firestore:faAssets', label: 'Fixed Assets', detail: 'Every asset, its transactions (capitalization, take-over, depreciation, additional depreciation, reversals), capitalization and depreciation documents, depreciation runs and periods, and the asset-number counter. Their GL entries are in GL Journal Entries: clear both together. Deleting single assets here leaves their transactions behind.', group: 'transactional' },
  fixedAssetSetup: { paths: ['firestore:faClasses', 'firestore:faAccountDetermination', 'firestore:faSettings'], recordsPath: 'firestore:faClasses', label: 'Fixed Asset Configuration', detail: 'Asset classes, account determination and the Fixed Asset Clearing Account of each company. Clearing this while assets exist leaves them without a class.', group: 'master' },
  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications',`
  },
  {
    id: 'data-reset-fixed-assets (summary)',
    why: 'How an asset and an asset class are listed when browsing their categories.',
    find: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');`,
    replace: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');
    case 'fixedAssets':
      return (r.AssetNumber || '') + ' — ' + (r.Description || '') + ' [' + (r.Status || '') + ']';
    case 'fixedAssetSetup':
      return (r.Code || '') + ' — ' + (r.Name || '') + ' [' + (r.Kind || '') + ', ' + (r.Status || '') + ']';`
  },
  {
    id: 'data-reset-recurring-journals (category)',
    why: 'NEW DEVELOPMENT. Recurring journal templates live in their own RTDB path (recurringJournals), so Data Reset ' +
      'needs a category for them, as it has for PDC.',
    find: `  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications',`,
    replace: `  // [NEW DEVELOPMENT data-reset-recurring-journals] docs/modules/RECURRING_JOURNAL.md
  recurringJournals: { paths: ['recurringJournals'], recordsPath: 'recurringJournals', label: 'Recurring Journal Entries', detail: 'Every recurring journal template with its schedule and run log — Draft, Active, Paused, Completed and Ended alike. The entries its runs posted are in GL Journal Entries: clear both together.', group: 'transactional' },
  customerClassifications: { paths: ['customerClassifications'], recordsPath: 'customerClassifications', label: 'Customer Classifications',`
  },
  {
    id: 'data-reset-recurring-journals (summary)',
    why: 'How a recurring template is listed when browsing the category.',
    find: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');`,
    replace: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');
    case 'recurringJournals':
      return (r.TemplateNumber || 'DRAFT') + ' — ' + (r.Description || '') + ' [' + (r.Status || '') + ']';`
  }
];
