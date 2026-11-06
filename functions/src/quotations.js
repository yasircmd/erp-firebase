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
const actorOf = user => user.profile.username || user.uid;
const nowIso = () => new Date().toISOString();
const failed = m => new HttpsError('failed-precondition', m);
const historyWith = (q, what, user, note) => (q.History || []).concat([{ At: nowIso(), By: actorOf(user), What: what + (note ? ': ' + note : '') }]);

async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) throw new HttpsError('permission-denied', cap === 'write' ? 'You do not have permission to change quotations.' : 'You do not have access to Quotations.');
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
async function load(user, id) {
  const snap = await QUOTES().doc(text(id, 80)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Quotation not found.');
  const q = Object.assign({ QuotationID: snap.id }, snap.data());
  requireCompany(user, q.CompanyID);
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
async function priced(companyId, partyId, priceList, date, rawLines) {
  const items = (await rtdb.ref('items').get()).val() || {};
  const byCode = {};
  Object.values(items).forEach(it => { if (it && it.ItemCode) byCode[it.ItemCode] = it; });
  const lines = (Array.isArray(rawLines) ? rawLines : []).filter(l => l && text(l.ItemCode, 60)).slice(0, 300).map((l, i) => {
    const code = text(l.ItemCode, 60);
    const it = byCode[code];
    if (!it || it.Status !== 'Active') throw new HttpsError('invalid-argument', 'Line ' + (i + 1) + ': unknown or inactive item (' + code + ').');
    const quantity = Number(l.Quantity), unitPrice = Number(l.UnitPrice) || 0, discountPct = Number(l.DiscountPct) || 0;
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

// The company's quotations (the list), and what the screen needs to make one.
exports.getQuotations = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.getQuotationPriceList = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  let classification = text(d.classification, 80);
  if (d.customerId) classification = ((await rtdb.ref('customers/' + text(d.customerId, 80)).get()).val() || {}).Classification || '';
  return await priceListFor(companyId, classification);
});

// Save a draft (new or changed; a rejected one too). The number is given on the first save.
exports.saveQuotation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
  } else {
    const l = (await firestore.collection('crmLeads').doc(leadId).get()).data();
    if (!l || l.CompanyID !== companyId || l.Status !== 'Open') throw new HttpsError('invalid-argument', 'Choose an open lead of this company.');
    classification = text(d.Classification, 80);
  }
  const quoteDate = text(d.QuoteDate, 10), validUntil = text(d.ValidUntil, 10);
  if (!isDate(quoteDate) || !isDate(validUntil)) throw new HttpsError('invalid-argument', 'Give the quotation date and Valid until.');
  if (validUntil < quoteDate) throw new HttpsError('invalid-argument', 'Valid until cannot be before the quotation date.');
  const opportunityId = text(d.OpportunityID, 80);
  if (opportunityId) {
    const o = (await firestore.collection('crmOpportunities').doc(opportunityId).get()).data();
    if (!o || o.CompanyID !== companyId || (customerId ? o.CustomerID !== customerId : o.LeadID !== leadId)) throw new HttpsError('invalid-argument', 'That opportunity is not this customer\'s or lead\'s.');
  }
  const priceList = await priceListFor(companyId, classification);
  const p = await priced(companyId, customerId, priceList, quoteDate, d.Lines);
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
    await ref.set(Object.assign(fields, { Number: number, Revision: 1, PreviousID: '', Status: 'Draft', OwnerKey: 'U:' + user.uid,
      CreatedAt: nowIso(), CreatedBy: actorOf(user), History: [{ At: nowIso(), By: actorOf(user), What: 'Created' }] }));
    return { success: true, quotationId: ref.id, number };
  });
});

exports.deleteQuotationDraft = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.submitQuotation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireCap(user, 'write');
  return withGlobalLock(user.uid, async () => {
    const q = await load(user, request.data && request.data.quotationId);
    if (!EDITABLE.includes(q.Status)) throw failed('Only a draft or rejected quotation can be submitted.');
    if (q.ValidUntil < todayIn()) throw failed('This quotation has expired: change Valid until, or revise it.');
    const scopeKey = await resolveApprovalScopeKeyForDocument(MODULE_ID, { CompanyID: q.CompanyID, DivisionID: q.DivisionID, BranchID: q.BranchID, CostCenterID: q.CostCenterID });
    const label = q.Number + (q.Revision > 1 ? ' Rev ' + q.Revision : '');
    const a = await beginApprovalInstance(MODULE_ID, q.QuotationID, label, scopeKey, q.Total, user.uid);
    if (!a.required) { await approve(user, q, 'Approved (no approval required)'); return { success: true, status: 'Approved' }; }
    await QUOTES().doc(q.QuotationID).update({ Status: 'PendingApproval', ApprovalInstanceID: a.instanceId, RejectionReason: '', SubmittedAt: nowIso(),
      SubmittedBy: actorOf(user), UpdatedAt: nowIso(), UpdatedBy: actorOf(user), History: historyWith(q, 'Submitted for approval', user) });
    return { success: true, status: 'PendingApproval' };
  });
});

// The approver's decision (Home's approvals; the approval card on a phone too).
exports.decideQuotationApproval = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.reviseQuotation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.markQuotationOrdered = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
