// CRM, step C1: leads, opportunities and activities (owner, 2026-11-05;
// docs/modules/CRM.md, Q393-Q404). New development, hand-written.
//
// Each record belongs to a company and has an OWNER: an ERP user
// ('U:<uid>') or an employee who is a sales rep ('E:<employeeId>', the rep
// portal's step C3). A user sees the records they own (their own key, and
// the key of the employee linked to them); a user with the CRM Manager right
// sees every record of their companies and alone reassigns and changes the
// setup (Q396).
//
//   Firestore crmSetup/{CompanyID} { Stages [{ Name, Probability }], LostReasons [],
//     LeadSources [], ActivityTypes [], QuoteValidDays, UpdatedAt, UpdatedBy }
//   Firestore crmLeads/{id} { CompanyID, Name, Organisation, Phone, Email, Address,
//     Country, Source, Notes, OwnerKey, Status: Open | Converted | Disqualified,
//     DisqualifiedReason, CustomerID (once converted), History [], CreatedAt/By, UpdatedAt/By }
//   Firestore crmOpportunities/{id} { CompanyID, LeadID | CustomerID, Title, Stage,
//     Probability, ExpectedValue, Currency, ExpectedClose, OwnerKey, Status: Open | Won | Lost,
//     LostReason, ClosedAt, Notes, History [], ... }
//   Firestore crmActivities/{id} { CompanyID, Type, Subject, Due (yyyy-mm-dd), DueTime,
//     About: { Kind: Lead | Opportunity | Customer, ID }, OwnerKey, Status: Open | Done |
//     Cancelled, Outcome, DoneAt, ... }
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const { phoneKey } = require('./customerPhone');

const onCallOptions = { region: 'us-central1' };
const MODULE_ID = 'CRM';
const LEADS = () => firestore.collection('crmLeads');
const OPPS = () => firestore.collection('crmOpportunities');
const ACTS = () => firestore.collection('crmActivities');
const SETUP = companyId => firestore.collection('crmSetup').doc(companyId);
const KINDS = { Lead: LEADS, Opportunity: OPPS, Activity: ACTS };

// Q397: the default stages (Won and Lost always last), lists and validity.
const DEFAULT_SETUP = {
  Stages: [{ Name: 'New', Probability: 10 }, { Name: 'Qualified', Probability: 25 }, { Name: 'Proposal', Probability: 50 }, { Name: 'Negotiation', Probability: 75 }],
  LostReasons: ['Price', 'Competitor', 'No budget', 'No response', 'Other'],
  LeadSources: ['Website', 'Referral', 'Exhibition', 'Walk-in', 'Phone', 'Social media', 'Other'],
  ActivityTypes: ['Call', 'Meeting', 'Email', 'Visit', 'Task'],
  QuoteValidDays: 30
};
const WON = 'Won', LOST = 'Lost';

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
// The person acting: an ERP user (requireUser), or a sales rep in the
// Employee Portal (step C3: { uid, portal: { empId, companyId, manager, actor } },
// made by portalUser below after essPortal has checked who is signed in).
const actorOf = user => (user.portal ? user.portal.actor : user.profile.username || user.uid);
const nowIso = () => new Date().toISOString();
const failed = message => new HttpsError('failed-precondition', message);

async function requireCap(user, cap) {
  // A rep may see and change their own records (Q404), never CRM Setup or reassigning.
  if (user.portal) { if (cap === 'manage') throw new HttpsError('permission-denied', 'Only a CRM Manager can do that.'); return; }
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'manage' ? 'Only a CRM Manager can do that.' : cap === 'write' ? 'You do not have permission to change CRM records.' : 'You do not have access to CRM.');
  }
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (user.portal ? companyId !== user.portal.companyId : !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
// A CRM Manager; in the portal, a rep who is a sales manager (as with customers, decision 230).
const isManager = async user => (user.portal ? Boolean(user.portal.manager) : moduleHasCapability(MODULE_ID, 'manage', user.profile.role));

// The owner keys that are this user: their own, and the employee linked to them.
async function myKeys(user) {
  if (user.portal) return ['E:' + user.portal.empId];
  const emps = await firestore.collection('employees').where('UserUID', '==', user.uid).get();
  return ['U:' + user.uid].concat(emps.docs.map(d => 'E:' + d.id));
}

async function setupOf(companyId) {
  const snap = await SETUP(companyId).get();
  return Object.assign({}, DEFAULT_SETUP, snap.exists ? snap.data() : {});
}
// The stages as used: the company's, then Won and Lost.
const stagesOf = setup => setup.Stages.concat([{ Name: WON, Probability: 100 }, { Name: LOST, Probability: 0 }]);

// The people who can own a record in a company: its users who can write CRM records, and its active sales reps.
async function ownersOf(companyId) {
  const [users, reps] = await Promise.all([rtdb.ref('users').get().then(s => s.val() || {}), rtdb.ref('salesReps').get().then(s => s.val() || {})]);
  const out = [];
  for (const [uid, u] of Object.entries(users)) {
    if (!u || u.status === 'Inactive' || u.Status === 'Inactive') continue;
    if (!userCanAccessCompany(u, companyId)) continue;
    if (!(await moduleHasCapability(MODULE_ID, 'write', u.role))) continue;
    out.push({ Key: 'U:' + uid, Name: u.fullName || u.username || uid, Kind: 'User' });
  }
  const repIds = Object.keys(reps).filter(id => reps[id] && reps[id].Active !== false && reps[id].CompanyID === companyId);
  if (repIds.length) {
    const emps = await firestore.getAll(...repIds.map(id => firestore.collection('employees').doc(id)));
    emps.forEach(d => { if (d.exists) out.push({ Key: 'E:' + d.id, Name: (d.data().FullName || d.id) + ' (sales rep)', Kind: 'Rep' }); });
  }
  return out.sort((a, b) => a.Name.localeCompare(b.Name));
}

// The records of a kind a user may see in a company: a manager all the
// company's, anyone else their own (equality queries only: unit/movedReads).
async function visible(kind, companyId, manager, keys) {
  const col = KINDS[kind]();
  if (manager) return (await col.where('CompanyID', '==', companyId).get()).docs.map(d => Object.assign({ ID: d.id }, d.data()));
  const docs = [];
  for (const k of keys) (await col.where('OwnerKey', '==', k).get()).docs.forEach(d => { if (d.data().CompanyID === companyId) docs.push(Object.assign({ ID: d.id }, d.data())); });
  return docs;
}
// One record the user may change: theirs, or any of the company's for a manager.
async function editable(user, kind, id) {
  const snap = await KINDS[kind]().doc(text(id, 80)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That ' + kind.toLowerCase() + ' is not found.');
  const rec = snap.data();
  requireCompany(user, rec.CompanyID);
  if (!(await isManager(user)) && !(await myKeys(user)).includes(rec.OwnerKey)) {
    throw new HttpsError('permission-denied', 'That ' + kind.toLowerCase() + ' is not yours.');
  }
  return { ref: snap.ref, rec };
}
// A new record's owner: oneself, or (a manager) anyone who can own one in the company.
async function ownerFor(user, companyId, wanted) {
  const keys = await myKeys(user);
  if (user.portal) return keys[0]; // a rep's records are the rep's
  const key = text(wanted, 120) || keys[0];
  if (keys.includes(key)) return key;
  if (!(await isManager(user))) throw new HttpsError('permission-denied', 'Only a CRM Manager can give a record to someone else.');
  if (!(await ownersOf(companyId)).some(o => o.Key === key)) throw new HttpsError('invalid-argument', 'That owner cannot hold CRM records in this company.');
  return key;
}
// In the portal (step C3): a rep's customers are those they serve (decision
// 230; a sales manager, all), and the leads and opportunities theirs.
async function requireServed(user, kind, id) {
  if (!user.portal || user.portal.manager) return;
  if (kind === 'Customer') {
    const c = (await rtdb.ref('customers/' + text(id, 80)).get()).val();
    if (!c || c.SalesRepEmployeeID !== user.portal.empId) throw new HttpsError('permission-denied', 'That customer is not one of yours.');
  } else await editable(user, kind, id);
}
const stamp = (user, extra) => Object.assign({ UpdatedAt: nowIso(), UpdatedBy: actorOf(user) }, extra || {});
const historyEntry = (user, what) => ({ At: nowIso(), By: actorOf(user), What: what });

// ---------- duplicates (Q403) ----------
const nameKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const emailKey = s => String(s || '').trim().toLowerCase();
// A matcher for a company's leads and customers (loaded once, for a whole
// import too, step C4): matches(lead, exceptId) lists those that look like
// the lead: the same phone, email or name.
async function duplicateMatcher(companyId) {
  const [leads, customers] = await Promise.all([
    LEADS().where('CompanyID', '==', companyId).get().then(s => s.docs.map(d => Object.assign({ ID: d.id }, d.data()))),
    rtdb.ref('customers').get().then(s => s.val() || {})
  ]);
  return (lead, exceptId) => {
    const p = phoneKey(lead.Phone), e = emailKey(lead.Email), n = nameKey(lead.Organisation || lead.Name);
    const why = r => [p && phoneKey(r.Phone) === p ? 'phone' : '', e && emailKey(r.Email) === e ? 'email' : '',
      n && [nameKey(r.Organisation), nameKey(r.Name), nameKey(r.CustomerName)].includes(n) ? 'name' : ''].filter(Boolean);
    const out = [];
    leads.filter(l => l.ID !== exceptId && l.Status !== 'Disqualified').forEach(l => {
      const m = why(l);
      if (m.length) out.push({ Kind: 'Lead', ID: l.ID, Name: l.Organisation || l.Name, Match: m });
    });
    Object.entries(customers).forEach(([id, c]) => {
      if (!c || c.Status === 'Inactive' || (c.CompanyID && c.CompanyID !== companyId)) return;
      const m = why(c);
      if (m.length) out.push({ Kind: 'Customer', ID: id, Name: c.CustomerName + (c.CustomerCode ? ' (' + c.CustomerCode + ')' : ''), Match: m });
    });
    return out;
  };
}
// The company's leads and customers that look like this lead.
async function duplicatesOf(companyId, lead, exceptId) {
  return (await duplicateMatcher(companyId))(lead, exceptId);
}
// Two leads that look alike (rows of one import, step C4): what matches.
const sameLead = (a, b) => {
  const p = phoneKey(a.Phone), e = emailKey(a.Email), n = nameKey(a.Organisation || a.Name);
  return [p && phoneKey(b.Phone) === p ? 'phone' : '', e && emailKey(b.Email) === e ? 'email' : '',
    n && [nameKey(b.Organisation), nameKey(b.Name)].includes(n) ? 'name' : ''].filter(Boolean);
};

// ---------- callables ----------

// Each callable's work, by name, for the ERP (the callable) and the rep portal
// (essPortal's CRM actions, step C3) alike.
const cores = {};
function callable(name, core) {
  cores[name] = core;
  exports[name] = onCallWithMessages(onCallOptions, async (request) => core(await requireUser(request), request));
}

// Everything the CRM screen shows for a company: the setup, the owners and
// the user's records (a manager: all the company's).
callable('getCrm', async (user, request) => {
  await requireCap(user, 'access');
  const companyId = text(request.data && request.data.companyId, 80);
  requireCompany(user, companyId);
  const [manager, canWrite, keys, setup, owners] = await Promise.all([isManager(user), moduleHasCapability(MODULE_ID, 'write', user.profile.role), myKeys(user), setupOf(companyId), ownersOf(companyId)]);
  const [leads, opportunities, activities] = await Promise.all(['Lead', 'Opportunity', 'Activity'].map(k => visible(k, companyId, manager, keys)));
  const customers = (await rtdb.ref('customers').get()).val() || {};
  const customerList = Object.keys(customers).filter(id => customers[id].Status === 'Active' && (!customers[id].CompanyID || customers[id].CompanyID === companyId))
    .map(id => ({ CustomerID: id, Name: customers[id].CustomerName, Code: customers[id].CustomerCode || '' }));
  return { manager, canWrite, myKeys: keys, setup: Object.assign({}, setup, { AllStages: stagesOf(setup) }), owners, leads, opportunities, activities, customers: customerList };
});

callable('saveCrmSetup', async (user, request) => {
  await requireCap(user, 'manage');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const s = d.setup || {};
  const list = (a, max) => [...new Set((Array.isArray(a) ? a : []).map(x => text(x, 60)).filter(Boolean))].slice(0, max || 50);
  const stages = (Array.isArray(s.Stages) ? s.Stages : []).map(x => ({ Name: text(x && x.Name, 40), Probability: Math.round(Number(x && x.Probability)) }));
  if (!stages.length) throw new HttpsError('invalid-argument', 'Keep at least one stage before Won and Lost.');
  const names = new Set();
  for (const st of stages) {
    if (!st.Name) throw new HttpsError('invalid-argument', 'Every stage needs a name.');
    if ([WON, LOST].includes(st.Name)) throw new HttpsError('invalid-argument', 'Won and Lost are always the last two stages; do not add them.');
    if (names.has(st.Name.toLowerCase())) throw new HttpsError('invalid-argument', 'Two stages are named ' + st.Name + '.');
    names.add(st.Name.toLowerCase());
    if (!(st.Probability >= 0 && st.Probability <= 100)) throw new HttpsError('invalid-argument', 'A stage\'s probability is 0 to 100 %.');
  }
  const days = Math.round(Number(s.QuoteValidDays));
  if (!(days >= 1 && days <= 365)) throw new HttpsError('invalid-argument', 'A quotation is valid 1 to 365 days.');
  const out = { Stages: stages, LostReasons: list(s.LostReasons), LeadSources: list(s.LeadSources), ActivityTypes: list(s.ActivityTypes), QuoteValidDays: days };
  if (!out.LostReasons.length || !out.LeadSources.length || !out.ActivityTypes.length) throw new HttpsError('invalid-argument', 'Keep at least one lost reason, lead source and activity type.');
  await SETUP(companyId).set(stamp(user, out));
  return { success: true };
});

// A lead (new or changed). Matches warn (Q403): { success: false, duplicates } until saved with force.
callable('saveLead', async (user, request) => {
  await requireCap(user, 'write');
  const d = request.data || {};
  const l = d.lead || {};
  const id = text(l.ID, 80);
  const existing = id ? await editable(user, 'Lead', id) : null;
  const companyId = existing ? existing.rec.CompanyID : text(l.CompanyID, 80);
  requireCompany(user, companyId);
  const fields = {
    Name: text(l.Name, 120), Organisation: text(l.Organisation, 160), Phone: text(l.Phone, 40), Email: text(l.Email, 120),
    Address: text(l.Address, 300), Country: text(l.Country, 60), Source: text(l.Source, 60), Notes: text(l.Notes, 2000)
  };
  if (!fields.Name && !fields.Organisation) throw new HttpsError('invalid-argument', 'Give the lead\'s name or organisation.');
  if (!fields.Phone && !fields.Email) throw new HttpsError('invalid-argument', 'Give a phone or an email, so the lead can be reached.');
  if (fields.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.Email)) throw new HttpsError('invalid-argument', 'The email is not valid.');
  const setup = await setupOf(companyId);
  if (fields.Source && !setup.LeadSources.includes(fields.Source)) throw new HttpsError('invalid-argument', 'Choose a lead source from CRM Setup.');
  if (existing && existing.rec.Status !== 'Open') throw failed('Only an open lead can be changed.');
  if (!d.force) {
    const duplicates = await duplicatesOf(companyId, fields, id);
    if (duplicates.length) return { success: false, duplicates };
  }
  if (existing) {
    await existing.ref.update(stamp(user, fields));
    return { success: true, leadId: id };
  }
  const ownerKey = await ownerFor(user, companyId, l.OwnerKey);
  const ref = LEADS().doc();
  await ref.set(stamp(user, Object.assign(fields, { CompanyID: companyId, OwnerKey: ownerKey, Status: 'Open', CustomerID: '',
    CreatedAt: nowIso(), CreatedBy: actorOf(user), History: [historyEntry(user, 'Created')] })));
  return { success: true, leadId: ref.id };
});

callable('disqualifyLead', async (user, request) => {
  await requireCap(user, 'write');
  const d = request.data || {};
  const { ref, rec } = await editable(user, 'Lead', d.leadId);
  if (rec.Status !== 'Open') throw failed('Only an open lead can be disqualified.');
  const reason = text(d.reason, 300);
  if (!reason) throw new HttpsError('invalid-argument', 'Say why the lead is disqualified.');
  await ref.update(stamp(user, { Status: 'Disqualified', DisqualifiedReason: reason, History: (rec.History || []).concat([historyEntry(user, 'Disqualified: ' + reason)]) }));
  return { success: true };
});

// Convert to Customer (Q394): the customer is saved first through Customer
// Master's own save (its rules and right); this links it, and moves the
// lead's open opportunities, activities and quotations to the customer.
callable('convertLead', async (user, request) => {
  await requireCap(user, 'write');
  const d = request.data || {};
  const { ref, rec } = await editable(user, 'Lead', d.leadId);
  if (rec.Status !== 'Open') throw failed('This lead is already ' + rec.Status.toLowerCase() + '.');
  const customerId = text(d.customerId, 80);
  const customer = customerId ? (await rtdb.ref('customers/' + customerId).get()).val() : null;
  if (!customer || customer.Status === 'Inactive') throw new HttpsError('invalid-argument', 'Save the customer first; it is not found.');
  if (customer.CompanyID && customer.CompanyID !== rec.CompanyID) throw new HttpsError('invalid-argument', 'That customer belongs to another company.');
  const batch = firestore.batch();
  batch.update(ref, stamp(user, { Status: 'Converted', CustomerID: customerId, ConvertedAt: nowIso(),
    History: (rec.History || []).concat([historyEntry(user, 'Converted to customer ' + (customer.CustomerCode || customerId))]) }));
  const [opps, acts, quotes] = await Promise.all([OPPS().where('LeadID', '==', ref.id).get(), ACTS().where('About.ID', '==', ref.id).get(),
    firestore.collection('quotations').where('LeadID', '==', ref.id).get()]);
  // Its quotations too (step C2, Q399): the customer's from now, the open ones to be ordered.
  quotes.docs.forEach(q => { if (q.data().CompanyID === rec.CompanyID) batch.update(q.ref, stamp(user, { LeadID: '', CustomerID: customerId, FromLeadID: ref.id })); });
  opps.docs.forEach(o => { if (o.data().CompanyID === rec.CompanyID) batch.update(o.ref, stamp(user, { LeadID: '', CustomerID: customerId, FromLeadID: ref.id })); });
  acts.docs.forEach(a => {
    const x = a.data();
    if (x.CompanyID === rec.CompanyID && x.About && x.About.Kind === 'Lead') batch.update(a.ref, stamp(user, { About: { Kind: 'Customer', ID: customerId }, FromLeadID: ref.id }));
  });
  await batch.commit();
  return { success: true, moved: { opportunities: opps.size, activities: acts.size, quotations: quotes.size } };
});

// An opportunity (new or changed), for a lead or a customer.
callable('saveOpportunity', async (user, request) => {
  await requireCap(user, 'write');
  const o = (request.data || {}).opportunity || {};
  const id = text(o.ID, 80);
  const existing = id ? await editable(user, 'Opportunity', id) : null;
  const companyId = existing ? existing.rec.CompanyID : text(o.CompanyID, 80);
  requireCompany(user, companyId);
  if (existing && existing.rec.Status !== 'Open') throw failed('A won or lost opportunity cannot be changed.');
  const fields = { Title: text(o.Title, 160), ExpectedValue: Math.round((Number(o.ExpectedValue) || 0) * 100) / 100, Currency: text(o.Currency, 3).toUpperCase(),
    ExpectedClose: text(o.ExpectedClose, 10), Notes: text(o.Notes, 2000) };
  if (!fields.Title) throw new HttpsError('invalid-argument', 'Give the opportunity a title.');
  if (fields.ExpectedValue < 0) throw new HttpsError('invalid-argument', 'The expected value cannot be negative.');
  if (fields.ExpectedClose && !isDate(fields.ExpectedClose)) throw new HttpsError('invalid-argument', 'The expected close date is not valid.');
  if (!existing) {
    const leadId = text(o.LeadID, 80), customerId = text(o.CustomerID, 80);
    if (!!leadId === !!customerId) throw new HttpsError('invalid-argument', 'Choose a lead or a customer.');
    await requireServed(user, leadId ? 'Lead' : 'Customer', leadId || customerId);
    if (leadId) {
      const lead = (await LEADS().doc(leadId).get()).data();
      if (!lead || lead.CompanyID !== companyId || lead.Status !== 'Open') throw new HttpsError('invalid-argument', 'Choose an open lead of this company.');
    } else {
      const c = (await rtdb.ref('customers/' + customerId).get()).val();
      if (!c || c.Status === 'Inactive' || (c.CompanyID && c.CompanyID !== companyId)) throw new HttpsError('invalid-argument', 'Choose an active customer of this company.');
    }
    const setup = await setupOf(companyId);
    const first = setup.Stages[0];
    const ref = OPPS().doc();
    await ref.set(stamp(user, Object.assign(fields, { CompanyID: companyId, LeadID: leadId, CustomerID: customerId, Stage: first.Name, Probability: first.Probability,
      Status: 'Open', OwnerKey: await ownerFor(user, companyId, o.OwnerKey), CreatedAt: nowIso(), CreatedBy: actorOf(user), History: [historyEntry(user, 'Created at ' + first.Name)] })));
    return { success: true, opportunityId: ref.id };
  }
  await existing.ref.update(stamp(user, fields));
  return { success: true, opportunityId: id };
});

// Move an opportunity to a stage (Q397): Lost needs a reason from the list; Won and Lost close it.
callable('setOpportunityStage', async (user, request) => {
  await requireCap(user, 'write');
  const d = request.data || {};
  const { ref, rec } = await editable(user, 'Opportunity', d.opportunityId);
  if (rec.Status !== 'Open') throw failed('This opportunity is already ' + rec.Status.toLowerCase() + '.');
  const setup = await setupOf(rec.CompanyID);
  const stage = stagesOf(setup).find(s => s.Name === text(d.stage, 40));
  if (!stage) throw new HttpsError('invalid-argument', 'Choose a stage from CRM Setup.');
  const upd = { Stage: stage.Name, Probability: stage.Probability };
  if (stage.Name === LOST) {
    const reason = text(d.lostReason, 60);
    if (!setup.LostReasons.includes(reason)) throw new HttpsError('invalid-argument', 'Choose why it was lost.');
    Object.assign(upd, { Status: 'Lost', LostReason: reason, LostNote: text(d.note, 500), ClosedAt: nowIso() });
  } else if (stage.Name === WON) {
    Object.assign(upd, { Status: 'Won', ClosedAt: nowIso() });
  }
  upd.History = (rec.History || []).concat([historyEntry(user, 'Stage: ' + stage.Name + (upd.LostReason ? ' (' + upd.LostReason + ')' : ''))]);
  await ref.update(stamp(user, upd));
  return { success: true };
});

// An activity (new or changed) about a lead, an opportunity or a customer (Q401).
callable('saveActivity', async (user, request) => {
  await requireCap(user, 'write');
  const a = (request.data || {}).activity || {};
  const id = text(a.ID, 80);
  const existing = id ? await editable(user, 'Activity', id) : null;
  const companyId = existing ? existing.rec.CompanyID : text(a.CompanyID, 80);
  requireCompany(user, companyId);
  if (existing && existing.rec.Status !== 'Open') throw failed('Only an open activity can be changed.');
  const setup = await setupOf(companyId);
  const fields = { Type: text(a.Type, 40), Subject: text(a.Subject, 200), Due: text(a.Due, 10), DueTime: text(a.DueTime, 5), Notes: text(a.Notes, 2000) };
  if (!setup.ActivityTypes.includes(fields.Type)) throw new HttpsError('invalid-argument', 'Choose an activity type from CRM Setup.');
  if (!fields.Subject) throw new HttpsError('invalid-argument', 'Give the activity a subject.');
  if (!isDate(fields.Due)) throw new HttpsError('invalid-argument', 'Give the due date.');
  if (fields.DueTime && !/^\d{2}:\d{2}$/.test(fields.DueTime)) throw new HttpsError('invalid-argument', 'The time is not valid.');
  if (existing) {
    await existing.ref.update(stamp(user, fields));
    return { success: true, activityId: id };
  }
  const about = { Kind: text(a.About && a.About.Kind, 20), ID: text(a.About && a.About.ID, 80) };
  if (KINDS[about.Kind] || about.Kind === 'Customer') await requireServed(user, about.Kind, about.ID);
  if (about.Kind === 'Customer') {
    const c = (await rtdb.ref('customers/' + about.ID).get()).val();
    if (!c || (c.CompanyID && c.CompanyID !== companyId)) throw new HttpsError('invalid-argument', 'Choose a customer of this company.');
  } else if (about.Kind === 'Lead' || about.Kind === 'Opportunity') {
    const r = (await KINDS[about.Kind]().doc(about.ID).get()).data();
    if (!r || r.CompanyID !== companyId) throw new HttpsError('invalid-argument', 'Choose a ' + about.Kind.toLowerCase() + ' of this company.');
  } else throw new HttpsError('invalid-argument', 'Say what the activity is about: a lead, an opportunity or a customer.');
  const ref = ACTS().doc();
  await ref.set(stamp(user, Object.assign(fields, { CompanyID: companyId, About: about, Status: 'Open', OwnerKey: await ownerFor(user, companyId, a.OwnerKey),
    CreatedAt: nowIso(), CreatedBy: actorOf(user) })));
  return { success: true, activityId: ref.id };
});

// Done (with the outcome) or cancelled; done can schedule the next (Q401).
callable('closeActivity', async (user, request) => {
  await requireCap(user, 'write');
  const d = request.data || {};
  const { ref, rec } = await editable(user, 'Activity', d.activityId);
  if (rec.Status !== 'Open') throw failed('This activity is already ' + rec.Status.toLowerCase() + '.');
  const cancel = d.cancel === true;
  const outcome = text(d.outcome, 2000);
  if (!cancel && !outcome) throw new HttpsError('invalid-argument', 'Say what came of it.');
  const batch = firestore.batch();
  batch.update(ref, stamp(user, { Status: cancel ? 'Cancelled' : 'Done', Outcome: outcome, DoneAt: nowIso() }));
  let nextId = '';
  if (!cancel && d.next) {
    const n = d.next;
    const setup = await setupOf(rec.CompanyID);
    const next = { Type: text(n.Type, 40), Subject: text(n.Subject, 200), Due: text(n.Due, 10), DueTime: text(n.DueTime, 5), Notes: '' };
    if (!setup.ActivityTypes.includes(next.Type) || !next.Subject || !isDate(next.Due)) throw new HttpsError('invalid-argument', 'The next activity needs a type, a subject and a due date.');
    const nref = ACTS().doc();
    nextId = nref.id;
    batch.set(nref, stamp(user, Object.assign(next, { CompanyID: rec.CompanyID, About: rec.About, Status: 'Open', OwnerKey: rec.OwnerKey,
      FollowsActivityID: ref.id, CreatedAt: nowIso(), CreatedBy: actorOf(user) })));
  }
  await batch.commit();
  return { success: true, nextActivityId: nextId };
});

// Give a lead, an opportunity or an activity to another owner (a manager, Q396).
callable('reassignCrm', async (user, request) => {
  await requireCap(user, 'manage');
  const d = request.data || {};
  const kind = text(d.kind, 20);
  if (!KINDS[kind]) throw new HttpsError('invalid-argument', 'Unknown record.');
  const { ref, rec } = await editable(user, kind, d.id);
  const key = text(d.ownerKey, 120);
  if (!(await ownersOf(rec.CompanyID)).some(o => o.Key === key)) throw new HttpsError('invalid-argument', 'That owner cannot hold CRM records in this company.');
  const upd = { OwnerKey: key };
  if (rec.History) upd.History = rec.History.concat([historyEntry(user, 'Given to ' + key)]);
  await ref.update(stamp(user, upd));
  return { success: true };
});

// Home (Q401): the user's open activities due today or before, overdue flagged.
callable('getCrmActivitiesDueForUser', async (user, request) => {
  if (!(await moduleHasCapability(MODULE_ID, 'access', user.profile.role))) return [];
  const today = isDate(request.data && request.data.today) ? request.data.today : new Date().toISOString().slice(0, 10);
  const out = [];
  for (const k of await myKeys(user)) {
    (await ACTS().where('OwnerKey', '==', k).get()).docs.forEach(d => {
      const a = d.data();
      if (a.Status !== 'Open' || !(a.Due <= today) || !userCanAccessCompany(user.profile, a.CompanyID)) return;
      out.push({ ModuleID: MODULE_ID, DocumentID: d.id, Type: a.Type, Subject: a.Subject, Due: a.Due, DueTime: a.DueTime || '', Overdue: a.Due < today });
    });
  }
  return out.sort((a, b) => (a.Due + a.DueTime).localeCompare(b.Due + b.DueTime));
});

// ---------- reports (step C4, Q402, Q407, Q408) ----------

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const dayOf = iso => String(iso || '').slice(0, 10);
const inPeriod = (day, from, to) => Boolean(day) && (!from || day >= from) && (!to || day <= to);
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);

// The four reports from the records a user may see (pure, for the tests).
// `rates`: { CODE: rate to base | null when there is none }; a value with
// no rate is shown in its own currency and left out of the totals (Q407).
function crmReports(input) {
  const { leads, opportunities, activities, setup, base, rates, from, to, today } = input;
  const toBase = (value, cur) => {
    const c = String(cur || '').toUpperCase() || base;
    if (c === base) return round2(value);
    return rates[c] == null ? null : round2(Number(value) * rates[c]);
  };
  const missing = new Set();
  const line = o => {
    const b = toBase(o.ExpectedValue, o.Currency);
    if (b === null) missing.add(String(o.Currency).toUpperCase());
    return { ID: o.ID, Title: o.Title, LeadID: o.LeadID || '', CustomerID: o.CustomerID || '', Stage: o.Stage, Probability: Number(o.Probability) || 0,
      OwnerKey: o.OwnerKey, ExpectedClose: o.ExpectedClose || '', Currency: String(o.Currency || '').toUpperCase() || base, Value: round2(o.ExpectedValue),
      BaseValue: b, Weighted: b === null ? null : round2(b * (Number(o.Probability) || 0) / 100), Status: o.Status, LostReason: o.LostReason || '', Closed: dayOf(o.ClosedAt) };
  };
  // Adds a line to a group's totals (count; base value and weighted where converted).
  const group = (map, key, l, extra) => {
    const g = map.get(key) || Object.assign({ Key: key, Count: 0, Value: 0, Weighted: 0 }, extra || {});
    g.Count++;
    if (l.BaseValue !== null) { g.Value = round2(g.Value + l.BaseValue); g.Weighted = round2(g.Weighted + l.Weighted); }
    map.set(key, g);
    return g;
  };

  // Pipeline: the open opportunities, by stage (in the setup's order), owner and expected close month.
  const open = opportunities.filter(o => o.Status === 'Open').map(line);
  const byStage = new Map(setup.Stages.map(st => [st.Name, { Key: st.Name, Probability: st.Probability, Count: 0, Value: 0, Weighted: 0 }]));
  const pOwner = new Map(), pMonth = new Map();
  open.forEach(l => { group(byStage, l.Stage, l); group(pOwner, l.OwnerKey, l); group(pMonth, l.ExpectedClose.slice(0, 7), l); });
  const sum = (ls, k) => round2(ls.reduce((a, l) => a + (l[k] === null ? 0 : l[k]), 0));
  const pipeline = { lines: open, byStage: [...byStage.values()], byOwner: [...pOwner.values()],
    byMonth: [...pMonth.values()].sort((a, b) => (a.Key || '9999').localeCompare(b.Key || '9999')),
    total: { Count: open.length, Value: sum(open, 'BaseValue'), Weighted: sum(open, 'Weighted') } };

  // Win / loss: closed in the period, by month, owner and lost reason; the win rate by count.
  const closed = opportunities.filter(o => (o.Status === 'Won' || o.Status === 'Lost') && inPeriod(dayOf(o.ClosedAt), from, to)).map(line);
  const wl = () => ({ Won: 0, WonValue: 0, Lost: 0, LostValue: 0 });
  const addWl = (g, l) => {
    const v = l.BaseValue === null ? 0 : l.BaseValue;
    if (l.Status === 'Won') { g.Won++; g.WonValue = round2(g.WonValue + v); } else { g.Lost++; g.LostValue = round2(g.LostValue + v); }
    g.WinRate = pct(g.Won, g.Won + g.Lost);
  };
  const keyed = (map, key) => { if (!map.has(key)) map.set(key, Object.assign({ Key: key }, wl())); return map.get(key); };
  const wMonth = new Map(), wOwner = new Map(), reasons = new Map();
  const wTotal = Object.assign({ Key: '' }, wl());
  closed.forEach(l => {
    addWl(wTotal, l); addWl(keyed(wMonth, l.Closed.slice(0, 7)), l); addWl(keyed(wOwner, l.OwnerKey), l);
    if (l.Status === 'Lost') group(reasons, l.LostReason || 'Not given', l);
  });
  if (!closed.length) wTotal.WinRate = null;
  const winLoss = { lines: closed, byMonth: [...wMonth.values()].sort((a, b) => a.Key.localeCompare(b.Key)), byOwner: [...wOwner.values()],
    byReason: [...reasons.values()].sort((a, b) => b.Count - a.Count), total: wTotal };

  // Activities: by owner and type, done in the period, open now and of those overdue.
  const aMap = new Map();
  activities.forEach(a => {
    const key = a.OwnerKey + '|' + a.Type;
    const g = aMap.get(key) || { OwnerKey: a.OwnerKey, Type: a.Type, Done: 0, Open: 0, Overdue: 0 };
    if (a.Status === 'Done' && inPeriod(dayOf(a.DoneAt), from, to)) g.Done++;
    if (a.Status === 'Open') { g.Open++; if (a.Due < today) g.Overdue++; }
    if (g.Done || g.Open) aMap.set(key, g);
  });
  const aRows = [...aMap.values()].sort((a, b) => a.OwnerKey.localeCompare(b.OwnerKey) || a.Type.localeCompare(b.Type));
  const activityReport = { rows: aRows, total: aRows.reduce((t, r) => ({ Done: t.Done + r.Done, Open: t.Open + r.Open, Overdue: t.Overdue + r.Overdue }), { Done: 0, Open: 0, Overdue: 0 }) };

  // Lead sources: leads created in the period, how many converted, and the won value of their opportunities.
  const periodLeads = leads.filter(l => inPeriod(dayOf(l.CreatedAt), from, to));
  const sourceOf = new Map(periodLeads.map(l => [l.ID, l.Source || 'Not given']));
  const sMap = new Map();
  const src = k => { if (!sMap.has(k)) sMap.set(k, { Key: k, Leads: 0, Converted: 0, Won: 0, WonValue: 0 }); return sMap.get(k); };
  periodLeads.forEach(l => { const g = src(l.Source || 'Not given'); g.Leads++; if (l.Status === 'Converted') g.Converted++; });
  opportunities.filter(o => o.Status === 'Won').forEach(o => {
    const k = sourceOf.get(o.LeadID || o.FromLeadID || '');
    if (!k) return;
    const l = line(o);
    const g = src(k); g.Won++; g.WonValue = round2(g.WonValue + (l.BaseValue === null ? 0 : l.BaseValue));
  });
  const sRows = [...sMap.values()].map(g => Object.assign(g, { Conversion: pct(g.Converted, g.Leads) })).sort((a, b) => b.Leads - a.Leads || a.Key.localeCompare(b.Key));
  const sTotal = sRows.reduce((t, r) => ({ Leads: t.Leads + r.Leads, Converted: t.Converted + r.Converted, Won: t.Won + r.Won, WonValue: round2(t.WonValue + r.WonValue) }), { Leads: 0, Converted: 0, Won: 0, WonValue: 0 });
  sTotal.Conversion = pct(sTotal.Converted, sTotal.Leads);

  return { base, from, to, today, missingRates: [...missing].sort(), pipeline, winLoss, activities: activityReport, sources: { rows: sRows, total: sTotal } };
}

// CRM → Reports (Q408): what the user may see (a manager: the company's, or one owner's).
callable('getCrmReports', async (user, request) => {
  await requireCap(user, 'access');
  const d = request.data || {};
  const companyId = text(d.companyId, 80);
  requireCompany(user, companyId);
  const from = isDate(d.from) ? d.from : '', to = isDate(d.to) ? d.to : '';
  if (from && to && from > to) throw new HttpsError('invalid-argument', 'The period ends before it starts.');
  const today = isDate(d.today) ? d.today : new Date().toISOString().slice(0, 10);
  const [manager, keys, setup] = await Promise.all([isManager(user), myKeys(user), setupOf(companyId)]);
  let [leads, opportunities, activities] = await Promise.all(['Lead', 'Opportunity', 'Activity'].map(k => visible(k, companyId, manager, keys)));
  const owner = manager ? text(d.ownerKey, 120) : '';
  if (owner) [leads, opportunities, activities] = [leads, opportunities, activities].map(list => list.filter(r => r.OwnerKey === owner));
  // Q407: the base currency at the latest rate (today's).
  const fx = require('./exchangeRates');
  const b = await fx.baseCurrency();
  const rates = {};
  for (const code of new Set(opportunities.map(o => String(o.Currency || '').toUpperCase()).filter(c => c && c !== b.Code))) {
    try { rates[code] = (await fx.rateOn(code, today, b)).Rate; } catch (e) { rates[code] = null; }
  }
  return Object.assign(crmReports({ leads, opportunities, activities, setup, base: b.Code, rates, from, to, today }), { manager, ownerKey: owner });
});

// ---------- the rep portal (step C3; essPortal.js actions) ----------

// The rep as the one acting: `me` is essPortal's signed-in employee, `rep` their salesReps record.
function portalUser(me, rep) {
  const actor = 'Portal: ' + (me.emp.EmployeeNo || me.emp.EmployeeID) + ' ' + (me.emp.FullName || '');
  // The approvals' submitter: the ERP user when the rep signed in with one (so self-approval
  // is still seen), else the rep's name.
  return { uid: me.uid, portal: { empId: me.emp.EmployeeID, companyId: me.emp.CompanyID, manager: Boolean(rep.IsManager), actor,
    submitter: me.via === 'erp' ? me.uid : actor } };
}
// What the portal's CRM pages show: the setup, and the rep's records (a sales manager: the company's).
async function portalCrm(user, customers) {
  const companyId = user.portal.companyId;
  const [setup, keys, manager] = await Promise.all([setupOf(companyId), myKeys(user), isManager(user)]);
  const [leads, opportunities, activities] = await Promise.all(['Lead', 'Opportunity', 'Activity'].map(k => visible(k, companyId, manager, keys)));
  return { setup: Object.assign({}, setup, { AllStages: stagesOf(setup) }), myKey: keys[0], manager,
    leads: leads.filter(l => l.Status === 'Open'), opportunities: opportunities.filter(o => o.Status === 'Open'), activities: activities.filter(a => a.Status === 'Open'),
    customers: customers.map(c => ({ CustomerID: c.CustomerID, Name: c.CustomerName, Code: c.CustomerCode || '' })) };
}
// The cores the portal runs, with the rep as the user (convertLead, setup and reassigning stay in the ERP).
const PORTAL = ['saveLead', 'disqualifyLead', 'saveOpportunity', 'setOpportunityStage', 'saveActivity', 'closeActivity'];
const runForRep = (user, name, data) => {
  if (!PORTAL.includes(name)) throw new HttpsError('permission-denied', 'Not from the portal.');
  const d = Object.assign({}, data || {});
  // The rep's company, whatever the phone sends.
  ['lead', 'opportunity', 'activity'].forEach(k => { if (d[k] && typeof d[k] === 'object') d[k] = Object.assign({}, d[k], { CompanyID: user.portal.companyId }); });
  return cores[name](user, { data: d });
};

module.exports.portalUser = portalUser;
module.exports.portalCrm = portalCrm;
module.exports.runForRep = runForRep;
module.exports.DEFAULT_SETUP = DEFAULT_SETUP;
module.exports.duplicatesOf = duplicatesOf;
module.exports.myKeys = myKeys;
module.exports.crmReports = crmReports;
// Master Import's Leads (step C4, Q409-Q410): the checks, then each row saved as the form saves it.
module.exports.duplicateMatcher = duplicateMatcher;
module.exports.sameLead = sameLead;
module.exports.setupOf = setupOf;
module.exports.ownersOf = ownersOf;
module.exports.isManager = isManager;
module.exports.saveLeadFor = async (user, lead) => {
  const r = await cores.saveLead(user, { data: { lead, force: true } }); // the matches were shown at the check (Q409)
  if (!r || !r.success || !r.leadId) throw new Error('The lead could not be saved.');
  return r.leadId;
};
