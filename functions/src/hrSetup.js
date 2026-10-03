// HR Setup (owner, 2026-10-03; docs/modules/HR_EMPLOYEES.md): the masters
// the employee record uses.
//   - Grades: one ladder for the group (code, name, level), each company
//     with its own pay band (min / mid / max monthly basic) (decision 2).
//   - Designations (job titles): the grade range they normally carry.
//   - Employee fields (flexi columns, owner point 1): date, text or amount,
//     compulsory or optional, a section of the form, sensitive or not.
//   - Employee document types: whether they have a number and an expiry.
// All in Firestore, read and written through these functions only.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');

const onCallOptions = { region: 'us-central1' };
const GRADES = () => firestore.collection('hrGrades');
const DESIGNATIONS = () => firestore.collection('hrDesignations');
const FIELDS = () => firestore.collection('hrFields');
const DOC_TYPES = () => firestore.collection('hrDocumentTypes');
const FIELD_TYPES = ['date', 'text', 'amount'];
const SECTIONS = ['Personal', 'Employment', 'Other'];
const START_DOC_TYPES = [
  ['Passport', true, true], ['Emirates ID', true, true], ['Visa / Residence', true, true], ['Labour Card', true, true],
  ['Education Certificate', false, false], ['Experience Certificate', false, false], ['Employment Contract', false, true], ['Other', false, false]
];

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const norm = v => text(v).toLowerCase();
const money = v => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

async function canSetup(user, cap) { return moduleHasCapability('HRSETUP', cap, user.profile.role); }
async function requireSetupWrite(user) {
  if (!(await canSetup(user, 'write'))) throw new HttpsError('permission-denied', 'You do not have permission to change HR Setup.');
}
// The setup is read by HR Setup and by Employees (its lists and fields).
async function requireSetupRead(user) {
  if (await canSetup(user, 'access')) return;
  if (await moduleHasCapability('EMPLOYEES', 'access', user.profile.role)) return;
  throw new HttpsError('permission-denied', 'You do not have access to HR Setup.');
}

const all = async col => (await col().get()).docs.map(d => Object.assign({ _id: d.id }, d.data()));

async function docTypes() {
  let list = await all(DOC_TYPES);
  if (!list.length) {
    const batch = firestore.batch();
    START_DOC_TYPES.forEach(([name, num, exp], i) => batch.set(DOC_TYPES().doc('dt-' + String(i + 1).padStart(2, '0')),
      { Name: name, HasNumber: num, HasExpiry: exp, Active: true, Sort: i + 1 }));
    await batch.commit();
    list = await all(DOC_TYPES);
  }
  return list.map(x => Object.assign({ DocumentTypeID: x._id }, x)).sort((a, b) => (a.Sort || 999) - (b.Sort || 999));
}

// Everything the screens need, in one call.
async function loadSetup() {
  const [grades, designations, fields, types] = await Promise.all([all(GRADES), all(DESIGNATIONS), all(FIELDS), docTypes()]);
  return {
    grades: grades.map(g => Object.assign({ GradeID: g._id }, g, { Bands: g.Bands || {} })).sort((a, b) => (a.Level - b.Level) || a.Code.localeCompare(b.Code)),
    designations: designations.map(d => Object.assign({ DesignationID: d._id }, d)).sort((a, b) => a.Title.localeCompare(b.Title)),
    fields: fields.map(f => Object.assign({ FieldID: f._id }, f)).sort((a, b) => SECTIONS.indexOf(a.Section) - SECTIONS.indexOf(b.Section) || (a.Sort || 0) - (b.Sort || 0) || a.Label.localeCompare(b.Label)),
    documentTypes: types
  };
}

exports.getHrSetup = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetupRead(user);
  const setup = await loadSetup();
  // Pay bands: only the companies the user may see.
  setup.grades.forEach(g => {
    g.Bands = Object.fromEntries(Object.entries(g.Bands).filter(([co]) => userCanAccessCompany(user.profile, co)));
  });
  return Object.assign(setup, { canWrite: await canSetup(user, 'write'), fieldTypes: FIELD_TYPES, sections: SECTIONS });
});

// ---------- grades ----------

exports.saveHrGrade = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetupWrite(user);
  const g = (request.data || {}).grade || {};
  const out = { Code: text(g.Code, 20), Name: text(g.Name, 80), Level: Number(g.Level), Active: g.Active !== false };
  if (!out.Code) throw new HttpsError('invalid-argument', 'Enter the grade code.');
  if (!Number.isInteger(out.Level) || out.Level < 1 || out.Level > 99) throw new HttpsError('invalid-argument', 'The level is a whole number from 1 to 99 (higher is more senior).');
  const grades = await all(GRADES);
  if (grades.some(x => x._id !== g.GradeID && norm(x.Code) === norm(out.Code))) throw new HttpsError('already-exists', 'Grade code "' + out.Code + '" is already in use.');
  const existing = g.GradeID ? grades.find(x => x._id === g.GradeID) : null;
  if (g.GradeID && !existing) throw new HttpsError('not-found', 'Grade not found.');
  // Bands: per company; other companies' bands stay as they are.
  const bands = Object.assign({}, (existing && existing.Bands) || {});
  for (const [co, b] of Object.entries(g.Bands || {})) {
    if (!userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
    if (!(await rtdb.ref('companies/' + co).get()).exists()) throw new HttpsError('invalid-argument', 'Company not found.');
    const min = money(b && b.Min), mid = money(b && b.Mid), max = money(b && b.Max);
    if ([min, mid, max].every(v => v === null)) { delete bands[co]; continue; }
    if ([min, mid, max].some(v => v === null || isNaN(v) || v < 0)) throw new HttpsError('invalid-argument', 'Enter the minimum, midpoint and maximum basic as amounts (0 or more).');
    if (!(min <= mid && mid <= max)) throw new HttpsError('invalid-argument', 'The pay band must run minimum ≤ midpoint ≤ maximum.');
    bands[co] = { Min: min, Mid: mid, Max: max };
  }
  out.Bands = bands;
  if (existing) { await GRADES().doc(existing._id).set(out); return { success: true, gradeId: existing._id }; }
  const ref = await GRADES().add(out);
  return { success: true, gradeId: ref.id };
});

// ---------- designations ----------

exports.saveHrDesignation = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetupWrite(user);
  const d = (request.data || {}).designation || {};
  const out = { Title: text(d.Title, 100), GradeFromID: text(d.GradeFromID, 80), GradeToID: text(d.GradeToID, 80), Active: d.Active !== false };
  if (!out.Title) throw new HttpsError('invalid-argument', 'Enter the designation.');
  const [list, grades] = await Promise.all([all(DESIGNATIONS), all(GRADES)]);
  if (list.some(x => x._id !== d.DesignationID && norm(x.Title) === norm(out.Title))) throw new HttpsError('already-exists', 'There is already a designation "' + out.Title + '".');
  const gFrom = out.GradeFromID ? grades.find(x => x._id === out.GradeFromID) : null;
  const gTo = out.GradeToID ? grades.find(x => x._id === out.GradeToID) : null;
  if ((out.GradeFromID && !gFrom) || (out.GradeToID && !gTo)) throw new HttpsError('invalid-argument', 'Grade not found.');
  if (gFrom && gTo && gFrom.Level > gTo.Level) throw new HttpsError('invalid-argument', 'The grade range runs from the lower grade to the higher one.');
  if (d.DesignationID) {
    if (!list.some(x => x._id === d.DesignationID)) throw new HttpsError('not-found', 'Designation not found.');
    await DESIGNATIONS().doc(d.DesignationID).set(out);
    return { success: true, designationId: d.DesignationID };
  }
  const ref = await DESIGNATIONS().add(out);
  return { success: true, designationId: ref.id };
});

// ---------- employee fields (flexi columns) ----------

exports.saveHrField = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetupWrite(user);
  const f = (request.data || {}).field || {};
  const out = {
    Label: text(f.Label, 60), Type: text(f.Type, 10), Required: f.Required === true, Section: text(f.Section, 20) || 'Other',
    Sort: Number(f.Sort) || 0, Sensitive: f.Sensitive === true, Active: f.Active !== false
  };
  if (!out.Label) throw new HttpsError('invalid-argument', 'Enter the field\'s name.');
  if (!FIELD_TYPES.includes(out.Type)) throw new HttpsError('invalid-argument', 'The type is date, text or amount.');
  if (!SECTIONS.includes(out.Section)) throw new HttpsError('invalid-argument', 'Unknown section.');
  const list = await all(FIELDS);
  if (list.some(x => x._id !== f.FieldID && norm(x.Label) === norm(out.Label))) throw new HttpsError('already-exists', 'There is already a field "' + out.Label + '".');
  if (f.FieldID) {
    const cur = list.find(x => x._id === f.FieldID);
    if (!cur) throw new HttpsError('not-found', 'Field not found.');
    if (cur.Type !== out.Type) {
      // Values already entered would no longer fit their type.
      const used = (await firestore.collection('employees').get()).docs.some(e => { const v = (e.data().Custom || {})[f.FieldID]; return v !== undefined && v !== '' && v !== null; });
      if (used) throw new HttpsError('failed-precondition', 'Employees already have values in "' + cur.Label + '": its type can\'t change. Add a new field instead.');
    }
    await FIELDS().doc(f.FieldID).set(out);
    return { success: true, fieldId: f.FieldID };
  }
  const ref = await FIELDS().add(out);
  return { success: true, fieldId: ref.id };
});

// ---------- employee document types ----------

exports.saveHrDocumentType = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  await requireSetupWrite(user);
  const t = (request.data || {}).documentType || {};
  const out = { Name: text(t.Name, 60), HasNumber: t.HasNumber === true, HasExpiry: t.HasExpiry === true, Active: t.Active !== false };
  if (!out.Name) throw new HttpsError('invalid-argument', 'Enter the document type.');
  const list = await docTypes();
  if (list.some(x => x.DocumentTypeID !== t.DocumentTypeID && norm(x.Name) === norm(out.Name))) throw new HttpsError('already-exists', 'There is already a document type "' + out.Name + '".');
  if (t.DocumentTypeID) {
    const cur = list.find(x => x.DocumentTypeID === t.DocumentTypeID);
    if (!cur) throw new HttpsError('not-found', 'Document type not found.');
    await DOC_TYPES().doc(t.DocumentTypeID).set(Object.assign(out, { Sort: cur.Sort || 0 }));
    return { success: true, documentTypeId: t.DocumentTypeID };
  }
  const ref = await DOC_TYPES().add(Object.assign(out, { Sort: list.length + 1 }));
  return { success: true, documentTypeId: ref.id };
});

module.exports.loadSetup = loadSetup;
module.exports.FIELD_TYPES = FIELD_TYPES;
