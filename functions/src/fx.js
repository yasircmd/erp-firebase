// Foreign-currency amounts on GL lines (owner, 2026-10-16; docs/modules/
// MULTI_CURRENCY.md, decisions 211-218). New development, hand-written.
//
// A foreign party's documents are in its own currency (fixed per party,
// 211): their amounts, totals and allocations stay in it, so the party
// ledger, SOA and aging work in that currency. Each GL line keeps the
// foreign amount (FcCurrency, FcDebit, FcCredit, FcRate) beside the base
// Debit / Credit, which every report, the Trial Balance and the financial
// statements use.
'use strict';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// The party's currency if it is foreign ('' for the base currency or none).
function partyCurrency(party, baseCode) {
  const c = String((party && party.DefaultCurrency) || '').trim().toUpperCase();
  return c && c !== String(baseCode || '').toUpperCase() ? c : '';
}

// Lines in the foreign currency -> the same lines in base, each keeping its
// foreign amount. The base amounts are rounded per line; the rounding left
// over goes to the largest line of the side that needs it, so the entry
// still balances whenever the foreign lines did.
function toBase(lines, code, rate) {
  const r = Number(rate);
  if (!code) return lines;
  if (!(r > 0)) throw new Error('The exchange rate for ' + code + ' is missing.');
  const out = lines.map(l => {
    const fd = round2(l.Debit), fc = round2(l.Credit);
    return Object.assign({}, l, { Debit: round2(fd * r), Credit: round2(fc * r), FcCurrency: code, FcDebit: fd, FcCredit: fc, FcRate: r });
  });
  const fcDiff = round2(out.reduce((t, l) => t + l.FcDebit - l.FcCredit, 0));
  const diff = round2(out.reduce((t, l) => t + l.Debit - l.Credit, 0));
  if (diff && !fcDiff) {
    const side = diff > 0 ? 'Credit' : 'Debit';
    const big = out.reduce((b, l, i) => (l[side] > (b < 0 ? 0 : out[b][side]) ? i : b), -1);
    if (big >= 0) out[big][side] = round2(out[big][side] + Math.abs(diff));
  }
  return out;
}

// A line's amount in the party's terms: the foreign amount on a foreign
// line, else the base amount.
const lineFc = l => (l && l.FcCurrency ? round2((Number(l.FcDebit) || 0) || (Number(l.FcCredit) || 0)) : round2((Number(l.Debit) || 0) || (Number(l.Credit) || 0)));

// An invoice's currency fields (Customer / Vendor Invoice, patches
// invoice-currency-*): the party's currency and the rate on the invoice
// date, or the user's own rate with a reason (decision 214). Throws Error.
async function invoiceFields(party, date, data, total, opts) {
  const rates = require('./exchangeRates');
  const base = await rates.baseCurrency();
  const code = partyCurrency(party, base.Code);
  if (!code) return { CurrencyCode: '', ExchangeRate: 1, RateEffectiveDate: '', ExchangeRateReason: '', TotalBase: round2(total) };
  if (opts && opts.grns) throw new Error('This vendor is invoiced in ' + code + ': for now a ' + code + ' invoice takes direct lines only (GRNs in a foreign currency come with Purchase Orders, docs/modules/MULTI_CURRENCY.md, decision 215).');
  if (opts && opts.dns) throw new Error('This customer is invoiced in ' + code + ': for now a ' + code + ' invoice takes item lines and direct lines; Delivery Notes made separately are priced in base (Sales Orders and Delivery Notes in a foreign currency come later, docs/modules/MULTI_CURRENCY.md, decision 215).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('Enter the invoice date: the ' + code + ' rate is taken on it.');
  const r = await documentRate(code, date, data, base);
  return Object.assign({ CurrencyCode: code }, r, { TotalBase: round2(total * r.ExchangeRate) });
}
// A document's rate (decision 214): the rate of `code` on its date, or the
// user's own (data.ExchangeRate) with a reason (data.ExchangeRateReason).
async function documentRate(code, date, data, base) {
  const on = await require('./exchangeRates').rateOn(code, date, base);
  let rate = on.Rate, reason = '';
  const own = Number(String((data && data.ExchangeRate) == null ? '' : data.ExchangeRate).replace(/,/g, ''));
  if (own > 0 && Math.abs(own - on.Rate) > 1e-9) {
    reason = String((data && data.ExchangeRateReason) || '').trim().slice(0, 200);
    if (!reason) throw new Error('The rate ' + own + ' differs from the ' + code + ' rate on ' + date + ' (' + on.Rate + '): give the reason.');
    rate = Math.round(own * 1e6) / 1e6;
  }
  return { ExchangeRate: rate, RateEffectiveDate: on.EffectiveDate, ExchangeRateReason: reason };
}

// A cash or bank account's own currency (decision 217; patch bank-currency):
// '' for the base currency or none. Only a postable cash or bank account has
// one. Throws Error.
async function accountCurrency(raw, cashBankPostable) {
  const c = String(raw || '').trim().toUpperCase();
  if (!c) return '';
  const rates = require('./exchangeRates');
  const base = await rates.baseCurrency();
  if (c === base.Code) return '';
  if (!cashBankPostable) throw new Error('Only a cash or bank account (one that takes postings) has a currency of its own.');
  const { rtdb } = require('./firebaseAdmin');
  const cur = Object.values((await rtdb.ref('currencies').get()).val() || {}).find(x => x.Code === c);
  if (!cur || cur.Status !== 'Active') throw new Error('Choose an active currency of Currency Configuration for the account.');
  return c;
}
// The document's GL lines in base, each keeping its foreign amount.
const documentBaseLines = (lines, doc) => (doc && doc.CurrencyCode ? toBase(lines, doc.CurrencyCode, doc.ExchangeRate) : lines);

// A mirrored (reversal) line's foreign fields: the foreign amounts swap with the base ones.
const mirrorFc = l => (l && l.FcCurrency ? { FcCurrency: l.FcCurrency, FcDebit: Number(l.FcCredit) || 0, FcCredit: Number(l.FcDebit) || 0, FcRate: Number(l.FcRate) || 0 } : {});

// A party's currency is fixed once it has documents (decision 211): its
// invoices, payments and statement are all in it. Throws Error.
async function assertPartyCurrencyKept(partyType, partyId, newCurrency) {
  if (!partyId) return;
  const { rtdb, firestore } = require('./firebaseAdmin');
  const cfg = { Vendor: ['vendors', 'vendorInvoices', 'VendorID'], Customer: ['customers', 'customerInvoices', 'CustomerID'] }[partyType];
  const cur = (await rtdb.ref(cfg[0] + '/' + partyId).get()).val();
  if (!cur) return;
  const before = String(cur.DefaultCurrency || '').trim().toUpperCase(), after = String(newCurrency || '').trim().toUpperCase();
  if (before === after) return;
  const invoices = Object.values((await rtdb.ref(cfg[1]).get()).val() || {}).some(i => i && i[cfg[2]] === partyId);
  const entries = await firestore.collection('journalEntries').where('PartyKeys', 'array-contains', partyType + ':' + partyId).limit(1).get();
  if (invoices || !entries.empty) throw new Error('This ' + partyType.toLowerCase() + ' already has invoices or payments in ' + (before || 'the base currency') + ': its currency can\'t change (create a new ' + partyType.toLowerCase() + ' for ' + (after || 'the base currency') + ').');
}

// The ledger of an account in a foreign currency (patch bank-currency):
// its opening, each row's and its closing balance in that currency. Lines
// with no foreign amount (none should reach such an account) count 0.
function ledgerFcBalances(currency, allLines, periodLines, fromDate, sign) {
  if (!currency) return { currency: '', opening: 0, closing: 0, rows: [] };
  const fcNet = l => (l.FcCurrency === currency ? (Number(l.FcDebit) || 0) - (Number(l.FcCredit) || 0) : 0);
  const opening = round2(allLines.filter(l => fromDate && l.JVDate < fromDate).reduce((t, l) => t + sign * fcNet(l), 0));
  let running = opening;
  const rows = periodLines.map(l => {
    running = round2(running + sign * fcNet(l));
    return { FcDebit: l.FcCurrency === currency ? Number(l.FcDebit) || 0 : 0, FcCredit: l.FcCurrency === currency ? Number(l.FcCredit) || 0 : 0, FcBalance: running };
  });
  return { currency, opening, closing: running, rows };
}

module.exports = { partyCurrency, toBase, lineFc, round2, invoiceFields, documentRate, accountCurrency, ledgerFcBalances, documentBaseLines, mirrorFc, assertPartyCurrencyKept };
