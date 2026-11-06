// CRM in the rep portal, step C3 (owner, 2026-11-06; docs/modules/CRM.md,
// Q404-Q406): a rep adds leads (the duplicate warning), opportunities and
// activities for their own customers and leads, through the ERP's rules; sees
// only their own (a sales manager the company's; the office's CRM Manager
// sees the reps'); quotes at the price list's price with a discount only;
// submits (Approval Configuration's levels, decided in the ERP); orders an
// approved quotation as a draft Sales Order the office confirms. Convert,
// setup and approving stay in the ERP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val, put } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.then(x => ({ ok: true, x }), e => ({ ok: false, error: e.message })); assert.equal(r.ok, false, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const ess = (uid, action, data) => call(uid, 'essPortal', Object.assign({ action }, data || {}));
const crmRun = (uid, what, data) => ess(uid, 'crmRun', { what, data });
const quoteRun = (uid, what, data) => ess(uid, 'quoteRun', { what, data });
const today = new Date().toISOString().slice(0, 10);
const daysFrom = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// The reps: Sam (E1, u-viewer), Mia the sales manager (E2, u-approver), Rob (E3, u-admin).
const SAM = 'u-viewer', MIA = 'u-approver', ROB = 'u-admin';

test.before(async () => {
  const f = baseFixture();
  f.customers = {
    CU1: { CustomerCode: 'C001', CustomerName: 'Corner Shop', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', Phone: '0500000001', SalesRepEmployeeID: 'E1' },
    CU2: { CustomerCode: 'C002', CustomerName: 'Market Stall', Status: 'Active', CompanyID: 'C1', Classification: 'Retail', TradeReceivablesAccountID: 'A-AR', SalesRepEmployeeID: 'E3' }
  };
  f.customerClassifications = { CL1: { Name: 'Retail', IsExport: false, Status: 'Active', CompanyID: '' } };
  f.priceLists = { PL1: { Name: 'Retail', CompanyID: 'C1', Status: 'Active', CustomerClassificationMapping: 'Retail', CurrencyID: 'AED' } };
  f.priceListLines = { L1: { PriceListID: 'PL1', ItemCode: 'RM-001', UnitPrice: 60, EffectiveFrom: '2026-01-01', Status: 'Active' } };
  f.items.I2 = { ItemCode: 'FG-002', ItemName: 'Bracket', Category: 'FinishedGood', Status: 'Active', CompanyID: 'C1', UOMID: 'UOM-PCS', InventoryAccountID: 'A-INV' };
  f.salesReps = { E1: { CompanyID: 'C1', Active: true, IsManager: false }, E2: { CompanyID: 'C1', Active: true, IsManager: true }, E3: { CompanyID: 'C1', Active: true, IsManager: false } };
  await reset(f);
  const emp = (id, no, name, uid) => firestore.collection('employees').doc(id).set({ EmployeeNo: no, FullName: name, CompanyID: 'C1', Status: 'Active', UserUID: uid, CostCenterID: 'CC1' });
  await emp('E1', 'EMP-0001', 'Sam Seller', SAM);
  await emp('E2', 'EMP-0002', 'Mia Manager', MIA);
  await emp('E3', 'EMP-0003', 'Rob Rep', ROB);
});

let samLead, samOpp;
test('leads: a rep adds their own (the duplicate warning as in the ERP); sees only theirs; the sales manager and the office\'s CRM Manager see them', async () => {
  const h = await ess(SAM, 'crm');
  assert.deepEqual([h.leads.length, h.myKey, h.manager, h.customers.map(c => c.CustomerID)], [0, 'E:E1', false, ['CU1']]);
  assert.deepEqual(h.setup.AllStages.map(s => s.Name).slice(-2), ['Won', 'Lost']);
  const dup = await crmRun(SAM, 'saveLead', { lead: { CompanyID: 'C1', Organisation: 'Gulf Trading', Name: 'Sara', Phone: '050 000 0001', Source: 'Website' } });
  assert.equal(dup.success, false);
  assert.deepEqual(dup.duplicates.map(d => [d.Kind, d.Match]), [['Customer', ['phone']]]);
  samLead = ok(await crmRun(SAM, 'saveLead', { lead: { CompanyID: 'C1', Organisation: 'Gulf Trading', Name: 'Sara', Phone: '050 000 0001', Source: 'Website' }, force: true })).leadId;
  ok(await crmRun(ROB, 'saveLead', { lead: { CompanyID: 'C1', Organisation: 'Desert Co', Phone: '052 111 2222', Source: 'Referral', OwnerKey: 'E:E1' } }));
  const lead = (await firestore.collection('crmLeads').doc(samLead).get()).data();
  assert.deepEqual([lead.OwnerKey, lead.CreatedBy], ['E:E1', 'Portal: EMP-0001 Sam Seller']);
  assert.deepEqual((await ess(SAM, 'crm')).leads.map(l => l.Organisation), ['Gulf Trading'], 'only Sam\'s');
  assert.deepEqual((await ess(ROB, 'crm')).leads.map(l => [l.Organisation, l.OwnerKey]), [['Desert Co', 'E:E3']], 'a rep\'s records are the rep\'s, whatever owner is asked');
  assert.deepEqual((await ess(MIA, 'crm')).leads.map(l => l.Organisation).sort(), ['Desert Co', 'Gulf Trading'], 'the sales manager sees the company\'s');
  assert.ok((await call('u-admin', 'getCrm', { companyId: 'C1' })).leads.some(l => l.ID === samLead), 'the office\'s CRM Manager');
  assert.match(await err(crmRun(ROB, 'saveLead', { lead: { ID: samLead, CompanyID: 'C1', Organisation: 'Taken', Phone: '1', Source: 'Website' }, force: true })), /not yours/);
});

test('opportunities and activities: for the rep\'s own customers and leads; through the stages; done with the next', async () => {
  assert.match(await err(crmRun(SAM, 'saveOpportunity', { opportunity: { CompanyID: 'C1', CustomerID: 'CU2', Title: 'Not mine' } })), /not one of yours/);
  samOpp = ok(await crmRun(SAM, 'saveOpportunity', { opportunity: { CompanyID: 'C1', CustomerID: 'CU1', Title: 'Shelving', ExpectedValue: 900, Currency: 'AED' } })).opportunityId;
  ok(await crmRun(SAM, 'saveOpportunity', { opportunity: { CompanyID: 'C1', LeadID: samLead, Title: 'First order', ExpectedValue: 300 } }));
  ok(await crmRun(SAM, 'setOpportunityStage', { opportunityId: samOpp, stage: 'Proposal' }));
  assert.match(await err(crmRun(SAM, 'setOpportunityStage', { opportunityId: samOpp, stage: 'Lost' })), /Choose why it was lost/);
  assert.equal((await firestore.collection('crmOpportunities').doc(samOpp).get()).data().Probability, 50);
  assert.match(await err(crmRun(SAM, 'saveActivity', { activity: { CompanyID: 'C1', Type: 'Visit', Subject: 'x', Due: today, About: { Kind: 'Customer', ID: 'CU2' } } })), /not one of yours/);
  const a = ok(await crmRun(SAM, 'saveActivity', { activity: { CompanyID: 'C1', Type: 'Visit', Subject: 'Show samples', Due: today, About: { Kind: 'Opportunity', ID: samOpp } } }));
  const done = ok(await crmRun(SAM, 'closeActivity', { activityId: a.activityId, outcome: 'Liked them', next: { Type: 'Call', Subject: 'Follow up', Due: daysFrom(7) } }));
  const h = await ess(SAM, 'crm');
  assert.deepEqual(h.activities.map(x => [x.Subject, x.OwnerKey]), [['Follow up', 'E:E1']], 'open ones only: the next');
  assert.ok(done.nextActivityId);
  assert.match(await err(crmRun(SAM, 'convertLead', { leadId: samLead, customerId: 'CU1' })), /Not from the portal/);
  assert.match(await err(crmRun(SAM, 'saveCrmSetup', { companyId: 'C1', setup: {} })), /Not from the portal/);
  assert.match(await err(crmRun(SAM, 'reassignCrm', { kind: 'Lead', id: samLead, ownerKey: 'E:E3' })), /Not from the portal/);
});

let samQuote;
test('a rep\'s quotation (Q405): the price list\'s price whatever the phone says, the discount the rep\'s; only their customers and the list\'s items', async () => {
  const items = await ess(SAM, 'quoteItems', { customerId: 'CU1' });
  assert.deepEqual([items.priceList.CurrencyID, items.items.map(i => [i.ItemCode, i.UnitPrice])], ['AED', [['RM-001', 60]]]);
  assert.match(await err(ess(SAM, 'quoteItems', { customerId: 'CU2' })), /not one of yours/);
  const q = d => quoteRun(SAM, 'saveQuotation', { quotation: Object.assign({ CompanyID: 'C1', CustomerID: 'CU1', QuoteDate: today, ValidUntil: daysFrom(30), OpportunityID: samOpp,
    Lines: [{ ItemCode: 'RM-001', Quantity: 5, UnitPrice: 1, DiscountPct: 10 }] }, d || {}) });
  assert.match(await err(q({ Lines: [{ ItemCode: 'FG-002', Quantity: 1, UnitPrice: 5 }] })), /Line 1: FG-002 is not on the price list/);
  assert.match(await err(q({ CustomerID: 'CU2', OpportunityID: '' })), /not one of yours/);
  const r = ok(await q());
  samQuote = r.quotationId;
  const saved = (await firestore.collection('quotations').doc(samQuote).get()).data();
  assert.deepEqual([saved.Lines[0].UnitPrice, saved.Lines[0].NetPrice, saved.Subtotal, saved.OwnerKey, saved.CreatedBy], [60, 54, 270, 'E:E1', 'Portal: EMP-0001 Sam Seller'], 'the list\'s 60, less 10 %');
  // The rep's list; another rep's quotation is not theirs; the office sees it in Quotations.
  assert.deepEqual((await ess(SAM, 'crm')).quotations.map(x => x.Number), [r.number]);
  assert.deepEqual((await ess(ROB, 'crm')).quotations, []);
  assert.match(await err(quoteRun(ROB, 'submitQuotation', { quotationId: samQuote })), /not yours/);
  assert.equal((await ess(MIA, 'crm')).quotations.length, 1, 'the sales manager');
  assert.ok((await call('u-admin', 'getQuotations', { companyId: 'C1' })).quotations.some(x => x.QuotationID === samQuote));
  assert.match(await err(quoteRun(SAM, 'decideQuotationApproval', { quotationId: samQuote })), /Not from the portal/);
});

test('submit with approval levels: decided in the ERP; then the rep orders it (Q406): a draft Sales Order at the net prices, the quotation Accepted, the opportunity Won', async () => {
  await put('approvalConfigurations/QUOTATION', { Enabled: true, ScopeType: 'Global' });
  await put('approvalLevels/QUOTATION', { GLOBAL: { Levels: [{ LevelNumber: 1, ApproverUserID: 'u-other', ThresholdAmount: 0 }] } });
  await put('users/u-other/AssignedCompanies', ['C1']);
  assert.equal((await quoteRun(SAM, 'submitQuotation', { quotationId: samQuote })).status, 'PendingApproval');
  assert.match(await err(ess(SAM, 'quoteOrder', { quotationId: samQuote })), /Only an approved quotation/);
  const task = (await call('u-other', 'getPendingApprovalsForUser', {})).find(x => x.DocumentID === samQuote);
  assert.ok(task, 'on the approver\'s Home');
  assert.equal((await call('u-other', 'decideQuotationApproval', { quotationId: samQuote, levelNumber: 1, decision: 'Approved', reason: '' })).status, 'Approved');
  const o = ok(await ess(SAM, 'quoteOrder', { quotationId: samQuote, warehouseId: 'WH1' }));
  const so = await val('salesOrders/' + o.soId);
  assert.deepEqual([so.Status, so.CustomerID, so.CostCenterID, so.SalesRepEmployeeID, so.Lines.map(l => [l.ItemCode, l.OrderedQuantity, l.UnitPrice, l.WarehouseID]), so.Total],
    ['Draft', 'CU1', 'CC1', 'E1', [['RM-001', 5, 54, 'WH1']], 270]);
  assert.match(so.Description, /^From quotation QT-/);
  const q = (await firestore.collection('quotations').doc(samQuote).get()).data();
  assert.deepEqual([q.Status, q.SalesOrderID], ['Accepted', o.soId]);
  assert.equal((await firestore.collection('crmOpportunities').doc(samOpp).get()).data().Status, 'Won');
  ok(await call('u-admin', 'confirmSalesOrder', { soId: o.soId }));
});

test('a lead\'s quotation: the classification\'s price list; not ordered from the phone until the office converts the lead; Revise keeps the rep as owner', async () => {
  const r = ok(await quoteRun(SAM, 'saveQuotation', { quotation: { CompanyID: 'C1', LeadID: samLead, Classification: 'Retail', QuoteDate: today, ValidUntil: daysFrom(10),
    Lines: [{ ItemCode: 'RM-001', Quantity: 1 }] } }));
  await put('approvalConfigurations/QUOTATION', null);
  ok(await quoteRun(SAM, 'submitQuotation', { quotationId: r.quotationId }));
  assert.match(await err(ess(SAM, 'quoteOrder', { quotationId: r.quotationId })), /the office converts the lead/);
  assert.match(await err(quoteRun(ROB, 'saveQuotation', { quotation: { CompanyID: 'C1', LeadID: samLead, Classification: 'Retail', QuoteDate: today, ValidUntil: daysFrom(10), Lines: [{ ItemCode: 'RM-001', Quantity: 1 }] } })), /That lead is not yours/);
  const rev = ok(await quoteRun(SAM, 'reviseQuotation', { quotationId: r.quotationId }));
  assert.equal((await firestore.collection('quotations').doc(rev.quotationId).get()).data().OwnerKey, 'E:E1');
  // Not a rep: no CRM in the portal.
  await put('salesReps/E3/Active', false);
  assert.match(await err(ess(ROB, 'crm')), /not set up as a sales rep/);
});
