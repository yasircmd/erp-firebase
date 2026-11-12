// Module Builder, phase 4 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q483, Q486): a variant's documents, kept with the original's. New
// development, hand-written.
//
// In a variant's request (variantContext.js), on its original's own store
// only:
//   - a document opened by its id is the variant's, or none (Q486: someone
//     with only Room Invoice rights opens only Room Invoices);
//   - the whole store, read for its list, is the variant's documents;
//   - a document written is marked Variant, with the variant's extra fields
//     (VariantFields, checked by their types) when the call sends them.
// Outside a variant's request nothing changes: the original's screen, with
// the original's rights, sees every document, the variants' included.
// Queries (a customer's open invoices for the credit check, a party's open
// items) are never narrowed: they see every document, as before.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const V = require('./variantContext');

// The store each original keeps its documents in (movedPaths' path, or the collection).
const STORE_OF = Object.freeze({ CUSTOMERINVOICE: 'customerInvoices', VENDORINVOICE: 'vendorInvoices', SALESORDER: 'salesOrders', JV: 'journalEntries', QUOTATION: 'quotations' });
const BASE_OF = Object.freeze(Object.fromEntries(Object.entries(STORE_OF).map(([b, s]) => [s, b])));

// The variant, when the request runs in the variant of the original keeping `store`.
const variantFor = store => (BASE_OF[store] ? V.forBase(BASE_OF[store]) : null);
const own = (v, doc) => Boolean(doc && doc.Variant === v.id);

// A document read by its id: itself, or null when it isn't the variant's.
function guardDoc(store, doc) {
  const v = variantFor(store);
  return !v || doc == null ? doc : own(v, doc) ? doc : null;
}
// A whole store (an { id: doc } map or a list): only the variant's documents.
function guardAll(store, all) {
  const v = variantFor(store);
  if (!v || all == null) return all;
  if (Array.isArray(all)) return all.filter(d => own(v, d));
  return Object.fromEntries(Object.entries(all).filter(([, d]) => own(v, d)));
}
// Before changing or deleting a document by its id: refused when it isn't the variant's.
function assertOwn(store, doc) {
  const v = variantFor(store);
  if (v && doc && !own(v, doc)) throw new HttpsError('permission-denied', 'That document is not a ' + v.label + '.');
}

// The variant's marks for a document written in its request: { Variant,
// VariantFields? }, or {} outside one. The extra fields are checked by the
// variant's definition (types, required, a link from its choices for the
// document's company).
async function marksFor(store, companyId) {
  const v = variantFor(store);
  if (!v) return {};
  const out = { Variant: v.id };
  if (v.fields && typeof v.fields === 'object') {
    const def = await require('./builtDefinitions').publishedDef(v.id);
    const BM = require('./builtModules');
    const links = {};
    for (const t of [...new Set(def.fields.filter(f => f.type === 'link').map(f => f.target))]) links[t] = await BM.linkOptions(t, companyId || '', { profile: {} });
    out.VariantFields = BM.cleanFields(def.fields, v.fields, { links }, '');
  }
  return out;
}

module.exports = { STORE_OF, BASE_OF, variantFor, guardDoc, guardAll, assertOwn, marksFor };
