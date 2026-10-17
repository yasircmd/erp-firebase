// Sales reps in the Employee Portal (owner, 2026-10-16; docs/modules/
// SALES_REP_PORTAL.md, decisions 230-236). New development, hand-written.
//
// The office marks an employee as a sales rep of a company (with the cash
// account their cash collections go to) and gives each customer its rep, in
// Sales Invoice Configuration. In the portal a rep then sees their own
// customers (a sales manager sees all the company's, decision 230), with
// each one's balance and overdue amount; places an order, saved as a DRAFT
// Sales Order the office confirms (231), at the customer's price list only
// (234), seeing the stock free to sell (235); and records a collection: cash
// as a DRAFT Cash Receipt to the rep's cash account, a cheque as a DRAFT PDC
// Received with its photo, both posted by the office (232). Online only (233).
//
//   salesReps/{employeeId} { CompanyID, Active, IsManager, CashAccountID, UpdatedAt, UpdatedBy }
//   customers/{id}.SalesRepEmployeeID
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const coaScheme = require('./coaScheme');
const { salesOrders } = require('./salesStore');

const onCallOptions = { region: 'us-central1' };
const REPS = 'salesReps';
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const val = async p => (await rtdb.ref(p).get()).val();
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const failed = msg => new HttpsError('failed-precondition', msg);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const today = () => todayIn('Asia/Dubai');
const L = () => require('./legacy/codegs');
const CTX = {}; // the legacy helpers below only read the database

// ---------- the office: Sales Invoice Configuration → Sales reps ----------

async function requireSetup(user, cap, companyId) {
  if (!(await moduleHasCapability('SALESINVOICESETUP', cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change Sales Invoice Configuration.' : 'You do not have access to Sales Invoice Configuration.');
  }
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
const cashAccountsOf = (coa, co) => Object.keys(coa || {}).filter(id => coa[id].Status === 'Active' && coa[id].IsPostable === true && coaScheme.kindOf(coa[id]) === 'Cash' &&
  (!coa[id].CompanyID || coa[id].CompanyID === co)).map(id => ({ AccountID: id, AccountCode: coa[id].AccountCode, AccountName: coa[id].AccountName }));

exports.getSalesReps = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const co = text((request.data || {}).companyId, 80);
  await requireSetup(user, 'access', co);
  const [reps, customers, coa, emps] = await Promise.all([val(REPS), val('customers'), val('coa'), firestore.collection('employees').where('CompanyID', '==', co).get()]);
  const employees = emps.docs.map(d => Object.assign({ EmployeeID: d.id }, d.data())).filter(e => e.Status !== 'Left')
    .map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo || '', FullName: e.FullName || '' })).sort((a, b) => a.FullName.localeCompare(b.FullName));
  const custs = Object.keys(customers || {}).filter(id => customers[id].Status === 'Active' && (!customers[id].CompanyID || customers[id].CompanyID === co))
    .map(id => ({ CustomerID: id, Code: customers[id].CustomerCode || '', Name: customers[id].CustomerName || '', SalesRepEmployeeID: customers[id].SalesRepEmployeeID || '' }));
  const list = Object.keys(reps || {}).filter(id => reps[id].CompanyID === co).map(id => Object.assign({ EmployeeID: id }, reps[id],
    { Employee: employees.find(e => e.EmployeeID === id) || null, Customers: custs.filter(c => c.SalesRepEmployeeID === id).map(c => c.CustomerID) }));
  return { reps: list, employees, customers: custs, cashAccounts: cashAccountsOf(coa, co), canWrite: await moduleHasCapability('SALESINVOICESETUP', 'write', user.profile.role) };
});

exports.saveSalesRep = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = text(d.companyId, 80);
  await requireSetup(user, 'write', co);
  const empId = text(d.employeeId, 80);
  const emp = (await firestore.collection('employees').doc(empId || '-').get()).data();
  if (!emp || emp.CompanyID !== co) bad('Choose an employee of the company.');
  const cashAccountId = text(d.cashAccountId, 80);
  if (cashAccountId && !cashAccountsOf(await val('coa'), co).some(a => a.AccountID === cashAccountId)) bad('Choose a cash account of the company for the rep\'s cash collections.');
  const customers = (await val('customers')) || {};
  const ids = [...new Set((Array.isArray(d.customerIds) ? d.customerIds : []).map(x => text(x, 80)))];
  ids.forEach(id => { const c = customers[id]; if (!c || (c.CompanyID && c.CompanyID !== co)) bad('Choose customers of the company.'); });
  await rtdb.ref(REPS + '/' + empId).set({ CompanyID: co, Active: d.active !== false, IsManager: d.isManager === true, CashAccountID: cashAccountId,
    UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  // Each customer has one rep: these are now this rep's, and only these.
  const updates = {};
  Object.keys(customers).forEach(id => {
    const mine = customers[id].SalesRepEmployeeID === empId, wanted = ids.includes(id);
    if (wanted && !mine) updates[id + '/SalesRepEmployeeID'] = empId;
    if (!wanted && mine) updates[id + '/SalesRepEmployeeID'] = '';
  });
  if (Object.keys(updates).length) await rtdb.ref('customers').update(updates);
  return { success: true };
});

// ---------- the portal (essPortal.js actions; `me` is the signed-in employee) ----------

// The rep's record, or null for an employee who isn't one.
async function repOf(me) {
  const r = await val(REPS + '/' + me.emp.EmployeeID);
  return r && r.Active !== false && r.CompanyID === me.emp.CompanyID ? r : null;
}
async function requireRep(me) {
  const r = await repOf(me);
  if (!r) throw failed('You are not set up as a sales rep: ask the office (Sales Invoice Configuration → Sales reps).');
  return r;
}
const actorOf = me => 'Portal: ' + (me.emp.EmployeeNo || me.emp.EmployeeID) + ' ' + (me.emp.FullName || '');
const portalRep = me => ({ actor: actorOf(me), companyId: me.emp.CompanyID });

// The customers the rep may serve (decision 230).
async function myCustomers(me, rep) {
  const all = (await val('customers')) || {};
  return Object.keys(all).filter(id => all[id].Status === 'Active' && (!all[id].CompanyID || all[id].CompanyID === me.emp.CompanyID) &&
    (rep.IsManager || all[id].SalesRepEmployeeID === me.emp.EmployeeID)).map(id => Object.assign({ CustomerID: id }, all[id]));
}
async function requireMyCustomer(me, rep, customerId) {
  const c = (await myCustomers(me, rep)).find(x => x.CustomerID === text(customerId, 80));
  if (!c) throw new HttpsError('permission-denied', 'That customer is not one of yours.');
  return c;
}

// My customers, each with its balance and what is overdue (from the aging).
async function salesHome(me) {
  const rep = await requireRep(me);
  const customers = await myCustomers(me, rep);
  const aging = customers.length ? await require('./agingReports').partyAging('Customer', me.emp.CompanyID, today(), 'due', customers.map(c => c.CustomerID)) : { Rows: [] };
  const byId = new Map((aging.Rows || []).map(r => [r.PartyID, r]));
  const drafts = await myDrafts(me);
  return {
    isManager: Boolean(rep.IsManager), today: today(),
    customers: customers.map(c => {
      const r = byId.get(c.CustomerID) || { Net: 0, Buckets: {} };
      const overdue = round2(Object.keys(r.Buckets || {}).filter(k => k !== 'notDue').reduce((s, k) => s + (Number(r.Buckets[k]) || 0), 0));
      return { CustomerID: c.CustomerID, Code: c.CustomerCode || '', Name: c.CustomerName || '', Phone: c.Phone || '', Balance: round2(r.Net), Overdue: overdue, Currency: r.Currency || '' };
    }).sort((a, b) => a.Name.localeCompare(b.Name)),
    activity: drafts
  };
}

// For a new order: the customer's price list items at today's price, with
// the stock free to sell in each of the company's warehouses (decisions 234-235).
async function salesItems(me, d) {
  const rep = await requireRep(me);
  const customer = await requireMyCustomer(me, rep, d.customerId);
  const priceList = await L().resolvePriceListForClassification_(CTX, me.emp.CompanyID, customer.Classification || '');
  if (!priceList) throw failed('This customer has no price list (Price Listing, by its classification): the office prices its orders.');
  const [byItem, items, units] = await Promise.all([L().groupPriceListLinesByItem_(CTX, priceList.PriceListID), val('items'), val('orgUnits')]);
  const warehouses = Object.keys(units || {}).filter(id => units[id].Type === 'Warehouse' && units[id].Status === 'Active' && (!units[id].CompanyID || units[id].CompanyID === me.emp.CompanyID))
    .map(id => ({ WarehouseID: id, Code: units[id].Code, Name: units[id].Name }));
  const out = [];
  for (const id of Object.keys(items || {})) {
    const it = items[id];
    if (it.Status !== 'Active' || (it.CompanyID && it.CompanyID !== me.emp.CompanyID)) continue;
    const price = L().getPriceEffectiveOnDate_(byItem, it.ItemCode, today());
    if (!price) continue;
    const stock = [];
    for (const w of warehouses) {
      const free = await L().getAvailableQuantity_(CTX, id, w.WarehouseID);
      if (free > 0) stock.push({ WarehouseID: w.WarehouseID, Code: w.Code, Free: free });
    }
    out.push({ ItemCode: it.ItemCode, ItemName: it.ItemName || '', UnitPrice: Number(price.UnitPrice) || 0, DefaultWarehouseID: it.DefaultWarehouseID || '', Stock: stock });
  }
  return { priceList: priceList.Name || '', currency: priceList.CurrencyID || '', items: out.sort((a, b) => a.ItemName.localeCompare(b.ItemName)), warehouses };
}

// A draft Sales Order, in the shape the ERP's own draft has (saveDraftSalesOrder);
// the office confirms it there, with every rule of confirming (decision 231).
async function placeOrder(me, d) {
  const rep = await requireRep(me);
  const customer = await requireMyCustomer(me, rep, d.customerId);
  const ccId = me.emp.CostCenterID || '';
  if (!ccId) throw failed('Your employee record has no cost center: ask HR, then place the order.');
  const priceList = await L().resolvePriceListForClassification_(CTX, me.emp.CompanyID, customer.Classification || '');
  if (!priceList) throw failed('This customer has no price list: the office prices its orders.');
  const [byItem, items, units] = await Promise.all([L().groupPriceListLinesByItem_(CTX, priceList.PriceListID), val('items'), val('orgUnits')]);
  const byCode = {};
  Object.keys(items || {}).forEach(id => { byCode[items[id].ItemCode] = Object.assign({ ItemID: id }, items[id]); });
  const raw = (Array.isArray(d.lines) ? d.lines : []).filter(l => text(l.ItemCode));
  if (!raw.length) bad('Add at least one item.');
  let total = 0;
  const lines = raw.map((l, i) => {
    const n = 'Line ' + (i + 1) + ': ';
    const it = byCode[text(l.ItemCode)];
    if (!it || it.Status !== 'Active' || (it.CompanyID && it.CompanyID !== me.emp.CompanyID)) bad(n + 'choose an item of the price list.');
    const price = L().getPriceEffectiveOnDate_(byItem, it.ItemCode, today());
    if (!price) bad(n + it.ItemCode + ' is not on the customer\'s price list.');
    const qty = Number(l.Quantity);
    if (!(qty > 0)) bad(n + 'enter a quantity greater than zero.');
    const wh = text(l.WarehouseID, 80) || it.DefaultWarehouseID || '';
    const u = (units || {})[wh];
    if (!u || u.Type !== 'Warehouse' || (u.CompanyID && u.CompanyID !== me.emp.CompanyID)) bad(n + 'choose a warehouse.');
    const unitPrice = Number(price.UnitPrice) || 0;
    total += qty * unitPrice;
    return { LineID: 'SOL-' + randomUUID().split('-')[0].toUpperCase(), ItemCode: it.ItemCode, WarehouseID: wh, OrderedQuantity: qty, EnteredUOMID: it.UOMID || '', UnitPrice: unitPrice, LineTotal: round2(qty * unitPrice) };
  });
  const now = new Date().toISOString(), actor = actorOf(me);
  const id = 'SO-' + randomUUID().split('-')[0].toUpperCase();
  await salesOrders.set(id, {
    CustomerID: customer.CustomerID, CompanyID: me.emp.CompanyID, DivisionID: me.emp.DivisionID || '', BranchID: me.emp.BranchID || '',
    CostCenterID: ccId, ProfitCenterID: '', SODate: today(), RequestedDeliveryDate: text(d.deliveryDate, 10),
    PriceListID: priceList.PriceListID, CurrencyID: priceList.CurrencyID || '', Description: text(d.note, 200) || 'Order taken by ' + (me.emp.FullName || 'the sales rep'),
    Lines: lines, Total: round2(total), UpdatedAt: now, UpdatedBy: actor,
    SONumber: '', Status: 'Draft', RequestedBy: actor, CreatedAt: now, CreatedBy: actor, SalesRepEmployeeID: me.emp.EmployeeID
  });
  return { success: true, soId: id, total: round2(total) };
}

// A collection (decision 232): cash, a draft Cash Receipt to the rep's cash
// account; a cheque, a draft PDC Received with its photo. The office posts.
async function collect(me, d) {
  const rep = await requireRep(me);
  const customer = await requireMyCustomer(me, rep, d.customerId);
  const amount = round2(Number(String(d.amount == null ? '' : d.amount).replace(/,/g, '')));
  if (!(amount > 0)) bad('Enter the amount collected.');
  const note = text(d.note, 200);
  const ccId = me.emp.CostCenterID || '';
  if (d.method === 'Cheque') {
    const c = d.cheque || {};
    if (!text(c.number, 40)) bad('Enter the cheque number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(c.date, 10))) bad('Enter the cheque date.');
    if (!text(c.bank, 80)) bad('Enter the bank the cheque is drawn on.');
    const r = await require('./pdc').savePdcDraftForRep(portalRep(me), {
      CompanyID: me.emp.CompanyID, PartyID: customer.CustomerID, TransactionDate: today(), ChequeDate: text(c.date, 10), ChequeNumber: text(c.number, 40),
      DraweeBank: text(c.bank, 80), Amount: amount, Description: note || 'Cheque collected by ' + (me.emp.FullName || 'the sales rep'), CostCenterID: ccId, Allocations: []
    });
    let photo = '';
    if (d.photo && d.photo.data) {
      try { await require('./attachments').portalUpload({ uid: actorOf(me), profile: { username: actorOf(me), fullName: me.emp.FullName } }, 'PDCRECEIVED', r.pdcId, text(d.photo.name, 120) || 'cheque.jpg', d.photo.data); photo = 'attached'; }
      catch (e) { photo = 'not attached: ' + (e.message || 'the document storage is not connected'); }
    }
    return { success: true, kind: 'Cheque', pdcId: r.pdcId, photo };
  }
  if (!rep.CashAccountID) throw failed('You have no cash account for collections yet: ask the office (Sales Invoice Configuration → Sales reps).');
  const coa = (await val('coa')) || {};
  const cash = coa[rep.CashAccountID];
  const ar = coa[customer.TradeReceivablesAccountID];
  if (!cash || !ar) throw failed('The cash or the customer\'s receivables account is not set up: ask the office.');
  const r = await require('./journal').saveCbtDraftForRep(portalRep(me), {
    VoucherType: 'Cash Receipt', SelectedAccountCode: String(cash.AccountCode), JVDate: today(), Reference: text(d.reference, 60),
    Description: note || 'Cash collected by ' + (me.emp.FullName || 'the sales rep'), CompanyID: me.emp.CompanyID, CostCenterID: ccId,
    OppositeLines: [{ AccountCode: String(ar.AccountCode), Amount: String(amount), Description: 'Collection — ' + (customer.CustomerName || ''), CostCenterID: ccId,
      PartyType: 'Customer', PartyID: customer.CustomerID, Allocations: [{ RefType: 'New', Amount: amount }] }]
  });
  if (!r.success) throw failed(r.error);
  return { success: true, kind: 'Cash', jvId: r.jvId };
}

// My orders and collections: their status, today's totals.
async function myDrafts(me) {
  const actor = actorOf(me);
  const [orders, pdcs, cbt] = await Promise.all([salesOrders.query({ CreatedBy: actor }), val('pdcCheques'), firestore.collection('journalEntries').where('CreatedBy', '==', actor).get()]);
  const out = [];
  Object.keys(orders || {}).forEach(id => { const o = orders[id]; if (o.CreatedBy === actor) out.push({ Kind: 'Order', ID: id, Number: o.SONumber || '', Date: o.SODate, CustomerID: o.CustomerID, Amount: round2(o.Total), Status: o.Status }); });
  Object.keys(pdcs || {}).forEach(id => { const p = pdcs[id]; if (p.CreatedBy === actor) out.push({ Kind: 'Cheque', ID: id, Number: p.TransactionNumber || '', Date: p.TransactionDate, CustomerID: p.PartyID, Amount: round2(p.Amount), Status: p.Status }); });
  cbt.docs.forEach(doc => { const e = doc.data(); out.push({ Kind: 'Cash', ID: doc.id, Number: e.JVNumber || '', Date: e.JVDate, CustomerID: ((e.Lines || []).find(l => l.PartyID) || {}).PartyID || '', Amount: round2(e.TotalDebit), Status: e.Status }); });
  return out.sort((a, b) => String(b.Date).localeCompare(String(a.Date))).slice(0, 50);
}

module.exports = Object.assign(exports, { repOf, salesHome, salesItems, placeOrder, collect, myDrafts });
