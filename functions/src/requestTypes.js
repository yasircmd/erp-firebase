// Employee requests of any type (UX round 2, item 27; owner, 2026-10-25;
// docs/modules/EMPLOYEE_REQUEST_TYPES.md, decisions Q277, Q305-Q308).
//   - Request types set up by HR (Employee Requests → Types, "setup"): a
//     name, a description for the employee, its fields (short or long text,
//     number, date, a choice, yes/no, files), the companies it is for (none:
//     every company, Q308), the route (straight to its handler, or through
//     the line manager first, Q305), an optional "answer within N days"
//     (Q307), and whether the answer is a document (a certificate, which HR
//     uploads, Q277).
//   - A request of a type is an employeeRequests record of Type "Custom",
//     its category the type's name (so the Handlers tab names its handler),
//     numbered from one series, RQ-2026-0001 (Q306). It lives as the other
//     requests do (employeeRequests.js): replies, internal notes, files,
//     resolve, reject, reassign, reopen within 14 days.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { firestore } = require('./firebaseAdmin');
const { userCanAccessCompany } = require('./glWriting');
const { todayIn } = require('./recurringSchedule');

const TYPES = () => firestore.collection('employeeRequestTypes');
const KINDS = ['text', 'longtext', 'number', 'date', 'choice', 'yesno', 'file'];
const ROUTES = ['Handler', 'Manager'];
const MAX_FIELDS = 20, MAX_OPTIONS = 30;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 150);
const bad = msg => { throw new HttpsError('invalid-argument', msg); };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const today = () => todayIn('Asia/Dubai');

async function allTypes() {
  return (await TYPES().get()).docs.map(d => Object.assign({ TypeID: d.id }, d.data())).sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
}
// The types an employee of a company may raise: active, for every company or for theirs.
async function typesFor(companyId) {
  return (await allTypes()).filter(t => t.Active !== false && (!(t.CompanyIDs || []).length || t.CompanyIDs.includes(companyId)));
}
async function typeOf(id) {
  const s = await TYPES().doc(text(id, 80) || '-').get();
  return s.exists ? Object.assign({ TypeID: s.id }, s.data()) : null;
}

// ---------- set-up (the ERP: Employee Requests → Types) ----------

async function saveType(user, d, reservedNames) {
  const name = text(d.name, 60);
  if (!name) bad('Give the type a name (e.g. Salary certificate).');
  if ((reservedNames || []).some(n => n.toLowerCase() === name.toLowerCase())) bad(name + ' is one of the portal\'s own requests: choose another name.');
  const id = text(d.typeId, 80);
  const others = (await allTypes()).filter(t => t.TypeID !== id);
  if (others.some(t => String(t.Name).toLowerCase() === name.toLowerCase())) bad('There is already a type called ' + name + '.');
  const route = ROUTES.includes(d.route) ? d.route : bad('Choose where the request goes: to its handler, or to the line manager first.');
  const days = d.answerDays === '' || d.answerDays == null ? null : Number(d.answerDays);
  if (days != null && !(Number.isInteger(days) && days >= 1 && days <= 365)) bad('Answer within: a number of days from 1 to 365, or blank.');
  const companyIds = [...new Set((Array.isArray(d.companyIds) ? d.companyIds : []).map(c => text(c, 80)).filter(Boolean))];
  const stranger = companyIds.find(c => !userCanAccessCompany(user.profile, c));
  if (stranger) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  const raw = Array.isArray(d.fields) ? d.fields : [];
  if (raw.length > MAX_FIELDS) bad('At most ' + MAX_FIELDS + ' fields.');
  const keys = new Set();
  const fields = raw.map((f, i) => {
    const label = text(f.Label, 80);
    if (!label) bad('Field ' + (i + 1) + ' needs a label.');
    const kind = KINDS.includes(f.Kind) ? f.Kind : bad(label + ': choose what kind of field it is.');
    let key = text(f.Key, 40) || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field' + (i + 1);
    while (keys.has(key)) key += '-' + (i + 1);
    keys.add(key);
    const options = kind === 'choice' ? [...new Set((f.Options || []).map(o => text(o, 80)).filter(Boolean))] : [];
    if (kind === 'choice' && options.length < 2) bad(label + ': a choice needs at least two options.');
    if (options.length > MAX_OPTIONS) bad(label + ': at most ' + MAX_OPTIONS + ' options.');
    return { Key: key, Label: label, Kind: kind, Required: f.Required === true, Options: options };
  });
  const out = { Name: name, Description: text(d.description, 500), Fields: fields, Route: route, AnswerDays: days, DocumentAnswer: d.documentAnswer === true,
    CompanyIDs: companyIds, Active: d.active !== false, UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.fullName || user.profile.username || user.uid };
  if (id) {
    if (!(await typeOf(id))) throw new HttpsError('not-found', 'Request type not found.');
    await TYPES().doc(id).set(out, { merge: true });
    return { success: true, typeId: id };
  }
  const ref = await TYPES().add(Object.assign(out, { CreatedAt: out.UpdatedAt }));
  return { success: true, typeId: ref.id };
}

// ---------- a request of a type (the portal) ----------

// The answers checked against the type's fields. Files are attached after
// the request is sent (the portal uploads them as for any request), so a
// required file field is checked by the portal.
function answersFor(type, values) {
  const v = values || {};
  return (type.Fields || []).filter(f => f.Kind !== 'file').map(f => {
    let x = v[f.Key];
    if (f.Kind === 'yesno') x = x === true || x === 'Yes' ? 'Yes' : (x === false || x === 'No' ? 'No' : '');
    else x = text(x, f.Kind === 'longtext' ? 2000 : 200);
    if (!x) { if (f.Required) bad('Fill in ' + f.Label + '.'); return { Key: f.Key, Label: f.Label, Kind: f.Kind, Value: '' }; }
    if (f.Kind === 'number' && !Number.isFinite(Number(String(x).replace(/,/g, '')))) bad(f.Label + ' is a number.');
    if (f.Kind === 'date' && !isDate(x)) bad(f.Label + ' is a date.');
    if (f.Kind === 'choice' && !f.Options.includes(x)) bad('Choose ' + f.Label + ' from its list.');
    return { Key: f.Key, Label: f.Label, Kind: f.Kind, Value: x };
  });
}
// When it is due: the type's days from the day it reached its handler (Q307).
const dueFrom = (type, day) => (type.AnswerDays ? addDays(day, type.AnswerDays) : '');

module.exports = { allTypes, typesFor, typeOf, saveType, answersFor, dueFrom, today, KINDS, ROUTES };
