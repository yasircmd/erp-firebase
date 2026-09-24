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
  }
];
