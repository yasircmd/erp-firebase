// Documented source patches applied to Code.gs before porting — the ONLY
// place behavior deliberately differs from the Apps Script original.
// Each: { id, why, find, replace } — `find` must match Code.gs exactly
// once (the generator fails loudly otherwise, so a changed original
// can't silently skip a fix). Every entry is also listed in README.md
// under "Deviations from Code.gs".
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
  }
];
