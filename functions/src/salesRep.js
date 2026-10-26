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
// A rep's collections, balance and receipts (UX round 2, items 30-31;
// docs/modules/REP_COLLECTIONS.md, Q294-Q298, Q309-Q310) replace decision
// 232's drafts: a collection is FINAL when the rep records it. The rep is a
// party in the ledger (partyLedger.js, SalesRep) on the company's Rep Cash
// Clearing account: cash posts at once, Dr Rep Cash Clearing (an open item
// on the rep) · Cr the customer (the invoices the rep picked, else on
// account); a cheque posts at once as a PDC Received "with the rep". Each
// receipt takes the rep's own number, RC-<rep code>-000001. The cashier
// takes the cash with an ordinary Cash Receipt matching the rep's receipts;
// the office ticks the cheques received from the rep in PDC Received, and
// cancels a receipt with Cash & Bank's post right.
//
//   salesReps/{employeeId} { CompanyID, Active, IsManager, RepCode, UpdatedAt, UpdatedBy }
//   salesRepSettings/{companyId} { ClearingAccountID }
//   salesRepCodes/{code} = employeeId (a code is never given to another rep)
//   salesRepCounters/{employeeId} = the rep's last receipt number
//   repReceipts/{number} (Firestore) the receipt, as shared with the customer
//   customers/{id}.SalesRepEmployeeID
'use strict';
const { randomUUID } = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany, FIRESTORE_JOURNAL_ENTRIES_COLLECTION } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');
const coaScheme = require('./coaScheme');
const { salesOrders } = require('./salesStore');

const onCallOptions = { region: 'us-central1' };
const REPS = 'salesReps', SETTINGS = 'salesRepSettings', CODES = 'salesRepCodes', COUNTERS = 'salesRepCounters';
const RECEIPTS = () => firestore.collection('repReceipts');
const CODE_RE = /^[A-Z0-9]{1,12}$/;
const defaultCode = emp => String((emp && emp.EmployeeNo) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
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
// The accounts that may be a company's Rep Cash Clearing: postable and
// active, of the company, not a cash or bank account (the cashier's), and
// not a vendor's or customer's control account.
async function clearingCandidates(coa, co) {
  const [vendors, customers] = await Promise.all([val('vendors'), val('customers')]);
  const control = new Set([...Object.values(vendors || {}).map(v => v.TradePayablesAccountID), ...Object.values(customers || {}).map(c => c.TradeReceivablesAccountID)].filter(Boolean));
  return Object.keys(coa || {}).filter(id => coa[id].Status === 'Active' && coa[id].IsPostable === true && (!coa[id].CompanyID || coa[id].CompanyID === co) &&
    !['Cash', 'Bank'].includes(coaScheme.kindOf(coa[id])) && !control.has(id))
    .map(id => ({ AccountID: id, AccountCode: coa[id].AccountCode, AccountName: coa[id].AccountName }))
    .sort((x, y) => String(x.AccountCode).localeCompare(String(y.AccountCode)));
}

// The reps as parties of the ledger (partyLedger.js loadParties): their
// code and name, company and the company's Rep Cash Clearing account. ids:
// only these reps (one party's lookup), else all.
async function repParties(ids) {
  let reps;
  if (ids) {
    reps = {};
    for (const id of ids.map(x => text(x, 80)).filter(Boolean)) { const r = await val(REPS + '/' + id); if (r) reps[id] = r; }
  } else reps = (await val(REPS)) || {};
  const keys = Object.keys(reps);
  if (!keys.length) return {};
  const [settings, emps] = await Promise.all([val(SETTINGS), firestore.getAll(...keys.map(id => firestore.collection('employees').doc(id)))]);
  const out = {};
  keys.forEach((id, i) => {
    const r = reps[id], e = emps[i].exists ? emps[i].data() : {};
    out[id] = { RepCode: r.RepCode || defaultCode(e) || id, RepName: e.FullName || id, EmployeeNo: e.EmployeeNo || '', CompanyID: r.CompanyID || '',
      ClearingAccountID: ((settings || {})[r.CompanyID] || {}).ClearingAccountID || '', Status: r.Active === false ? 'Inactive' : 'Active', PaymentTermsDays: 0 };
  });
  return out;
}

// What a rep holds (item 30): the cash of their receipts not yet taken by
// the cashier (their open items) and the cheques still with them.
async function balanceOf(repId, party) {
  const ledger = require('./partyLedger');
  const items = party ? [...(await ledger.getOpenItemsForParty('SalesRep', repId, party)).values()].filter(i => i.Side === 'Dr' && i.Outstanding > 0.005) : [];
  const cheques = Object.entries(await require('./jobStore').pdcCheques.query({ RepEmployeeID: repId }))
    .map(([id, p]) => Object.assign({ PdcID: id }, p)).filter(p => p.WithRep === true && p.Status === 'Pending')
    .map(p => ({ PdcID: p.PdcID, Number: p.RepReceiptNumber || p.TransactionNumber || '', PdcNumber: p.TransactionNumber || '', CustomerID: p.PartyID, Customer: p.PartyName || '',
      ChequeNumber: p.ChequeNumber, ChequeDate: p.ChequeDate, DraweeBank: p.DraweeBank || '', Amount: round2(p.Amount) }))
    .sort((a, b) => String(a.ChequeDate).localeCompare(String(b.ChequeDate)));
  return {
    Cash: round2(items.reduce((t, i) => t + i.Outstanding, 0)), CashItems: items.map(i => ({ Number: i.Number, Date: i.Date, Amount: i.Amount, Outstanding: i.Outstanding })),
    Cheques: cheques, ChequeTotal: round2(cheques.reduce((t, c) => t + c.Amount, 0))
  };
}

exports.getSalesReps = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const co = text((request.data || {}).companyId, 80);
  await requireSetup(user, 'access', co);
  const [reps, customers, coa, emps, settings] = await Promise.all([val(REPS), val('customers'), val('coa'), firestore.collection('employees').where('CompanyID', '==', co).get(), val(SETTINGS + '/' + co)]);
  const employees = emps.docs.map(d => Object.assign({ EmployeeID: d.id }, d.data())).filter(e => e.Status !== 'Left')
    .map(e => ({ EmployeeID: e.EmployeeID, EmployeeNo: e.EmployeeNo || '', FullName: e.FullName || '', DefaultCode: defaultCode(e) })).sort((a, b) => a.FullName.localeCompare(b.FullName));
  const custs = Object.keys(customers || {}).filter(id => customers[id].Status === 'Active' && (!customers[id].CompanyID || customers[id].CompanyID === co))
    .map(id => ({ CustomerID: id, Code: customers[id].CustomerCode || '', Name: customers[id].CustomerName || '', SalesRepEmployeeID: customers[id].SalesRepEmployeeID || '' }));
  const ids = Object.keys(reps || {}).filter(id => reps[id].CompanyID === co);
  const parties = await repParties(ids);
  const list = [];
  for (const id of ids) {
    list.push(Object.assign({ EmployeeID: id }, reps[id], { RepCode: parties[id].RepCode, Employee: employees.find(e => e.EmployeeID === id) || null,
      Customers: custs.filter(c => c.SalesRepEmployeeID === id).map(c => c.CustomerID),
      Balance: await balanceOf(id, parties[id].ClearingAccountID ? parties[id] : null) }));
  }
  const clearingId = (settings || {}).ClearingAccountID || '';
  return { reps: list, employees, customers: custs, clearingAccountId: clearingId, clearingAccounts: await clearingCandidates(coa, co),
    canWrite: await moduleHasCapability('SALESINVOICESETUP', 'write', user.profile.role), canCancel: await moduleHasCapability('CBT', 'post', user.profile.role) };
});

// The company's Rep Cash Clearing account. It can't change while any rep
// of the company still holds cash on it (the cashier matches on it).
exports.saveSalesRepSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = text(d.companyId, 80);
  await requireSetup(user, 'write', co);
  const id = text(d.clearingAccountId, 80);
  if (!(await clearingCandidates(await val('coa'), co)).some(a => a.AccountID === id)) {
    bad('Choose the Rep Cash Clearing account: a postable account of the company, not a cash or bank account, nor a vendor\'s or customer\'s control account.');
  }
  const was = ((await val(SETTINGS + '/' + co)) || {}).ClearingAccountID || '';
  if (was && was !== id) {
    const parties = await repParties();
    for (const repId of Object.keys(parties).filter(r => parties[r].CompanyID === co)) {
      if ((await balanceOf(repId, parties[repId])).Cash > 0.005) throw failed(parties[repId].RepName + ' still holds cash on the Rep Cash Clearing account: take it in Cash & Bank first, then change the account.');
    }
  }
  await rtdb.ref(SETTINGS + '/' + co).set({ ClearingAccountID: id, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

exports.saveSalesRep = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const co = text(d.companyId, 80);
  await requireSetup(user, 'write', co);
  const empId = text(d.employeeId, 80);
  const emp = (await firestore.collection('employees').doc(empId || '-').get()).data();
  if (!emp || emp.CompanyID !== co) bad('Choose an employee of the company.');
  // The rep's code, in their receipt numbers (Q298): short, unique, and
  // never given to another rep once used, so no number can repeat.
  const code = text(d.repCode, 12).toUpperCase() || defaultCode(emp);
  if (!CODE_RE.test(code)) bad('The rep code is 1 to 12 letters or digits (e.g. AK); it is in their receipt numbers.');
  const holder = await val(CODES + '/' + code);
  if (holder && holder !== empId) bad('The code ' + code + ' belongs to another rep: choose another.');
  const customers = (await val('customers')) || {};
  const ids = [...new Set((Array.isArray(d.customerIds) ? d.customerIds : []).map(x => text(x, 80)))];
  ids.forEach(id => { const c = customers[id]; if (!c || (c.CompanyID && c.CompanyID !== co)) bad('Choose customers of the company.'); });
  await rtdb.ref(CODES + '/' + code).set(empId);
  await rtdb.ref(REPS + '/' + empId).set({ CompanyID: co, Active: d.active !== false, IsManager: d.isManager === true, RepCode: code,
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
  const party = (await repParties([me.emp.EmployeeID]))[me.emp.EmployeeID];
  return {
    isManager: Boolean(rep.IsManager), today: today(), balance: await balanceOf(me.emp.EmployeeID, party.ClearingAccountID ? party : null),
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

// ---------- a collection: final when the rep records it (items 30-31) ----------

// The customer's open invoices the rep may settle (Q296), oldest first.
async function openInvoices(me, d) {
  const rep = await requireRep(me);
  const customer = await requireMyCustomer(me, rep, d.customerId);
  const items = await require('./partyLedger').listOpenItems('Customer', customer.CustomerID, me.emp.CompanyID);
  return { invoices: items.filter(i => i.Side === 'Dr').map(i => ({ RefID: i.RefID, Number: i.Number, Date: i.Date, DueDate: i.DueDate, Amount: i.Amount, Outstanding: i.Outstanding })) };
}

// The rep's next number, RC-<code>-000001 (Q298, Q309): one series per rep.
async function nextReceiptNumber(repId, code) {
  const r = await rtdb.ref(COUNTERS + '/' + repId).transaction(c => (Number(c) || 0) + 1);
  return 'RC-' + code + '-' + String(r.snapshot.val()).padStart(6, '0');
}
const amountOf = v => round2(Number(String(v == null ? '' : v).replace(/,/g, '')));
// The invoices picked, each Against, and the rest on account (a New Ref).
function allocationsOf(d, amount) {
  const picked = (Array.isArray(d.invoices) ? d.invoices : []).map(a => ({ RefType: 'Against', RefID: text(a.refId, 120), Amount: amountOf(a.amount) })).filter(a => a.RefID && a.Amount > 0);
  const total = round2(picked.reduce((t, a) => t + a.Amount, 0));
  if (total > amount + 0.005) bad('The invoices picked come to ' + total.toFixed(2) + ', more than the ' + amount.toFixed(2) + ' collected.');
  const rest = round2(amount - total);
  return rest > 0.005 ? picked.concat([{ RefType: 'New', Amount: rest }]) : picked;
}
const settlesOf = allocations => allocations.map(a => a.RefType === 'Against' ? { Number: a.RefNumber || a.RefID, Amount: round2(a.Amount) } : { Number: '', OnAccount: true, Amount: round2(a.Amount) });
const repUser = me => { const actor = actorOf(me); return { uid: actor, profile: { username: actor, fullName: me.emp.FullName || '', AssignedCompanies: [me.emp.CompanyID] } }; };

async function collect(me, d) {
  const rep = await requireRep(me);
  const customer = await requireMyCustomer(me, rep, d.customerId);
  const amount = amountOf(d.amount);
  if (!(amount > 0)) bad('Enter the amount collected.');
  const co = me.emp.CompanyID, repId = me.emp.EmployeeID, ccId = me.emp.CostCenterID || '';
  if (require('./fx').partyCurrency(customer, (await require('./exchangeRates').baseCurrency()).Code)) throw failed(customer.CustomerName + ' is invoiced in a foreign currency: the office records its receipts.');
  const party = (await repParties([repId]))[repId];
  const isCheque = d.method === 'Cheque';
  const c = d.cheque || {};
  if (isCheque) {
    if (!text(c.number, 40)) bad('Enter the cheque number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(c.date, 10))) bad('Enter the cheque date.');
    if (!text(c.bank, 80)) bad('Enter the bank the cheque is drawn on.');
  } else if (!party.ClearingAccountID) throw failed('The company has no Rep Cash Clearing account yet: ask the office (Sales Invoice Configuration → Sales reps).');
  const allocations = allocationsOf(d, amount);
  const note = text(d.note, 200);
  const user = repUser(me), actor = actorOf(me);

  const number = await require('./lock').withGlobalLock(actor, async () => {
    const no = await nextReceiptNumber(repId, party.RepCode);
    const now = new Date().toISOString();
    const receipt = { Number: no, CompanyID: co, RepEmployeeID: repId, RepCode: party.RepCode, RepName: party.RepName, CustomerID: customer.CustomerID,
      CustomerCode: customer.CustomerCode || '', CustomerName: customer.CustomerName || '', Amount: amount, Date: today(), At: now, Method: isCheque ? 'Cheque' : 'Cash',
      Note: note, Status: 'Issued', CreatedBy: actor };
    if (isCheque) {
      await require('./pdc').postPdcForRep(user, {
        CompanyID: co, PartyID: customer.CustomerID, TransactionDate: today(), ChequeDate: text(c.date, 10), ChequeNumber: text(c.number, 40), DraweeBank: text(c.bank, 80),
        Amount: amount, Description: (note || 'Cheque collected by ' + party.RepName) + ' (' + no + ')', Reference: no, CostCenterID: ccId,
        DivisionID: me.emp.DivisionID || '', BranchID: me.emp.BranchID || '', Allocations: allocations
      }, { WithRep: true, RepEmployeeID: repId, RepName: party.RepName, RepReceiptNumber: no }, (batch, pdcId, posted) => batch.set(RECEIPTS().doc(no), Object.assign(receipt, {
        PdcID: pdcId, PdcNumber: posted.number, Cheque: { Number: text(c.number, 40), Date: text(c.date, 10), Bank: text(c.bank, 80) }, Settles: settlesOf(posted.allocations)
      })));
      return no;
    }
    // Cash: Dr Rep Cash Clearing (an open item on the rep, its number the receipt's) · Cr the customer.
    const ledger = require('./partyLedger');
    const coa = (await val('coa')) || {};
    const ar = coa[customer.TradeReceivablesAccountID], clearing = coa[party.ClearingAccountID];
    if (!ar || !clearing) throw failed('The customer\'s receivables account or the Rep Cash Clearing account is not set up: ask the office.');
    const label = 'Receipt ' + no + ' — ' + (customer.CustomerName || '');
    const resolved = await ledger.resolvePartyLines([
      { AccountID: party.ClearingAccountID, AccountCode: String(clearing.AccountCode), AccountName: clearing.AccountName, Debit: amount, Credit: 0, Description: label, CostCenterID: ccId,
        PartyType: 'SalesRep', PartyID: repId, Allocations: [{ RefType: 'New', Amount: amount }] },
      { AccountID: customer.TradeReceivablesAccountID, AccountCode: String(ar.AccountCode), AccountName: ar.AccountName, Debit: 0, Credit: amount, Description: label, CostCenterID: ccId,
        PartyType: 'Customer', PartyID: customer.CustomerID, Allocations: allocations }
    ], co);
    await require('./stockPosting').postStock(user, {
      type: 'RepReceipt', date: today(), description: label, reference: no,
      lines: resolved.lines.map(l => ({ AccountCode: l.AccountCode, Debit: l.Debit, Credit: l.Credit, Description: l.Description, CostCenterID: l.CostCenterID || '',
        PartyType: l.PartyType, PartyID: l.PartyID, PartyName: l.PartyName, Allocations: l.Allocations })),
      dimensions: { CompanyID: co, DivisionID: me.emp.DivisionID || '', BranchID: me.emp.BranchID || '', CostCenterID: ccId },
      extra: Object.assign({ NumberAs: no, SourceTransactionID: no, ReversalOfJV: '', RepEmployeeID: repId, RepReceiptNumber: no }, resolved.fields)
    }, {}, () => ({}), async (batch, gl) => {
      batch.set(RECEIPTS().doc(no), Object.assign(receipt, { JVID: gl.jvId, Settles: settlesOf(resolved.lines[1].Allocations) }));
    });
    return no;
  });
  return { success: true, number, receipt: await receiptView(number) };
}

// ---------- a receipt and the rep's balance ----------

// What a receipt is now: cash, with the rep until the cashier takes it (all
// or part) in a Cash Receipt; a cheque, with the rep until the office ticks
// it received, then the PDC's own state.
function statusOf(r, outstandingOf, pdc) {
  if (r.Status === 'Cancelled') return 'Cancelled';
  if (r.Method === 'Cheque') {
    if (!pdc) return 'Issued';
    if (pdc.Status === 'Pending') return pdc.WithRep ? 'With the rep' : 'Handed over';
    return { Cleared: 'Cleared', Bounced: 'Bounced', Cancelled: 'Cancelled' }[pdc.Status] || pdc.Status;
  }
  const left = outstandingOf(r);
  if (left == null) return 'Handed over';
  if (left <= 0.005) return 'Handed over';
  return left < r.Amount - 0.005 ? 'Part handed over' : 'With the rep';
}
// The rep's receipts, newest first, each with its status.
async function receiptsOf(repId, limit) {
  const docs = (await RECEIPTS().where('RepEmployeeID', '==', repId).get()).docs.map(x => x.data()).sort((a, b) => String(b.At).localeCompare(String(a.At))).slice(0, limit || 200);
  const party = (await repParties([repId]))[repId];
  const items = party && party.ClearingAccountID ? await require('./partyLedger').getOpenItemsForParty('SalesRep', repId, party) : new Map();
  const left = new Map(); // a cash receipt's entry -> what the cashier has still to take of it
  items.forEach(i => { if (i.ItemType === 'NewRef') left.set(i.RefID.split(':')[1], i.Outstanding); });
  const outstandingOf = r => (left.has(r.JVID) ? left.get(r.JVID) : null);
  const pdcs = await require('./jobStore').pdcCheques.query({ RepEmployeeID: repId });
  return docs.map(r => Object.assign({}, r, { StatusText: statusOf(r, outstandingOf, pdcs[r.PdcID]), Outstanding: r.Method === 'Cash' && r.Status !== 'Cancelled' ? (outstandingOf(r) || 0) : 0 }));
}
// One receipt as the customer gets it (the PDF on the rep's phone).
async function receiptView(number) {
  const r = (await RECEIPTS().doc(text(number, 40) || '-').get()).data();
  if (!r) return null;
  const co = (await val('companies/' + r.CompanyID)) || {};
  const base = await require('./exchangeRates').baseCurrency();
  return Object.assign({}, r, { Company: { Name: co.CompanyName || co.Name || '', Address: co.Address || co.RegisteredAddress || '', Phone: co.Phone || '', TRN: co.TRN || co.TaxRegistrationNumber || '' },
    Currency: base.Code || '', Words: require('./eosStatement').amountInWords(r.Amount, base.Code || '') });
}

// The portal: what I hold, my receipts; one of mine to share again.
async function myCollections(me) {
  await requireRep(me);
  const repId = me.emp.EmployeeID;
  const party = (await repParties([repId]))[repId];
  return { balance: await balanceOf(repId, party.ClearingAccountID ? party : null), receipts: await receiptsOf(repId, 100), repCode: party.RepCode };
}
async function myReceipt(me, d) {
  await requireRep(me);
  const r = await receiptView(d.number);
  if (!r || r.RepEmployeeID !== me.emp.EmployeeID) throw new HttpsError('not-found', 'Receipt not found.');
  return { receipt: r };
}

// ---------- the office ----------

// A rep's receipts (Sales Invoice Configuration → Sales reps).
exports.getRepReceipts = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const repId = text(d.employeeId, 80);
  const rep = await val(REPS + '/' + (repId || '-'));
  if (!rep) throw new HttpsError('not-found', 'Sales rep not found.');
  await requireSetup(user, 'access', rep.CompanyID);
  const party = (await repParties([repId]))[repId];
  return { receipts: await receiptsOf(repId), balance: await balanceOf(repId, party.ClearingAccountID ? party : null), canCancel: await moduleHasCapability('CBT', 'post', user.profile.role) };
});

// Only the office cancels a receipt (Q297), with Cash & Bank's post right
// (Q310): a reversal, with the reason; the number stays, marked cancelled.
// Cash the cashier has already taken can't be cancelled until that Cash
// Receipt is reversed; a cheque only while it is Pending (as PDC Received's
// own Cancel).
exports.cancelRepReceipt = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const number = text(d.number, 40), reason = text(d.reason, 200);
  const date = text(d.date, 10) || today();
  if (!reason) bad('Give the reason for cancelling the receipt.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('Enter the date of the cancellation.');
  const ref = RECEIPTS().doc(number || '-');
  return require('./lock').withGlobalLock(user.uid, async () => {
    const r = (await ref.get()).data();
    if (!r) throw new HttpsError('not-found', 'Receipt not found.');
    if (!userCanAccessCompany(user.profile, r.CompanyID)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (!(await moduleHasCapability('CBT', 'post', user.profile.role))) throw new HttpsError('permission-denied', 'Cancelling a rep\'s receipt needs Cash & Bank\'s post right.');
    if (r.Status === 'Cancelled') throw failed(number + ' is already cancelled.');
    if (date < r.Date) bad('The date is before the receipt\'s own date.');
    const actor = user.profile.username || user.uid;
    const mark = (batch, now, extra) => batch.update(ref, Object.assign({ Status: 'Cancelled', CancelReason: reason, CancelledAt: now, CancelledBy: actor, CancelDate: date }, extra));
    if (r.Method === 'Cheque') {
      await require('./pdc').cancelPdcFor(user, r.PdcID, date, 'Receipt ' + number + ' cancelled: ' + reason, (batch, gl, now) => mark(batch, now, { CancelJVID: gl.jvId, CancelNumber: gl.jvNumber }));
      return { success: true };
    }
    const glRef = firestore.collection(FIRESTORE_JOURNAL_ENTRIES_COLLECTION).doc(r.JVID);
    const entry = (await glRef.get()).data();
    if (!entry || entry.ReversedByJV) throw failed('The entry of ' + number + ' was not found or is already reversed.');
    try { await require('./partyLedger').assertEntryReversible(r.JVID, entry); } catch (e) {
      throw failed('The cashier has already taken this cash (' + (e.message.match(/settled by ([^—]+)/) || [, 'a Cash Receipt'])[1].trim() + '): reverse that Cash Receipt first.');
    }
    const description = 'Receipt ' + number + ' cancelled — ' + reason;
    await require('./stockPosting').postStock(user, {
      type: 'RepReceipt', date, description, reference: number, lines: require('./pdc').mirrorLines(entry, 'Cancelled — '),
      dimensions: { CompanyID: entry.CompanyID, DivisionID: entry.DivisionID || '', BranchID: entry.BranchID || '', CostCenterID: entry.CostCenterID || '' },
      extra: { NumberAs: number + '-C', SourceTransactionID: number, ReversalOfJV: r.JVID, RepEmployeeID: r.RepEmployeeID, PartyKeys: entry.PartyKeys || [], AllocatedRefs: [], AllocatedRefTypes: [] }
    }, {}, () => ({}), async (batch, gl, now) => {
      batch.update(glRef, { ReversedByJV: gl.jvId, UpdatedAt: now, UpdatedBy: actor });
      mark(batch, now, { CancelJVID: gl.jvId, CancelNumber: gl.jvNumber });
    });
    return { success: true };
  });
});

// My orders and collections: their status, today's totals.
async function myDrafts(me) {
  const actor = actorOf(me);
  const [orders, pdcs, cbt] = await Promise.all([salesOrders.query({ CreatedBy: actor }), require('./jobStore').pdcCheques.query({ CreatedBy: actor }), firestore.collection('journalEntries').where('CreatedBy', '==', actor).get()]);
  const out = [];
  Object.keys(orders || {}).forEach(id => { const o = orders[id]; if (o.CreatedBy === actor) out.push({ Kind: 'Order', ID: id, Number: o.SONumber || '', Date: o.SODate, CustomerID: o.CustomerID, Amount: round2(o.Total), Status: o.Status }); });
  // The receipts (items 30-31) are listed apart (myCollections); these are the drafts of before.
  Object.keys(pdcs || {}).forEach(id => { const p = pdcs[id]; if (p.CreatedBy === actor && !p.RepReceiptNumber) out.push({ Kind: 'Cheque', ID: id, Number: p.TransactionNumber || '', Date: p.TransactionDate, CustomerID: p.PartyID, Amount: round2(p.Amount), Status: p.Status }); });
  cbt.docs.forEach(doc => { const e = doc.data(); if (!e.RepReceiptNumber) out.push({ Kind: 'Cash', ID: doc.id, Number: e.JVNumber || '', Date: e.JVDate, CustomerID: ((e.Lines || []).find(l => l.PartyID) || {}).PartyID || '', Amount: round2(e.TotalDebit), Status: e.Status }); });
  return out.sort((a, b) => String(b.Date).localeCompare(String(a.Date))).slice(0, 50);
}

module.exports = Object.assign(exports, { repOf, repParties, salesHome, salesItems, placeOrder, collect, myDrafts, openInvoices, myCollections, myReceipt, receiptView, balanceOf });
