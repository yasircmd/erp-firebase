// Module Builder, phase 4 (owner, 2026-11-12; docs/modules/MODULE_BUILDER.md,
// Q481-Q488): the variant a request runs in. New development, hand-written.
//
// A call from a variant's screen carries its id (data.__variant); callable.js
// checks it is a published variant and runs the handler inside it. For that
// request only, and only for the variant's original module:
//   - auth.moduleHasCapability answers with the variant's own rights (Q484);
//   - numbering.voucherNumber gives the variant's own series (Q482);
//   - approvals.beginApprovalInstance asks the variant's own approvers (Q485).
// Every other module keeps its own rights in the same request (a Room Invoice's
// posting still needs nothing else's rights it didn't need before). Its own
// module (AsyncLocalStorage, per request), with nothing required, so every
// callable doesn't depend on the builder's code.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();
// v: { id, base, label, prefix } or null.
const runWithVariant = (v, fn) => (v ? store.run(Object.freeze(Object.assign({}, v)), fn) : fn());
const current = () => store.getStore() || null;
// The variant, when the request runs in one of `base`'s.
const forBase = base => { const v = current(); return v && v.base === base ? v : null; };

module.exports = { runWithVariant, current, forBase };
