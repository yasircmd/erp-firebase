// UAE e-invoicing, ready to send (owner, 2026-10-16; docs/modules/
// E_INVOICING.md, decisions 225-229). New development, hand-written.
//
// Per company, in Sales Invoice Configuration: on / off, the date it starts
// and the Accredited Service Provider (ASP) once chosen. For a company with
// it on, posting a Customer Invoice (or a Sales Return: a credit note)
// builds its PINT AE document (eInvoiceDocument.js), checks it is complete
// and stores it with its status. Sending goes through one connector
// (eInvoiceConnector.js), plugged in for the ASP once one is chosen; until
// then nothing is sent (decision 226).
//
//   eInvoiceSettings/{companyId} { Enabled, StartDate, AspName, UpdatedAt, UpdatedBy }
//   eInvoices/{Kind}_{sourceId}  { Kind, SourceID, Number, CompanyID, CustomerID, Date, Currency, Total,
//                                  Status: Ready | NotReady | NotApplicable, Issues, Xml,
//                                  SendStatus: NotSent | Sent | Rejected, SendNote, BuiltAt }
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { onCallWithMessages } = require('./callable');
const { rtdb } = require('./firebaseAdmin');
const { requireUser, moduleHasCapability } = require('./auth');
const { userCanAccessCompany } = require('./glWriting');
const E = require('./eInvoiceDocument');

const onCallOptions = { region: 'us-central1' };
const SETTINGS = 'eInvoiceSettings';
const DOCS = 'eInvoices';
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 120);
const val = async p => (await rtdb.ref(p).get()).val();
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + (Number(n) || 0)); return t.toISOString().slice(0, 10); };
const KINDS = { Invoice: { module: 'CUSTOMERINVOICE' }, CreditNote: { module: 'SALESRETURN' } };

async function settingsOf(companyId) { return (await val(SETTINGS + '/' + companyId)) || { Enabled: false, StartDate: '', AspName: '' }; }

// The document's lines, from the posted record.
function linesOf(kind, doc) {
  if (kind === 'CreditNote') return (doc.Lines || []).map(l => ({ Description: l.ItemName || l.ItemCode || '', Quantity: Number(l.Quantity) || 0, UnitPrice: Number(l.UnitPrice) || 0, Amount: Math.round((Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0) * 100) / 100 }));
  const out = [];
  (doc.SourceDeliveryNotes || []).forEach(dn => (dn.Lines || []).forEach(l => out.push({ Description: l.ItemCode || dn.DeliveryNoteNumber || '', Quantity: l.Quantity, UnitPrice: l.UnitPrice, Amount: Math.round(l.Quantity * l.UnitPrice * 100) / 100 })));
  (doc.ItemLines || []).forEach(l => out.push({ Description: l.Description || l.ItemCode || '', Quantity: l.Quantity, UnitPrice: l.UnitPrice, Amount: l.Amount }));
  (doc.DirectLines || []).forEach(l => out.push({ Description: l.Description || '', Quantity: 1, UnitPrice: l.Amount, Amount: l.Amount }));
  return out;
}

// Builds, checks and stores the e-invoice of a posted document, if its
// company has e-invoicing on from its date. Never throws: a posting is not
// held up by its e-invoice (its status says what is missing). Returns the
// record, or null when the company doesn't e-invoice it.
async function recordEInvoice(kind, sourceId) {
  try {
    const doc = await val(kind === 'CreditNote' ? 'stock/transactions/' + sourceId : 'customerInvoices/' + sourceId);
    if (!doc || doc.Status !== 'Posted' || doc.ReversalOfInvoiceID) return null;
    const settings = await settingsOf(doc.CompanyID);
    const date = doc.InvoiceDate || doc.TransactionDate || '';
    if (!settings.Enabled || (settings.StartDate && date < settings.StartDate)) return null;
    const [company, customer, base] = await Promise.all([val('companies/' + doc.CompanyID), val('customers/' + doc.CustomerID), require('./exchangeRates').baseCurrency()]);
    const facts = Object.assign({}, doc, {
      EInvoiceLines: linesOf(kind, doc),
      DueDate: kind === 'Invoice' ? addDays(doc.InvoiceDate, (customer || {}).PaymentTermsDays) : '',
      // A Sales Return's figures in invoice terms (its credit note).
      Subtotal: kind === 'CreditNote' ? doc.ReturnValue : doc.Subtotal, Discount: kind === 'CreditNote' ? doc.DiscountAmount : doc.Discount,
      BillingReference: kind === 'CreditNote' ? doc.SourceInvoiceNumber || '' : '',
      CurrencyCode: kind === 'CreditNote' && doc.SourceInvoiceID ? ((await val('customerInvoices/' + doc.SourceInvoiceID)) || {}).CurrencyCode || '' : doc.CurrencyCode,
      ExchangeRate: kind === 'CreditNote' && doc.SourceInvoiceID ? ((await val('customerInvoices/' + doc.SourceInvoiceID)) || {}).ExchangeRate || 1 : doc.ExchangeRate
    });
    const d = E.documentOf(kind, facts, company || {}, customer || {}, base.Code || 'AED');
    const r = E.readiness(d);
    const rec = {
      Kind: kind, SourceID: sourceId, Number: d.number, CompanyID: doc.CompanyID, CustomerID: doc.CustomerID || '', Date: d.date,
      Currency: d.currency, Total: d.total, Status: r.status, Issues: r.issues, Xml: r.status === 'NotApplicable' ? '' : E.toXml(d),
      SendStatus: 'NotSent', SendNote: '', BuiltAt: new Date().toISOString()
    };
    // Sending: only through the ASP's connector, once one is plugged in.
    if (r.status === 'Ready') Object.assign(rec, await require('./eInvoiceConnector').send(rec, settings));
    await rtdb.ref(DOCS + '/' + kind + '_' + sourceId).set(rec);
    return rec;
  } catch (err) {
    console.error('e-invoice ' + kind + ' ' + sourceId + ': ' + (err && err.message));
    return null;
  }
}

async function requireCompany(user, companyId) {
  if (!companyId || !userCanAccessCompany(user.profile, companyId)) throw new HttpsError('permission-denied', 'You do not have access to that company.');
}

// Sales Invoice Configuration → E-invoicing.
exports.getEInvoiceSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('SALESINVOICESETUP', 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to Sales Invoice Configuration.');
  const co = text((request.data || {}).companyId, 80);
  await requireCompany(user, co);
  const s = await settingsOf(co);
  const company = (await val('companies/' + co)) || {};
  return { Enabled: Boolean(s.Enabled), StartDate: s.StartDate || '', AspName: s.AspName || '', CompanyTrn: E.companyTrn(company),
    CompanyTrnValid: E.isTrn(E.companyTrn(company)), Connector: require('./eInvoiceConnector').NAME,
    canWrite: await moduleHasCapability('SALESINVOICESETUP', 'write', user.profile.role) };
});

exports.saveEInvoiceSettings = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  if (!(await moduleHasCapability('SALESINVOICESETUP', 'write', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have permission to change Sales Invoice Configuration.');
  const d = request.data || {};
  const co = text(d.companyId, 80);
  await requireCompany(user, co);
  const enabled = d.enabled === true;
  const start = text(d.startDate, 10);
  if (enabled && !isDate(start)) throw new HttpsError('invalid-argument', 'Enter the date e-invoicing starts.');
  if (start && !isDate(start)) throw new HttpsError('invalid-argument', 'Enter the start date as a date.');
  await rtdb.ref(SETTINGS + '/' + co).set({ Enabled: enabled, StartDate: start, AspName: text(d.aspName, 120), UpdatedAt: new Date().toISOString(), UpdatedBy: user.profile.username || user.uid });
  return { success: true };
});

// A document's e-invoice (its status, what is missing, and the XML), and
// "Check again" after the missing data is fixed.
async function readable(user, kind, id) {
  const cfg = KINDS[kind];
  if (!cfg) throw new HttpsError('invalid-argument', 'Unknown document.');
  if (!(await moduleHasCapability(cfg.module, 'access', user.profile.role))) throw new HttpsError('permission-denied', 'You do not have access to that document.');
  const doc = await val(kind === 'CreditNote' ? 'stock/transactions/' + id : 'customerInvoices/' + id);
  if (!doc) throw new HttpsError('not-found', 'Document not found.');
  await requireCompany(user, doc.CompanyID);
  return doc;
}
exports.getEInvoice = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const kind = text(d.kind, 20), id = text(d.id, 80);
  const doc = await readable(user, kind, id);
  const rec = await val(DOCS + '/' + kind + '_' + id);
  const s = await settingsOf(doc.CompanyID);
  return { enabled: Boolean(s.Enabled), record: rec || null };
});
exports.rebuildEInvoice = onCallWithMessages(onCallOptions, async (request) => {
  const user = await requireUser(request);
  const d = request.data || {};
  const kind = text(d.kind, 20), id = text(d.id, 80);
  const doc = await readable(user, kind, id);
  if (doc.Status !== 'Posted') throw new HttpsError('failed-precondition', 'Only a posted document has an e-invoice.');
  const prev = await val(DOCS + '/' + kind + '_' + id);
  if (prev && prev.SendStatus === 'Sent') throw new HttpsError('failed-precondition', 'This e-invoice has been sent: correct it with a credit note.');
  const rec = await recordEInvoice(kind, id);
  if (!rec) throw new HttpsError('failed-precondition', 'E-invoicing is not on for this company on the document\'s date (Sales Invoice Configuration).');
  return { success: true, record: rec };
});

module.exports = Object.assign(exports, { recordEInvoice, settingsOf, linesOf });
