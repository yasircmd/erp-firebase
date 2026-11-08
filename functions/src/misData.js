// MIS, the readers (owner, 2026-11-08; docs/modules/MIS.md): what the
// report types need from the stores, each read with equality / range
// queries, never a whole corporate's collection. Figures are in the base
// currency. New development, hand-written.
'use strict';
const { rtdb, firestore } = require('./firebaseAdmin');
const { FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const M = require('./misCalc');

const val = p => rtdb.ref(p).get().then(s => s.val() || {});
// A document reversed, or a reversal itself (ReversedByDeliveryNoteID,
// ReversalOfSaleID…): left out, the pair nets to nothing.
const reversedOrReversal = d => Object.keys(d || {}).some(k => /^(ReversalOf|ReversedBy)\w*ID$/.test(k) && d[k]);

// The company's posted GL entries up to `to` (from `from` when given), as
// the Budget reads them: one query on company and date (firestore.indexes.json).
async function postedEntries(companyId, to, from) {
  let q = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).where('CompanyID', '==', companyId).where('JVDate', '<=', to);
  if (from) q = q.where('JVDate', '>=', from);
  return (await q.get()).docs.map(d => d.data()).filter(e => e.Status === 'Posted');
}

// The company's current budget as GL buckets (debit − credit by account and
// month) for the months asked: the approved, current budget of each year
// (budget.js; amounts in each account's natural sign, Q429's "vs budget").
async function budgetBuckets(companyId, months, coa) {
  const snap = await firestore.collection('budgets').where('CompanyID', '==', companyId).get();
  const out = {};
  const credit = t => ['Revenue', 'Liability', 'Equity'].includes(t);
  snap.docs.map(d => d.data()).filter(b => b.Current === true && b.Status === 'Approved' && b.Kind !== 'Project' && b.YearStart).forEach(b => {
    (b.Lines || []).forEach(l => (l.Amounts || []).forEach((amt, i) => {
      const m = M.addMonths(b.YearStart, i);
      if (!months.includes(m) || !amt) return;
      const sign = credit((coa[l.AccountID] || {}).AccountType) ? -1 : 1;
      const k = out[l.AccountID] || (out[l.AccountID] = {});
      k[m] = M.round2((k[m] || 0) + sign * Number(amt));
    }));
  });
  return out;
}

// The parties' control accounts and the items' inventory accounts (the
// ratio map's seed, Q432).
async function controlAccounts() {
  const [customers, vendors, items] = await Promise.all([val('customers'), val('vendors'), val('items')]);
  const ids = (o, f) => [...new Set(Object.values(o).map(x => x && x[f]).filter(Boolean))];
  return { receivableIds: ids(customers, 'TradeReceivablesAccountID'), payableIds: ids(vendors, 'TradePayablesAccountID'), inventoryIds: ids(items, 'InventoryAccountID') };
}

// The financial year's first month (Period Closing's setting, as the Budget reads it).
async function fyStartMonth(companyId) {
  const s = (await rtdb.ref('periodClosing/' + companyId + '/Settings/FiscalYearStart').get()).val();
  const m = Number(String(s || '').slice(5, 7));
  return m >= 1 && m <= 12 ? m : 1;
}

// Stock on hand of the company's items: { itemId: { qty, value, warehouses: { id: { qty, value } } } }.
async function stockOnHand(companyId) {
  const [ledger, items] = await Promise.all([require('./stockStore').allLedger(), val('items')]);
  const out = {};
  Object.keys(ledger).forEach(itemId => {
    const it = items[itemId];
    if (!it || (it.CompanyID && it.CompanyID !== companyId)) return;
    Object.keys(ledger[itemId]).forEach(wh => {
      const e = ledger[itemId][wh] || {};
      const o = out[itemId] || (out[itemId] = { qty: 0, value: 0, warehouses: {} });
      o.qty = M.round2(o.qty + (Number(e.Quantity) || 0)); o.value = M.round2(o.value + (Number(e.TotalValue) || 0));
      o.warehouses[wh] = { qty: Number(e.Quantity) || 0, value: Number(e.TotalValue) || 0 };
    });
  });
  return out;
}

// Quantities sold or issued per item over the months (Q431): the Out lines
// of sales and issues, less returns. Not moves between warehouses,
// adjustments or counts.
const OUT_TYPES = Object.freeze(['DeliveryNote', 'CustomerInvoice', 'RetailSale', 'MaterialIssue', 'Production']);
const RETURN_TYPES = Object.freeze(['SalesReturn', 'RetailReturn']);
async function stockMoved(companyId, months) {
  const stockStore = require('./stockStore');
  const out = {};
  for (const m of months) {
    const txs = await stockStore.queryTx({ CompanyID: companyId, Period: m });
    Object.values(txs || {}).forEach(t => {
      if (!t || t.Status !== 'Posted' || reversedOrReversal(t)) return;
      const sign = OUT_TYPES.includes(t.TransactionType) ? 1 : RETURN_TYPES.includes(t.TransactionType) ? -1 : 0;
      if (!sign) return;
      (Array.isArray(t.Lines) ? t.Lines : Object.values(t.Lines || {})).forEach(l => {
        if (!l || !l.ItemID) return;
        if (sign > 0 && l.Direction && l.Direction !== 'Out') return; // Production's outputs come in
        out[l.ItemID] = M.round2((out[l.ItemID] || 0) + sign * (Number(l.Quantity) || 0));
      });
    });
  }
  return out;
}

// Sales by customer over the months: posted invoices before tax, in base
// ((Subtotal − Discount) × rate), less their returns; reversed invoices
// and their mirrors left out.
async function salesByCustomer(companyId, months) {
  const { customerInvoices } = require('./salesStore');
  const stockStore = require('./stockStore');
  const out = {};
  const add = (id, v) => { out[id] = M.round2((out[id] || 0) + v); };
  for (const m of months) {
    const inv = await customerInvoices.query({ CompanyID: companyId, Period: m });
    Object.values(inv || {}).forEach(i => {
      if (!i || i.Status !== 'Posted' || reversedOrReversal(i)) return;
      add(i.CustomerID || '', ((Number(i.Subtotal) || 0) - (Number(i.Discount) || 0)) * (Number(i.ExchangeRate) || 1));
    });
    const rets = await stockStore.queryTx({ CompanyID: companyId, Period: m, TransactionType: 'SalesReturn' });
    Object.values(rets || {}).forEach(r => {
      if (!r || r.Status !== 'Posted' || reversedOrReversal(r)) return;
      add(r.CustomerID || '', -((Number(r.ReturnValue) || 0) - (Number(r.DiscountAmount) || 0)));
    });
  }
  return out;
}

module.exports = { reversedOrReversal, postedEntries, budgetBuckets, controlAccounts, fyStartMonth, stockOnHand, stockMoved, salesByCustomer, OUT_TYPES, RETURN_TYPES, val };
