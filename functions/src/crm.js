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
const actorOf = user => user.profile.username || user.uid;
const nowIso = () => new Date().toISOString();
const failed = message => new HttpsError('failed-precondition', message);

async function requireCap(user, cap) {
  if (!(await moduleHasCapability(MODULE_ID, cap, user.profile.role))) {
    throw new HttpsError('permission-denied', cap === 'manage' ? 'Only a CRM Manager can do that.' : cap === 'write' ? 'You do not have permission to change CRM records.' : 'You do not have access to CRM.');
  }
}
function requireCompany(user, companyId) {
  if (!companyId) throw new HttpsError('invalid-argument', 'Choose a company.');
  if (!userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}
const isManager = user => moduleHasCapability(MODULE_ID, 'manage', user.profile.role);

// The owner keys that are this user: their own, and the employee linked to them.
async function myKeys(user) {
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
  const key = text(wanted, 120) || keys[0];
  if (keys.includes(key)) return key;
  if (!(await isManager(user))) throw new HttpsError('permission-denied', 'Only a CRM Manager can give a record to someone else.');
  if (!(await ownersOf(companyId)).some(o => o.Key === key)) throw new HttpsError('invalid-argument', 'That owner cannot hold CRM records in this company.');
  return key;
}
const stamp = (user, extra) => Object.assign({ UpdatedAt: nowIso(), UpdatedBy: actorOf(user) }, extra || {});
const historyEntry = (user, what) => ({ At: nowIso(), By: actorOf(user), What: what });

// ---------- duplicates (Q403) ----------
const nameKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const emailKey = s => String(s || '').trim().toLowerCase();
// The company's leads and customers that look like this lead: the same phone, email or name.
async function duplicatesOf(companyId, lead, exceptId) {
  const [leads, customers] = await Promise.all([
    LEADS().where('CompanyID', '==', companyId).get().then(s => s.docs.map(d => Object.assign({ ID: d.id }, d.data()))),
    rtdb.ref('customers').get().then(s => s.val() || {})
  ]);
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
}

// ---------- callables ----------

// Everything the CRM screen shows for a company: the setup, the owners and
// the user's records (a manager: all the company's).
exports.getCrm = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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

exports.saveCrmSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.saveLead = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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

exports.disqualifyLead = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
// lead's open opportunities and activities to the customer.
exports.convertLead = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
  const [opps, acts] = await Promise.all([OPPS().where('LeadID', '==', ref.id).get(), ACTS().where('About.ID', '==', ref.id).get()]);
  opps.docs.forEach(o => { if (o.data().CompanyID === rec.CompanyID) batch.update(o.ref, stamp(user, { LeadID: '', CustomerID: customerId, FromLeadID: ref.id })); });
  acts.docs.forEach(a => {
    const x = a.data();
    if (x.CompanyID === rec.CompanyID && x.About && x.About.Kind === 'Lead') batch.update(a.ref, stamp(user, { About: { Kind: 'Customer', ID: customerId }, FromLeadID: ref.id }));
  });
  await batch.commit();
  return { success: true, moved: { opportunities: opps.size, activities: acts.size } };
});

// An opportunity (new or changed), for a lead or a customer.
exports.saveOpportunity = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.setOpportunityStage = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.saveActivity = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.closeActivity = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.reassignCrm = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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
exports.getCrmActivitiesDueForUser = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
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

module.exports.DEFAULT_SETUP = DEFAULT_SETUP;
module.exports.duplicatesOf = duplicatesOf;
module.exports.myKeys = myKeys;
