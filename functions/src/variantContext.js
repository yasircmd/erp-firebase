// Module Builder, phase 4 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q481-Q488): the variant a request runs in. New development, hand-written.
//
// A call from a variant's screen carries its id (data.__variant); callable.js
// checks it is a published variant and runs the handler inside it. For that
// request only, and only for the variant's original module:
//   - auth.moduleHasCapability answers with the variant's own rights (Q484);
//   - numbering.voucherNumber gives the variant's own series (Q482);
//   - approvals.beginApprovalInstance asks the variant's own approvers (Q485).
// Every other module keeps its own rights in the same request.
//
// A call from the original's own screen (its own rights, Q486) on a variant's
// document: when the request opens that document by its id
// (variantDocuments.noteRead), the request notes the document's variant, so
// posting it still takes the variant's series and approvers. Its rights stay
// the user's own (the original's).
//
// Its own module (AsyncLocalStorage, per request), with nothing required, so
// every callable doesn't depend on the builder's code.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();
// Every request runs with its holder: { variant (named by the call), doc (noted from a document read) }.
// v: { id, base, label, prefix, fields } or null.
const runWithVariant = (v, fn) => store.run({ variant: v ? Object.freeze(Object.assign({}, v)) : null, doc: null }, fn);
const holder = () => store.getStore() || null;
const current = () => { const h = holder(); return h ? h.variant : null; };
// The variant named by the call, when it is one of `base`'s (rights, documents, extra fields).
const forBase = base => { const v = current(); return v && v.base === base ? v : null; };
// The variant whose series and approvers `base`'s document takes: the one named, else the one noted.
const seriesFor = base => { const h = holder(); if (!h) return null; const v = h.variant || h.doc; return v && v.base === base ? v : null; };
// A variant's document read in a request that names no variant (the first one counts).
const noteDocument = v => { const h = holder(); if (h && !h.variant && !h.doc && v) h.doc = Object.freeze(Object.assign({}, v)); };

module.exports = { runWithVariant, current, forBase, seriesFor, noteDocument };
