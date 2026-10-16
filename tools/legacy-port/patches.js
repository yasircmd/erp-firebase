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
    id: 'stock-ledger-report-club-lines',
    why: 'NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/LINE_CLUBBING.md). A document with several lines of the same ' +
      'item at the same warehouse showed one Stock Ledger row per line; lines with the same direction, cost center, ' +
      'profit center and description are now one row (quantities and values summed), like the GL lines.',
    find: `  relevant.forEach(tx => linesHere(tx).forEach(line => {`,
    replace: `  // [NEW DEVELOPMENT stock-ledger-report-club-lines] docs/modules/LINE_CLUBBING.md
  relevant.forEach(tx => clubStockLines_(linesHere(tx)).forEach(line => {`
  },
  {
    id: 'coa-recode-on-move',
    why: 'NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/COA_RECODE.md). An account created under the wrong head kept ' +
      'its code when moved to the right one. Now, when its head changes, it gets the next code under the new head, but ' +
      'only if it has never been used (posted lines keep a copy of the code; drafts, templates and documents refer to it ' +
      'by code) and has no child accounts. Otherwise the move is refused (owner decision: "only if never used").',
    find: `    const record = {
      AccountCode: current.AccountCode,
      AccountName: accountName,
      AccountType: current.AccountType,`,
    replace: `    // [NEW DEVELOPMENT coa-recode-on-move] docs/modules/COA_RECODE.md
    let accountCode = current.AccountCode;
    let codeChangedFrom = '';
    if (parentAccountId !== String(current.ParentAccountID || '')) {
      if (hasChildren) {
        throw new Error("This account has child accounts, so it can't move to another head: its code would no longer match theirs. Move or deactivate the child accounts first.");
      }
      const usedIn = findAccountUsage_(idToken, accountId, current.AccountCode, 3);
      if (usedIn.length) {
        throw new Error('Account ' + current.AccountCode + ' has already been used (' + usedIn.join(', ') + '), so it can' + "'" + 't move to another head with a new code. ' +
          'Create a new account under the right head, move the balance to it with a JV, and deactivate this one.');
      }
      const others = {};
      Object.keys(existing).forEach(id => { if (id !== accountId) others[id] = existing[id]; });
      accountCode = generateAccountCode_(current.AccountType, parentAccountId || null, others, isPostable);
      codeChangedFrom = current.AccountCode;
    }

    const record = {
      AccountCode: accountCode,
      AccountName: accountName,
      AccountType: current.AccountType,`
  },
  {
    id: 'coa-recode-on-move (result)',
    why: 'The new code (and the old one) back to the screen, which tells the user.',
    find: `    return { success: true, accountId: accountId, accountCode: current.AccountCode };`,
    replace: `    return { success: true, accountId: accountId, accountCode: accountCode, codeChangedFrom: codeChangedFrom };`
  },
  {
    id: 'data-reset-opening-balances (category)',
    why: 'NEW DEVELOPMENT (docs/modules/OPENING_BALANCES.md). The opening batches log lives in its own RTDB path; ' +
      'its entries and stock are in GL Journal Entries and Stock Transactions, so clearing those should clear the log too.',
    find: `  boms: { paths: ['boms'], recordsPath: 'boms', label: 'Bill of Materials',`,
    replace: `  // [NEW DEVELOPMENT data-reset-opening-balances] docs/modules/OPENING_BALANCES.md
  openingBalanceBatches: { paths: ['openingBalances/batches'], recordsPath: 'openingBalances/batches', label: 'Opening Balance Batches', detail: 'The log of posted opening batches (GL, Stock, Open Invoices) and their reversals. Their entries are in GL Journal Entries and Stock Transactions: clear all three together. The opening date and clearing account set-up is kept.', group: 'transactional' },
  boms: { paths: ['boms'], recordsPath: 'boms', label: 'Bill of Materials',`
  },
  {
    id: 'data-reset-opening-balances (summary)',
    why: 'How an opening batch is listed when browsing the category.',
    find: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');`,
    replace: `    case 'customerClassifications':
      return (r.Name || '') + (r.IsExport ? ' [Export]' : ' [Local]');
    case 'openingBalanceBatches':
      return 'Opening ' + (r.Kind || '') + ' ' + ((r.JVNumbers || [])[0] || '') + ' — ' + (r.Rows || 0) + ' rows dated ' + (r.OpeningDate || '') + ' [' + (r.Status || '') + ']';`
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
  },
  {
    id: 'job-order-approval-helpers',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `function linesForBatch_(idToken, batchId) {
`,
    replace: `// [PORT CHANGE job-order-approval] Job Order acceptance / stop through
// Approval Configuration, levels in order (docs/modules/JOB_ORDER_ACCEPTANCE.md).
// One approval record per line (DocumentID = the line's own ID).
function beginJobOrderLineApproval_(idToken, batch, lineId, documentNumber, createdByUid) {
  const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'JOBORDERREQUEST', {
    CompanyID: batch.CompanyID, DivisionID: batch.DivisionID, BranchID: batch.BranchID, CostCenterID: batch.CostCenterID
  });
  const approval = beginApprovalInstance_(idToken, 'JOBORDERREQUEST', lineId, documentNumber, scopeKey, 0, createdByUid);
  return approval.required ? approval.instanceId : '';
}

// The lowest level with no decision yet on a Pending record: levels act in order.
function jobOrderCurrentLevel_(instance) {
  if (!instance || instance.Status !== 'Pending') return null;
  const decided = (instance.Decisions || []).map(d => d.LevelNumber);
  return (instance.RequiredLevels || []).slice().sort((a, b) => a.LevelNumber - b.LevelNumber)
    .find(l => decided.indexOf(l.LevelNumber) === -1) || null;
}

function jobOrderPendingApproval_(idToken, line) {
  if (!line.ApprovalInstanceID) return null;
  const instance = firebaseDbRequest_('approvalInstances/' + line.ApprovalInstanceID, 'get', null, idToken);
  return instance && instance.Status === 'Pending' ? instance : null;
}

// Records the current level's decision; only that level's approver may act.
// Returns the record's new status: 'Pending' (more levels), 'Approved' or 'Rejected'.
function decideJobOrderLineLevel_(idToken, user, line, decision, reason) {
  const level = jobOrderCurrentLevel_(jobOrderPendingApproval_(idToken, line));
  if (!level) throw new Error('This line has no approval waiting.');
  if (level.ApproverUserID !== user.uid) {
    throw new Error('This line is waiting on approval level ' + level.LevelNumber + '. Only its assigned approver can act on it now.');
  }
  const result = recordApprovalDecision(idToken, line.ApprovalInstanceID, level.LevelNumber, decision, reason);
  if (!result.success) throw new Error(result.error);
  return result.status;
}

// For the screen: which level a line waits on, who that is, and whether it's the caller.
function annotateJobOrderApproval_(line, actorUid, instances, usersData) {
  const level = line.ApprovalInstanceID ? jobOrderCurrentLevel_(instances[line.ApprovalInstanceID]) : null;
  const approver = level ? usersData[level.ApproverUserID] : null;
  line.ApprovalPending = Boolean(level);
  line.AwaitingLevel = level ? level.LevelNumber : null;
  line.AwaitingApproverName = level ? ((approver && (approver.fullName || approver.username)) || level.ApproverUserID) : '';
  line.CanActOnApproval = Boolean(level) && level.ApproverUserID === actorUid;
}

function linesForBatch_(idToken, batchId) {
`
  },
  {
    id: 'job-order-approval-submit',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `    lines.forEach(line => {
      const subJONumber = batchNumber + '/' + String(line.LineNumber).padStart(2, '0');
      firebaseDbRequest_('jobOrderLines/' + line.LineID, 'patch', {
        SubJONumber: subJONumber, Status: startingStatus, SubmittedAt: now, SubmittedBy: actor,
        UpdatedAt: now, UpdatedBy: actor
      }, idToken);
    });
`,
    replace: `    lines.forEach(line => {
      const subJONumber = batchNumber + '/' + String(line.LineNumber).padStart(2, '0');
      // [PORT CHANGE job-order-approval] a line awaiting acceptance starts its approval (if configured).
      const approvalId = startingStatus === 'Pending Acceptance' ? beginJobOrderLineApproval_(idToken, existing, line.LineID, subJONumber, user.uid) : '';
      firebaseDbRequest_('jobOrderLines/' + line.LineID, 'patch', {
        SubJONumber: subJONumber, Status: startingStatus, SubmittedAt: now, SubmittedBy: actor,
        ApprovalInstanceID: approvalId, UpdatedAt: now, UpdatedBy: actor
      }, idToken);
    });
`
  },
  {
    id: 'job-order-approval-accept',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `    if (existing.Status !== 'Pending Acceptance') throw new Error('Only a line Pending Acceptance can be accepted.');
`,
    replace: `    if (existing.Status !== 'Pending Acceptance') throw new Error('Only a line Pending Acceptance can be accepted.');
    // [PORT CHANGE job-order-approval] with an approval waiting, only the current level's approver accepts;
    // the line is Accepted after the last level.
    if (jobOrderPendingApproval_(idToken, existing)) {
      const approvalStatus = decideJobOrderLineLevel_(idToken, user, existing, 'Approved', '');
      if (approvalStatus !== 'Approved') {
        firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', { UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
        return { success: true, status: 'Pending Acceptance' };
      }
    }
`
  },
  {
    id: 'job-order-approval-amend',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Amendment Requested',`,
    replace: `    // [PORT CHANGE job-order-approval] with an approval waiting, only the current level's approver may ask;
    // it ends the chain as a rejection, so the submitter sees it in Home tasks.
    if (jobOrderPendingApproval_(idToken, existing)) decideJobOrderLineLevel_(idToken, user, existing, 'Rejected', noteText);
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Amendment Requested',`
  },
  {
    id: 'job-order-approval-resubmit',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      OrderedQuantity: qty, TargetDate: date, Status: 'Pending Acceptance',
`,
    replace: `    // [PORT CHANGE job-order-approval] resubmitting starts a fresh approval from level 1 (if configured).
    const resubmitBatch = firebaseDbRequest_('jobOrderBatches/' + existing.ParentBatchID, 'get', null, idToken) || {};
    const resubmitApprovalId = beginJobOrderLineApproval_(idToken, resubmitBatch, lineId, existing.SubJONumber || '', user.uid);
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      OrderedQuantity: qty, TargetDate: date, Status: 'Pending Acceptance', ApprovalInstanceID: resubmitApprovalId,
`
  },
  {
    id: 'job-order-approval-withdraw',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `      throw new Error('Only a not-yet-accepted line can be withdrawn — once Accepted, request a Stop instead.');
    }
`,
    replace: `      throw new Error('Only a not-yet-accepted line can be withdrawn — once Accepted, request a Stop instead.');
    }
    // [PORT CHANGE job-order-approval] close its approval, so no Home task is left behind.
    if (existing.ApprovalInstanceID) {
      const withdrawnApproval = firebaseDbRequest_('approvalInstances/' + existing.ApprovalInstanceID, 'get', null, idToken);
      if (withdrawnApproval && (withdrawnApproval.Status === 'Pending' || withdrawnApproval.Status === 'Rejected')) {
        firebaseDbRequest_('approvalInstances/' + existing.ApprovalInstanceID, 'patch', { Status: 'Withdrawn', UpdatedAt: new Date().toISOString() }, idToken);
      }
    }
`
  },
  {
    id: 'job-order-approval-request-stop',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Stop Requested', StopRequestedAt: now, StopRequestedBy: actor,
`,
    replace: `    // [PORT CHANGE job-order-approval] the stop goes through the same approvers (if configured);
    // otherwise the line keeps its earlier, finished approval and the stop works as before.
    const stopApprovalId = beginJobOrderLineApproval_(idToken, batch, lineId, (existing.SubJONumber || '') + ' (stop)', user.uid);
    firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', {
      Status: 'Stop Requested', StopRequestedAt: now, StopRequestedBy: actor,
      ApprovalInstanceID: stopApprovalId || existing.ApprovalInstanceID || '',
`
  },
  {
    id: 'job-order-approval-accept-stop',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `    if (existing.Status !== 'Stop Requested') throw new Error('Only a line with a pending Stop Request can be closed this way.');
`,
    replace: `    if (existing.Status !== 'Stop Requested') throw new Error('Only a line with a pending Stop Request can be closed this way.');
    // [PORT CHANGE job-order-approval] with a stop approval waiting, only the current level's approver accepts;
    // the line is Stopped after the last level.
    if (jobOrderPendingApproval_(idToken, existing)) {
      const approvalStatus = decideJobOrderLineLevel_(idToken, user, existing, 'Approved', '');
      if (approvalStatus !== 'Approved') {
        firebaseDbRequest_('jobOrderLines/' + lineId, 'patch', { UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid }, idToken);
        return { success: true, status: 'Stop Requested' };
      }
    }
`
  },
  {
    id: 'job-order-approval-list',
    why: "Owner decision 2026-09-28 (docs/modules/JOB_ORDER_ACCEPTANCE.md): a Sales-triggered Job Order line waiting for acceptance (or a stop) goes through the users set for Job Order Request in Approval Configuration, levels in order, and only they can act. Code.gs listed JOBORDERREQUEST as approval-gateable but never used it. Not configured for the batch's scope = as before.",
    find: `        ProducedQuantity: computeJobOrderLineProducedQty_(idToken, l)
      });
    })
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;
`,
    replace: `        ProducedQuantity: computeJobOrderLineProducedQty_(idToken, l)
      });
    })
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const capped = limit ? all.slice(0, limit) : all;
  // [PORT CHANGE job-order-approval] which level each line waits on, and whether the caller can act.
  const approvalInstances = firebaseDbRequest_('approvalInstances', 'get', null, idToken) || {};
  const approvalUsers = firebaseDbRequest_('users', 'get', null, idToken) || {};
  capped.forEach(l => annotateJobOrderApproval_(l, user.uid, approvalInstances, approvalUsers));
`
  },
  {
    id: 'grn-non-stock-invoice-eligible-amount',
    why: "Owner decision 2026-09-28 (docs/modules/GRN_NON_STOCK.md): a GRN can carry non-stock lines (a Procurement Setup category, no item), kept in their own NonStockLines list and posted Dr the category account · Cr GRN Clearing. The Vendor Invoice bills a GRN for its GRN Clearing amount, so that amount must include them.",
    find: `      Amount: (g.Lines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0)`,
    replace: `      // [PORT CHANGE grn-non-stock] a GRN's non-stock lines count too.
      Amount: (g.Lines || []).concat(g.NonStockLines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0)`
  },
  {
    id: 'grn-non-stock-invoice-draft-amount',
    why: "Owner decision 2026-09-28 (docs/modules/GRN_NON_STOCK.md): a GRN can carry non-stock lines (a Procurement Setup category, no item), kept in their own NonStockLines list and posted Dr the category account · Cr GRN Clearing. The Vendor Invoice bills a GRN for its GRN Clearing amount, so that amount must include them.",
    find: `      const amount = (grn.Lines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0);`,
    replace: `      // [PORT CHANGE grn-non-stock] a GRN's non-stock lines count too.
      const amount = (grn.Lines || []).concat(grn.NonStockLines || []).reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitCost) || 0), 0);`
  },
  {
    id: 'delivery-note-invoice-state',
    why: "Owner decision 2026-09-28: the Delivery Note list shows whether each posted note is invoiced (with the Customer Invoice number), on an unposted invoice, or pending, and can be filtered on it. MatchedToInvoiceID is set when a Customer Invoice posts and cleared when it is reversed; drafts don't set it, so they are found from the invoices' SourceDeliveryNotes. Same rule as the GRN list (functions/src/grn.js).",
    find: `    .filter(dn => userCanAccessCompany_(user.profile, dn.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  return { entries: capped, total: all.length };
}`,
    replace: `    .filter(dn => userCanAccessCompany_(user.profile, dn.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const useAll = limit === 'all';
  const capped = useAll ? all : all.slice(0, 100);
  // [PORT CHANGE delivery-note-invoice-state] Invoiced / On draft invoice / Pending, for the list.
  const invoices = firebaseDbRequest_('customerInvoices', 'get', null, idToken) || {};
  const unposted = ['Draft', 'PendingApproval', 'Rejected'];
  capped.forEach(dn => {
    if (dn.Status !== 'Posted' || dn.ReversedByDeliveryNoteID || dn.ReversalOfDeliveryNoteID) { dn.InvoiceStatus = ''; return; }
    if (dn.MatchedToInvoiceID) {
      Object.assign(dn, { InvoiceStatus: 'Invoiced', InvoiceID: dn.MatchedToInvoiceID, InvoiceNumber: (invoices[dn.MatchedToInvoiceID] || {}).TransactionNumber || '' });
      return;
    }
    const draftId = Object.keys(invoices).find(id => unposted.includes(invoices[id].Status) &&
      (invoices[id].SourceDeliveryNotes || []).some(d => d.DeliveryNoteID === dn.DeliveryNoteID));
    if (draftId) Object.assign(dn, { InvoiceStatus: 'OnDraftInvoice', InvoiceID: draftId, InvoiceNumber: invoices[draftId].TransactionNumber || '', InvoiceDocStatus: invoices[draftId].Status });
    else dn.InvoiceStatus = 'Pending';
  });
  return { entries: capped, total: all.length };
}`
  },
  {
    id: 'approval-config-cbt-split',
    why: "NEW DEVELOPMENT (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md): CBT's four voucher types each have their own Approval Configuration entry. Before the list is shown, today's single CBT setup is copied into the four once (approvals.js ensureCbtSplit), so nothing changes until someone edits one.",
    find: `  const saved = firebaseDbRequest_('approvalConfigurations', 'get', null, idToken) || {};
  return APPROVAL_GATEABLE_MODULES.map(m => {`,
    replace: `  // [PORT CHANGE approval-config-cbt-split] copy the CBT setup into its four voucher-type entries once.
  ensureCbtSplit_(idToken);
  const saved = firebaseDbRequest_('approvalConfigurations', 'get', null, idToken) || {};
  return APPROVAL_GATEABLE_MODULES.map(m => {`
  },
  {
    id: 'approval-tracker-config-key',
    why: "NEW DEVELOPMENT (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md): the Approval Tracker's module filter lists the Approval Configuration entries, and a CBT approval is filed under its voucher type's entry (ConfigKey). Filtering on one of them finds those approvals; CBT approvals from before the split have no ConfigKey.",
    find: `    .filter(inst => !f.ModuleID || inst.ModuleID === f.ModuleID)`,
    replace: `    .filter(inst => !f.ModuleID || inst.ModuleID === f.ModuleID || inst.ConfigKey === f.ModuleID) // [PORT CHANGE approval-tracker-config-key]`
  },
  {
    id: 'cbt-fund-transfer-prefix',
    why: "NEW DEVELOPMENT (owner, 2026-09-29; docs/modules/APPROVAL_ROUTING.md, Fund Transfer): a fifth CBT type for moving money between the company's own cash and bank accounts, numbered FT-. voucherPrefixForEntry_ reads its prefix from this table; the type itself is built in functions/src/journal.js.",
    find: `  'Bank Payment': { ledgerPrefix: '11', ledgerIsDebit: false, voucherPrefix: 'BP' }
};`,
    replace: `  'Bank Payment': { ledgerPrefix: '11', ledgerIsDebit: false, voucherPrefix: 'BP' },
  // [PORT CHANGE cbt-fund-transfer-prefix] cash / bank to cash / bank (functions/src/journal.js).
  'Fund Transfer': { ledgerPrefixes: ['10', '11'], ledgerIsDebit: false, voucherPrefix: 'FT', transfer: true }
};`
  },
  {
    id: 'bom-current-parent-name',
    why: "BUG FIX (owner, 2026-09-29): a BOM stores its parent item's code and name as they were when it was saved, " +
      'and getBoms returned that copy, so after an item was renamed the BOM list, the BOM header and Duplicate still ' +
      "showed the old name (components already showed the item master's). getBoms now returns the parent's current " +
      'code and name from the item master; the stored copy is kept (it is what the BOM was saved against) and used ' +
      'only if the item no longer exists.',
    find: `  const data = firebaseDbRequest_('boms', 'get', null, idToken) || {};
  return Object.keys(data).map(id => Object.assign({ BOMID: id }, data[id]));
}`,
    replace: `  const data = firebaseDbRequest_('boms', 'get', null, idToken) || {};
  // [PORT FIX bom-current-parent-name] the parent's CURRENT code and name.
  const itemsData = firebaseDbRequest_('items', 'get', null, idToken) || {};
  return Object.keys(data).map(id => {
    const bom = Object.assign({ BOMID: id }, data[id]);
    const parent = itemsData[bom.ParentItemID];
    if (parent) { bom.ParentItemCode = parent.ItemCode; bom.ParentItemName = parent.ItemName; }
    return bom;
  });
}`
  },
  {
    id: 'list-paging-purchase-order',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/LIST_PAGING.md): Gmail-style paging. With a `page` argument the list returns 100 at a time after a marker (`next`), and search and filters run here over every entry the user can see. Without it the list behaves as before.",
    find: `function getPurchaseOrderEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PURCHASEORDER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Purchase Order.');
  }
  const data = firebaseDbRequest_('purchaseOrders', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ POID: id }, data[id]))
    .filter(po => userCanAccessCompany_(user.profile, po.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
`,
    replace: `function getPurchaseOrderEntries(idToken, limit, page) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PURCHASEORDER', 'access', user.profile.role)) {
    throw new Error('You do not have access to Purchase Order.');
  }
  const data = firebaseDbRequest_('purchaseOrders', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ POID: id }, data[id]))
    .filter(po => userCanAccessCompany_(user.profile, po.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  // [PORT CHANGE list-paging-purchase-order] Gmail-style paging; search
  // matches the PO number and the vendor's name, as the screen's did.
  if (page) {
    const vendorsData = firebaseDbRequest_('vendors', 'get', null, idToken) || {};
    return __listPaging.pageOf(all, page, { idField: 'POID', dateField: 'PODate', equals: ['CompanyID', 'Status'],
      text: po => (po.PONumber || '') + ' ' + ((vendorsData[po.VendorID] || {}).VendorName || '') });
  }
`
  },
  {
    id: 'list-paging-production',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/LIST_PAGING.md): Gmail-style paging. With a `page` argument the list returns 100 at a time after a marker (`next`), and search and filters run here over every entry the user can see. Without it the list behaves as before.",
    find: `function getProductionEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PRODUCTION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Production Entry.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ ProductionID: id }, data[id]))
    .filter(e => e.TransactionType === 'Production')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
`,
    replace: `function getProductionEntries(idToken, limit, page) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PRODUCTION', 'access', user.profile.role)) {
    throw new Error('You do not have access to Production Entry.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ ProductionID: id }, data[id]))
    .filter(e => e.TransactionType === 'Production')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  // [PORT CHANGE list-paging-production] Gmail-style paging and server-side search.
  if (page) {
    return __listPaging.pageOf(all, page, { idField: 'ProductionID', idAlso: ['LinkedJVID'], dateField: 'TransactionDate', equals: ['CompanyID', 'Status'],
      text: e => \`\${e.TransactionNumber} \${e.Description}\` });
  }
`
  },
  {
    id: 'list-paging-physical-count',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/LIST_PAGING.md): Gmail-style paging. With a `page` argument the list returns 100 at a time after a marker (`next`), and search and filters run here over every entry the user can see. Without it the list behaves as before.",
    find: `function getPhysicalCountEntries(idToken, limit) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PHYSICALCOUNT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Physical / Cycle Count.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ CountID: id }, data[id]))
    .filter(e => e.TransactionType === 'PhysicalCount')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
`,
    replace: `function getPhysicalCountEntries(idToken, limit, page) {
  const user = requireUser_(idToken);
  if (!moduleHasCapability_(idToken, 'PHYSICALCOUNT', 'access', user.profile.role)) {
    throw new Error('You do not have access to Physical / Cycle Count.');
  }
  const data = firebaseDbRequest_('stock/transactions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ CountID: id }, data[id]))
    .filter(e => e.TransactionType === 'PhysicalCount')
    .filter(e => userCanAccessCompany_(user.profile, e.CompanyID))
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  // [PORT CHANGE list-paging-physical-count] Gmail-style paging and server-side search.
  if (page) {
    return __listPaging.pageOf(all, page, { idField: 'CountID', idAlso: ['LinkedJVID'], dateField: 'TransactionDate', equals: ['CompanyID', 'Status'],
      text: e => \`\${e.TransactionNumber} \${e.Description}\` });
  }
`
  },
  {
    id: 'pr-visibility-list',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `  const data = firebaseDbRequest_('purchaseRequisitions', 'get', null, idToken) || {};
  const all = Object.keys(data)
    .map(id => Object.assign({ PRID: id }, data[id]))
    .filter(pr => userCanAccessCompany_(user.profile, pr.CompanyID))
`,
    replace: `  const data = firebaseDbRequest_('purchaseRequisitions', 'get', null, idToken) || {};
  // [PORT CHANGE pr-visibility-list] raiser, approvers, Procurement team, Admins.
  const canSeePr = prVisibilityFor_(idToken, user);
  const all = Object.keys(data)
    .map(id => Object.assign({ PRID: id }, data[id]))
    .filter(pr => userCanAccessCompany_(user.profile, pr.CompanyID))
    .filter(pr => canSeePr(pr, pr.PRID))
`
  },
  {
    id: 'pr-visibility-save',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `      const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
      if (!existing) throw new Error('Requisition not found.');
      // Rejected is editable too now`,
    replace: `      const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
      // [PORT CHANGE pr-visibility-save] only a requisition the user may see.
      if (!existing || !canSeePurchaseRequisition_(idToken, user, prId, existing)) throw new Error('Requisition not found.');
      // Rejected is editable too now`
  },
  {
    id: 'pr-visibility-submit',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `function submitPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
`,
    replace: `function submitPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // [PORT CHANGE pr-visibility-submit] only a requisition the user may see.
    if (!canSeePurchaseRequisition_(idToken, user, prId, existing)) throw new Error('Requisition not found.');
`
  },
  {
    id: 'pr-visibility-close',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `function closePurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
`,
    replace: `function closePurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // [PORT CHANGE pr-visibility-close] only a requisition the user may see.
    if (!canSeePurchaseRequisition_(idToken, user, prId, existing)) throw new Error('Requisition not found.');
`
  },
  {
    id: 'pr-visibility-cancel',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `function cancelPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
`,
    replace: `function cancelPurchaseRequisition(idToken, prId) {
  try {
    const user = requireUser_(idToken);
    requirePostAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // [PORT CHANGE pr-visibility-cancel] only a requisition the user may see.
    if (!canSeePurchaseRequisition_(idToken, user, prId, existing)) throw new Error('Requisition not found.');
`
  },
  {
    id: 'pr-visibility-delete',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `    requireDraftAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (!existing) throw new Error('Requisition not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft requisition can be deleted.');`,
    replace: `    requireDraftAccess_(idToken, user, 'PURCHASEREQUISITION');
    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    // [PORT CHANGE pr-visibility-delete] only a requisition the user may see
    // (which also checks its company: delete had no company check).
    if (!existing || !canSeePurchaseRequisition_(idToken, user, prId, existing)) throw new Error('Requisition not found.');
    if (existing.Status !== 'Draft') throw new Error('Only a Draft requisition can be deleted.');`
  },
  {
    id: 'pr-visibility-decide',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/PR_VISIBILITY.md): a Purchase Requisition is seen only by who raised it, its approvers (any level, delegated or decided, from then on), the Procurement follow-up team for its scope, and Admins. The list and every requisition action use functions/src/prVisibility.js, so a requisition can't be opened or acted on by id either.",
    find: `    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (existing && !userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    const result = decideApprovalForDocument_(idToken, 'purchaseRequisitions'`,
    replace: `    const existing = firebaseDbRequest_('purchaseRequisitions/' + prId, 'get', null, idToken);
    if (existing && !userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // [PORT CHANGE pr-visibility-decide] only a requisition the user may see.
    if (existing && !canSeePurchaseRequisition_(idToken, user, prId, existing)) throw new Error('Requisition not found.');
    const result = decideApprovalForDocument_(idToken, 'purchaseRequisitions'`
  },
  {
    id: 'import-user-id',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/MASTER_IMPORT.md, Part 2): the save also returns the new record's id, so Master Data Import can remove it again if a later row of the same import fails. Nothing else changes.",
    find: `    if (!id) {
      if (!email) throw new Error('Email is required for a new Firebase account.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');

      const authUser = firebaseAuthRequest_('accounts:signUp', {
        email: email,
        password: password,
        returnSecureToken: true
      });

      firebaseDbRequest_(
        \`users/\${authUser.localId}\`,
        'put',
        {
          username: username,
          email: email,
          fullName: fullName,
          role: role,
          status: status,
          lastLogin: 'Never',
          createdAt: new Date().toISOString(),
          AssignedCompanies: assignedCompanies
        },
        idToken
      );
    } else {
      firebaseDbRequest_(
        \`users/\${id}\`,
        'patch',
        {
          fullName: fullName,
          role: role,
          status: status,
          updatedAt: new Date().toISOString(),
          AssignedCompanies: assignedCompanies
        },
        idToken
      );
    }

    return { success: true };
`,
    replace: `    // [PORT CHANGE import-user-id] the user's id is returned, for Master Data Import's undo.
    let savedUserId = id;
    if (!id) {
      if (!email) throw new Error('Email is required for a new Firebase account.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');

      const authUser = firebaseAuthRequest_('accounts:signUp', {
        email: email,
        password: password,
        returnSecureToken: true
      });
      savedUserId = authUser.localId;

      firebaseDbRequest_(
        \`users/\${authUser.localId}\`,
        'put',
        {
          username: username,
          email: email,
          fullName: fullName,
          role: role,
          status: status,
          lastLogin: 'Never',
          createdAt: new Date().toISOString(),
          AssignedCompanies: assignedCompanies
        },
        idToken
      );
    } else {
      firebaseDbRequest_(
        \`users/\${id}\`,
        'patch',
        {
          fullName: fullName,
          role: role,
          status: status,
          updatedAt: new Date().toISOString(),
          AssignedCompanies: assignedCompanies
        },
        idToken
      );
    }

    return { success: true, userId: savedUserId };
`
  },
  {
    id: 'import-bom-id',
    why: "NEW DEVELOPMENT (owner, 2026-10-02; docs/modules/MASTER_IMPORT.md, Part 2): the save also returns the new record's id, so Master Data Import can remove it again if a later row of the same import fails. Nothing else changes.",
    find: `      const newId = 'BOM-' + Utilities.getUuid().split('-')[0].toUpperCase();
      updates[newId] = Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor });
    }

    firebaseDbRequest_('boms', 'patch', updates, idToken);
    return { success: true };
`,
    replace: `      const newId = 'BOM-' + Utilities.getUuid().split('-')[0].toUpperCase();
      updates[newId] = Object.assign({}, fields, { CreatedAt: now, CreatedBy: actor });
    }

    firebaseDbRequest_('boms', 'patch', updates, idToken);
    // [PORT CHANGE import-bom-id] the BOM's id is returned, for Master Data Import's undo.
    return { success: true, bomId: bomId || Object.keys(updates).find(k => updates[k].CreatedAt === now && updates[k].ParentItemID === parentItemId) };
`
  },
  {
    id: 'gl-report-cost-center',
    why: 'NEW DEVELOPMENT (owner, 2026-10-10; docs/modules/GL_VIEWS.md): each GL Report line carries its cost center, for the new Cost Center column. Nothing else changes.',
    find: `      Description: l.Description || l.EntryDescription, Debit: l.Debit, Credit: l.Credit, Balance: running`,
    replace: `      Description: l.Description || l.EntryDescription, Debit: l.Debit, Credit: l.Credit, Balance: running,
      // [PORT CHANGE gl-report-cost-center] the line's cost center, for the Cost Center column.
      CostCenterID: l.CostCenterID || ''`
  },
  {
    id: 'period-lock-vendor-reversal',
    why: 'NEW DEVELOPMENT (owner, 2026-10-11; docs/modules/PERIOD_CLOSING.md, step 1b, decision 130): a vendor invoice reversal, which may go through approval, is refused at once when its date is in a closed month (the entry itself is checked again when written). Nothing else changes.',
    find: `    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'VENDORINVOICE', {`,
    replace: `    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    // [PORT CHANGE period-lock-vendor-reversal] the reversal's date must be in an open month, before it is sent for approval.
    assertPeriodOpen_(idToken, existing.CompanyID, date);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'VENDORINVOICE', {`
  },
  {
    id: 'period-lock-customer-reversal',
    why: 'NEW DEVELOPMENT (owner, 2026-10-11; docs/modules/PERIOD_CLOSING.md, step 1b, decision 130): a customer invoice reversal, which may go through approval, is refused at once when its date is in a closed month (the entry itself is checked again when written). Nothing else changes.',
    find: `    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'CUSTOMERINVOICE', {`,
    replace: `    const date = String(reversalDate || '').trim() || new Date().toISOString().substring(0, 10);
    // [PORT CHANGE period-lock-customer-reversal] the reversal's date must be in an open month, before it is sent for approval.
    assertPeriodOpen_(idToken, existing.CompanyID, date);
    const now = new Date().toISOString();
    const actor = user.profile.username || user.uid;

    const scopeKey = resolveApprovalScopeKeyForDocument_(idToken, 'CUSTOMERINVOICE', {`
  },
  {
    id: 'pl-without-year-end-close',
    why: "NEW DEVELOPMENT (owner, 2026-10-11; docs/modules/PERIOD_CLOSING.md, step 2): the Profit and Loss leaves the Year-End Closing entry out, so a closed year's P&L still shows its income and expenses (the entry moves them to Retained Earnings). Nothing else changes.",
    find: `  const lines = getPostedGlLines_(idToken, filters).filter(l => l.JVDate >= fromDate && l.JVDate <= toDate);`,
    replace: `  // [PORT CHANGE pl-without-year-end-close] the year-end closing entry left out: a closed year's P&L still shows its figures.
  const lines = getPostedGlLines_(idToken, filters).filter(l => l.JVDate >= fromDate && l.JVDate <= toDate && l.VoucherType !== 'YearEndClose');`
  },
  {
    id: 'user-access-until',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/HR_EMPLOYEES.md, \"A leaver's access\"): User Management shows a leaver's last day of access (users/{uid}/AccessUntil, kept by leaverAccess.js). Nothing else changes.",
    find: `    lastLogin: users[uid].lastLogin || 'Never',`,
    replace: `    lastLogin: users[uid].lastLogin || 'Never',
    // [PORT CHANGE user-access-until] a leaver's last day of access.
    accessUntil: users[uid].AccessUntil || '',`
  },
  {
    id: 'org-unit-location',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/FIXED_ASSETS.md, \"Locations\"): a Location org unit type, for employees and fixed assets, shared by all companies or of one (as every org unit). Nothing else changes.",
    find: `const ORG_UNIT_TYPES = ['Division', 'Branch', 'Warehouse', 'Rack', 'CostCenter', 'ProfitCenter'];`,
    replace: `// [PORT CHANGE org-unit-location] Location: where employees work and assets are.
const ORG_UNIT_TYPES = ['Division', 'Branch', 'Warehouse', 'Rack', 'CostCenter', 'ProfitCenter', 'Location'];`
  },
  // Item Sub-Categories by company (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md):
  // shared by all companies or one company's, as items are.
  {
    id: 'subcat-company-read',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md): Item Master's picker gets each sub-category's company. Nothing else changes.",
    find: `    .map(id => ({ SubCategoryID: id, Name: data[id].Name, ParentCategory: data[id].ParentCategory }));`,
    replace: `    // [PORT CHANGE subcat-company-read] its company ('' = shared).
    .map(id => ({ SubCategoryID: id, Name: data[id].Name, ParentCategory: data[id].ParentCategory, CompanyID: data[id].CompanyID || '' }));`
  },
  {
    id: 'subcat-company-save',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md): a sub-category is shared or one company's; it can't move to a company while items of another company (or shared items) use it.",
    find: `    if (!name) throw new Error('Name is required.');
    if (!ITEM_CATEGORY_PREFIXES[parentCategory]) throw new Error('Select a valid parent category.');
`,
    replace: `    if (!name) throw new Error('Name is required.');
    if (!ITEM_CATEGORY_PREFIXES[parentCategory]) throw new Error('Select a valid parent category.');
    // [PORT CHANGE subcat-company-save] shared ('') or one company's.
    const companyId = String(data.CompanyID || '').trim();
    if (companyId && !userCanAccessCompany_(user.profile, companyId)) throw new Error('You do not have access to that company.');
    if (subCategoryId && companyId) {
      const items = firebaseDbRequest_('items', 'get', null, idToken) || {};
      const other = Object.keys(items).find(id => items[id].SubCategoryID === subCategoryId && (items[id].CompanyID || '') !== companyId);
      if (other) throw new Error('Item ' + (items[other].ItemCode || other) + ' of ' + (items[other].CompanyID ? 'another company' : 'all companies') + ' uses this sub-category: it cannot belong to one company only.');
    }
`
  },
  {
    id: 'subcat-company-store',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md): the sub-category's company is stored.",
    find: `      firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'patch', {
        Name: name, ParentCategory: parentCategory, Status: status, UpdatedAt: now, UpdatedBy: actor
      }, idToken);`,
    replace: `      firebaseDbRequest_('itemSubCategories/' + subCategoryId, 'patch', {
        Name: name, ParentCategory: parentCategory, Status: status, CompanyID: companyId, UpdatedAt: now, UpdatedBy: actor // [PORT CHANGE subcat-company-store]
      }, idToken);`
  },
  {
    id: 'subcat-company-store-new',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md): a new sub-category's company is stored.",
    find: `    firebaseDbRequest_('itemSubCategories/' + newId, 'put', {
      Name: name, ParentCategory: parentCategory, Status: status,`,
    replace: `    firebaseDbRequest_('itemSubCategories/' + newId, 'put', {
      Name: name, ParentCategory: parentCategory, Status: status, CompanyID: companyId, // [PORT CHANGE subcat-company-store-new]`
  },
  {
    id: 'item-subcat-company',
    why: "NEW DEVELOPMENT (owner, 2026-10-14; docs/modules/ITEM_SUBCATEGORIES.md): an item uses a shared sub-category or one of its own company's.",
    find: `      if (subCat.ParentCategory !== category) throw new Error('Sub-category does not belong to the selected Category.');`,
    replace: `      if (subCat.ParentCategory !== category) throw new Error('Sub-category does not belong to the selected Category.');
      // [PORT CHANGE item-subcat-company] a shared one, or the item's company's.
      if (subCat.CompanyID && subCat.CompanyID !== companyId) throw new Error('Sub-category "' + subCat.Name + '" belongs to ' + (companyId ? 'another company' : 'one company; a shared item uses a shared sub-category') + '.');`
  },
  {
    id: 'customer-mobile-unique',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/UX_TIER3.md, E, decision 160): a customer's mobile (Phone) is unique per company, so the Retail counter can find a customer by it. Checked when the number is new or changed (customers saved before keep theirs); compared on the last 9 digits (customerPhone.js). Nothing else changes.",
    find: `      CompanyID: companyId, Notes: String(customerData.Notes || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    };

    if (customerId) {`,
    replace: `      CompanyID: companyId, Notes: String(customerData.Notes || '').trim(),
      UpdatedAt: now, UpdatedBy: actor
    };

    // [PORT CHANGE customer-mobile-unique] one mobile number per customer of a company.
    if (__customerPhone.phoneKey(fields.Phone)) {
      const allCustomers = firebaseDbRequest_('customers', 'get', null, idToken) || {};
      const before = customerId ? allCustomers[customerId] : null;
      if (!before || __customerPhone.phoneKey(before.Phone) !== __customerPhone.phoneKey(fields.Phone) || (before.CompanyID || '') !== companyId) {
        const clash = __customerPhone.phoneClash(allCustomers, fields.Phone, companyId, customerId);
        if (clash) throw new Error(__customerPhone.clashMessage(fields.Phone, clash));
      }
    }

    if (customerId) {`
  },
  {
    id: 'invoice-item-lines-save',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): item lines on a Customer Invoice that deliver stock directly (a company setting, off by default), typed or brought in from a Sales Order; checked by invoiceStock.js; one Sales Type for them. Nothing else changes.",
    find: `    if (!sourceDeliveryNotes.length && !directLines.length) {
      throw new Error('Add at least one Delivery Note or one direct line.');
    }`,
    replace: `    // [PORT CHANGE invoice-item-lines-save] item lines that deliver the stock themselves.
    if (invoiceId) {
      const beforeItems = firebaseDbRequest_('customerInvoices/' + invoiceId, 'get', null, idToken);
      if (beforeItems && beforeItems.AutoDeliveryNoteID && (beforeItems.Status === 'Draft' || beforeItems.Status === 'Rejected')) throw new Error("This invoice's items are already delivered (" + (beforeItems.AutoDeliveryNoteNumber || beforeItems.AutoDeliveryNoteID) + "): post it as it is.");
    }
    const itemLines = cleanInvoiceItemLines_(idToken, invoiceData.ItemLines || [], companyId, customerId, invoiceId, costCenterId);
    const itemSalesTypeId = itemLines.length ? resolveAndValidateSalesType_(idToken, invoiceData.ItemSalesTypeID, customerData.Classification, 'Item lines').SalesTypeID : '';

    if (!sourceDeliveryNotes.length && !directLines.length && !itemLines.length) {
      throw new Error('Add at least one Delivery Note, item line or direct line.');
    }`
  },
  {
    id: 'invoice-item-lines-save (cost center)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): the item lines' revenue posts to the header cost center, as a Delivery Note's does.",
    find: `    if (sourceDeliveryNotes.length && !costCenterId) {`,
    replace: `    if ((sourceDeliveryNotes.length || itemLines.length) && !costCenterId) { // [PORT CHANGE invoice-item-lines-save]`
  },
  {
    id: 'invoice-item-lines-save (totals)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): the item lines count in the subtotal.",
    find: `    const subtotal = Math.round((dnSubtotal + directTotal) * 100) / 100;`,
    replace: `    // [PORT CHANGE invoice-item-lines-save]
    const itemTotal = itemLines.reduce((sum, l) => sum + l.Amount, 0);
    const subtotal = Math.round((dnSubtotal + directTotal + itemTotal) * 100) / 100;`
  },
  {
    id: 'invoice-item-lines-save (fields)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): the item lines and their Sales Type are stored with the invoice.",
    find: `      SourceDeliveryNotes: sourceDeliveryNotes, DirectLines: directLines,`,
    replace: `      SourceDeliveryNotes: sourceDeliveryNotes, DirectLines: directLines,
      ItemLines: itemLines, ItemSalesTypeID: itemSalesTypeId, // [PORT CHANGE invoice-item-lines-save]`
  },
  {
    id: 'invoice-item-lines-post',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): on posting (or final approval), a Delivery Note is made and posted for the item lines, then matched to the invoice like any other: stock out at average cost with its COGS, the order's delivered quantities and reservations, returns and the month-end check all as for a delivery.",
    find: `function commitCustomerInvoicePosting_(idToken, user, existing, invoiceId) {`,
    replace: `function commitCustomerInvoicePosting_(idToken, user, existing, invoiceId) {
  // [PORT CHANGE invoice-item-lines-post] the item lines delivered first, then matched below like any other delivery.
  if ((existing.ItemLines || []).length && !existing.AutoDeliveryNoteID) {
    const auto = createInvoiceDeliveryNote_(idToken, user, existing, invoiceId);
    existing.SourceDeliveryNotes = (existing.SourceDeliveryNotes || []).concat([auto.entry]);
    existing.AutoDeliveryNoteID = auto.dnId;
    existing.AutoDeliveryNoteNumber = auto.entry.DeliveryNoteNumber;
    firebaseDbRequest_('customerInvoices/' + invoiceId, 'patch', { SourceDeliveryNotes: existing.SourceDeliveryNotes, AutoDeliveryNoteID: auto.dnId, AutoDeliveryNoteNumber: auto.entry.DeliveryNoteNumber }, idToken);
  }`
  },
  {
    id: 'invoice-item-lines-post (the delivery)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): the Delivery Note behind an invoice's item lines: made and posted under the invoice posting's lock, dated the invoice date; removed again if its posting fails (e.g. not enough stock).",
    find: `function decideDeliveryNoteApproval(idToken, dnId, levelNumber, decision, reason) {`,
    replace: `// [PORT CHANGE invoice-item-lines-post] the Delivery Note behind an invoice's item lines. Caller holds the lock.
function createInvoiceDeliveryNote_(idToken, user, inv, invoiceId) {
  const now = new Date().toISOString();
  const actor = user.profile.username || user.uid;
  const dnId = 'DND-' + Utilities.getUuid().split('-')[0].toUpperCase();
  const lines = (inv.ItemLines || []).map((l, i) => ({
    LineNo: i + 1, ItemID: l.ItemID, ItemCode: l.ItemCode, ItemName: l.ItemName || '', WarehouseID: l.WarehouseID,
    Quantity: l.Quantity, UnitPrice: l.UnitPrice, BatchNumber: '', ExpiryDate: '',
    CostCenterID: l.CostCenterID || inv.CostCenterID || '', ProfitCenterID: l.ProfitCenterID || '', Description: l.Description || l.ItemName || l.ItemCode,
    SourceSOID: l.SourceSOID || '', SourceSOLineID: l.SourceSOLineID || '', SourceSONumber: l.SourceSONumber || ''
  }));
  const record = {
    TransactionType: 'DeliveryNote', TransactionDate: inv.InvoiceDate, Description: inv.Description, Reference: '',
    CompanyID: inv.CompanyID, DivisionID: inv.DivisionID || '', BranchID: inv.BranchID || '', CostCenterID: inv.CostCenterID || '', ProfitCenterID: inv.ProfitCenterID || '',
    CustomerID: inv.CustomerID, Lines: lines, Status: 'Draft', AutoFromInvoiceID: invoiceId,
    CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor
  };
  firebaseDbRequest_('stock/transactions/' + dnId, 'put', record, idToken);
  let result;
  try {
    result = commitDeliveryNotePosting_(idToken, user, record, dnId);
  } catch (err) {
    const left = firebaseDbRequest_('stock/transactions/' + dnId, 'get', null, idToken);
    if (left && left.Status !== 'Posted') firebaseDbRequest_('stock/transactions/' + dnId, 'delete', null, idToken);
    throw err;
  }
  const amount = Math.round(lines.reduce((sum, l) => sum + Math.round(l.Quantity * l.UnitPrice * 100) / 100, 0) * 100) / 100;
  return { dnId: dnId, entry: { DeliveryNoteID: dnId, DeliveryNoteNumber: result.dnNumber || '', SalesTypeID: inv.ItemSalesTypeID, Amount: amount,
    Lines: lines.map(l => ({ ItemCode: l.ItemCode, Quantity: l.Quantity, UnitPrice: l.UnitPrice, CostCenterID: l.CostCenterID, ProfitCenterID: l.ProfitCenterID })) } };
}

function decideDeliveryNoteApproval(idToken, dnId, levelNumber, decision, reason) {`
  },
  {
    id: 'invoice-item-lines-post (lines without an order)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): an item line typed directly on an invoice has no Sales Order: the delivery's order checks and order updates skip such lines (a delivery made on its own screen always has one).",
    find: `  for (const l of (dn.Lines || [])) {
    const key = l.SourceSOID + '|' + l.SourceSOLineID;`,
    replace: `  for (const l of (dn.Lines || [])) {
    if (!l.SourceSOID) continue; // [PORT CHANGE invoice-item-lines-post] a line invoiced directly, with no order
    const key = l.SourceSOID + '|' + l.SourceSOLineID;`
  },
  {
    id: 'invoice-item-lines-post (order status)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): the order's status is refreshed only for lines that have one.",
    find: `  const distinctSOIds = Array.from(new Set(existing.Lines.map(l => l.SourceSOID)));`,
    replace: `  const distinctSOIds = Array.from(new Set(existing.Lines.map(l => l.SourceSOID))).filter(Boolean); // [PORT CHANGE invoice-item-lines-post]`
  },
  {
    id: 'invoice-item-lines-reverse',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): reversing an invoice with item lines also reverses the Delivery Note made for them (the stock comes back at the cost it left at).",
    find: `  (existing.SourceDeliveryNotes || []).forEach(dn => {
    firebaseDbRequest_('stock/transactions/' + dn.DeliveryNoteID, 'patch', { MatchedToInvoiceID: '' }, idToken);
  });

  return { invoiceId: newId, invoiceNumber: glResult.jvNumber };`,
    replace: `  (existing.SourceDeliveryNotes || []).forEach(dn => {
    firebaseDbRequest_('stock/transactions/' + dn.DeliveryNoteID, 'patch', { MatchedToInvoiceID: '' }, idToken);
  });
  // [PORT CHANGE invoice-item-lines-reverse] its own delivery, reversed with it.
  if (existing.AutoDeliveryNoteID) {
    const dnReversal = reverseDeliveryNote(idToken, existing.AutoDeliveryNoteID, date);
    if (!dnReversal.success) throw new Error('The invoice is reversed, but its delivery ' + (existing.AutoDeliveryNoteNumber || existing.AutoDeliveryNoteID) + ' could not be: ' + dnReversal.error);
  }

  return { invoiceId: newId, invoiceNumber: glResult.jvNumber };`
  },
  {
    id: 'invoice-item-lines-reverse (access)',
    why: "NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/DIRECT_SALES_INVOICE.md, decisions 166-172): the delivery of a reversed invoice's item lines is reversed by the invoice's reversal: the Delivery Note post right is not asked of the user reversing the invoice.",
    find: `    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    requirePostAccess_(idToken, user, 'DELIVERYNOTE');
    if (existing.Status !== 'Posted') throw new Error('Only a posted Delivery Note can be reversed.');`,
    replace: `    if (!userCanAccessCompany_(user.profile, existing.CompanyID)) throw new Error('You do not have access to that company.');
    // [PORT CHANGE invoice-item-lines-reverse] made for an invoice that is now reversed: no Delivery Note right needed.
    const ofReversedInvoice = existing.AutoFromInvoiceID && (firebaseDbRequest_('customerInvoices/' + existing.AutoFromInvoiceID, 'get', null, idToken) || {}).ReversedByInvoiceID;
    if (!ofReversedInvoice) requirePostAccess_(idToken, user, 'DELIVERYNOTE');
    if (existing.Status !== 'Posted') throw new Error('Only a posted Delivery Note can be reversed.');`
  }
  ,
  {
    id: 'coa-class-group-seed',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/COA_NUMBERING.md, decisions 197-210). The seeded chart is a class per type (X00000, a heading) ' +
      'with its groups under it (XN0000); 110000 Cash and 120000 Bank carry the Cash / Bank mark (coaScheme.js SEED).',
    find: `  const existingCodes = new Set(Object.values(existing).map(a => String(a.AccountCode)));
  const missing = COA_SUBCATEGORIES.filter(sc => !existingCodes.has(sc.code));
  if (!missing.length) return existing;

  const now = new Date().toISOString();
  const updates = {};
  missing.forEach(sc => {
    const id = 'ACC-' + Utilities.getUuid().split('-')[0].toUpperCase();
    updates[id] = {`,
    replace: `  // [NEW DEVELOPMENT coa-class-group-seed] docs/modules/COA_NUMBERING.md
  const existingCodes = new Set(Object.values(existing).map(a => String(a.AccountCode)));
  const missing = __coaScheme.SEED.filter(sc => !existingCodes.has(sc.code));
  if (!missing.length) return existing;

  const now = new Date().toISOString();
  const updates = {};
  const idOfCode = {};
  Object.keys(existing).forEach(id => { idOfCode[String(existing[id].AccountCode)] = id; });
  missing.forEach(sc => { idOfCode[sc.code] = 'ACC-' + Utilities.getUuid().split('-')[0].toUpperCase(); });
  missing.forEach(sc => {
    const id = idOfCode[sc.code];
    updates[id] = {
      OwnCashBank: sc.cashBank || '', CashBank: sc.cashBank || '',`
  },
  {
    id: 'coa-class-group-seed (parent)',
    why: 'The seeded groups sit under their class.',
    find: `      CashFlowCategory: sc.cashFlowCategory || '',
      ParentAccountID: '',`,
    replace: `      CashFlowCategory: sc.cashFlowCategory || '',
      ParentAccountID: sc.parent ? idOfCode[sc.parent] || '' : '',`
  },
  {
    id: 'coa-class-group-mark',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/COA_NUMBERING.md, decision 210): a group or sub-group of the Assets class may be marked Cash or Bank; ' +
      'its accounts take the mark (cash and bank accounts are found by it, not by their code).',
    find: `    if (!accountName) {
      throw new Error('Account name is required.');
    }
`,
    replace: `    if (!accountName) {
      throw new Error('Account name is required.');
    }
    // [NEW DEVELOPMENT coa-class-group-mark] docs/modules/COA_NUMBERING.md
    let ownMark = isPostable ? '' : String(accountData.CashBank || '').trim();
    if (ownMark && !__coaScheme.MARKS.includes(ownMark)) throw new Error('Cash / Bank must be Cash, Bank or neither.');
    if (ownMark && !parentAccountId) throw new Error('Only a group (or sub-group) is marked Cash or Bank, not a class.');
`
  },
  {
    id: 'coa-class-group-new',
    why: 'A new account: the mark checked (Assets only) and stored, with the one its accounts take.',
    find: `      const code = generateAccountCode_(accountType, parentAccountId || null, existing, isPostable);
      const newId = 'ACC-' + Utilities.getUuid().split('-')[0].toUpperCase();
`,
    replace: `      const code = generateAccountCode_(accountType, parentAccountId || null, existing, isPostable);
      const newId = 'ACC-' + Utilities.getUuid().split('-')[0].toUpperCase();
      // [NEW DEVELOPMENT coa-class-group-new] docs/modules/COA_NUMBERING.md
      if (ownMark && accountType !== 'Asset') throw new Error('Only an Assets group is marked Cash or Bank.');
      const cashBank = __coaScheme.markFor({ IsPostable: isPostable, OwnCashBank: ownMark, ParentAccountID: parentAccountId }, existing);
`
  },
  {
    id: 'coa-class-group-new (store)',
    why: 'The mark stored on the new account.',
    find: `        CashFlowCategory: cashFlowCategory,
        Status: status,
        CreatedAt: now, CreatedBy: actor,`,
    replace: `        CashFlowCategory: cashFlowCategory,
        OwnCashBank: ownMark, CashBank: cashBank, // [NEW DEVELOPMENT coa-class-group-new]
        Status: status,
        CreatedAt: now, CreatedBy: actor,`
  },
  {
    id: 'coa-class-group-edit',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/COA_NUMBERING.md, decisions 197, 201, 210). A heading does not become an account (it has a heading code); ' +
      'the mark checked; accounts already outside a group may still be edited (they are listed to fix).',
    find: `    const record = {
      AccountCode: accountCode,`,
    replace: `    // [NEW DEVELOPMENT coa-class-group-edit] docs/modules/COA_NUMBERING.md
    if (isPostable && current.IsPostable !== true && __coaScheme.levelOf(accountCode) !== 'account') {
      throw new Error('Account ' + accountCode + ' is a heading (its code is a class, group or sub-group code): it can' + "'" + 't take postings. Create the account under it instead.');
    }
    if (accountData.CashBank === undefined && !isPostable) ownMark = String(current.OwnCashBank || ''); // not sent (e.g. an import): kept
    if (ownMark && current.AccountType !== 'Asset') throw new Error('Only an Assets group is marked Cash or Bank.');
    const editedMarks = Object.assign({}, existing);
    editedMarks[accountId] = Object.assign({}, current, { IsPostable: isPostable, OwnCashBank: ownMark, ParentAccountID: parentAccountId });
    const cashBank = __coaScheme.markFor(editedMarks[accountId], editedMarks);
    editedMarks[accountId].CashBank = cashBank;

    const record = {
      AccountCode: accountCode,`
  },
  {
    id: 'coa-class-group-edit (store)',
    why: 'The mark stored; the codes it had before (Renumber, coaRenumber.js) kept.',
    find: `      CashFlowCategory: cashFlowCategory,
      Status: status,
      CreatedAt: current.CreatedAt, CreatedBy: current.CreatedBy,`,
    replace: `      CashFlowCategory: cashFlowCategory,
      OwnCashBank: ownMark, CashBank: cashBank, FormerCodes: current.FormerCodes || null, // [NEW DEVELOPMENT coa-class-group-edit]
      Status: status,
      CreatedAt: current.CreatedAt, CreatedBy: current.CreatedBy,`
  },
  {
    id: 'coa-class-group-edit (below)',
    why: 'A heading saved: the accounts under it take its mark (or lose it).',
    find: `    firebaseDbRequest_('coa/' + accountId, 'put', record, idToken);
    return { success: true, accountId: accountId, accountCode: accountCode, codeChangedFrom: codeChangedFrom };`,
    replace: `    firebaseDbRequest_('coa/' + accountId, 'put', record, idToken);
    // [NEW DEVELOPMENT coa-class-group-edit] the accounts under a heading follow its mark.
    if (!isPostable) {
      const below = __coaScheme.marksBelow(accountId, editedMarks);
      const marks = {};
      Object.keys(below).forEach(id => { marks[id + '/CashBank'] = below[id] || ''; });
      if (Object.keys(marks).length) firebaseDbRequest_('coa', 'patch', marks, idToken);
    }
    return { success: true, accountId: accountId, accountCode: accountCode, codeChangedFrom: codeChangedFrom };`
  }
  ,
  {
    id: 'item-custom-category',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/ITEM_CATEGORIES_CUSTOM.md, decisions 203-207). An item may be in a category of your own ' +
      '(itemCategories.js): it keeps the base category it behaves like as its Category (BOM and production rules unchanged), and the category of its own ' +
      'gives its code (its own prefix and sequence) and its sub-categories.',
    find: `    if (!ITEM_CATEGORY_PREFIXES[category]) throw new Error('Select a valid item category.');
`,
    replace: `    if (!ITEM_CATEGORY_PREFIXES[category]) throw new Error('Select a valid item category.');
    // [NEW DEVELOPMENT item-custom-category] docs/modules/ITEM_CATEGORIES_CUSTOM.md
    const customCategoryId = String(itemData.CustomCategoryID || '').trim();
    const customCategory = customCategoryId ? checkItemCategory_(idToken, customCategoryId, category, String(itemData.CompanyID || '').trim(), !itemId) : null;
    const ownCategory = customCategoryId ? 'X-' + customCategoryId : category;
`
  },
  {
    id: 'item-custom-category (sub-category)',
    why: 'A category of your own has its own sub-categories (ParentCategory X-<id>).',
    find: `      if (subCat.ParentCategory !== category) throw new Error('Sub-category does not belong to the selected Category.');`,
    replace: `      if (subCat.ParentCategory !== ownCategory) throw new Error('Sub-category does not belong to the selected Category.'); // [NEW DEVELOPMENT item-custom-category]`
  },
  {
    id: 'item-custom-category (store)',
    why: 'The category of its own stored on the item.',
    find: `      SubCategoryID: subCategoryId,
      UOMID: uomId,`,
    replace: `      SubCategoryID: subCategoryId,
      CustomCategoryID: customCategoryId, // [NEW DEVELOPMENT item-custom-category]
      UOMID: uomId,`
  },
  {
    id: 'item-custom-category (locked)',
    why: 'As the five: an item never changes category (decision 207).',
    find: `      if (existing.Category !== category) throw new Error('Item category cannot be changed after creation.');`,
    replace: `      if (existing.Category !== category || String(existing.CustomCategoryID || '') !== customCategoryId) throw new Error('Item category cannot be changed after creation.'); // [NEW DEVELOPMENT item-custom-category]`
  },
  {
    id: 'item-custom-category (code)',
    why: 'Its own prefix and sequence (decision 204).',
    find: `    const itemCode = generateItemCode_(idToken, category);`,
    replace: `    const itemCode = customCategory ? customItemCode_(idToken, customCategoryId, customCategory) : generateItemCode_(idToken, category); // [NEW DEVELOPMENT item-custom-category]`
  },
  {
    id: 'item-custom-category (sub-category parent)',
    why: 'A sub-category may sit under a category of your own (docs/modules/ITEM_CATEGORIES_CUSTOM.md).',
    find: `    if (!ITEM_CATEGORY_PREFIXES[parentCategory]) throw new Error('Select a valid parent category.');`,
    replace: `    if (!validItemCategoryParent_(idToken, parentCategory)) throw new Error('Select a valid parent category.'); // [NEW DEVELOPMENT item-custom-category]`
  }
  ,
  {
    id: 'invoice-currency (customer save)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/MULTI_CURRENCY.md, decisions 211-218). A foreign customer is invoiced in its own currency: ' +
      'the invoice keeps the currency, the rate on its date (or the user\'s own, with a reason) and its total in base.',
    find: `      SourceDeliveryNotes: sourceDeliveryNotes, DirectLines: directLines,`,
    replace: `      SourceDeliveryNotes: sourceDeliveryNotes, DirectLines: directLines,
      ...(invoiceCurrencyFields_(idToken, customerData, invoiceDate, invoiceData, total, { dns: sourceDeliveryNotes.length > 0 })), // [NEW DEVELOPMENT invoice-currency]
      ProjectID: String(invoiceData.ProjectID || '').trim(), // [NEW DEVELOPMENT projects] the invoice's project, on every line it posts`
  },
  {
    id: 'invoice-currency (vendor save)',
    why: 'As the customer invoice; a foreign vendor\'s invoice takes direct lines only for now (GRNs stay in base, decision 215).',
    find: `      SourceGRNs: sourceGRNs, DirectLines: directLines,`,
    replace: `      SourceGRNs: sourceGRNs, DirectLines: directLines,
      ...(invoiceCurrencyFields_(idToken, vendorData, invoiceDate, invoiceData, total, { grns: sourceGRNs.length > 0 })), // [NEW DEVELOPMENT invoice-currency]
      ProjectID: String(invoiceData.ProjectID || '').trim(), // [NEW DEVELOPMENT projects] the invoice's project, on every line it posts`
  },
  {
    id: 'invoice-currency (vendor post)',
    why: 'Posted in base: each GL line keeps its foreign amount and the rate.',
    find: `    glResult = writeStockGlEntry_(idToken, user, 'VendorInvoice', existing.InvoiceDate, existing.Description, existing.VendorRefNumber,
      glLines,`,
    replace: `    glResult = writeStockGlEntry_(idToken, user, 'VendorInvoice', existing.InvoiceDate, existing.Description, existing.VendorRefNumber,
      linesWithProject_(documentBaseLines_(glLines, existing), existing.ProjectID), // [NEW DEVELOPMENT invoice-currency] [NEW DEVELOPMENT projects]`
  },
  {
    id: 'invoice-currency (customer post)',
    why: 'Posted in base: each GL line keeps its foreign amount and the rate.',
    find: `    glResult = writeStockGlEntry_(idToken, user, 'CustomerInvoice', existing.InvoiceDate, existing.Description, '',
      glLines,`,
    replace: `    glResult = writeStockGlEntry_(idToken, user, 'CustomerInvoice', existing.InvoiceDate, existing.Description, '',
      linesWithProject_(documentBaseLines_(glLines, existing), existing.ProjectID), // [NEW DEVELOPMENT invoice-currency] [NEW DEVELOPMENT projects]`
  },
  {
    id: 'invoice-currency (vendor reversal)',
    why: 'The reversal at the invoice\'s own rate, so it mirrors the invoice exactly.',
    find: `    glResult = writeStockGlEntry_(idToken, user, 'VendorInvoice', date,
      'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, existing.VendorRefNumber,
      glLines,`,
    replace: `    glResult = writeStockGlEntry_(idToken, user, 'VendorInvoice', date,
      'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, existing.VendorRefNumber,
      linesWithProject_(documentBaseLines_(glLines, existing), existing.ProjectID), // [NEW DEVELOPMENT invoice-currency] [NEW DEVELOPMENT projects]`
  },
  {
    id: 'invoice-currency (customer reversal)',
    why: 'The reversal at the invoice\'s own rate, so it mirrors the invoice exactly.',
    find: `    glResult = writeStockGlEntry_(idToken, user, 'CustomerInvoice', date,
      'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, '',
      glLines,`,
    replace: `    glResult = writeStockGlEntry_(idToken, user, 'CustomerInvoice', date,
      'Reversal of ' + (existing.TransactionNumber || '') + ' — ' + existing.Description, '',
      linesWithProject_(documentBaseLines_(glLines, existing), existing.ProjectID), // [NEW DEVELOPMENT invoice-currency] [NEW DEVELOPMENT projects]`
  },
  {
    id: 'invoice-currency (customer reversal record)',
    why: 'The reversal record in the invoice\'s currency, for the statement.',
    find: `    SourceDeliveryNotes: existing.SourceDeliveryNotes || [], DirectLines: existing.DirectLines || [],`,
    replace: `    SourceDeliveryNotes: existing.SourceDeliveryNotes || [], DirectLines: existing.DirectLines || [],
    CurrencyCode: existing.CurrencyCode || '', ExchangeRate: existing.ExchangeRate || 1, TotalBase: existing.TotalBase != null ? existing.TotalBase : existing.Total, // [NEW DEVELOPMENT invoice-currency]`
  },
  {
    id: 'invoice-currency (vendor reversal record)',
    why: 'The reversal record in the invoice\'s currency, for the statement.',
    find: `    SourceGRNs: existing.SourceGRNs || [], DirectLines: existing.DirectLines || [],`,
    replace: `    SourceGRNs: existing.SourceGRNs || [], DirectLines: existing.DirectLines || [],
    CurrencyCode: existing.CurrencyCode || '', ExchangeRate: existing.ExchangeRate || 1, TotalBase: existing.TotalBase != null ? existing.TotalBase : existing.Total, // [NEW DEVELOPMENT invoice-currency]`
  }
  ,
  {
    id: 'invoice-currency (approval amount, vendor)',
    why: 'Approval limits are in the base currency: a foreign invoice is gated on its base total (docs/modules/MULTI_CURRENCY.md).',
    find: `beginApprovalInstance_(idToken, 'VENDORINVOICE', invoiceId, '', scopeKey, existing.Total`,
    replace: `beginApprovalInstance_(idToken, 'VENDORINVOICE', invoiceId, '', scopeKey, (existing.TotalBase != null ? existing.TotalBase : existing.Total)`
  }
  ,
  {
    id: 'invoice-currency (approval amount, vendor reversal)',
    why: 'Approval limits are in the base currency: a foreign invoice is gated on its base total (docs/modules/MULTI_CURRENCY.md).',
    find: `beginApprovalInstance_(idToken, 'VENDORINVOICE', invoiceId, (existing.TransactionNumber || '') + ' (Reversal)', scopeKey, existing.Total`,
    replace: `beginApprovalInstance_(idToken, 'VENDORINVOICE', invoiceId, (existing.TransactionNumber || '') + ' (Reversal)', scopeKey, (existing.TotalBase != null ? existing.TotalBase : existing.Total)`
  }
  ,
  {
    id: 'invoice-currency (approval amount, customer)',
    why: 'Approval limits are in the base currency: a foreign invoice is gated on its base total (docs/modules/MULTI_CURRENCY.md).',
    find: `beginApprovalInstance_(idToken, 'CUSTOMERINVOICE', invoiceId, '', scopeKey, existing.Total`,
    replace: `beginApprovalInstance_(idToken, 'CUSTOMERINVOICE', invoiceId, '', scopeKey, (existing.TotalBase != null ? existing.TotalBase : existing.Total)`
  }
  ,
  {
    id: 'invoice-currency (approval amount, customer reversal)',
    why: 'Approval limits are in the base currency: a foreign invoice is gated on its base total (docs/modules/MULTI_CURRENCY.md).',
    find: `beginApprovalInstance_(idToken, 'CUSTOMERINVOICE', invoiceId, (existing.TransactionNumber || '') + ' (Reversal)', scopeKey, existing.Total`,
    replace: `beginApprovalInstance_(idToken, 'CUSTOMERINVOICE', invoiceId, (existing.TransactionNumber || '') + ' (Reversal)', scopeKey, (existing.TotalBase != null ? existing.TotalBase : existing.Total)`
  }
  ,
  {
    id: 'party-currency-fixed (vendor)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/MULTI_CURRENCY.md, decision 211): a party\'s currency is fixed once it has invoices or payments.',
    find: `    const vendorId = String(vendorData.VendorID || '').trim();`,
    replace: `    const vendorId = String(vendorData.VendorID || '').trim();
    assertPartyCurrencyKept_(idToken, 'Vendor', vendorId, vendorData.DefaultCurrency); // [NEW DEVELOPMENT party-currency-fixed]`
  },
  {
    id: 'party-currency-fixed (customer)',
    why: 'As the vendor (decision 211).',
    find: `    const customerId = String(customerData.CustomerID || '').trim();`,
    replace: `    const customerId = String(customerData.CustomerID || '').trim();
    assertPartyCurrencyKept_(idToken, 'Customer', customerId, customerData.DefaultCurrency); // [NEW DEVELOPMENT party-currency-fixed]`
  }
  ,
  {
    id: 'bank-currency (new)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/MULTI_CURRENCY.md, decision 217): a cash or bank account may carry a currency of its own.',
    find: `      const cashBank = __coaScheme.markFor({ IsPostable: isPostable, OwnCashBank: ownMark, ParentAccountID: parentAccountId }, existing);`,
    replace: `      const cashBank = __coaScheme.markFor({ IsPostable: isPostable, OwnCashBank: ownMark, ParentAccountID: parentAccountId }, existing);
      const accountCurrency = accountCurrency_(idToken, accountData.Currency, isPostable && Boolean(cashBank)); // [NEW DEVELOPMENT bank-currency]`
  },
  {
    id: 'bank-currency (new, store)',
    why: 'As above.',
    find: `        OwnCashBank: ownMark, CashBank: cashBank, // [NEW DEVELOPMENT coa-class-group-new]`,
    replace: `        OwnCashBank: ownMark, CashBank: cashBank, // [NEW DEVELOPMENT coa-class-group-new]
        Currency: accountCurrency, // [NEW DEVELOPMENT bank-currency]`
  },
  {
    id: 'bank-currency (edit)',
    why: 'As above; the currency is fixed once the account has postings.',
    find: `    editedMarks[accountId].CashBank = cashBank;`,
    replace: `    editedMarks[accountId].CashBank = cashBank;
    // [NEW DEVELOPMENT bank-currency] docs/modules/MULTI_CURRENCY.md, decision 217
    const accountCurrency = accountCurrency_(idToken, accountData.Currency === undefined ? current.Currency : accountData.Currency, isPostable && Boolean(cashBank));
    const currencyUsedIn = accountCurrency !== String(current.Currency || '') ? findAccountUsage_(idToken, accountId, current.AccountCode, 1) : [];
    if (currencyUsedIn.length) {
      throw new Error('Account ' + current.AccountCode + ' already has postings in ' + (current.Currency || 'the base currency') + ', so its currency can' + "'" + 't change. Create a new account for the other currency.');
    }`
  },
  {
    id: 'bank-currency (edit, store)',
    why: 'As above.',
    find: `      OwnCashBank: ownMark, CashBank: cashBank, FormerCodes: current.FormerCodes || null, // [NEW DEVELOPMENT coa-class-group-edit]`,
    replace: `      OwnCashBank: ownMark, CashBank: cashBank, FormerCodes: current.FormerCodes || null, // [NEW DEVELOPMENT coa-class-group-edit]
      Currency: accountCurrency, // [NEW DEVELOPMENT bank-currency]`
  }
  ,
  {
    id: 'bank-currency (gl lines)',
    why: 'NEW DEVELOPMENT (decision 217): the posted lines keep their foreign amounts, for the ledger of an account in a foreign currency.',
    find: `        Credit: Number(line.Credit) || 0,
        CostCenterID: line.CostCenterID || '',
        ProfitCenterID: line.ProfitCenterID || ''
      });`,
    replace: `        Credit: Number(line.Credit) || 0,
        CostCenterID: line.CostCenterID || '',
        ProfitCenterID: line.ProfitCenterID || '',
        FcCurrency: line.FcCurrency || '', FcDebit: Number(line.FcDebit) || 0, FcCredit: Number(line.FcCredit) || 0 // [NEW DEVELOPMENT bank-currency]
      });`
  },
  {
    id: 'bank-currency (gl report)',
    why: 'NEW DEVELOPMENT (decision 217): the ledger of a cash or bank account in a foreign currency shows its balance in that currency too.',
    find: `  return {
    account: { AccountCode: account.AccountCode, AccountName: account.AccountName, NormalBalance: account.NormalBalance, IsRollup: isRollup },`,
    replace: `  // [NEW DEVELOPMENT bank-currency] docs/modules/MULTI_CURRENCY.md, decision 217
  const fc = ledgerFcBalances_(isRollup ? '' : account.Currency, allLines, periodLines, fromDate, sign);
  rows.forEach((r, i) => Object.assign(r, fc.rows[i] || {}));
  return {
    fcOpening: fc.opening, fcClosing: fc.closing,
    account: { AccountCode: account.AccountCode, AccountName: account.AccountName, NormalBalance: account.NormalBalance, IsRollup: isRollup, Currency: fc.currency },`
  }
  ,
  {
    id: 'projects (type)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, decision 221): Project, an Organizational Unit type, with a customer, start and end dates; Active or Closed.',
    find: `const ORG_UNIT_TYPES = ['Division', 'Branch', 'Warehouse', 'Rack', 'CostCenter', 'ProfitCenter', 'Location'];`,
    replace: `const ORG_UNIT_TYPES = ['Division', 'Branch', 'Warehouse', 'Rack', 'CostCenter', 'ProfitCenter', 'Location', 'Project']; // [NEW DEVELOPMENT projects]`
  },
  {
    id: 'projects (fields)',
    why: 'As above: a project saves its customer and dates (functions/src/projects.js).',
    find: `    if (!ORG_UNIT_TYPES.includes(type)) throw new Error('Type must be one of: ' + ORG_UNIT_TYPES.join(', ') + '.');`,
    replace: `    if (!ORG_UNIT_TYPES.includes(type)) throw new Error('Type must be one of: ' + ORG_UNIT_TYPES.join(', ') + '.');
    const projectFields = projectFields_(idToken, type, unitData, companyId, status); // [NEW DEVELOPMENT projects]`
  },
  {
    id: 'projects (edit, store)',
    why: 'As above.',
    find: `        Type: type, Code: code, Name: name, ParentUnitID: parentUnitId, CompanyID: companyId, Status: status,
        UpdatedAt: now, UpdatedBy: actor`,
    replace: `        Type: type, Code: code, Name: name, ParentUnitID: parentUnitId, CompanyID: companyId, Status: status,
        ...projectFields, // [NEW DEVELOPMENT projects]
        UpdatedAt: now, UpdatedBy: actor`
  },
  {
    id: 'projects (new, store)',
    why: 'As above.',
    find: `      Type: type, Code: code, Name: name, ParentUnitID: parentUnitId, CompanyID: companyId, Status: status,
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor`,
    replace: `      Type: type, Code: code, Name: name, ParentUnitID: parentUnitId, CompanyID: companyId, Status: status,
      ...projectFields, // [NEW DEVELOPMENT projects]
      CreatedAt: now, CreatedBy: actor, UpdatedAt: now, UpdatedBy: actor`
  }
  ,
  {
    id: 'dimension-rules (new)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, decisions 219-220): an account or heading says whether its lines need a cost center, profit center and project (functions/src/dimensionRules.js).',
    find: `CashBank: cashBank, // [NEW DEVELOPMENT coa-class-group-new]
        Currency: accountCurrency, // [NEW DEVELOPMENT bank-currency]`,
    replace: `CashBank: cashBank, // [NEW DEVELOPMENT coa-class-group-new]
        Currency: accountCurrency, // [NEW DEVELOPMENT bank-currency]
        DimensionRules: cleanDimensionRules_(accountData.DimensionRules), // [NEW DEVELOPMENT dimension-rules]`
  },
  {
    id: 'dimension-rules (edit)',
    why: 'As above; not sent (an import): kept.',
    find: `FormerCodes: current.FormerCodes || null, // [NEW DEVELOPMENT coa-class-group-edit]
      Currency: accountCurrency, // [NEW DEVELOPMENT bank-currency]`,
    replace: `FormerCodes: current.FormerCodes || null, // [NEW DEVELOPMENT coa-class-group-edit]
      Currency: accountCurrency, // [NEW DEVELOPMENT bank-currency]
      DimensionRules: accountData.DimensionRules === undefined ? (current.DimensionRules || null) : cleanDimensionRules_(accountData.DimensionRules), // [NEW DEVELOPMENT dimension-rules]`
  }
  ,
  {
    id: 'dimension-rules (invoice)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, decision 219): the save-time cost center check follows the rule of the revenue account the Sales Types post to, not the account type.',
    find: `    if ((sourceDeliveryNotes.length || itemLines.length) && !costCenterId) { // [PORT CHANGE invoice-item-lines-save]`,
    replace: `    if ((sourceDeliveryNotes.length || itemLines.length) && !costCenterId && needsCostCenter_(idToken, { salesTypeIds: sourceDeliveryNotes.map(d => d.SalesTypeID).concat(itemLines.length ? [itemSalesTypeId] : []) })) { // [PORT CHANGE invoice-item-lines-save] [NEW DEVELOPMENT dimension-rules]`
  },
  {
    id: 'dimension-rules (invoice direct lines)',
    why: 'As above, for the direct lines (each posts to its Sales Type\'s revenue account).',
    find: `    directLines.forEach((l, idx) => {
      if (!l.CostCenterID && !costCenterId) {`,
    replace: `    const directCcSalesTypes = []; // [NEW DEVELOPMENT dimension-rules] the Sales Types whose revenue account needs a cost center
    for (const st of [...new Set(directLines.map(l => l.SalesTypeID))]) { if (needsCostCenter_(idToken, { salesTypeIds: [st] })) directCcSalesTypes.push(st); }
    directLines.forEach((l, idx) => {
      if (!l.CostCenterID && !costCenterId && directCcSalesTypes.includes(l.SalesTypeID)) {`
  },
  {
    id: 'dimension-rules (delivery note)',
    why: 'As above: the Delivery Note line\'s cost of sales account.',
    find: `      if (!lineCostCenterId) throw new Error('Line ' + (idx + 1) + ': Cost Center is required — set one on this line or as the header default.');`,
    replace: `      if (!lineCostCenterId && needsCostCenter_(idToken, { itemIds: [item.ItemID] })) throw new Error('Line ' + (idx + 1) + ': Cost Center is required — set one on this line or as the header default.'); // [NEW DEVELOPMENT dimension-rules]`
  }
  ,
  {
    id: 'projects (report filter)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/PROJECTS_DIMENSIONS.md, "Reports"): the GL report, Trial Balance and P&L filter by project; __none__ is the lines with none (decision 223).',
    find: `    profitCenterId: String(params.ProfitCenterID || '').trim()
  };`,
    replace: `    profitCenterId: String(params.ProfitCenterID || '').trim(),
    projectId: String(params.ProjectID || '').trim() // [NEW DEVELOPMENT projects]
  };`
  },
  {
    id: 'projects (report lines)',
    why: 'As above.',
    find: `      if (f.profitCenterId && line.ProfitCenterID !== f.profitCenterId) return;`,
    replace: `      if (f.profitCenterId && line.ProfitCenterID !== f.profitCenterId) return;
      if (f.projectId && String(line.ProjectID || '') !== (f.projectId === '__none__' ? '' : f.projectId)) return; // [NEW DEVELOPMENT projects]`
  },
  {
    id: 'projects (report line field)',
    why: 'As above: each line\'s project, for the Project report.',
    find: `        FcCurrency: line.FcCurrency || '', FcDebit: Number(line.FcDebit) || 0, FcCredit: Number(line.FcCredit) || 0 // [NEW DEVELOPMENT bank-currency]`,
    replace: `        FcCurrency: line.FcCurrency || '', FcDebit: Number(line.FcDebit) || 0, FcCredit: Number(line.FcCredit) || 0, // [NEW DEVELOPMENT bank-currency]
        ProjectID: line.ProjectID || '' // [NEW DEVELOPMENT projects]`
  }
  ,
  {
    id: 'e-invoicing (customer invoice)',
    why: 'NEW DEVELOPMENT (owner, 2026-10-16; docs/modules/E_INVOICING.md, decisions 225-229): a posted invoice of a company with e-invoicing on gets its PINT AE document built, checked and stored (never holding up the posting).',
    find: `  finalizeCommitAttempt_(idToken, invoiceId, glResult, {}, actor, 'customerInvoices');`,
    replace: `  finalizeCommitAttempt_(idToken, invoiceId, glResult, {}, actor, 'customerInvoices');
  recordEInvoice_(idToken, 'Invoice', invoiceId); // [NEW DEVELOPMENT e-invoicing]`
  }
];
