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
  }
];
