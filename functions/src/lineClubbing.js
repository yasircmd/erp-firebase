// One line per identical posting (owner, 2026-10-02; docs/modules/LINE_CLUBBING.md).
// A document with many lines used to post one GL line per document line,
// and the Stock Ledger report showed one row per line. Lines are now
// clubbed into one when everything that tells them apart is the same:
//   GL:           account, debit-or-credit side, cost center, profit
//                 center and description
//   Stock Ledger: (one document, one item at one warehouse) direction,
//                 cost center, profit center and description
// Anything different stays its own line (owner: "if description is
// different, it should be separate line"). Debits and credits are never
// netted. A line tagged with a vendor or customer (and its allocations) is
// never clubbed.
'use strict';
const round2 = n => Math.round(n * 100) / 100;
const round6 = n => Math.round(n * 1e6) / 1e6;
const text = v => String(v == null ? '' : v).trim();

// Raw GL lines ({ AccountCode, Debit, Credit, Description, CostCenterID,
// ProfitCenterID, ... }) -> the same lines, identical ones summed, in the
// order each first appears.
function clubGlLines(rawLines) {
  const out = [];
  const at = new Map();
  (rawLines || []).forEach(l => {
    const debit = Number(l.Debit) || 0, credit = Number(l.Credit) || 0;
    if (l.PartyType || !text(l.AccountCode) || (debit > 0) === (credit > 0)) { out.push(l); return; }
    // In a foreign currency (docs/modules/MULTI_CURRENCY.md): clubbed only with the same currency and rate, its own amounts summed too.
    const key = [text(l.AccountCode), debit > 0 ? 'Dr' : 'Cr', text(l.CostCenterID), text(l.ProfitCenterID), text(l.ProjectID), text(l.Description), text(l.FcCurrency), l.FcCurrency ? Number(l.FcRate) || 0 : '', l.FxAdjustment ? 'fx' : ''].join('\u0001');
    if (!at.has(key)) { at.set(key, out.length); out.push(Object.assign({}, l, { Debit: debit, Credit: credit })); return; }
    const c = out[at.get(key)];
    c.Debit = round2(c.Debit + debit);
    c.Credit = round2(c.Credit + credit);
    if (l.FcCurrency) { c.FcDebit = round2((Number(c.FcDebit) || 0) + (Number(l.FcDebit) || 0)); c.FcCredit = round2((Number(c.FcCredit) || 0) + (Number(l.FcCredit) || 0)); }
  });
  return out;
}

// One document's stock lines for one item at one warehouse -> one row per
// direction, cost center, profit center and description: quantities and
// values summed, the unit cost their average.
function clubStockLines(lines) {
  const out = [];
  const at = new Map();
  (lines || []).forEach(l => {
    const qty = Number(l.Quantity) || 0;
    const value = l.TotalValue != null ? Number(l.TotalValue) : round2(qty * (Number(l.UnitCost) || 0));
    const key = [l.Direction, text(l.CostCenterID), text(l.ProfitCenterID), text(l.Description)].join('\u0001');
    if (!at.has(key)) { at.set(key, out.length); out.push(Object.assign({}, l, { Quantity: qty, TotalValue: value })); return; }
    const c = out[at.get(key)];
    c.Quantity = round6(c.Quantity + qty);
    c.TotalValue = round2(c.TotalValue + value);
    c.UnitCost = c.Quantity > 0.000001 ? Math.round((c.TotalValue / c.Quantity) * 10000) / 10000 : 0;
  });
  return out;
}

module.exports = { clubGlLines, clubStockLines };
