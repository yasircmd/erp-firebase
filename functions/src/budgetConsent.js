// The budget overrun a user chose to go ahead with, for this request
// (docs/modules/BUDGET.md, step B3): the request's budgetConsent { go,
// reason }, carried as the period lock's consent is (callable.js), so the
// spending check (budgetCheck.js) sees it several calls deep. Its own
// module, with nothing required, so every callable doesn't depend on the
// budget's code.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();
const runWithBudgetConsent = (c, fn) => store.run({ go: Boolean(c && c.go === true), reason: String((c && c.reason) || '').trim().slice(0, 300) }, fn);
const consent = () => store.getStore() || { go: false, reason: '' };

module.exports = { runWithBudgetConsent, consent };
