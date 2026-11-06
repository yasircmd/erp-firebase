// CRM, step C1 (owner, 2026-11-05; docs/modules/CRM.md, Q393-Q404): the
// setup and its defaults; leads with the duplicate warning; who sees and
// changes what (owner, CRM Manager, Viewer); opportunities through the
// stages to Won / Lost; activities on Home and closed with the next one;
// Convert to Customer moving the lead's opportunities and activities.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, firestore, call, reset, baseFixture, val } = require('./_helpers');

test.after(async () => { await app.delete(); });
const ok = r => { assert.equal(r && r.success, true, r && r.error); return r; };
const err = async p => { const r = await p.then(x => ({ ok: true, x }), e => ({ ok: false, error: e.message })); assert.equal(r.ok, false, 'expected a refusal: ' + JSON.stringify(r.x)); return r.error; };
const today = new Date().toISOString().slice(0, 10);
const daysFrom = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function fixture() {
  const f = baseFixture();
  // Two sales users (write, no manage) and the Viewer (access only).
  Object.assign(f.users, {
    'u-rep1': { status: 'Active', role: 'Sales', username: 'rep1', fullName: 'Rep One', AssignedCompanies: ['C1'] },
    'u-rep2': { status: 'Active', role: 'Sales', username: 'rep2', fullName: 'Rep Two', AssignedCompanies: ['C1'] }
  });
  f.permissions.CRM.access.push('Sales');
  f.permissions.CRM.write.push('Sales');
  f.customers = { CU1: { CustomerCode: 'C001', CustomerName: 'Retail Co', Status: 'Active', CompanyID: 'C1', Phone: '+971 50 111 2222', TradeReceivablesAccountID: 'A-AR' } };
  return f;
}
const lead = (o, uid) => call(uid || 'u-rep1', 'saveLead', Object.assign({ lead: Object.assign({ CompanyID: 'C1', Name: 'Sara', Organisation: 'Gulf Trading', Phone: '050 999 8888', Email: 'sara@gulf.example', Source: 'Website' }, o.lead || {}) }, o.force ? { force: true } : {}));

test('setup: the defaults until saved; only a CRM Manager changes it; Won and Lost stay last', async () => {
  await reset(fixture());
  const s = (await call('u-rep1', 'getCrm', { companyId: 'C1' })).setup;
  assert.deepEqual(s.AllStages.map(x => x.Name), ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
  assert.equal(s.QuoteValidDays, 30);
  const setup = { Stages: [{ Name: 'New', Probability: 10 }, { Name: 'Demo', Probability: 40 }], LostReasons: ['Price'], LeadSources: ['Website', 'Referral'], ActivityTypes: ['Call', 'Visit'], QuoteValidDays: 15 };
  assert.match(await err(call('u-rep1', 'saveCrmSetup', { companyId: 'C1', setup })), /Only a CRM Manager/);
  assert.match(await err(call('u-admin', 'saveCrmSetup', { companyId: 'C1', setup: Object.assign({}, setup, { Stages: [{ Name: 'Won', Probability: 100 }] }) })), /Won and Lost are always the last/);
  ok(await call('u-admin', 'saveCrmSetup', { companyId: 'C1', setup }));
  assert.deepEqual((await call('u-rep1', 'getCrm', { companyId: 'C1' })).setup.AllStages.map(x => x.Name), ['New', 'Demo', 'Won', 'Lost']);
});

test('leads: required fields; the duplicate warning (a customer\'s phone, another lead\'s email); saved anyway with force', async () => {
  await reset(fixture());
  assert.match(await err(lead({ lead: { Name: '', Organisation: '' } })), /name or organisation/);
  assert.match(await err(lead({ lead: { Phone: '', Email: '' } })), /phone or an email/);
  assert.match(await err(lead({ lead: { Source: 'Carrier pigeon' } })), /lead source/);
  ok(await lead({}));
  const dupCustomer = await lead({ lead: { Name: 'Ali', Organisation: 'Other Co', Phone: '00971501112222', Email: 'ali@other.example' } });
  assert.equal(dupCustomer.success, false);
  assert.deepEqual(dupCustomer.duplicates.map(d => [d.Kind, d.Name, d.Match]), [['Customer', 'Retail Co (C001)', ['phone']]], 'the same number, written differently');
  const dupLead = await lead({ lead: { Name: 'S. Khan', Organisation: 'Another', Phone: '055 000 0000', Email: 'SARA@gulf.example' } });
  assert.deepEqual(dupLead.duplicates.map(d => [d.Kind, d.Match]), [['Lead', ['email']]]);
  ok(await lead({ lead: { Name: 'S. Khan', Organisation: 'Another', Phone: '055 000 0000', Email: 'SARA@gulf.example' }, force: true }));
  assert.equal((await call('u-rep1', 'getCrm', { companyId: 'C1' })).leads.length, 2);
});

test('visibility: an owner sees their own; a CRM Manager sees all and reassigns; the Viewer cannot write; others\' records are refused', async () => {
  await reset(fixture());
  const a = ok(await lead({}));
  const b = ok(await lead({ lead: { Name: 'Omar', Organisation: 'Desert Co', Phone: '052 123 4567', Email: 'omar@desert.example' } }, 'u-rep2'));
  const ids = async uid => (await call(uid, 'getCrm', { companyId: 'C1' })).leads.map(l => l.ID).sort();
  assert.deepEqual(await ids('u-rep1'), [a.leadId]);
  assert.deepEqual(await ids('u-rep2'), [b.leadId]);
  assert.deepEqual(await ids('u-admin'), [a.leadId, b.leadId].sort(), 'the manager sees all');
  assert.match(await err(call('u-rep2', 'saveLead', { lead: { ID: a.leadId, Name: 'X', Phone: '1234567' }, force: true })), /not yours/);
  assert.match(await err(lead({ lead: { Name: 'V', Organisation: 'V Co', Phone: '056 777 7777', Email: 'v@v.example' } }, 'u-viewer')), /permission to change CRM/);
  assert.match(await err(lead({ lead: { OwnerKey: 'U:u-rep2', Name: 'Z', Organisation: 'Z Co', Phone: '056 111 1111', Email: 'z@z.example' } })), /Only a CRM Manager can give/);
  assert.match(await err(call('u-rep1', 'reassignCrm', { kind: 'Lead', id: a.leadId, ownerKey: 'U:u-rep2' })), /Only a CRM Manager/);
  const owners = (await call('u-admin', 'getCrm', { companyId: 'C1' })).owners.map(o => o.Key);
  assert.ok(owners.includes('U:u-rep1') && owners.includes('U:u-rep2') && !owners.includes('U:u-viewer'), owners.join(','));
  ok(await call('u-admin', 'reassignCrm', { kind: 'Lead', id: a.leadId, ownerKey: 'U:u-rep2' }));
  assert.deepEqual(await ids('u-rep2'), [a.leadId, b.leadId].sort());
  assert.deepEqual(await ids('u-rep1'), []);
});

test('opportunities: start at the first stage; move; Lost needs a reason from the list; a closed one cannot change', async () => {
  await reset(fixture());
  const l = ok(await lead({}));
  assert.match(await err(call('u-rep1', 'saveOpportunity', { opportunity: { CompanyID: 'C1', Title: 'Racks' } })), /a lead or a customer/);
  const o = ok(await call('u-rep1', 'saveOpportunity', { opportunity: { CompanyID: 'C1', LeadID: l.leadId, Title: 'Racks', ExpectedValue: 5000, Currency: 'AED', ExpectedClose: daysFrom(30) } }));
  const c = ok(await call('u-rep1', 'saveOpportunity', { opportunity: { CompanyID: 'C1', CustomerID: 'CU1', Title: 'Shelves', ExpectedValue: 1200 } }));
  let opp = (await call('u-rep1', 'getCrm', { companyId: 'C1' })).opportunities.find(x => x.ID === o.opportunityId);
  assert.deepEqual([opp.Stage, opp.Probability, opp.Status], ['New', 10, 'Open']);
  ok(await call('u-rep1', 'setOpportunityStage', { opportunityId: o.opportunityId, stage: 'Proposal' }));
  assert.match(await err(call('u-rep1', 'setOpportunityStage', { opportunityId: o.opportunityId, stage: 'Lost' })), /why it was lost/);
  ok(await call('u-rep1', 'setOpportunityStage', { opportunityId: o.opportunityId, stage: 'Lost', lostReason: 'Price' }));
  opp = (await call('u-rep1', 'getCrm', { companyId: 'C1' })).opportunities.find(x => x.ID === o.opportunityId);
  assert.deepEqual([opp.Stage, opp.Probability, opp.Status, opp.LostReason], ['Lost', 0, 'Lost', 'Price']);
  assert.match(await err(call('u-rep1', 'setOpportunityStage', { opportunityId: o.opportunityId, stage: 'New' })), /already lost/);
  ok(await call('u-rep1', 'setOpportunityStage', { opportunityId: c.opportunityId, stage: 'Won' }));
  assert.match(await err(call('u-rep1', 'saveOpportunity', { opportunity: { ID: c.opportunityId, Title: 'Changed' } })), /won or lost opportunity cannot be changed/);
});

test('activities: due ones on Home (overdue flagged, future not); done needs the outcome and can schedule the next', async () => {
  await reset(fixture());
  const l = ok(await lead({}));
  const act = (o) => call('u-rep1', 'saveActivity', { activity: Object.assign({ CompanyID: 'C1', Type: 'Call', Subject: 'Intro call', Due: today, About: { Kind: 'Lead', ID: l.leadId } }, o) });
  assert.match(await err(act({ Type: 'Fax' })), /activity type/);
  assert.match(await err(act({ About: { Kind: 'Customer', ID: 'NOPE' } })), /customer of this company/);
  const a1 = ok(await act({}));
  const a2 = ok(await act({ Subject: 'Send brochure', Due: daysFrom(-2) }));
  ok(await act({ Subject: 'Later', Due: daysFrom(5) }));
  const home = await call('u-rep1', 'getCrmActivitiesDueForUser', { today });
  assert.deepEqual(home.map(h => [h.Subject, h.Overdue]), [['Send brochure', true], ['Intro call', false]]);
  assert.deepEqual(await call('u-rep2', 'getCrmActivitiesDueForUser', { today }), [], 'not another rep\'s');
  assert.match(await err(call('u-rep1', 'closeActivity', { activityId: a1.activityId })), /what came of it/);
  const done = ok(await call('u-rep1', 'closeActivity', { activityId: a1.activityId, outcome: 'Interested', next: { Type: 'Visit', Subject: 'Site visit', Due: daysFrom(3) } }));
  ok(await call('u-rep1', 'closeActivity', { activityId: a2.activityId, cancel: true }));
  const acts = (await call('u-rep1', 'getCrm', { companyId: 'C1' })).activities;
  const by = id => acts.find(a => a.ID === id);
  assert.deepEqual([by(a1.activityId).Status, by(a1.activityId).Outcome, by(a2.activityId).Status], ['Done', 'Interested', 'Cancelled']);
  assert.deepEqual([by(done.nextActivityId).Subject, by(done.nextActivityId).FollowsActivityID, by(done.nextActivityId).About.ID], ['Site visit', a1.activityId, l.leadId]);
  assert.deepEqual((await call('u-rep1', 'getCrmActivitiesDueForUser', { today })).length, 0);
});

test('Convert to Customer: the customer saved through Customer Master; the lead linked; its opportunities and activities move to the customer', async () => {
  await reset(fixture());
  const l = ok(await lead({}));
  const o = ok(await call('u-rep1', 'saveOpportunity', { opportunity: { CompanyID: 'C1', LeadID: l.leadId, Title: 'Racks', ExpectedValue: 5000 } }));
  const a = ok(await call('u-rep1', 'saveActivity', { activity: { CompanyID: 'C1', Type: 'Call', Subject: 'Follow up', Due: today, About: { Kind: 'Lead', ID: l.leadId } } }));
  assert.match(await err(call('u-admin', 'convertLead', { leadId: l.leadId, customerId: 'NOPE' })), /Save the customer first/);
  // As the screen does: Customer Master's own save (its rules), then the link.
  const c = await call('u-admin', 'saveCustomer', { customerData: { CustomerName: 'Gulf Trading', CompanyID: 'C1', Classification: 'Local', TradeReceivablesAccountID: 'A-AR', PaymentTermsDays: 30, Phone: '050 999 8888', Email: 'sara@gulf.example', ContactPerson: 'Sara' } });
  assert.equal(c.success, true, c.error);
  ok(await call('u-admin', 'convertLead', { leadId: l.leadId, customerId: c.customerId }));
  const data = await call('u-rep1', 'getCrm', { companyId: 'C1' });
  const L = data.leads.find(x => x.ID === l.leadId), O = data.opportunities.find(x => x.ID === o.opportunityId), A = data.activities.find(x => x.ID === a.activityId);
  assert.deepEqual([L.Status, L.CustomerID], ['Converted', c.customerId]);
  assert.deepEqual([O.LeadID, O.CustomerID, O.FromLeadID], ['', c.customerId, l.leadId]);
  assert.deepEqual([A.About.Kind, A.About.ID], ['Customer', c.customerId]);
  assert.match(await err(call('u-admin', 'convertLead', { leadId: l.leadId, customerId: c.customerId })), /already converted/);
  assert.match(await err(call('u-rep1', 'saveLead', { lead: { ID: l.leadId, Name: 'X', Phone: '0501234567' }, force: true })), /Only an open lead/);
});
