// CRM, step C2: Quotations (owner, 2026-11-05; docs/modules/CRM.md, Q398-Q400).
// New development, hand-written.
//
// A quotation is for a customer or a lead (Q399), with item lines like a
// Sales Order's (the price list's price, a discount, the items' tax codes),
// Valid until, its own number (Numbering's QT series, given on the first
// save) and revisions: Revise keeps the old one (Revised, read-only) and
// starts the next (the same number, Rev n+1). Submit goes to Approval
// Configuration's Quotation type when it has levels (Q400), else straight to
// Approved; only an approved (latest) revision becomes an order, through the
// Sales Order's own save (the screen), and is then Accepted, linked both
// ways. It posts nothing.
//
//   Firestore quotations/{id} { Number, Revision, PreviousID, CompanyID, CustomerID | LeadID,
//     OpportunityID, Classification (a lead's, for its price list), PriceListID, CurrencyID,
//     QuoteDate, ValidUntil, DivisionID, BranchID, CostCenterID, ProfitCenterID,
//     Lines [{ ItemCode, Description, Quantity, UnitPrice, DiscountPct, NetPrice, Amount, WarehouseID }],
//     Subtotal, TaxAmount, TaxAdded, TaxSummary, Total, Terms, OwnerKey,
//     Status: Draft | PendingApproval | Approved | Rejected | Accepted | Revised,
//     ApprovalInstanceID, RejectionReason, SalesOrderID, History [], Created/Updated At, By }
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { withGlobalLock } = require('./lock');
const { resolveApprovalScopeKeyForDocument, beginApprovalInstance, recordApprovalDecision } = require('./approvals');
const numbering = require('./numbering');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'QUOTATION';
const QUOTES = () => firestore.collection('quotations');
const EDITABLE = ['Draft', 'Rejected'];
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
// An ERP user, or a sales rep in the portal (step C3: crm.portalUser).
const actorOf = user => (user.portal ? user.portal.actor : user.profile.username || user.uid);
const ownerKeyOf = user => (user.portal ? 'E:' + user.portal.empId : 'U:' + user.uid);
const nowIso = () => new Date().toISOString();
const failed = m => new HttpsError('failed-precondition', m);
const historyWith = (q, what, user, note) => (q.History || []).concat([{ At: nowIso(), By: actorOf(user), What: what + (note ? ': ' + note : '') }]);

async function requireCap(user, cap) {
  if (user.portal) { if (!['access', 'write'].includes(cap)) throw new HttpsError('permission-denied', 'Not from the portal.'); return; }
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change quotations.' : 'You do not have access to Quotations.');
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (user.portal ? companyId !== user.portal.companyId : !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
// A rep's own quotations (a sales manager: the company's); an ERP user sees the company's.
const mine = (user, q) => !user.portal || user.portal.manager || q.OwnerKey === ownerKeyOf(user);
// A rep quotes the customers they serve and their own leads (decision 230; a sales manager, any).
async function requireServed(user, customerId, lead) {
  if (!user.portal || user.portal.manager) return;
  if (customerId) {
    const c = (await rtdb.ref('customers/' + customerId).get()).val() || {};
    if (c.SalesRepEmployeeID !== user.portal.empId) throw new HttpsError('permission-denied', 'That customer is not one of yours.');
  } else if (!lead || lead.OwnerKey !== ownerKeyOf(user)) throw new HttpsError('permission-denied', 'That lead is not yours.');
}
async function load(user, id) {
  const snap = await QUOTES().doc(text(id, 80)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Quotation not found.');
  const q = Object.assign({ QuotationID: snap.id }, snap.data());
  requireCompany(user, q.CompanyID);
  if (!mine(user, q)) throw new HttpsError('permission-denied', 'That quotation is not yours.');
  return q;
}
const todayIn = () => { const S = require('./recurringSchedule'); return S.todayIn(S.TIME_ZONE); };
const expired = (q, today) => ['Draft', 'PendingApproval', 'Approved'].includes(q.Status) && q.ValidUntil && q.ValidUntil < today;

// The price list a customer (or, for a lead, a classification) buys at: the company's active list mapped to it.
async function priceListFor(companyId, classification) {
  if (!classification) return null;
  const lists = (await rtdb.ref('priceLists').get()).val() || {};
  const id = Object.keys(lists).find(k => lists[k].CompanyID === companyId && lists[k].Status === 'Active' && lists[k].CustomerClassificationMapping === classification);
  return id ? Object.assign({ PriceListID: id }, lists[id]) : null;
}

// The lines, priced and totalled; the tax as on a Sales Order (salesTax.orderTax).
async function priced(companyId, partyId, priceList, date, rawLines, listOnly) {
  const items = (await rtdb.ref('items').get()).val() || {};
  // A rep's price is the price list's, on the quotation's date (Q405): only the discount is theirs.
  const L = require('./legacy/codegs');
  const byItem = listOnly ? (priceList ? await L.groupPriceListLinesByItem_({}, priceList.PriceListID) : null) : null;
  if (listOnly && !priceList) throw failed('This customer has no price list (Price Listing, by its classification): the office prices its quotations.');
  const byCode = {};
  Object.values(items).forEach(it => { if (it && it.ItemCode) byCode[it.ItemCode] = it; });
  const lines = (Array.isArray(rawLines) ? rawLines : []).filter(l => l && text(l.ItemCode, 60)).slice(0, 300).map((l, i) => {
    const code = text(l.ItemCode, 60);
    const it = byCode[code];
    if (!it || it.Status !== 'Active') throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': unknown or inactive item (' + code + ').');
    let unitPrice = Number(l.UnitPrice) || 0;
    if (listOnly) {
      const price = L.getPriceEffectiveOnDate_(byItem, code, date);
      if (!price) throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': ' + code + ' is not on the price list.');
      unitPrice = Number(price.UnitPrice) || 0;
    }
    const quantity = Number(l.Quantity), discountPct = Number(l.DiscountPct) || 0;
    if (!(quantity > 0)) throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': the quantity must be more than zero.');
    if (unitPrice < 0) throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': the price cannot be negative.');
    if (!(discountPct >= 0 && discountPct <= 100)) throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': the discount is 0 to 100 %.');
    const netPrice = round2(unitPrice * (1 - discountPct / 100));
    return { ItemCode: code, Description: text(l.Description, 300) || it.ItemName || '', Quantity: quantity, UnitPrice: round2(unitPrice), DiscountPct: discountPct,
      NetPrice: netPrice, Amount: round2(netPrice * quantity), WarehouseID: text(l.WarehouseID, 80) };
  });
  if (!lines.length) throw new HttpsError('invalid-argument', 'Add at least one item line.');
  const subtotal = round2(lines.reduce((s, l) => s + l.Amount, 0));
  const t = await require('./salesTax').orderTax({ kind: 'sale', CompanyID: companyId, PartyID: partyId || '', PriceListID: priceList ? priceList.PriceListID : '', Date: date,
    Lines: lines.map(l => ({ ItemCode: l.ItemCode, Amount: l.Amount })) });
  if (t.problem) throw new HttpsError('invalid-argument', t.problem);
  const tax = t.configured ? t.tax : { TaxAmount: 0, TaxAdded: 0, TaxSummary: [] };
  return { lines, Subtotal: subtotal, TaxAmount: round2(tax.TaxAmount), TaxAdded: round2(tax.TaxAdded), TaxSummary: tax.TaxSummary || [], Total: round2(subtotal + (Number(tax.TaxAdded) || 0)) };
}

// ---------- callables ----------

// Each callable's work by name, for the ERP and the rep portal alike (step C3).
const cores = {};
function callable(name, core) {
  cores[name] = core;
  exports[name] = onCallWithMessages(onCallOptions, async (request) => core(await requireUser(request), request));
}

// The company's quotations (the list), and what the screen needs to make one.
callable('getQuotations', async (user, request) => {
  await requireCap(user, 'access');
  const companyId = text(request.data && request.data.companyId, 80);
  requireCompany(user, companyId);
  const today = todayIn();
  const [list, canWrite, customers, leads, opps, setup, classes] = await Promise.all([
    QUOTES().where('CompanyID', '==', companyId).get().then(s => s.docs.map(d => Object.assign({ QuotationID: d.id }, d.data()))),
    moduleHasCapability(MODULE_ID, 'write', user.profile.role),
    rtdb.ref('customers').get().then(s => s.val() || {}),
    firestore.collection('crmLeads').where('CompanyID', '==', companyId).get().then(s => s.docs.map(d => Object.assign({ ID: d.id }, d.data())).filter(l => l.Status === 'Open')),
    firestore.collection('crmOpportunities').where('CompanyID', '==', companyId).get().then(s => s.docs.map(d => Object.assign({ ID: d.id }, d.data())).filter(o => o.Status === 'Open')),
    firestore.collection('crmSetup').doc(companyId).get().then(s => s.exists ? s.data() : {}),
    rtdb.ref('customerClassifications').get().then(s => s.val() || {})
  ]);
  const customerList = Object.keys(customers).filter(id => customers[id].Status === 'Active' && (!customers[id].CompanyID || customers[id].CompanyID === companyId))
    .map(id => { const c = customers[id]; return { CustomerID: id, Name: c.CustomerName, Code: c.CustomerCode || '', Classification: c.Classification || '',
      Address: [c.AddressLine1, c.AddressLine2, c.Country].filter(Boolean).join(', '), TaxNumber: c.TaxRegistrationNumber || c.GSTIN || '' }; });
  return {
    canWrite, today, validDays: Number(setup.QuoteValidDays) || 30,
    quotations: list.map(q => Object.assign(q, { Expired: expired(q, today) })),
    customers: customerList,
    leads: leads.map(l => ({ ID: l.ID, Name: l.Organisation || l.Name, Contact: l.Organisation ? l.Name || '' : '', Address: [l.Address, l.Country].filter(Boolean).join(', '), Phone: l.Phone || '', Email: l.Email || '' })),
    opportunities: opps.map(o => ({ ID: o.ID, Title: o.Title, LeadID: o.LeadID || '', CustomerID: o.CustomerID || '' })),
    classifications: Object.values(classes).filter(c => c && c.Status === 'Active').map(c => c.Name)
  };
});

// The price list a quotation takes: the customer's, or (a lead) the chosen classification's.
callable('getQuotationPriceList', async (user, request) => {
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  let classification = text(d.classification, 80);
  if (d.customerId) classification = ((await rtdb.ref('customers/' + text(d.customerId, 80)).get()).val() || {}).Classification || '';
  return await priceListFor(companyId, classification);
});

// Save a draft (new or changed; a rejected one too). The number is given on the first save.
callable('saveQuotation', async (user, request) => {
  await requireCap(user, 'write');
  const d = (request.data || {}).quotation || {};
  const id = text(d.QuotationID, 80);
  const existing = id ? await load(user, id) : null;
  if (existing && !EDITABLE.includes(existing.Status)) throw failed('Only a draft or rejected quotation can be changed.');
  const companyId = existing ? existing.CompanyID : text(d.CompanyID, 80);
  requireCompany(user, companyId);
  const customerId = text(d.CustomerID, 80), leadId = text(d.LeadID, 80);
  if (!!customerId === !!leadId) throw new HttpsError('invalid-argument', 'Choose a customer or a lead.');
  let classification = '';
  if (customerId) {
    const c = (await rtdb.ref('customers/' + customerId).get()).val();
    if (!c || c.Status !== 'Active' || (c.CompanyID && c.CompanyID !== companyId)) throw new HttpsError('invalid-argument', 'Choose an active customer of this company.');
    classification = c.Classification || '';
    await requireServed(user, customerId);
  } else {
    const l = (await firestore.collection('crmLeads').doc(leadId).get()).data();
    if (!l || l.CompanyID !== companyId || l.Status !== 'Open') throw new HttpsError('invalid-argument', 'Choose an open lead of this company.');
    await requireServed(user, '', l);
    classification = text(d.Classification, 80);
  }
  const quoteDate = text(d.QuoteDate, 10), validUntil = text(d.ValidUntil, 10);
  if (!isDate(quoteDate) || !isDate(validUntil)) throw new HttpsError('invalid-argument', 'Give the quotation date and Valid until.');
  if (validUntil < quoteDate) throw new HttpsError('invalid-argument', 'Valid until cannot be before the quotation date.');
  require('./periodLock').assertNotPostDated(quoteDate, 'The quotation'); // its date this month or before (UX round 3 item 3); Valid until is free
  const opportunityId = text(d.OpportunityID, 80);
  if (opportunityId) {
    const o = (await firestore.collection('crmOpportunities').doc(opportunityId).get()).data();
    if (!o || o.CompanyID !== companyId || (customerId ? o.CustomerID !== customerId : o.LeadID !== leadId)) throw new HttpsError('invalid-argument', 'That opportunity is not this customer\'s or lead\'s.');
  }
  const priceList = await priceListFor(companyId, classification);
  const p = await priced(companyId, customerId, priceList, quoteDate, d.Lines, Boolean(user.portal));
  const fields = {
    CompanyID: companyId, CustomerID: customerId, LeadID: leadId, OpportunityID: opportunityId, Classification: classification,
    PriceListID: priceList ? priceList.PriceListID : '', CurrencyID: priceList ? priceList.CurrencyID || '' : '',
    QuoteDate: quoteDate, ValidUntil: validUntil, DivisionID: text(d.DivisionID, 80), BranchID: text(d.BranchID, 80),
    CostCenterID: text(d.CostCenterID, 80), ProfitCenterID: text(d.ProfitCenterID, 80), Terms: text(d.Terms, 4000),
    Lines: p.lines, Subtotal: p.Subtotal, TaxAmount: p.TaxAmount, TaxAdded: p.TaxAdded, TaxSummary: p.TaxSummary, Total: p.Total,
    UpdatedAt: nowIso(), UpdatedBy: actorOf(user)
  };
  if (existing) {
    await QUOTES().doc(id).update(Object.assign(fields, { Status: 'Draft', History: historyWith(existing, 'Saved', user) }));
    return { success: true, quotationId: id, number: existing.Number };
  }
  // The number under the lock, as the other documents': two first saves at once get two numbers.
  return withGlobalLock(user.uid, async () => {
    const number = await numbering.next('doc:QT', { companyId, year: Number(quoteDate.slice(0, 4)) });
    const ref = QUOTES().doc();
    await ref.set(Object.assign(fields, { Number: number, Revision: 1, PreviousID: '', Status: 'Draft', OwnerKey: ownerKeyOf(user),
      CreatedAt: nowIso(), CreatedBy: actorOf(user), History: [{ At: nowIso(), By: actorOf(user), What: 'Created' }] }));
    return { success: true, quotationId: ref.id, number };
  });
});

callable('deleteQuotationDraft', async (user, request) => {
  await requireCap(user, 'write');
  const q = await load(user, request.data && request.data.quotationId);
  if (q.Status !== 'Draft' || q.Revision > 1) throw failed('Only a first draft can be deleted (a revision is kept with its number).');
  await QUOTES().doc(q.QuotationID).delete();
  return { success: true };
});

async function approve(user, q, note) {
  await QUOTES().doc(q.QuotationID).update({ Status: 'Approved', ApprovedAt: nowIso(), ApprovedBy: actorOf(user), RejectionReason: '',
    UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: historyWith(q, note, user) });
}

// Submit: Approval Configuration's Quotation levels (Q400), or Approved at once.
callable('submitQuotation', async (user, request) => {
  await requireCap(user, 'write');
  return withGlobalLock(user.uid, async () => {
    const q = await load(user, request.data && request.data.quotationId);
    if (!EDITABLE.includes(q.Status)) throw failed('Only a draft or rejected quotation can be submitted.');
    if (q.ValidUntil < todayIn()) throw failed('This quotation has expired: change Valid until, or revise it.');
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: q.CompanyID, DivisionID: q.DivisionID, BranchID: q.BranchID, CostCenterID: q.CostCenterID });
    const label = q.Number + (q.Revision > 1 ? ' Rev ' + q.Revision : '');
    const a = await beginApprovalInstance(MODULE_ID, q.QuotationID, label, scopeKey, q.Total, user.portal ? user.portal.submitter : user.uid);
    if (!a.required) { await approve(user, q, 'Approved (no approval required)'); return { success: true, status: 'Approved' }; }
    await QUOTES().doc(q.QuotationID).update({ Status: 'PendingApproval', ApprovalInstanceID: a.instanceId, RejectionReason: '', SubmittedAt: nowIso(),
      SubmittedBy: actorOf(user), UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: historyWith(q, 'Submitted for approval', user) });
    return { success: true, status: 'PendingApproval' };
  });
});

// The approver's decision (Home's approvals; the approval card on a phone too).
callable('decideQuotationApproval', async (user, request) => {
  await requireCap(user, 'access');
  const d = request.data || {};
  return withGlobalLock(user.uid, async () => {
    const q = await load(user, d.quotationId);
    if (q.Status !== 'PendingApproval' || !q.ApprovalInstanceID) throw failed('This quotation is not waiting for approval.');
    const r = await recordApprovalDecision(user, q.ApprovalInstanceID, d.levelNumber, d.decision, d.reason);
    if (r.status === 'Approved') await approve(user, q, 'Approved');
    if (r.status === 'Rejected') {
      const reason = text(d.reason, 500);
      await QUOTES().doc(q.QuotationID).update({ Status: 'Rejected', RejectionReason: reason, UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: historyWith(q, 'Rejected', user, reason) });
    }
    return { success: true, status: r.status, selfApproved: r.selfApproved };
  });
});

// Revise (Q398): the next revision, a draft with the same number; this one is kept, Revised.
callable('reviseQuotation', async (user, request) => {
  await requireCap(user, 'write');
  return withGlobalLock(user.uid, async () => {
    const q = await load(user, request.data && request.data.quotationId);
    if (!['Approved', 'Rejected', 'PendingApproval'].includes(q.Status) && !(q.Status === 'Draft' && expired(q, todayIn()))) throw failed('Revise an approved, rejected or expired quotation; change a draft directly.');
    if (q.Status === 'PendingApproval') throw failed('Wait for the approval, or have it rejected, before revising.');
    const days = Number(((await firestore.collection('crmSetup').doc(q.CompanyID).get()).data() || {}).QuoteValidDays) || 30;
    const today = todayIn();
    const until = new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    const copy = Object.assign({}, q);
    ['QuotationID', 'ApprovalInstanceID', 'ApprovedAt', 'ApprovedBy', 'SubmittedAt', 'SubmittedBy', 'RejectionReason', 'Expired'].forEach(k => delete copy[k]);
    const ref = QUOTES().doc();
    const batch = firestore.batch();
    batch.set(ref, Object.assign(copy, { Revision: (q.Revision || 1) + 1, PreviousID: q.QuotationID, Status: 'Draft', QuoteDate: today, ValidUntil: until,
      CreatedAt: nowIso(), CreatedBy: actorOf(user), UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: [{ At: nowIso(), By: actorOf(user), What: 'Revision ' + ((q.Revision || 1) + 1) + ' of ' + q.Number }] }));
    batch.update(QUOTES().doc(q.QuotationID), { Status: 'Revised', RevisedByID: ref.id, UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: historyWith(q, 'Revised', user) });
    await batch.commit();
    return { success: true, quotationId: ref.id, revision: (q.Revision || 1) + 1 };
  });
});

// After the Sales Order is saved from it (the screen, through the order's own
// save): the quotation Accepted and linked; its opportunity Won when asked.
callable('markQuotationOrdered', async (user, request) => {
  await requireCap(user, 'write');
  const d = request.data || {};
  return withGlobalLock(user.uid, async () => {
    const q = await load(user, d.quotationId);
    if (q.Status !== 'Approved') throw failed('Only an approved quotation becomes an order.');
    if (q.LeadID) throw failed('Convert the lead to a customer first (CRM → the lead → Convert to Customer).');
    const soId = text(d.soId, 80);
    const so = await require('./salesStore').salesOrders.get(soId);
    if (!so || so.CompanyID !== q.CompanyID || so.CustomerID !== q.CustomerID) throw new HttpsError('invalid-argument', 'That Sales Order is not this quotation\'s customer\'s.');
    const batch = firestore.batch();
    batch.update(QUOTES().doc(q.QuotationID), { Status: 'Accepted', SalesOrderID: soId, SalesOrderNumber: so.SONumber || '', AcceptedAt: nowIso(),
      UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: historyWith(q, 'Ordered', user, so.SONumber || soId) });
    if (d.markWon && q.OpportunityID) {
      const oref = firestore.collection('crmOpportunities').doc(q.OpportunityID);
      const o = (await oref.get()).data();
      if (o && o.Status === 'Open') batch.update(oref, { Stage: 'Won', Probability: 100, Status: 'Won', ClosedAt: nowIso(), UpdatedAt: nowIso(), UpdatedBy: actorOf(user),
        History: (o.History || []).concat([{ At: nowIso(), By: actorOf(user), What: 'Stage: Won (quotation ' + q.Number + ' ordered)' }]) });
    }
    await batch.commit();
    return { success: true };
  });
});

module.exports.priceListFor = priceListFor;

// ---------- the rep portal (step C3; essPortal.js actions, the rep as `user`: crm.portalUser) ----------

// The rep's quotations (a sales manager: the company's), with what a new one needs.
async function portalQuotes(user, customers) {
  const companyId = user.portal.companyId;
  const today = todayIn();
  const q = user.portal.manager ? QUOTES().where('CompanyID', '==', companyId) : QUOTES().where('OwnerKey', '==', ownerKeyOf(user));
  const [list, setup, classes, units] = await Promise.all([
    q.get().then(s => s.docs.map(d => Object.assign({ QuotationID: d.id }, d.data())).filter(x => x.CompanyID === companyId)),
    firestore.collection('crmSetup').doc(companyId).get().then(s => s.exists ? s.data() : {}),
    rtdb.ref('customerClassifications').get().then(s => s.val() || {}),
    rtdb.ref('orgUnits').get().then(s => s.val() || {})
  ]);
  return {
    // Where an order from a quotation is delivered from (Q406).
    warehouses: Object.keys(units).filter(id => units[id].Type === 'Warehouse' && units[id].Status === 'Active' && (!units[id].CompanyID || units[id].CompanyID === companyId))
      .map(id => ({ WarehouseID: id, Code: units[id].Code, Name: units[id].Name })),
    today, validDays: Number(setup.QuoteValidDays) || 30,
    quotations: list.map(x => Object.assign(x, { Expired: expired(x, today) })).sort((a, b) => (b.QuoteDate || '').localeCompare(a.QuoteDate || '') || (b.Revision || 0) - (a.Revision || 0)),
    customers: customers.map(c => ({ CustomerID: c.CustomerID, Name: c.CustomerName, Code: c.CustomerCode || '', Classification: c.Classification || '',
      Address: [c.AddressLine1, c.AddressLine2, c.Country].filter(Boolean).join(', '), TaxNumber: c.TaxRegistrationNumber || c.GSTIN || '' })),
    classifications: Object.values(classes).filter(c => c && c.Status === 'Active').map(c => c.Name)
  };
}

// The items a rep may quote: the price list's (the customer's, or a lead's chosen classification's), at its price on the date.
async function portalQuoteItems(user, d) {
  const companyId = user.portal.companyId;
  let classification = text(d.classification, 80);
  if (d.customerId) {
    await requireServed(user, text(d.customerId, 80));
    classification = ((await rtdb.ref('customers/' + text(d.customerId, 80)).get()).val() || {}).Classification || '';
  }
  const pl = await priceListFor(companyId, classification);
  if (!pl) return { priceList: null, items: [] };
  const L = require('./legacy/codegs');
  const date = isDate(d.date) ? d.date : todayIn();
  const [byItem, items] = await Promise.all([L.groupPriceListLinesByItem_({}, pl.PriceListID), rtdb.ref('items').get().then(s => s.val() || {})]);
  const out = [];
  Object.values(items).forEach(it => {
    if (!it || it.Status !== 'Active' || (it.CompanyID && it.CompanyID !== companyId)) return;
    const price = L.getPriceEffectiveOnDate_(byItem, it.ItemCode, date);
    if (price) out.push({ ItemCode: it.ItemCode, ItemName: it.ItemName || '', UnitPrice: Number(price.UnitPrice) || 0 });
  });
  return { priceList: { Name: pl.Name || '', CurrencyID: pl.CurrencyID || '' }, items: out.sort((a, b) => a.ItemName.localeCompare(b.ItemName)) };
}

// Q406: the rep's approved quotation becomes a draft Sales Order, as a portal
// order is (salesRep.writeRepOrder: the rep's cost center, the office confirms
// it), at the quotation's net prices; the quotation is then Accepted.
async function orderForRep(user, me, d) {
  const q = await load(user, d.quotationId);
  if (q.Status !== 'Approved') throw failed('Only an approved quotation becomes an order.');
  if (q.ValidUntil < todayIn()) throw failed('This quotation has expired: revise it first.');
  if (q.LeadID) throw failed('This quotation is for a lead: the office converts the lead to a customer (CRM → Convert to Customer), then you can order.');
  await requireServed(user, q.CustomerID);
  const customer = Object.assign({ CustomerID: q.CustomerID }, (await rtdb.ref('customers/' + q.CustomerID).get()).val() || {});
  const [items, units] = await Promise.all([rtdb.ref('items').get().then(s => s.val() || {}), rtdb.ref('orgUnits').get().then(s => s.val() || {})]);
  const byCode = {};
  Object.values(items).forEach(it => { if (it && it.ItemCode) byCode[it.ItemCode] = it; });
  const wanted = text(d.warehouseId, 80);
  const lines = q.Lines.map((l, i) => {
    const it = byCode[l.ItemCode] || {};
    const wh = l.WarehouseID || wanted || it.DefaultWarehouseID || '';
    const u = units[wh];
    if (!u || u.Type !== 'Warehouse' || (u.CompanyID && u.CompanyID !== q.CompanyID)) throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': choose a warehouse.');
    return { ItemCode: l.ItemCode, WarehouseID: wh, OrderedQuantity: l.Quantity, EnteredUOMID: it.UOMID || '', UnitPrice: l.NetPrice };
  });
  const priceList = q.PriceListID ? Object.assign({ PriceListID: q.PriceListID }, (await rtdb.ref('priceLists/' + q.PriceListID).get()).val() || {}) : null;
  const so = await require('./salesRep').writeRepOrder(me, customer, priceList, lines, { note: 'From quotation ' + q.Number + (q.Revision > 1 ? ' Rev ' + q.Revision : '') });
  await cores.markQuotationOrdered(user, { data: { quotationId: q.QuotationID, soId: so.soId, markWon: d.markWon !== false } });
  return { success: true, soId: so.soId };
}

// The cores the portal runs with the rep as the user (approving stays in the ERP).
const PORTAL = ['saveQuotation', 'deleteQuotationDraft', 'submitQuotation', 'reviseQuotation'];
const runForRep = (user, name, data) => {
  if (!PORTAL.includes(name)) throw new HttpsError('permission-denied', 'Not from the portal.');
  const d = Object.assign({}, data || {});
  // The rep's company, whatever the phone sends.
  ['quotation'].forEach(k => { if (d[k] && typeof d[k] === 'object') d[k] = Object.assign({}, d[k], { CompanyID: user.portal.companyId }); });
  return cores[name](user, { data: d });
};

Object.assign(module.exports, { portalQuotes, portalQuoteItems, orderForRep, runForRep });
