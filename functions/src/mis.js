// MIS, the engine (owner, 2026-11-08; docs/modules/MIS.md, Q427-Q434): the
// report catalogue and each report type with its comparison (previous
// month, same month last year, year to date, budget), the MIS setup (the
// ratio map, stock cover's thresholds). The dashboard, saved reports and the
// builder are later phases. New development, hand-written.
//
//   Firestore misSetup/{companyId} { RatioMap: { currentAssets: [ids], ... },
//     StockCover: { fastDays, slowDays, days }, UpdatedAt, UpdatedBy }
//
// Every report answers { type, title, period, columns, rows, chart, notes }:
// rows { key, label, level, current, compare, abs, pct, good } (variance),
// so one screen shows any of them as a table or a chart.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const M = require('./misCalc');
const D = require('./misData');

const onCallOptions = { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' };
const MODULE_ID = 'MIS';
const SETUP = id => firestore.collection('misSetup').doc(id);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);

// The catalogue (Q427): each type, what it shows, its default chart.
const CATALOGUE = Object.freeze([
  { type: 'kpis', title: 'Key figures', group: 'Dashboard', chart: 'none' },
  { type: 'profitLoss', title: 'Profit and Loss', group: 'Financial', chart: 'bar' },
  { type: 'balanceSheet', title: 'Balance Sheet', group: 'Financial', chart: 'bar' },
  { type: 'cashFlow', title: 'Cash Flow', group: 'Financial', chart: 'bar' },
  { type: 'ratios', title: 'Financial ratios', group: 'Financial', chart: 'none' },
  { type: 'bankBalances', title: 'Bank and cash balances', group: 'Financial', chart: 'bar' },
  { type: 'expenses', title: 'Expenses by account', group: 'Financial', chart: 'pie' },
  { type: 'trend', title: '12-month trend', group: 'Financial', chart: 'line' },
  { type: 'receivables', title: 'Accounts receivable', group: 'Parties', chart: 'pie' },
  { type: 'payables', title: 'Accounts payable', group: 'Parties', chart: 'pie' },
  { type: 'salesByCustomer', title: 'Sales by customer', group: 'Sales', chart: 'bar' },
  { type: 'salesByRep', title: 'Sales by rep', group: 'Sales', chart: 'bar' },
  { type: 'stockInHand', title: 'Stock in hand', group: 'Stock', chart: 'pie' },
  { type: 'stockCover', title: 'Fast, slow and non-moving stock', group: 'Stock', chart: 'pie' }
]);
const MODE_LABEL = Object.freeze({ prevMonth: 'vs previous month', lastYear: 'vs same month last year', ytd: 'year to date vs last year', budget: 'vs budget' });

async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to MIS reports.');
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}

// The company's setup: saved, or seeded from the chart (Q432).
async function setupFor(companyId, coa) {
  const s = await SETUP(companyId).get();
  const saved = s.exists ? s.data() : {};
  const seeded = M.seedRatioMap(coa, companyId, await D.controlAccounts());
  return {
    RatioMap: Object.assign({}, seeded, saved.RatioMap || {}), Seeded: !saved.RatioMap,
    StockCover: Object.assign({ fastDays: 30, slowDays: 90, days: 90 }, saved.StockCover || {})
  };
}

const row = (key, label, cur, cmp, sense, level) => Object.assign({ key, label, level: level || 0 }, M.variance(cur, cmp, sense));

// ---------- the report types ----------
async function build(type, ctx) {
  const { companyId, coa, per } = ctx;
  const groups = M.accountsByGroup(coa, companyId);
  const glFor = async (needBalances) => {
    const from = needBalances ? '' : [per.current.from, per.compare.from].sort()[0];
    return M.glBuckets(await D.postedEntries(companyId, per.current.to, from));
  };
  const cmpBuckets = async (buckets) => (per.compare.budget ? D.budgetBuckets(companyId, per.compare.months, coa) : buckets);
  const lastOf = p => p.months[p.months.length - 1];
  const name = id => (coa[id] ? String(coa[id].AccountCode || '') + ' ' + (coa[id].AccountName || '') : id);

  if (type === 'profitLoss') {
    const b = await glFor(false), cb = await cmpBuckets(b);
    const c = M.profitAndLoss(b, groups, per.current.months), p = M.profitAndLoss(cb, groups, per.compare.months);
    return { rows: [row('revenue', 'Revenue', c.revenue, p.revenue, 'up'), row('cogs', 'Cost of sales', c.cogs, p.cogs, 'down'),
      row('grossProfit', 'Gross profit', c.grossProfit, p.grossProfit, 'up', 1), row('expenses', 'Expenses', c.expenses, p.expenses, 'down'),
      row('netProfit', 'Net profit', c.netProfit, p.netProfit, 'up', 1)] };
  }
  if (type === 'expenses') {
    const b = await glFor(false), cb = await cmpBuckets(b);
    const rows = groups.expenses.concat(groups.cogs).map(id => row(id, name(id), M.movement(b, [id], per.current.months), M.movement(cb, [id], per.compare.months), 'down'))
      .filter(r => r.current || r.compare).sort((a, z) => z.current - a.current);
    return { rows: rows.slice(0, ctx.top || 50) };
  }
  if (type === 'balanceSheet') {
    if (per.compare.budget) throw new HttpsError('failed-precondition', 'The Balance Sheet compares with another month, not a budget.');
    const b = await glFor(true);
    const c = M.balanceSheet(b, groups, lastOf(per.current)), p = M.balanceSheet(b, groups, lastOf(per.compare));
    return { rows: [row('assets', 'Assets', c.assets, p.assets, 'up'), row('liabilities', 'Liabilities', c.liabilities, p.liabilities, 'down'),
      row('equity', 'Equity (with this year\'s profit)', c.equity, p.equity, 'up'), row('check', 'Assets − liabilities − equity', c.check, p.check, 'none', 1)] };
  }
  if (type === 'bankBalances') {
    const b = await glFor(true);
    const cash = groups.assets.filter(id => coa[id].CashBank === 'Cash' || coa[id].CashBank === 'Bank');
    const rows = cash.map(id => row(id, name(id), M.balanceTo(b, [id], lastOf(per.current)), M.balanceTo(b, [id], lastOf(per.compare)), 'up'));
    const tot = (k) => M.round2(rows.reduce((s, r) => s + r[k], 0));
    return { rows: rows.concat([row('total', 'Total', tot('current'), tot('compare'), 'up', 1)]) };
  }
  if (type === 'cashFlow') {
    // Direct method: the cash and bank accounts' movement, by the other side
    // of each entry: operating (P&L and current accounts), investing (other
    // assets), financing (equity and other liabilities).
    const setup = await setupFor(companyId, coa);
    const cash = new Set(groups.assets.filter(id => coa[id].CashBank === 'Cash' || coa[id].CashBank === 'Bank'));
    const current = new Set([].concat(setup.RatioMap.currentAssets || [], setup.RatioMap.currentLiabilities || []));
    const section = id => { const t = (coa[id] || {}).AccountType; if (['Revenue', 'COGS', 'Expense'].includes(t) || current.has(id)) return 'operating'; return t === 'Asset' ? 'investing' : 'financing'; };
    const flows = async (p) => {
      const out = { operating: 0, investing: 0, financing: 0 };
      (await D.postedEntries(companyId, p.to, p.from)).forEach(e => {
        const lines = e.Lines || [];
        const net = lines.filter(l => cash.has(l.AccountID)).reduce((s, l) => s + (Number(l.Debit) || 0) - (Number(l.Credit) || 0), 0);
        if (!net) return;
        const others = lines.filter(l => !cash.has(l.AccountID));
        const weight = others.reduce((s, l) => s + Math.abs((Number(l.Debit) || 0) - (Number(l.Credit) || 0)), 0) || 1;
        others.forEach(l => { out[section(l.AccountID)] += net * Math.abs((Number(l.Debit) || 0) - (Number(l.Credit) || 0)) / weight; });
      });
      Object.keys(out).forEach(k => { out[k] = M.round2(out[k]); });
      return out;
    };
    if (per.compare.budget) throw new HttpsError('failed-precondition', 'Cash Flow compares with another period, not a budget.');
    const [c, p] = await Promise.all([flows(per.current), flows(per.compare)]);
    const net = o => M.round2(o.operating + o.investing + o.financing);
    return { rows: [row('operating', 'Operating', c.operating, p.operating, 'up'), row('investing', 'Investing', c.investing, p.investing, 'none'),
      row('financing', 'Financing', c.financing, p.financing, 'none'), row('net', 'Net cash flow', net(c), net(p), 'up', 1)] };
  }
  if (type === 'ratios') {
    const b = await glFor(true), cb = await cmpBuckets(b);
    const map = (await setupFor(companyId, coa)).RatioMap;
    const c = M.ratios(b, groups, map, per.current.months, lastOf(per.current)), p = M.ratios(cb, groups, map, per.compare.months, lastOf(per.compare));
    return { rows: M.RATIOS.map(r => Object.assign(row(r.key, r.label, c[r.key], p[r.key], r.sense), { unit: r.unit, current: c[r.key], compare: p[r.key] })) };
  }
  if (type === 'trend') {
    const months = M.monthsBetween(M.addMonths(lastOf(per.current), -11), lastOf(per.current));
    const b = M.glBuckets(await D.postedEntries(companyId, per.current.to, months[0] + '-01'));
    const rows = months.map(m => { const pl = M.profitAndLoss(b, groups, [m]); return { key: m, label: m, revenue: pl.revenue, expenses: M.round2(pl.cogs + pl.expenses), netProfit: pl.netProfit }; });
    return { rows, series: ['revenue', 'expenses', 'netProfit'] };
  }
  if (type === 'receivables' || type === 'payables') {
    const { partyAging } = require('./agingReports');
    const pt = type === 'receivables' ? 'Customer' : 'Vendor';
    const [c, p] = await Promise.all([partyAging(pt, companyId, per.current.to, 'due'), partyAging(pt, companyId, per.compare.to, 'due')]);
    const prev = Object.fromEntries((p.Rows || []).map(r => [r.PartyID, r.Net || 0]));
    const rows = (c.Rows || []).map(r => row(r.PartyID, r.Name || r.Code || r.PartyID, r.Net || 0, prev[r.PartyID] || 0, 'none')).sort((a, z) => z.current - a.current);
    const buckets = (c.Buckets || []).map(bk => ({ key: bk.key, label: bk.label, amount: M.round2((c.Totals || {})[bk.key] || 0) }));
    return { rows: rows.slice(0, ctx.top || 20).concat([row('total', 'Total', (c.Totals || {}).Net || 0, (p.Totals || {}).Net || 0, 'none', 1)]), buckets };
  }
  if (type === 'salesByCustomer') {
    if (per.compare.budget) throw new HttpsError('failed-precondition', 'Sales by customer compares with another period, not a budget.');
    const [c, p, customers] = await Promise.all([D.salesByCustomer(companyId, per.current.months), D.salesByCustomer(companyId, per.compare.months), D.val('customers')]);
    const ids = [...new Set(Object.keys(c).concat(Object.keys(p)))];
    const rows = ids.map(id => row(id, (customers[id] || {}).CustomerName || id || '(none)', c[id] || 0, p[id] || 0, 'up')).sort((a, z) => z.current - a.current);
    const tot = k => M.round2(rows.reduce((s, r) => s + r[k], 0));
    return { rows: rows.slice(0, ctx.top || 20).concat([row('total', 'Total', tot('current'), tot('compare'), 'up', 1)]) };
  }
  if (type === 'salesByRep') {
    if (per.compare.budget) throw new HttpsError('failed-precondition', 'Sales by rep compares with another period, not a budget.');
    const [c, p] = await Promise.all([D.salesByRep(companyId, per.current.months), D.salesByRep(companyId, per.compare.months)]);
    const ids = [...new Set(Object.keys(c).concat(Object.keys(p)))];
    const reps = await require('./salesRep').repParties(ids.filter(Boolean));
    const rows = ids.map(id => row(id || 'none', id ? ((reps[id] || {}).RepName || id) : 'No rep', c[id] || 0, p[id] || 0, 'up')).sort((a, z) => z.current - a.current);
    const tot = k => M.round2(rows.reduce((s, r) => s + r[k], 0));
    return { rows: rows.slice(0, ctx.top || 20).concat([row('total', 'Total', tot('current'), tot('compare'), 'up', 1)]),
      notes: ['Each document\'s own rep: invoices and retail sales before tax, less their returns. Documents made before the rep field have none.'] };
  }
  if (type === 'stockInHand') {
    const onHand = await D.stockOnHand(companyId);
    const items = await require('./itemStore').forReport(Object.keys(onHand), ''); // only the items in hand (ITEMS_FIRESTORE.md)
    const by = {};
    Object.keys(onHand).forEach(id => { const k = (items[id] || {}).Category || 'Other'; by[k] = M.round2((by[k] || 0) + onHand[id].value); });
    const rows = Object.keys(by).sort().map(k => Object.assign(row(k, k, by[k], 0, 'none'), { compare: null, abs: null, pct: null }));
    const total = M.round2(Object.values(by).reduce((s, v) => s + v, 0));
    return { rows: rows.concat([Object.assign(row('total', 'Total', total, 0, 'none', 1), { compare: null, abs: null, pct: null })]), notes: ['Stock in hand is today\'s; it has no comparison.'] };
  }
  if (type === 'stockCover') {
    const setup = await setupFor(companyId, coa);
    const t = setup.StockCover;
    const months = M.monthsBetween(M.monthOf(new Date(Date.now() - t.days * 86400000).toISOString()), M.monthOf(new Date().toISOString()));
    const [onHand, moved] = await Promise.all([D.stockOnHand(companyId), D.stockMoved(companyId, months)]);
    const ids = [...new Set(Object.keys(onHand).concat(Object.keys(moved)))];
    const items = await require('./itemStore').forReport(ids, ''); // only these items (ITEMS_FIRESTORE.md)
    const list = ids.map(id => {
      const c = M.stockCover((onHand[id] || {}).qty || 0, moved[id] || 0, t.days, t);
      return { key: id, label: ((items[id] || {}).ItemCode || id) + ' ' + ((items[id] || {}).ItemName || ''), onHand: (onHand[id] || {}).qty || 0, value: (onHand[id] || {}).value || 0, moved: moved[id] || 0, cover: c.cover, class: c.class };
    }).filter(x => x.class !== 'none');
    const counts = ['fast', 'normal', 'slow', 'nonMoving'].map(k => ({ key: k, count: list.filter(x => x.class === k).length, value: M.round2(list.filter(x => x.class === k).reduce((s, x) => s + x.value, 0)) }));
    return { rows: list.sort((a, z) => (z.cover == null) - (a.cover == null) || (z.cover || 0) - (a.cover || 0)), classes: counts, thresholds: t,
      notes: ['Days of cover: stock on hand ÷ the average daily quantity sold or issued over the last ' + t.days + ' days.'] };
  }
  if (type === 'kpis') {
    const b = await glFor(true), cb = await cmpBuckets(b);
    const c = M.profitAndLoss(b, groups, per.current.months), p = M.profitAndLoss(cb, groups, per.compare.months);
    const map = (await setupFor(companyId, coa)).RatioMap;
    const bal = (bk, ids, sign) => M.round2((sign || 1) * M.balanceTo(bk, ids || [], lastOf(per.current)));
    const balP = (bk, ids, sign) => M.round2((sign || 1) * M.balanceTo(bk, ids || [], lastOf(per.compare)));
    const cashIds = groups.assets.filter(id => coa[id].CashBank === 'Cash' || coa[id].CashBank === 'Bank');
    const balRows = per.compare.budget ? [] : [
      row('bank', 'Bank and cash', bal(b, cashIds), balP(b, cashIds), 'up'),
      row('receivables', 'Receivables', bal(b, map.receivables), balP(b, map.receivables), 'none'),
      row('payables', 'Payables', bal(b, map.payables, -1), balP(b, map.payables, -1), 'none'),
      row('stock', 'Stock value', bal(b, map.inventory), balP(b, map.inventory), 'none')];
    return { rows: [row('sales', 'Sales (revenue)', c.revenue, p.revenue, 'up'), row('expenses', 'Expenses (with cost of sales)', M.round2(c.cogs + c.expenses), M.round2(p.cogs + p.expenses), 'down'),
      row('netProfit', 'Net profit', c.netProfit, p.netProfit, 'up')].concat(balRows) };
  }
  throw new HttpsError('invalid-argument', 'Unknown report: ' + type + '.');
}

// ---------- callables ----------
exports.getMisCatalogue = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  return { catalogue: CATALOGUE, modes: M.MODES.map(m => ({ mode: m, label: MODE_LABEL[m] })),
    rights: { design: await moduleHasCapability(MODULE_ID, 'design', user.profile.role), publish: await moduleHasCapability(MODULE_ID, 'publish', user.profile.role) } };
});

// One report: { type, companyId, month (yyyy-mm), mode, top }.
exports.runMisReport = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const type = text(d.type, 40);
  const def = CATALOGUE.find(c => c.type === type);
  if (!def) throw new HttpsError('invalid-argument', 'Unknown report: ' + type + '.');
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const month = text(d.month, 7) || M.monthOf(new Date().toISOString());
  let per;
  try { per = M.periods(month, text(d.mode, 20) || 'prevMonth', await D.fyStartMonth(companyId)); } catch (e) { throw new HttpsError('invalid-argument', e.message); }
  const coa = await D.val('coa');
  // top: the rows asked for; 0 is each report's own default (not 1, as before 2026-11-08).
  const out = await build(type, { companyId, coa, per, top: Number(d.top) >= 1 ? Math.min(200, Math.floor(Number(d.top))) : 0 });
  return Object.assign({ type, title: def.title, chart: def.chart, mode: per.mode, modeLabel: MODE_LABEL[per.mode],
    period: { current: per.current.label, compare: per.compare.label } }, out);
});

exports.getMisSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const companyId = text(request.data && request.data.companyId, 80);
  requireCompany(user, companyId);
  const coa = await D.val('coa');
  const g = M.accountsByGroup(coa, companyId);
  const acc = ids => ids.map(id => ({ AccountID: id, AccountCode: String(coa[id].AccountCode || ''), AccountName: coa[id].AccountName || '' })).sort((a, b) => a.AccountCode.localeCompare(b.AccountCode, undefined, { numeric: true }));
  return Object.assign(await setupFor(companyId, coa), { assets: acc(g.assets), liabilities: acc(g.liabilities), canEdit: await moduleHasCapability(MODULE_ID, 'publish', user.profile.role) });
});

// The ratio map and stock cover's thresholds (Finance: the publish right).
exports.saveMisSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'publish');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const coa = await D.val('coa');
  const g = M.accountsByGroup(coa, companyId);
  const KEYS = { currentAssets: g.assets, inventory: g.assets, cash: g.assets, receivables: g.assets, currentLiabilities: g.liabilities, payables: g.liabilities };
  const map = {};
  Object.keys(KEYS).forEach(k => {
    const ids = [...new Set((Array.isArray(d.RatioMap && d.RatioMap[k]) ? d.RatioMap[k] : []).map(x => text(x, 80)))];
    const bad = ids.filter(id => !KEYS[k].includes(id));
    if (bad.length) throw new HttpsError('invalid-argument', 'Not ' + (KEYS[k] === g.assets ? 'an asset' : 'a liability') + ' account of the company: ' + bad.map(id => (coa[id] || {}).AccountCode || id).join(', ') + '.');
    map[k] = ids.sort();
  });
  const sc = d.StockCover || {};
  const fast = Number(sc.fastDays), slow = Number(sc.slowDays), days = Number(sc.days);
  if (!(fast > 0 && slow > fast && days >= 7 && days <= 730)) throw new HttpsError('invalid-argument', 'Stock cover: fast under slow days, both above 0, over a period of 7 to 730 days.');
  await SETUP(companyId).set({ RatioMap: map, StockCover: { fastDays: fast, slowDays: slow, days }, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

module.exports.CATALOGUE = CATALOGUE;
module.exports.build = build;
