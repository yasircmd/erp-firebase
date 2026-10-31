// Customer credit control, step C1 (owner, 2026-10-31; docs/modules/
// CREDIT_CONTROL.md, Q360-Q365). New development, hand-written.
//
// Each company's credit limit and credit hold for each customer (Q360,
// Q364), the company's Credit Control Setup (Q361, Q362, Q365) and the
// report of what each customer owes and has coming against its limit. The
// check on Sales Orders and Customer Invoices (Q363) is step C2.
//
//   Firestore creditLimits/{CompanyID}__{CustomerID} { CompanyID, CustomerID,
//     Limit (null: none; 0: cash only; in the company's base currency),
//     Hold (bool), HoldReason, HoldBy, HoldAt, History [{ At, By, What }],
//     UpdatedAt, UpdatedBy }
//   Firestore creditSetup/{CompanyID} { Check: 'Off' | 'Warn' | 'Block',
//     Exposure: 'ReceivableAndOrders' | 'Receivable', GraceDays, UpdatedAt, UpdatedBy }
//
// Exposure (Q361): the receivable from the aging (open invoices less credits
// not applied; cheques in hand stay in it until they clear) and, where the
// company counts them, posted Delivery Notes not yet invoiced and confirmed
// Sales Orders' quantities not yet delivered, at their prices before tax,
// in base at today's rate. Overdue (Q362): open invoices more than the
// company's grace days past their due date.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { salesOrders } = require('./salesStore');
const stockStore = require('./stockStore');
const K = require('./creditCalc');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'CREDITCONTROL';
const SETUP_OPTIONS = { Check: ['Off', 'Warn', 'Block'], Exposure: ['ReceivableAndOrders', 'Receivable'] };
// Off to start: overdue invoices would otherwise stop every company's sales the day the check arrives.
const SETUP_DEFAULTS = { Check: 'Off', Exposure: 'ReceivableAndOrders', GraceDays: 0 };
const OPEN_ORDER = ['Reserved', 'Partially Reserved'];
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const actorOf = user => user.profile.username || user.uid;
const limits = () => firestore.collection('creditLimits');
const setupDoc = companyId => firestore.collection('creditSetup').doc(companyId);
const limitId = (companyId, customerId) => companyId + '__' + customerId;

const DENIED = {
  access: 'You do not have access to Credit Control.',
  write: 'You do not have permission to change credit limits.',
  hold: 'You do not have permission to place or lift a credit hold.',
  setup: 'You do not have permission to change Credit Control Setup.'
};
async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) throw new HttpsError('permission-denied', DENIED[cap]);
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
async function setupOf(companyId) {
  const snap = await setupDoc(companyId).get();
  return Object.assign({}, SETUP_DEFAULTS, snap.exists ? snap.data() : {});
}
async function limitsOf(companyId) {
  const out = {};
  (await limits().where('CompanyID', '==', companyId).get()).docs.forEach(d => { out[d.data().CustomerID] = d.data(); });
  return out;
}
// The customers a company sells to: Active, its own or shared.
function customersOf(all, companyId) {
  return Object.keys(all).filter(id => all[id] && all[id].Status === 'Active' && (!all[id].CompanyID || all[id].CompanyID === companyId));
}

// The rate of a currency (a Currency Configuration record's id) to base today: 1 for base or none.
function rateFinder(currencies, base, today) {
  const cache = {};
  return async currencyId => {
    const code = currencyId && currencies[currencyId] ? currencies[currencyId].Code : '';
    if (!code || !base.Code || code === base.Code) return 1;
    if (!(code in cache)) cache[code] = (await require('./exchangeRates').rateOn(code, today, base)).Rate;
    return cache[code];
  };
}

// Each customer's standing in a company: { rows, today, base }. `only`: these customers.
async function standings(companyId, only) {
  const S = require('./recurringSchedule');
  const today = S.todayIn(S.TIME_ZONE);
  const [setup, held, customers, currencies, base, aging, orders, dns] = await Promise.all([
    setupOf(companyId), limitsOf(companyId), rtdb.ref('customers').get().then(s => s.val() || {}), rtdb.ref('currencies').get().then(s => s.val() || {}),
    require('./exchangeRates').baseCurrency(), require('./agingReports').partyAging('Customer', companyId, today, 'due', only),
    Promise.all(OPEN_ORDER.map(st => salesOrders.query({ CompanyID: companyId, Status: st }))).then(a => Object.assign({}, ...a)),
    stockStore.queryTx({ TransactionType: 'DeliveryNote', Status: 'Posted', CompanyID: companyId })
  ]);
  const rate = rateFinder(currencies, base, today);
  const ids = customersOf(customers, companyId).filter(id => !only || only.includes(id));
  const want = new Set(ids);
  const byCustomer = {};
  const slot = id => (byCustomer[id] = byCustomer[id] || { Orders: 0, Deliveries: 0, OrderDocs: [], DeliveryDocs: [] });
  for (const [id, so] of Object.entries(orders)) {
    if (!want.has(so.CustomerID)) continue;
    const v = K.round2(K.openOrderValue(so) * await rate(so.CurrencyID));
    if (!(v > 0)) continue;
    const s = slot(so.CustomerID);
    s.Orders = K.round2(s.Orders + v);
    s.OrderDocs.push({ ID: id, Number: so.SONumber || '', Date: so.SODate || '', Amount: v });
  }
  for (const [id, dn] of Object.entries(dns)) {
    if (!want.has(dn.CustomerID) || !K.uninvoiced(dn)) continue;
    const soId = ((dn.Lines || []).find(l => l.SourceSOID) || {}).SourceSOID;
    const so = soId ? (orders[soId] || await salesOrders.get(soId)) : null;
    const v = K.round2(K.deliveryValue(dn) * await rate(so ? so.CurrencyID : ''));
    if (!(v > 0)) continue;
    const s = slot(dn.CustomerID);
    s.Deliveries = K.round2(s.Deliveries + v);
    s.DeliveryDocs.push({ ID: id, Number: dn.TransactionNumber || '', Date: dn.TransactionDate || '', Amount: v });
  }
  const agingBy = {};
  (aging.Rows || []).forEach(r => { agingBy[r.PartyID] = r; });
  const rows = ids.map(id => {
    const c = customers[id], a = agingBy[id], s = byCustomer[id] || slot(id), l = held[id] || {};
    const overdue = K.overdueOf(a, setup.GraceDays);
    const row = {
      CustomerID: id, Code: c.CustomerCode || '', Name: c.CustomerName || '', Terms: Number(c.PaymentTermsDays) || 0,
      Limit: K.limitOf(l.Limit), Hold: Boolean(l.Hold), HoldReason: l.HoldReason || '', HoldBy: l.HoldBy || '', HoldAt: l.HoldAt || '',
      Receivable: a ? K.round2(a.Net) : 0, ChequesInHand: a ? K.round2(a.PendingPdc) : 0, Deliveries: s.Deliveries, Orders: s.Orders,
      Overdue: overdue.Amount, OverdueDays: overdue.Days,
      Docs: {
        Receivable: a ? a.Items.map(i => ({ Number: i.Number, Type: i.Type, Date: i.Date, DueDate: i.DueDate, Age: i.Age, Amount: i.BaseOutstanding })) : [],
        Deliveries: s.DeliveryDocs, Orders: s.OrderDocs
      }
    };
    row.Exposure = K.exposureOf(row, setup.Exposure);
    row.Available = row.Limit === null ? null : K.round2(row.Limit - row.Exposure);
    Object.assign(row, K.standing(row, 0));
    return row;
  });
  return { rows: K.sortRows(rows), today, base: base.Code, setup };
}

exports.getCreditControl = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const can = async cap => moduleHasCapability(MODULE_ID, cap, user.profile.role);
  const rights = { canWrite: await can('write'), canHold: await can('hold'), canSetup: await can('setup') };
  const companyId = text(request.data && request.data.companyId, 80);
  if (!companyId) return { rights };
  requireCompany(user, companyId);
  const s = await standings(companyId);
  return { rights, companyId, today: s.today, base: s.base, setup: { Check: s.setup.Check, Exposure: s.setup.Exposure, GraceDays: Number(s.setup.GraceDays) || 0 }, rows: s.rows };
});

// Changes one customer's record in a company, with a line in its history.
async function change(user, companyId, customerId, fields, what) {
  const customer = (await rtdb.ref('customers/' + customerId).get()).val();
  if (!customer) throw new HttpsError('not-found', 'Customer not found.');
  if (customer.CompanyID && customer.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'That customer belongs to a different company.');
  const ref = limits().doc(limitId(companyId, customerId));
  const now = new Date().toISOString(), by = actorOf(user);
  await firestore.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data() || {};
    const history = (cur.History || []).concat([{ At: now, By: by, What: what }]).slice(-100);
    tx.set(ref, Object.assign({ CompanyID: companyId, CustomerID: customerId, Limit: cur.Limit === undefined ? null : cur.Limit, Hold: Boolean(cur.Hold) },
      fields, { History: history, UpdatedAt: now, UpdatedBy: by }));
  });
}
const fmt = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

exports.saveCreditLimit = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  const d = request.data || {};
  const companyId = text(d.companyId, 80), customerId = text(d.customerId, 80);
  requireCompany(user, companyId);
  if (!customerId) throw new HttpsError('invalid-argument', 'Choose a customer.');
  const blank = d.limit === null || d.limit === undefined || String(d.limit).trim() === '';
  const n = Number(d.limit);
  if (!blank && !(Number.isFinite(n) && n >= 0)) throw new HttpsError('invalid-argument', 'A credit limit is an amount of 0 or more, or blank for no limit.');
  const limit = blank ? null : K.round2(n);
  await change(user, companyId, customerId, { Limit: limit }, limit === null ? 'Limit removed' : 'Limit set to ' + fmt(limit));
  return { success: true, limit };
});

exports.setCreditHold = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'hold');
  const d = request.data || {};
  const companyId = text(d.companyId, 80), customerId = text(d.customerId, 80), reason = text(d.reason, 300);
  requireCompany(user, companyId);
  if (!customerId) throw new HttpsError('invalid-argument', 'Choose a customer.');
  const hold = d.hold === true;
  if (hold && !reason) throw new HttpsError('invalid-argument', 'Give the reason for the hold.');
  const now = new Date().toISOString();
  await change(user, companyId, customerId, hold ? { Hold: true, HoldReason: reason, HoldBy: actorOf(user), HoldAt: now } : { Hold: false, HoldReason: '', HoldBy: '', HoldAt: '' },
    hold ? 'Put on hold: ' + reason : 'Hold lifted' + (reason ? ': ' + reason : ''));
  return { success: true, hold };
});

exports.saveCreditSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'setup');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const fields = {};
  for (const [k, options] of Object.entries(SETUP_OPTIONS)) {
    if (d[k] === undefined) continue;
    if (!options.includes(d[k])) throw new HttpsError('invalid-argument', 'Credit Control Setup: ' + k + ' must be one of ' + options.join(', ') + '.');
    fields[k] = d[k];
  }
  if (d.GraceDays !== undefined) {
    const g = Number(d.GraceDays);
    if (!(Number.isInteger(g) && g >= 0 && g <= 365)) throw new HttpsError('invalid-argument', 'Grace days are a whole number from 0 to 365.');
    fields.GraceDays = g;
  }
  if (!Object.keys(fields).length) throw new HttpsError('invalid-argument', 'Nothing to save.');
  await setupDoc(companyId).set(Object.assign(fields, { UpdatedAt: new Date().toISOString(), UpdatedBy: actorOf(user) }), { merge: true });
  return { success: true };
});

// For the check (step C2) and the rep portal.
exports.standings = standings;
exports.setupOf = setupOf;
