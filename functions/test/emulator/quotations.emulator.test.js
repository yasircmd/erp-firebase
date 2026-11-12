// CRM step C2, Quotations (owner, 2026-11-05; docs/modules/CRM.md, Q398-Q400):
// a quotation saved with its QT number, discount and tax (UAE VAT); the price
// list by the customer's classification, or the lead's chosen one; the
// checks; submit without approval levels (Approved) and with them (Home,
// the approval card, reject, resubmit); Revise (Rev 2, the earlier Revised);
// a lead's quotation moved to the customer on Convert; the order made from
// it Accepted and linked, the opportunity Won; the Viewer and another
// company refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture } = require('./_helpers');
const engine = require('../../src/taxEngine');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.then(x => ({ ok: true, x }), e => ({ ok: false, error: e.message })); assert.equal(r.ok, false, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
// The company's own date (Asia/Dubai), as the server's: the UTC date is a day behind from 20:00 UTC.
const S = require('../../src/recurringSchedule');
const today = S.todayIn(S.TIME_ZONE);
const daysFrom = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const yy = today.slice(2, 4) + '-01'; // the year, then company C1's code

async function ready(o) {
  const f = baseFixture();
  Object.assign(f.items.I1, { TaxCode: 'SR' });
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV', TaxCode: 'SR' };
  f.customerClassifications = { CLS1: { Name: 'Local', IsExport: false, Status: 'Active', CompanyID: '' }, CLS2: { Name: 'Export', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR' } };
  f.priceLists = { PL1: { Name: 'Local', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Local', CurrencyID: 'AED' },
    PL2: { Name: 'Export', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Export', CurrencyID: 'USD' } };
  if (o && o.approval) {
    f.approvalConfigurations = { QUOTATION: { Enabled: true, ScopeType: 'Global' } };
    f.approvalLevels = { QUOTATION: { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-approver', ThresholdAmount: 0 }] } } };
  }
  await reset(f);
  const cfg = engine.preset('AE_VAT');
  cfg.Components.forEach(c => { c.OutputAccountID = 'A-VATOUT'; c.InputAccountID = 'A-VATIN'; });
  ok(await call('u-admin', 'saveTaxConfig', { companyId: 'C1', config: cfg }));
}
const quote = (q, uid) => call(uid || 'u-admin', 'saveQuotation', { quotation: Object.assign({ CompanyID: 'C1', CustomerID: 'CU1', QuoteDate: today, ValidUntil: daysFrom(30),
  Lines: [{ ItemCode: 'RM-001', Quantity: 10, UnitPrice: 100, DiscountPct: 10 }, { ItemCode: 'FG-002', Quantity: 2, UnitPrice: 50 }] }, q || {}) });
const get = async id => (await call('u-admin', 'getQuotations', { companyId: 'C1' })).quotations.find(q => q.QuotationID === id);

test('a quotation: the QT number, discount, VAT and the customer\'s price list; the checks', async () => {
  await ready();
  const r = ok(await quote());
  assert.equal(r.number, 'QT-' + yy + '-000001');
  const q = await get(r.quotationId);
  assert.deepEqual(q.Lines.map(l => [l.ItemCode, l.NetPrice, l.Amount, l.Description]), [['RM-001', 90, 900, 'Steel Sheet'], ['FG-002', 50, 100, 'Bracket']]);
  assert.deepEqual([q.Subtotal, q.TaxAmount, q.Total, q.PriceListID, q.CurrencyID, q.Status, q.Revision], [1000, 50, 1050, 'PL1', 'AED', 'Draft', 1]);
  assert.equal(ok(await quote()).number, 'QT-' + yy + '-000002', 'the series counts on');
  // Saved again: the same number.
  assert.equal(ok(await quote({ QuotationID: r.quotationId, Terms: 'Delivery in 2 weeks' })).number, r.number);
  assert.match(await err(quote({ Lines: [] })), /at least one item line/);
  assert.match(await err(quote({ Lines: [{ ItemCode: 'NOPE', Quantity: 1, UnitPrice: 1 }] })), /Line 1: unknown or inactive item/);
  assert.match(await err(quote({ Lines: [{ ItemCode: 'RM-001', Quantity: 0, UnitPrice: 1 }] })), /quantity must be more than zero/);
  assert.match(await err(quote({ Lines: [{ ItemCode: 'RM-001', Quantity: 1, UnitPrice: 1, DiscountPct: 120 }] })), /discount is 0 to 100/);
  assert.match(await err(quote({ ValidUntil: daysFrom(-1) })), /cannot be before the quotation date/);
  assert.match(await err(quote({ CustomerID: '' })), /a customer or a lead/);
  assert.match(await err(quote({}, 'u-viewer')), /permission to change quotations/);
  assert.match(await err(call('u-other', 'getQuotations', { companyId: 'C1' })), /access to that company/);
  assert.equal((await call('u-viewer', 'getQuotations', { companyId: 'C1' })).quotations.length, 2, 'the Viewer reads them');
  // The price list for the screen: the customer's classification.
  assert.equal((await call('u-admin', 'getQuotationPriceList', { companyId: 'C1', customerId: 'CU1' })).PriceListID, 'PL1');
  assert.equal((await call('u-admin', 'getQuotationPriceList', { companyId: 'C1', classification: 'Export' })).PriceListID, 'PL2');
  ok(await call('u-admin', 'deleteQuotationDraft', { quotationId: r.quotationId }));
  assert.equal(await get(r.quotationId), undefined);
});

test('submit with no approval levels: Approved at once; then read-only; Revise makes Rev 2, the earlier Revised', async () => {
  await ready();
  const r = ok(await quote());
  assert.equal((await call('u-admin', 'submitQuotation', { quotationId: r.quotationId })).status, 'Approved');
  assert.match(await err(quote({ QuotationID: r.quotationId })), /Only a draft or rejected/);
  const rev = ok(await call('u-admin', 'reviseQuotation', { quotationId: r.quotationId }));
  assert.equal(rev.revision, 2);
  const [old, next] = [await get(r.quotationId), await get(rev.quotationId)];
  assert.deepEqual([old.Status, old.RevisedByID], ['Revised', rev.quotationId]);
  assert.deepEqual([next.Number, next.Revision, next.Status, next.PreviousID, next.ValidUntil, next.Lines.length], [r.number, 2, 'Draft', r.quotationId, daysFrom(30), 2]);
  assert.match(await err(call('u-admin', 'reviseQuotation', { quotationId: r.quotationId })), /Revise an approved, rejected or expired/);
  assert.match(await err(call('u-admin', 'deleteQuotationDraft', { quotationId: rev.quotationId })), /Only a first draft/);
});

test('with Approval Configuration\'s Quotation levels: on the approver\'s Home and card; rejected, changed, resubmitted, approved', async () => {
  await ready({ approval: true });
  const r = ok(await quote());
  assert.equal((await call('u-admin', 'submitQuotation', { quotationId: r.quotationId })).status, 'PendingApproval');
  const task = (await call('u-approver', 'getPendingApprovalsForUser', {})).find(x => x.DocumentID === r.quotationId);
  assert.ok(task, 'on the approver\'s Home');
  const card = await call('u-approver', 'getApprovalSummary', { instanceId: task.InstanceID });
  assert.deepEqual([card.Amount, card.Decide.fn, card.Decide.id], [1050, 'decideQuotationApproval', 'quotationId']);
  assert.match(await err(call('u-admin', 'reviseQuotation', { quotationId: r.quotationId })), /Wait for the approval/);
  assert.equal((await call('u-approver', 'decideQuotationApproval', { quotationId: r.quotationId, levelNumber: 1, decision: 'Rejected', reason: 'Too much discount' })).status, 'Rejected');
  assert.deepEqual([(await get(r.quotationId)).Status, (await get(r.quotationId)).RejectionReason], ['Rejected', 'Too much discount']);
  ok(await quote({ QuotationID: r.quotationId, Lines: [{ ItemCode: 'RM-001', Quantity: 10, UnitPrice: 100, DiscountPct: 5 }] }));
  assert.equal((await call('u-admin', 'submitQuotation', { quotationId: r.quotationId })).status, 'PendingApproval');
  assert.equal((await call('u-approver', 'decideQuotationApproval', { quotationId: r.quotationId, levelNumber: 1, decision: 'Approved', reason: '' })).status, 'Approved');
  const q = await get(r.quotationId);
  assert.deepEqual([q.Status, q.Total], ['Approved', 997.5]);
});

test('a lead\'s quotation: its classification\'s price list; not ordered until converted; Convert moves it; the order Accepted and the opportunity Won', async () => {
  await ready();
  const lead = ok(await call('u-admin', 'saveLead', { lead: { CompanyID: 'C1', Name: 'Sara', Organisation: 'Gulf Trading', Phone: '050 999 8888', Email: 'sara@gulf.example', Source: 'Website' } }));
  const opp = ok(await call('u-admin', 'saveOpportunity', { opportunity: { CompanyID: 'C1', LeadID: lead.leadId, Title: 'Racks', ExpectedValue: 1000, Currency: 'AED' } }));
  assert.match(await err(quote({ CustomerID: '', LeadID: lead.leadId, OpportunityID: 'nope' })), /not this customer's or lead's/);
  const r = ok(await quote({ CustomerID: '', LeadID: lead.leadId, Classification: 'Export', OpportunityID: opp.opportunityId }));
  let q = await get(r.quotationId);
  assert.deepEqual([q.PriceListID, q.CurrencyID, q.LeadID], ['PL2', 'USD', lead.leadId]);
  ok(await call('u-admin', 'submitQuotation', { quotationId: r.quotationId }));
  assert.match(await err(call('u-admin', 'markQuotationOrdered', { quotationId: r.quotationId, soId: 'x' })), /Convert the lead to a customer first/);
  // Convert to Customer (Customer Master's save, then convertLead): the quotation moves with the opportunity.
  const c = ok(await call('u-admin', 'saveCustomer', { customerData: { CustomerName: 'Gulf Trading', CompanyID: 'C1', Classification: 'Export', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 30, Country: 'Oman' } }));
  const conv = ok(await call('u-admin', 'convertLead', { leadId: lead.leadId, customerId: c.customerId }));
  assert.equal(conv.moved.quotations, 1);
  q = await get(r.quotationId);
  assert.deepEqual([q.LeadID, q.CustomerID, q.FromLeadID], ['', c.customerId, lead.leadId]);
  // The order (the screen saves it through the Sales Order's own save), then linked.
  const other = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: today, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: 'CU1',
    Lines: [{ ItemCode: 'RM-001', WarehouseID: 'WH1', OrderedQuantity: 1, UnitPrice: 1 }] } }));
  assert.match(await err(call('u-admin', 'markQuotationOrdered', { quotationId: r.quotationId, soId: other.soId })), /not this quotation's customer's/);
  const so = ok(await call('u-admin', 'saveDraftSalesOrder', { header: { SODate: today, CompanyID: 'C1', CostCenterID: 'CC1', CustomerID: c.customerId,
    Lines: q.Lines.map(l => ({ ItemCode: l.ItemCode, WarehouseID: 'WH1', OrderedQuantity: l.Quantity, UnitPrice: l.NetPrice })) } }));
  ok(await call('u-admin', 'markQuotationOrdered', { quotationId: r.quotationId, soId: so.soId, markWon: true }));
  q = await get(r.quotationId);
  assert.deepEqual([q.Status, q.SalesOrderID], ['Accepted', so.soId]);
  const o = (await firestore.collection('crmOpportunities').doc(opp.opportunityId).get()).data();
  assert.deepEqual([o.Stage, o.Status, o.Probability], ['Won', 'Won', 100]);
  assert.match(await err(call('u-admin', 'markQuotationOrdered', { quotationId: r.quotationId, soId: so.soId })), /Only an approved quotation/);
  assert.match(await err(call('u-admin', 'reviseQuotation', { quotationId: r.quotationId })), /Revise an approved, rejected or expired/);
});

test('expired: past Valid until it shows Expired, cannot be submitted, and can be revised', async () => {
  await ready();
  const r = ok(await quote({ QuoteDate: daysFrom(-40), ValidUntil: daysFrom(-10) }));
  assert.equal((await get(r.quotationId)).Expired, true);
  assert.match(await err(call('u-admin', 'submitQuotation', { quotationId: r.quotationId })), /has expired/);
  const rev = ok(await call('u-admin', 'reviseQuotation', { quotationId: r.quotationId }));
  assert.equal((await get(rev.quotationId)).Expired, false);
});
