// The sales rep on a customer and on the sales documents (owner,
// 2026-11-08; docs/modules/MIS.md, phase 1c, Q435-Q438). New development,
// hand-written.
//
// A customer's rep is set in the Customer Master (Q435), as the existing
// customers/{id}.SalesRepEmployeeID the Employee Portal reads. A Quotation,
// Sales Order, Delivery Note, Customer Invoice, Sales Return or Retail Sale
// carries its own SalesRepEmployeeID (Q437): a new document takes the
// customer's rep, a document made from another takes that one's, and the
// user may change it while the document is a draft (Q436). Changing a
// customer's rep leaves the documents already made as they are (Q438).
//
// The rule on a value: '' (no rep) or an ACTIVE rep of the document's
// company (salesReps/{employeeId}, Sales Invoice Configuration → Sales reps).
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb, firestore } = require('./firebaseAdmin');
const { requireUser } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');

const REPS = 'salesReps';
const text = v => String(v == null ? '' : v).trim().slice(0, 80);
const val = async p => (await rtdb.ref(p).get()).val();
const NOT_A_REP = 'The sales rep must be an active sales rep of the company (Sales Invoice Configuration → Sales reps).';

// Checked: '' or the id of an active rep of the company. companyId '' (a
// customer of every company): any active rep.
async function checkRep(employeeId, companyId) {
  const id = text(employeeId);
  if (!id) return '';
  const r = await val(REPS + '/' + id);
  if (!r || r.Active === false || (companyId && r.CompanyID !== companyId)) throw new Error(NOT_A_REP);
  return id;
}

// A customer's rep ('' when none or the customer is unknown).
async function customerRep(customerId) {
  const id = text(customerId);
  return id ? text(await val('customers/' + id + '/SalesRepEmployeeID')) : '';
}

// The rep of the document a new one is made from: a Sales Order, a
// Delivery Note, a Customer Invoice or a Quotation (undefined when there is
// none or it has no rep field: older documents).
async function sourceRep({ soId, dnId, invoiceId, quotationId } = {}) {
  let d = null;
  if (text(dnId)) d = await require('./stockStore').getTx(text(dnId));
  else if (text(soId)) d = await require('./salesStore').salesOrders.get(text(soId));
  else if (text(invoiceId)) d = await require('./salesStore').customerInvoices.get(text(invoiceId));
  else if (text(quotationId)) d = (await firestore.collection('quotations').doc(text(quotationId)).get()).data() || null;
  return d && d.SalesRepEmployeeID !== undefined ? text(d.SalesRepEmployeeID) : undefined;
}

// A document's rep, as saved. `given` is what the screen sent; undefined
// (a caller that doesn't know the field: an import, an older screen, a
// document made by the system) takes, in turn, the draft's own rep
// (`existing`), the source document's (`source`: { soId, dnId, invoiceId,
// quotationId }), else the customer's. '' is "no rep", chosen by the user.
// A default no longer valid (the rep left, or is of another company) is
// dropped rather than refusing the save; a rep the user chose is checked.
async function documentRep(given, companyId, { customerId, existing, source } = {}) {
  if (given !== undefined && given !== null) return checkRep(given, companyId);
  let f = existing && existing.SalesRepEmployeeID !== undefined ? existing.SalesRepEmployeeID : undefined;
  if (f === undefined && source) f = await sourceRep(source);
  if (f === undefined) f = await customerRep(customerId);
  try { return await checkRep(f, companyId); } catch (e) { return ''; }
}

// An invoice's source for its rep: its first Delivery Note, else the
// Sales Order of its first item line from an order.
const invoiceRepSource = (dns, itemLines) => ({ dnId: ((dns || [])[0] || {}).DeliveryNoteID, soId: ((itemLines || []).find(l => l && l.SourceSOID) || {}).SourceSOID });

// The customer master's field: only when the screen sent it, so an import
// or an older caller leaves the rep as it is.
async function customerRepField(data, companyId) {
  if (!data || data.SalesRepEmployeeID === undefined) return {};
  return { SalesRepEmployeeID: await checkRep(data.SalesRepEmployeeID, companyId) };
}

// The choices for a rep picker: the company's active reps, by name (and,
// given customerId, that customer's rep).
// Anyone who can work in the company may list them (names and codes only).
const choices = onCallWithMessages({ region: 'us-central1' }, async (request) => {
  const user = await requireUser(request);
  const co = text((request.data || {}).companyId);
  if (co && !userCanAccessCompany(user.profile, co)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
  // With a customer: its rep too, the default of a new document (Q436).
  const cu = text((request.data || {}).customerId);
  const extra = cu ? { customerRep: await customerRep(cu) } : {};
  const reps = (await val(REPS)) || {};
  const ids = Object.keys(reps).filter(id => reps[id].Active !== false && (!co || reps[id].CompanyID === co));
  if (!ids.length) return Object.assign({ reps: [] }, extra);
  const emps = await firestore.getAll(...ids.map(id => firestore.collection('employees').doc(id)));
  return Object.assign({ reps: ids.map((id, i) => ({ EmployeeID: id, RepCode: reps[id].RepCode || '', Name: (emps[i].exists && emps[i].data().FullName) || id, CompanyID: reps[id].CompanyID || '' }))
    .sort((a, b) => a.Name.localeCompare(b.Name)) }, extra);
});

module.exports = { checkRep, customerRep, sourceRep, documentRep, invoiceRepSource, customerRepField, getSalesRepChoices: choices, NOT_A_REP };
